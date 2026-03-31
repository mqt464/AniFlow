import type { SkipSegment } from '../../../shared/contracts.js'
import type { AppEnv } from '../env.js'
import { AniFlowDatabase } from '../lib/database.js'
import { normalizeTitle } from '../lib/utils.js'

interface AniSkipSearchResponse {
  data?: {
    searchShows?: Array<{ id: string; name: string; originalName?: string | null }>
  }
}

interface AniSkipEpisodesResponse {
  data?: {
    findEpisodesByShowId?: Array<{ id: string; number?: string | null; name?: string | null; baseDuration?: number | null }>
  }
}

interface AniSkipTimestampsResponse {
  data?: {
    findTimestampsByEpisodeId?: Array<{ at: number; type: { name: string } }>
  }
}

export class AniSkipService {
  constructor(
    private readonly env: AppEnv,
    private readonly database: AniFlowDatabase,
  ) {}

  async getSegments(showTitle: string, episodeNumber: string, fallbackDuration: number | null): Promise<SkipSegment[]> {
    const cacheKey = `aniskip:${normalizeTitle(showTitle)}:${episodeNumber}`
    const cached = this.database.getCachedJson<SkipSegment[]>(cacheKey)
    if (cached) {
      return cached
    }

    const showId = await this.findShowId(showTitle)
    if (!showId) {
      return []
    }

    const episodes = await this.query<AniSkipEpisodesResponse>(
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

    const episode = episodes.data?.findEpisodesByShowId?.find((entry) => entry.number === episodeNumber || entry.name === episodeNumber)
    if (!episode?.id) {
      return []
    }

    const timestamps = await this.query<AniSkipTimestampsResponse>(
      `query ($episodeId: ID!) {
        findTimestampsByEpisodeId(episodeId: $episodeId) {
          at
          type {
            name
          }
        }
      }`,
      { episodeId: episode.id },
    )

    const ordered = [...(timestamps.data?.findTimestampsByEpisodeId ?? [])].sort((left, right) => left.at - right.at)
    const totalDuration = fallbackDuration ?? episode.baseDuration ?? 0
    const segments: SkipSegment[] = []

    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index]
      const next = ordered[index + 1]
      const label = this.mapTimestampType(current.type.name)
      if (!label) {
        continue
      }

      const endTime = next?.at ?? totalDuration
      if (endTime > current.at) {
        segments.push({
          label,
          startTime: current.at,
          endTime,
        })
      }
    }

    this.database.setCachedJson(cacheKey, segments, 1000 * 60 * 60 * 24)
    return segments
  }

  private async findShowId(showTitle: string): Promise<string | null> {
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
    const best = candidates
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
      .sort((left, right) => right.score - left.score)[0]

    return best && best.score > 0 ? best.id : null
  }

  private mapTimestampType(name: string): string | null {
    const value = name.toLowerCase()
    if (value.includes('intro')) {
      return 'Skip intro'
    }
    if (value.includes('credits') || value.includes('outro')) {
      return 'Skip credits'
    }
    if (value.includes('recap')) {
      return 'Skip recap'
    }
    return null
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
