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

interface AniSkipShowCandidate {
  id: string
  score: number
}

interface RankedAniSkipEpisode {
  episode: AniSkipEpisode
  score: number
}

interface AniSkipTimestampsResponse {
  data?: {
    findTimestampsByEpisodeId?: AniSkipTimestamp[]
  }
}

interface AniSkipGraphQlError {
  message?: string
}

interface AniSkipGraphQlEnvelope {
  errors?: AniSkipGraphQlError[]
}

export class AniSkipService {
  constructor(
    private readonly env: AppEnv,
    private readonly database: AniFlowDatabase,
  ) {}

  async getSegments(
    showTitle: string,
    episodeNumber: string,
    fallbackDuration: number | null,
    alternateTitles: string[] = [],
  ): Promise<SkipSegment[]> {
    const searchTitles = buildAniSkipSearchTitles(showTitle, alternateTitles)
    const cacheKey = `aniskip:v4:${searchTitles.map((title) => normalizeTitle(title)).join('|')}:${episodeNumber}`
    const cached = this.database.getCachedJson<SkipSegment[]>(cacheKey)
    if (cached) {
      return cached
    }

    try {
      const showCandidates = await this.findShowCandidates(showTitle, alternateTitles)
      let bestSegments: SkipSegment[] = []
      let bestHasSegments = false
      let bestMetadataScore = -1
      let bestSegmentScore = -1

      for (const showCandidate of showCandidates) {
        const episodes = await this.getEpisodes(showCandidate.id)
        const matches = this.rankEpisodeCandidates(episodes, episodeNumber)

        for (const match of matches.slice(0, 6)) {
          const timestamps = await this.getTimestamps(match.episode.id)
          const totalDuration = fallbackDuration ?? match.episode.baseDuration ?? 0
          const segments = this.buildSegments(timestamps, totalDuration)
          const segmentScore = this.scoreSegments(segments, totalDuration)
          const hasSegments = segmentScore > 0
          const metadataScore = showCandidate.score + match.score * 25

          if (
            (hasSegments && !bestHasSegments) ||
            (hasSegments === bestHasSegments && metadataScore > bestMetadataScore) ||
            (hasSegments === bestHasSegments &&
              metadataScore === bestMetadataScore &&
              segmentScore > bestSegmentScore)
          ) {
            bestSegments = segments
            bestHasSegments = hasSegments
            bestMetadataScore = metadataScore
            bestSegmentScore = segmentScore
          }
        }
      }

      this.database.setCachedJson(cacheKey, bestSegments, 1000 * 60 * 60 * 24)
      return bestSegments
    } catch {
      return []
    }
  }

