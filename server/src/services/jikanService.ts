import type { EpisodeAnnotation, ShowDetail } from '../../../shared/contracts.js'
import type { AppEnv } from '../env.js'
import { AniFlowDatabase } from '../lib/database.js'
import { normalizeTitle } from '../lib/utils.js'

interface JikanSearchResponse {
  data?: JikanSearchItem[]
}

interface JikanSearchItem {
  mal_id: number
  title: string
  title_english?: string | null
  title_japanese?: string | null
  title_synonyms?: string[] | null
  year?: number | null
  type?: string | null
}

interface JikanEpisodeResponse {
  pagination?: {
    has_next_page?: boolean
    current_page?: number
  }
  data?: Array<{
    title?: string | null
    title_romanji?: string | null
    title_japanese?: string | null
    filler?: boolean
    recap?: boolean
  }>
}

interface EpisodeAnnotationPayload {
  annotations: Record<string, EpisodeAnnotation>
  titles: Record<string, string>
  matchedTitle: string | null
}

interface RankedCandidate {
  item: JikanSearchItem
  score: number
}

export class JikanService {
  constructor(
    private readonly env: AppEnv,
    private readonly database: AniFlowDatabase,
  ) {}

  async getEpisodeAnnotations(show: ShowDetail): Promise<EpisodeAnnotationPayload> {
    const cacheKey = `jikan:episodes:${normalizeTitle(show.title)}:${show.year ?? 'na'}`
    const cached = normalizeEpisodeAnnotationPayload(this.database.getCachedJson<unknown>(cacheKey))
    if (cached) {
      // Rewrite legacy cache entries so future reads stay schema-compatible.
      this.database.setCachedJson(cacheKey, cached, 1000 * 60 * 60 * 24)
      return cached
    }

    const match = await this.findMatch(show)
    if (!match) {
      const emptyPayload: EpisodeAnnotationPayload = {
        annotations: {},
        titles: {},
        matchedTitle: null,
      }
      this.database.setCachedJson(cacheKey, emptyPayload, Math.min(this.env.cacheTtlMs, 1000 * 60 * 30))
      return emptyPayload
    }

    const { annotations, titles } = await this.fetchEpisodes(match.mal_id)
    const payload: EpisodeAnnotationPayload = {
      annotations,
      titles,
      matchedTitle: match.title,
    }

    this.database.setCachedJson(cacheKey, payload, 1000 * 60 * 60 * 24)
    return payload
  }

  private async findMatch(show: ShowDetail): Promise<JikanSearchItem | null> {
    const titles = collectTitles(show)
    let best: RankedCandidate | null = null

    for (const title of titles.slice(0, 3)) {
      const response = await this.fetchJson<JikanSearchResponse>(
        `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=8`,
      )

      for (const item of response.data ?? []) {
        const score = scoreCandidate(item, show)
        if (!best || score > best.score) {
          best = { item, score }
        }
      }

      if (best && best.score >= 100) {
        return best.item
      }
    }

    const finalBest = best as RankedCandidate | null

    if (!finalBest) {
      return null
    }

    if ((finalBest as RankedCandidate).score < 74) {
      return null
    }

    return (finalBest as RankedCandidate).item
  }

  private async fetchEpisodes(malId: number): Promise<{
    annotations: Record<string, EpisodeAnnotation>
    titles: Record<string, string>
  }> {
    const cacheKey = `jikan:episode-flags:${malId}`
    const cached = this.database.getCachedJson<{
      annotations: Record<string, EpisodeAnnotation>
      titles: Record<string, string>
    }>(cacheKey)
    if (cached) {
      return cached
    }

    const annotations: Record<string, EpisodeAnnotation> = {}
    const titles: Record<string, string> = {}
    let page = 1
    let hasNextPage = true

    while (hasNextPage) {
      const response = await this.fetchJson<JikanEpisodeResponse>(
        `https://api.jikan.moe/v4/anime/${encodeURIComponent(String(malId))}/episodes?page=${page}`,
      )

      for (const [index, episode] of (response.data ?? []).entries()) {
        const episodeNumber = String((page - 1) * 100 + index + 1)
        annotations[episodeNumber] = {
          isFiller: Boolean(episode.filler),
          isRecap: Boolean(episode.recap),
          source: 'jikan',
        }

        const resolvedTitle = pickEpisodeTitle(episode)
        if (resolvedTitle) {
          titles[episodeNumber] = resolvedTitle
        }
      }

      hasNextPage = Boolean(response.pagination?.has_next_page)
      page += 1
    }

    const payload = {
      annotations,
      titles,
    }

    this.database.setCachedJson(cacheKey, payload, 1000 * 60 * 60 * 24)
    return payload
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AniFlow/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`Jikan request failed with status ${response.status}`)
    }

    return (await response.json()) as T
  }
}

function normalizeEpisodeAnnotationPayload(value: unknown): EpisodeAnnotationPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as {
    annotations?: unknown
    titles?: unknown
    matchedTitle?: unknown
  }

  return {
    annotations: isRecord(payload.annotations) ? (payload.annotations as Record<string, EpisodeAnnotation>) : {},
    titles: isRecord(payload.titles) ? (payload.titles as Record<string, string>) : {},
    matchedTitle: typeof payload.matchedTitle === 'string' ? payload.matchedTitle : null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pickEpisodeTitle(episode: {
  title?: string | null
  title_romanji?: string | null
  title_japanese?: string | null
}): string | null {
  const value = episode.title?.trim() || episode.title_romanji?.trim() || episode.title_japanese?.trim() || null
  return value && value.length > 0 ? value : null
}

function collectTitles(show: ShowDetail): string[] {
  const titles = new Map<string, string>()

  for (const value of [show.title, show.originalTitle ?? null]) {
    const trimmed = value?.trim()
    if (!trimmed) {
      continue
    }

    const normalized = normalizeTitle(trimmed)
    if (!normalized || titles.has(normalized)) {
      continue
    }

    titles.set(normalized, trimmed)
  }

  return Array.from(titles.values())
}

function scoreCandidate(candidate: JikanSearchItem, show: ShowDetail): number {
  const queryTitles = collectTitles(show).map((value) => normalizeTitle(value))
  const candidateTitles = [
    candidate.title,
    candidate.title_english ?? '',
    candidate.title_japanese ?? '',
    ...(candidate.title_synonyms ?? []),
  ]
    .map((value) => normalizeTitle(value))
    .filter(Boolean)

  let bestScore = 0

  for (const queryTitle of queryTitles) {
    for (const candidateTitle of candidateTitles) {
      if (candidateTitle === queryTitle) {
        bestScore = Math.max(bestScore, 100)
        continue
      }

      if (candidateTitle.startsWith(queryTitle) || queryTitle.startsWith(candidateTitle)) {
        bestScore = Math.max(bestScore, 82)
        continue
      }

      const overlap = tokenOverlap(queryTitle, candidateTitle)
      if (overlap >= 0.85) {
        bestScore = Math.max(bestScore, 72)
      } else if (overlap >= 0.65) {
        bestScore = Math.max(bestScore, 58)
      }
    }
  }

  if (show.year && candidate.year === show.year) {
    bestScore += 14
  }

  if (candidate.type === 'TV' || candidate.type === 'ONA') {
    bestScore += 4
  }

  return bestScore
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
