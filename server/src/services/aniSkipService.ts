import type { SkipSegment } from '../../../shared/contracts.js'
import type { AppEnv } from '../env.js'
import { AniFlowDatabase } from '../lib/database.js'
import { normalizeTitle } from '../lib/utils.js'

interface AniSkipSearchResponse {
  data?: {
    searchShows?: Array<{ id: string; name: string; originalName?: string | null }>
  }
}

interface AniSkipEpisode {
  id: string
  number?: string | null
  name?: string | null
  baseDuration?: number | null
}

interface AniSkipEpisodesResponse {
  data?: {
    findEpisodesByShowId?: AniSkipEpisode[]
  }
}

interface AniSkipTimestamp {
  at: number
  type: { name: string }
}

interface AniSkipTimestampsResponse {
  data?: {
    findTimestampsByEpisodeId?: AniSkipTimestamp[]
  }
}

export class AniSkipService {
  constructor(
    private readonly env: AppEnv,
    private readonly database: AniFlowDatabase,
  ) {}

  async getSegments(showTitle: string, episodeNumber: string, fallbackDuration: number | null): Promise<SkipSegment[]> {
    const cacheKey = `aniskip:v2:${normalizeTitle(showTitle)}:${episodeNumber}`
    const cached = this.database.getCachedJson<SkipSegment[]>(cacheKey)
    if (cached) {
      return cached
    }

    const showIds = await this.findShowIds(showTitle)
    let bestSegments: SkipSegment[] = []
    let bestScore = -1

    for (const showId of showIds) {
      const episodes = await this.getEpisodes(showId)
      const matches = this.rankEpisodeCandidates(episodes, episodeNumber)

      for (const episode of matches.slice(0, 6)) {
        const timestamps = await this.getTimestamps(episode.id)
        const totalDuration = fallbackDuration ?? episode.baseDuration ?? 0
        const segments = this.buildSegments(timestamps, totalDuration)
        const score = this.scoreSegments(segments, totalDuration)

        if (score > bestScore) {
          bestSegments = segments
          bestScore = score
        }

        if (score >= 10) {
          break
        }
      }

      if (bestScore >= 10) {
        break
      }
    }

    this.database.setCachedJson(cacheKey, bestSegments, 1000 * 60 * 60 * 24)
    return bestSegments
  }

  private async findShowIds(showTitle: string): Promise<string[]> {
    const response = await this.query<AniSkipSearchResponse>(
      `query ($search: String!, $limit: Int) {
        searchShows(search: $search, limit: $limit) {
          id
          name
          originalName
        }
      }`,
      { search: showTitle, limit: 6 },
    )

    const normalizedQuery = normalizeTitle(showTitle)
    const candidates = response.data?.searchShows ?? []
    return candidates
      .map((candidate) => {
        const normalizedCandidate = normalizeTitle(candidate.name)
        let score = 0
        if (normalizedCandidate === normalizedQuery) {
          score += 3
        }
        if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
          score += 2
        }
        if (normalizeTitle(candidate.originalName ?? '').includes(normalizedQuery)) {
          score += 1
        }
        return { id: candidate.id, score }
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((candidate) => candidate.id)
  }

  private async getEpisodes(showId: string): Promise<AniSkipEpisode[]> {
    const response = await this.query<AniSkipEpisodesResponse>(
      `query ($showId: ID!) {
        findEpisodesByShowId(showId: $showId) {
          id
          number
          name
          baseDuration
        }
      }`,
      { showId },
    )

    return response.data?.findEpisodesByShowId ?? []
  }

  private async getTimestamps(episodeId: string): Promise<AniSkipTimestamp[]> {
    const response = await this.query<AniSkipTimestampsResponse>(
      `query ($episodeId: ID!) {
        findTimestampsByEpisodeId(episodeId: $episodeId) {
          at
          type {
            name
          }
        }
      }`,
      { episodeId },
    )

    return response.data?.findTimestampsByEpisodeId ?? []
  }

  private rankEpisodeCandidates(episodes: AniSkipEpisode[], episodeNumber: string): AniSkipEpisode[] {
    const normalizedEpisodeNumber = normalizeTitle(episodeNumber)
    return episodes
      .filter((episode) => episode.number === episodeNumber || episode.name === episodeNumber)
      .map((episode) => {
        let score = 0
        if (episode.number === episodeNumber) {
          score += 4
        }
        if ((episode.name ?? '').trim() && normalizeTitle(episode.name ?? '') !== normalizedEpisodeNumber) {
          score += 1
        }
        if (episode.baseDuration && episode.baseDuration > 300) {
          score += 1
        }
        return { episode, score }
      })
      .sort((left, right) => right.score - left.score)
      .map(({ episode }) => episode)
  }

  private mapTimestampType(name: string | null | undefined): string | null {
    if (!name) {
      return null
    }

    const value = name.toLowerCase()
    if (value.includes('intro')) {
      return 'Skip intro'
    }
    if (value.includes('credits') || value.includes('outro') || value.includes('ending') || value.includes('preview')) {
      return 'Skip outro'
    }
    if (value.includes('recap')) {
      return 'Skip recap'
    }
    return null
  }

  private buildSegments(timestamps: AniSkipTimestamp[], totalDuration: number): SkipSegment[] {
    const ordered = [...timestamps].sort((left, right) => left.at - right.at)
    const segments: SkipSegment[] = []

    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index]
      const label = this.mapTimestampType(current.type.name)
      if (!label) {
        continue
      }

      const previousLabel = index > 0 ? this.mapTimestampType(ordered[index - 1].type.name) : null
      if (previousLabel === label) {
        continue
      }

      let endIndex = index + 1
      while (endIndex < ordered.length && this.mapTimestampType(ordered[endIndex].type.name) === label) {
        endIndex += 1
      }

      const rawEndTime = ordered[endIndex]?.at ?? (label === 'Skip outro' && totalDuration > 0 ? totalDuration : null)
      if (rawEndTime === null) {
        continue
      }

      const endTime = totalDuration > 0 ? Math.min(rawEndTime, totalDuration) : rawEndTime
      if (endTime <= current.at) {
        continue
      }

      segments.push({
        label,
        startTime: current.at,
        endTime,
      })
    }

    return segments
  }

  private scoreSegments(segments: SkipSegment[], totalDuration: number): number {
    if (segments.length === 0) {
      return 0
    }

    let score = segments.length * 3
    for (const segment of segments) {
      const segmentDuration = segment.endTime - segment.startTime

      if (segment.label === 'Skip intro') {
        if (segment.startTime <= 180) {
          score += 2
        }
        if (segmentDuration <= 240) {
          score += 2
        }
        if (totalDuration > 0 && segmentDuration > Math.max(360, totalDuration * 0.45)) {
          score -= 6
        }
      }

      if (segment.label === 'Skip recap') {
        if (segment.startTime <= 300) {
          score += 1
        }
        if (segmentDuration <= 240) {
          score += 1
        }
        if (totalDuration > 0 && segmentDuration > Math.max(420, totalDuration * 0.5)) {
          score -= 5
        }
      }

      if (segment.label === 'Skip outro') {
        if (totalDuration > 0 && segment.startTime >= totalDuration * 0.5) {
          score += 2
        }
        if (segmentDuration <= 360) {
          score += 1
        }
        if (totalDuration > 0 && segment.startTime < totalDuration * 0.35) {
          score -= 5
        }
      }
    }

    return score
  }

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch('https://api.anime-skip.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-ID': this.env.aniSkipClientId,
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      throw new Error(`AniSkip query failed with status ${response.status}`)
    }

    return (await response.json()) as T
  }
}