  private async findShowCandidates(showTitle: string, alternateTitles: string[]): Promise<AniSkipShowCandidate[]> {
    const searchTitles = buildAniSkipSearchTitles(showTitle, alternateTitles)
    const candidateScores = new Map<string, number>()

    for (let index = 0; index < searchTitles.length; index += 1) {
      const search = searchTitles[index]
      const response = await this.query<AniSkipSearchResponse>(
        `query ($search: String!, $limit: Int) {
          searchShows(search: $search, limit: $limit) {
            id
            name
            originalName
          }
        }`,
        { search, limit: 10 },
      )

      for (const candidate of response.data?.searchShows ?? []) {
        const score = scoreShowCandidate(showTitle, search, candidate) + Math.max(0, 12 - index * 2)
        const previous = candidateScores.get(candidate.id) ?? -1
        if (score > previous) {
          candidateScores.set(candidate.id, score)
        }
      }
    }

    return [...candidateScores.entries()]
      .filter(([, score]) => score >= 24)
      .sort((left, right) => right[1] - left[1])
      .map(([id, score]) => ({ id, score }))
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

  private rankEpisodeCandidates(episodes: AniSkipEpisode[], episodeNumber: string): RankedAniSkipEpisode[] {
    const normalizedEpisodeNumber = normalizeTitle(episodeNumber)
    const numericEpisodeNumber = parseNumericValue(episodeNumber)
    return episodes
      .filter((episode) => episodeMatchesNumber(episode, episodeNumber, numericEpisodeNumber))
      .map((episode) => {
        let score = 0
        if (episode.number === episodeNumber) {
          score += 4
        }
        if (numericEpisodeNumber !== null) {
          const episodeNumberValue = parseNumericValue(episode.number)
          const episodeNameValue = parseNumericValue(episode.name)
          if (episodeNumberValue === numericEpisodeNumber) {
            score += 3
          }
          if (episodeNameValue === numericEpisodeNumber) {
            score += 2
          }
        }
        if (normalizeTitle(episode.name ?? '') === normalizedEpisodeNumber) {
          score += 2
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

    const body = (await response.json()) as T & AniSkipGraphQlEnvelope
    if (body.errors?.length) {
      throw new Error(body.errors.map((error) => error.message).filter(Boolean).join('; ') || 'AniSkip query failed')
    }

    return body
  }
}

function buildAniSkipSearchTitles(showTitle: string, alternateTitles: string[]): string[] {
  const values = new Set<string>()

  const queue = [showTitle, ...alternateTitles]
    .map((value) => value.trim())
    .filter(Boolean)

  const push = (value: string) => {
    const trimmed = value.trim()
    if (trimmed) {
      values.add(trimmed)
    }
  }

  for (const value of queue) {
    push(value)
    push(value.replace(/\([^)]*\)\s*$/u, ''))
    push(value.replace(/\b(?:season|cour|part)\s+\d+\b.*$/iu, ''))
    push(value.replace(/\b\d+(?:st|nd|rd|th)\s+season\b.*$/iu, ''))

    if (value.includes(': ')) {
      push(value.split(': ')[0] ?? '')
    }

    if (value.includes(' - ')) {
      push(value.split(' - ')[0] ?? '')
    }
  }

  return [...values].slice(0, 6)
}

function scoreShowCandidate(
  showTitle: string,
  searchTitle: string,
  candidate: { name: string; originalName?: string | null },
): number {
  const normalizedShowTitle = normalizeTitle(showTitle)
  const normalizedSearchTitle = normalizeTitle(searchTitle)
  const normalizedCandidateName = normalizeTitle(candidate.name)
  const normalizedCandidateOriginal = normalizeTitle(candidate.originalName ?? '')
  const candidateTitles = [normalizedCandidateName, normalizedCandidateOriginal].filter(Boolean)
  const showSeason = extractSeasonNumber(showTitle)
  const candidateSeason = extractSeasonNumber(candidate.name) ?? extractSeasonNumber(candidate.originalName ?? '')
  let score = 0

  for (const candidateTitle of candidateTitles) {
    score = Math.max(score, scoreNormalizedTitle(normalizedShowTitle, candidateTitle))
    score = Math.max(score, scoreNormalizedTitle(normalizedSearchTitle, candidateTitle) - 10)
  }

  if (showSeason !== null) {
    if (candidateSeason === showSeason) {
      score += 18
    } else if (candidateSeason !== null) {
      score -= 12
    } else {
      score -= 3
    }
  }

  return score
}

function scoreNormalizedTitle(query: string, candidate: string): number {
  if (!query || !candidate) {
    return 0
  }

  if (query === candidate) {
    return 100
  }

  if (candidate.includes(query) || query.includes(candidate)) {
    return 74
  }

  const overlap = tokenOverlap(query, candidate)
  if (overlap >= 0.9) {
    return 68
  }
  if (overlap >= 0.75) {
    return 56
  }
  if (overlap >= 0.6) {
    return 42
  }
  if (overlap >= 0.45) {
    return 28
  }

  return 0
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))

  if (!leftTokens.size || !rightTokens.size) {
    return 0
  }

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size)
}

function extractSeasonNumber(value: string): number | null {
  const normalized = normalizeTitle(value)
  if (!normalized) {
    return null
  }

  const directSeasonMatch = normalized.match(/\bseason\s+(\d+)\b/u)
  if (directSeasonMatch) {
    return Number(directSeasonMatch[1])
  }

  const ordinalSeasonMatch = normalized.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/u)
  if (ordinalSeasonMatch) {
    return Number(ordinalSeasonMatch[1])
  }

  const trailingNumberMatch = normalized.match(/\b(\d+)\b$/u)
  if (trailingNumberMatch && !normalized.includes('episode')) {
    return Number(trailingNumberMatch[1])
  }

  return null
}

function parseNumericValue(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function episodeMatchesNumber(episode: AniSkipEpisode, episodeNumber: string, numericEpisodeNumber: number | null): boolean {
  if (episode.number === episodeNumber || episode.name === episodeNumber) {
    return true
  }

  if (numericEpisodeNumber === null) {
    return false
  }

  return parseNumericValue(episode.number) === numericEpisodeNumber || parseNumericValue(episode.name) === numericEpisodeNumber
}
