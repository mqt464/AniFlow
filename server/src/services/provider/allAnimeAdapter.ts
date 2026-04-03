import type { EpisodeSummary, ShowDetail, ShowSummary, TranslationType } from '../../../../shared/contracts.js'
import type { AppEnv } from '../../env.js'
import { AniFlowDatabase } from '../../lib/database.js'
import { normalizeTitle, parseEpisodeNumericValue, sortEpisodeNumbers, stripHtml } from '../../lib/utils.js'
import { decodeAllAnimeSourceUrl } from './decodeAllAnimeSource.js'

interface SearchResponse {
  data?: {
    shows?: {
      edges?: Array<{
        _id: string
        name: string
        englishName?: string | null
        nativeName?: string | null
        thumbnail?: string | null
        availableEpisodes?: { sub?: number; dub?: number }
        score?: number | null
        season?: { quarter?: string | null; year?: number | null } | null
      }>
    }
  }
}

interface ShowResponse {
  data?: {
    show?: {
      _id: string
      name: string
      englishName?: string | null
      nativeName?: string | null
      thumbnail?: string | null
      banner?: string | null
      description?: string | null
      genres?: string[] | null
      status?: string | null
      score?: number | null
      season?: { quarter?: string | null; year?: number | null } | null
      availableEpisodes?: { sub?: number; dub?: number }
      availableEpisodesDetail?: { sub?: string[]; dub?: string[] }
    } | null
  }
}

interface EpisodeSourcesResponse {
  data?: {
    episode?: {
      episodeString?: string
      sourceUrls?: Array<{
        sourceUrl: string
        priority: number
        sourceName: string
        type: string
      }>
    } | null
  }
}

interface AniListMetadataResponse {
  data?: {
    Page?: {
      media?: AniListMetadataCandidate[]
    } | null
  }
  errors?: Array<{ message?: string }>
}

interface AniListMetadataCandidate {
  id: number
  title?: {
    english?: string | null
    romaji?: string | null
    native?: string | null
  } | null
  synonyms?: string[] | null
  coverImage?: {
    extraLarge?: string | null
    large?: string | null
  } | null
  bannerImage?: string | null
  description?: string | null
  genres?: string[] | null
  status?: string | null
  averageScore?: number | null
  season?: string | null
  seasonYear?: number | null
}

export interface ProviderCandidate {
  url: string
  mimeType: string
  headers: Record<string, string>
  subtitleUrl: string | null
  subtitleMimeType: string | null
  qualityLabel: string
}

interface DecodedProviderResponse {
  links?: ProviderLinkEntry[]
  sources?: ProviderLinkEntry[]
  subtitles?: unknown
  captions?: unknown
  tracks?: unknown
  headers?: Record<string, string>
  Referer?: string
  referer?: string
}

interface ProviderLinkEntry {
  link?: string
  url?: string
  src?: string
  file?: string
  hls?: boolean
  mp4?: boolean
  resolutionStr?: string
  resolution?: string | number
  subtitles?: unknown
  captions?: unknown
  tracks?: unknown
  headers?: Record<string, string>
  Referer?: string
  referer?: string
}

const ANILIST_GRAPHQL_ENDPOINTS = ['https://graphql.anilist.co', 'https://graphql.anilist.co/'] as const

export class AllAnimeAdapter {
  constructor(
    private readonly env: AppEnv,
    private readonly database: AniFlowDatabase,
  ) {}

  async search(query: string): Promise<ShowSummary[]> {
    const cacheKey = `allanime:search:${normalizeTitle(query)}`
    const cached = this.database.getCachedJson<ShowSummary[]>(cacheKey)
    if (cached) {
      return cached
    }

    const response = await this.query<SearchResponse>(
      `query ($search: SearchInput $limit: Int $page: Int $translationType: VaildTranslationTypeEnumType $countryOrigin: VaildCountryOriginEnumType ) {
        shows(search: $search limit: $limit page: $page translationType: $translationType countryOrigin: $countryOrigin) {
          edges {
            _id
            name
            englishName
            nativeName
            thumbnail
            availableEpisodes
            score
            season
          }
        }
      }`,
      {
        search: { allowAdult: false, allowUnknown: false, query },
        limit: 24,
        page: 1,
        translationType: 'sub',
        countryOrigin: 'ALL',
      },
    )

    const results =
      response.data?.shows?.edges?.map((entry) => ({
        id: entry._id,
        title: entry.englishName || entry.name,
        originalTitle: entry.nativeName ?? entry.name ?? null,
        bannerUrl: null,
        posterUrl: entry.thumbnail ?? null,
        description: null,
        genres: [],
        status: null,
        year: entry.season?.year ?? null,
        season: entry.season?.quarter ?? null,
        score: entry.score ?? null,
        availableEpisodes: {
          sub: entry.availableEpisodes?.sub ?? 0,
          dub: entry.availableEpisodes?.dub ?? 0,
        },
      })) ?? []

    this.database.setCachedJson(cacheKey, results, this.env.cacheTtlMs)
    return results
  }

  async getShow(showId: string): Promise<ShowDetail> {
    const cacheKey = `allanime:show:${showId}`
    const cached = this.database.getCachedJson<ShowDetail>(cacheKey)
    if (cached) {
      return cached
    }

    const response = await this.query<ShowResponse>(
      `query ($showId: String!) {
        show(_id: $showId) {
          _id
          name
          englishName
          nativeName
          thumbnail
          banner
          description
          genres
          status
          score
          season
          availableEpisodes
        }
      }`,
      { showId },
    )

    const show = response.data?.show
    if (!show) {
      throw new Error('Show not found')
    }

    const providerDescription = stripHtml(show.description)
    const aniListMetadata = needsAniListMetadata(show, providerDescription)
      ? await this.lookupAniListMetadata([show.englishName, show.name, show.nativeName], show.season?.year ?? null).catch(
          () => null,
        )
      : null

    const result: ShowDetail = {
      id: show._id,
      provider: 'allanime',
      title: show.englishName || show.name,
      originalTitle:
        show.nativeName ??
        aniListMetadata?.title?.native?.trim() ??
        aniListMetadata?.title?.romaji?.trim() ??
        show.name ??
        null,
      bannerUrl: show.banner ?? aniListMetadata?.bannerImage ?? null,
      posterUrl: show.thumbnail ?? aniListMetadata?.coverImage?.extraLarge ?? aniListMetadata?.coverImage?.large ?? null,
      description: providerDescription ?? stripHtml(aniListMetadata?.description),
      genres: show.genres?.length ? show.genres : aniListMetadata?.genres ?? [],
      status: normalizeStatus(show.status) ?? normalizeStatus(aniListMetadata?.status),
      year: show.season?.year ?? aniListMetadata?.seasonYear ?? null,
      season: show.season?.quarter ?? aniListMetadata?.season ?? null,
      score: show.score ?? aniListMetadata?.averageScore ?? null,
      availableEpisodes: {
        sub: show.availableEpisodes?.sub ?? 0,
        dub: show.availableEpisodes?.dub ?? 0,
      },
    }

    this.database.setCachedJson(cacheKey, result, this.env.cacheTtlMs)
    return result
  }

  async getEpisodes(showId: string, translationType: TranslationType): Promise<EpisodeSummary[]> {
    const cacheKey = `allanime:episodes:${showId}:${translationType}`
    const cached = this.database.getCachedJson<EpisodeSummary[]>(cacheKey)
    if (cached) {
      return cached
    }

    const response = await this.query<ShowResponse>(
      `query ($showId: String!) {
        show(_id: $showId) {
          _id
          availableEpisodesDetail
        }
      }`,
      { showId },
    )

    const numbers = sortEpisodeNumbers(response.data?.show?.availableEpisodesDetail?.[translationType] ?? [])
    const episodes = numbers.map((number) => ({
      showId,
      number,
      title: `Episode ${number}`,
      translationType,
      durationSeconds: null,
    }))

    this.database.setCachedJson(cacheKey, episodes, this.env.cacheTtlMs)
    return episodes
  }

  async resolvePlayback(showId: string, episodeNumber: string, translationType: TranslationType): Promise<ProviderCandidate> {
    const response = await this.query<EpisodeSourcesResponse>(
      `query ($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) {
        episode(showId: $showId translationType: $translationType episodeString: $episodeString) {
          episodeString
          sourceUrls
        }
      }`,
      {
        showId,
        translationType,
        episodeString: episodeNumber,
      },
    )

    const sourceUrls = [...(response.data?.episode?.sourceUrls ?? [])].sort((left, right) => right.priority - left.priority)

    for (const source of sourceUrls) {
      if (source.sourceName === 'Yt-mp4') {
        const decoded = decodeAllAnimeSourceUrl(source.sourceUrl)
        return {
          url: decoded,
          mimeType: this.inferMimeType(decoded, 'video/mp4'),
          headers: { Referer: this.env.allAnimeReferer },
          subtitleUrl: null,
          subtitleMimeType: null,
          qualityLabel: 'Source',
        }
      }

      if (!source.sourceUrl.startsWith('--')) {
        continue
      }

      const candidate = await this.tryDecodedProvider(source.sourceUrl)
      if (candidate) {
        return candidate
      }
    }

    throw new Error('No playable sources were available for this episode')
  }

  getNextEpisodeNumber(episodes: EpisodeSummary[], currentEpisode: string): string | null {
    const currentValue = parseEpisodeNumericValue(currentEpisode)
    const next = episodes.find((episode) => parseEpisodeNumericValue(episode.number) > currentValue)
    return next?.number ?? null
  }

  private async tryDecodedProvider(sourceUrl: string): Promise<ProviderCandidate | null> {
    const decoded = decodeAllAnimeSourceUrl(sourceUrl)
    if (!decoded.startsWith('/')) {
      return null
    }

    const response = await fetch(`https://allanime.day${decoded}`, {
      headers: {
        Referer: this.env.allAnimeReferer,
        'User-Agent': 'Mozilla/5.0',
      },
    })

    if (!response.ok) {
      return null
    }

    const text = await response.text()
    return parseAllAnimeProviderPayload(text, this.env.allAnimeReferer)
  }

  private inferMimeType(url: string, fallback: string): string {
    return url.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : fallback
  }

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const url = new URL('https://api.allanime.day/api')
    url.searchParams.set('query', query)
    url.searchParams.set('variables', JSON.stringify(variables))

    const response = await fetch(url, {
      headers: {
        Referer: this.env.allAnimeReferer,
        'User-Agent': 'Mozilla/5.0',
      },
    })

    if (!response.ok) {
      throw new Error(`AllAnime query failed with status ${response.status}`)
    }

    return (await response.json()) as T
  }

  private async lookupAniListMetadata(
    rawTitles: Array<string | null | undefined>,
    year: number | null,
  ): Promise<AniListMetadataCandidate | null> {
    const titles = Array.from(
      new Map(
        rawTitles
          .map((title) => title?.trim())
          .filter((title): title is string => Boolean(title))
          .map((title) => [normalizeTitle(title), title] as const),
      ).values(),
    )

    for (const title of titles.slice(0, 3)) {
      const match = await this.searchAniListByTitle(title, titles, year)
      if (match) {
        return match
      }
    }

    return null
  }

  private async searchAniListByTitle(
    search: string,
    titles: string[],
    year: number | null,
  ): Promise<AniListMetadataCandidate | null> {
    const responses = year ? [await this.queryAniList(search, year), await this.queryAniList(search, null)] : [await this.queryAniList(search, null)]

    let bestMatch: { item: AniListMetadataCandidate; score: number } | null = null
    for (const response of responses) {
      for (const candidate of response.data?.Page?.media ?? []) {
        const score = scoreAniListCandidate(candidate, titles, year)
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { item: candidate, score }
        }
      }
    }

    return bestMatch && bestMatch.score >= 75 ? bestMatch.item : null
  }

  private async queryAniList(search: string, seasonYear: number | null): Promise<AniListMetadataResponse> {
    let lastError: Error | null = null

    for (const endpoint of ANILIST_GRAPHQL_ENDPOINTS) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query: `query SearchAniListMetadata($search: String!, $seasonYear: Int) {
            Page(page: 1, perPage: 5) {
              media(search: $search, type: ANIME, seasonYear: $seasonYear, sort: SEARCH_MATCH) {
                id
                title {
                  english
                  romaji
                  native
                }
                synonyms
                coverImage {
                  extraLarge
                  large
                }
                bannerImage
                description
                genres
                status
                averageScore
                season
                seasonYear
              }
            }
          }`,
          variables: {
            search,
            seasonYear,
          },
        }),
      })

      if (!response.ok) {
        lastError = new Error(`AniList metadata lookup failed with status ${response.status}`)
        if (response.status === 404 && endpoint !== ANILIST_GRAPHQL_ENDPOINTS[ANILIST_GRAPHQL_ENDPOINTS.length - 1]) {
          continue
        }

        throw lastError
      }

      const body = (await response.json()) as AniListMetadataResponse
      if (body.errors?.length) {
        throw new Error(body.errors.map((error) => error.message).filter(Boolean).join('; ') || 'AniList metadata lookup failed')
      }

      return body
    }

    throw lastError ?? new Error('AniList metadata lookup failed')
  }
}

export function parseAllAnimeProviderPayload(text: string, fallbackReferer: string): ProviderCandidate | null {
  const payload = tryParseDecodedProviderResponse(text)
  if (payload) {
    const headers = extractProviderHeaders(payload, fallbackReferer)
    const links = extractProviderLinks(payload)
    const subtitleUrl = findSubtitleTrackUrl(payload)
    const subtitleMimeType = inferSubtitleMimeType(subtitleUrl)
    const hlsLink = links.find((entry) => entry.isHls)

    if (hlsLink) {
      return {
        url: hlsLink.url,
        mimeType: 'application/vnd.apple.mpegurl',
        headers: extractProviderHeaders(hlsLink.raw, headers.Referer),
        subtitleUrl,
        subtitleMimeType,
        qualityLabel: 'Auto',
      }
    }

    if (links.length > 0) {
      const preferredLink = [...links].sort((left, right) => right.resolution - left.resolution)[0]
      return {
        url: preferredLink.url,
        mimeType: inferMimeTypeFromUrl(preferredLink.url, 'video/mp4'),
        headers: extractProviderHeaders(preferredLink.raw, headers.Referer),
        subtitleUrl,
        subtitleMimeType,
        qualityLabel: preferredLink.qualityLabel,
      }
    }
  }

  const hlsUrl = text.match(/"hls","url":"([^"]+)"/)?.[1]
  if (hlsUrl) {
    const referer = text.match(/"Referer":"([^"]+)"/)?.[1] ?? fallbackReferer
    const subtitleUrl = text.match(/"src":"([^"]+)"/)?.[1] ?? null
    return {
      url: hlsUrl,
      mimeType: inferMimeTypeFromUrl(hlsUrl, 'application/vnd.apple.mpegurl'),
      headers: { Referer: referer },
      subtitleUrl,
      subtitleMimeType: inferSubtitleMimeType(subtitleUrl),
      qualityLabel: 'Auto',
    }
  }

  const directLinks = [...text.matchAll(/"link":"([^"]+)".*"resolutionStr":"([^"]+)"/g)]
    .map((match) => ({ url: match[1], label: match[2] }))
    .sort((left, right) => Number(right.label) - Number(left.label))

  if (directLinks.length > 0) {
    return {
      url: directLinks[0].url,
      mimeType: inferMimeTypeFromUrl(directLinks[0].url, 'video/mp4'),
      headers: { Referer: fallbackReferer },
      subtitleUrl: null,
      subtitleMimeType: null,
      qualityLabel: `${directLinks[0].label}p`,
    }
  }

  return null
}

function tryParseDecodedProviderResponse(text: string): DecodedProviderResponse | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null
  }

  try {
    return JSON.parse(trimmed) as DecodedProviderResponse
  } catch {
    return null
  }
}

function extractProviderLinks(payload: DecodedProviderResponse): Array<{
  url: string
  isHls: boolean
  resolution: number
  qualityLabel: string
  raw: ProviderLinkEntry
}> {
  const rawLinks = Array.isArray(payload.links)
    ? payload.links
    : Array.isArray(payload.sources)
      ? payload.sources
      : []

  return rawLinks
    .map((entry) => {
      const url = entry.link ?? entry.url ?? entry.src ?? entry.file
      if (!url) {
        return null
      }

      const isHls = Boolean(entry.hls) || inferMimeTypeFromUrl(url, 'video/mp4') === 'application/vnd.apple.mpegurl'
      return {
        url,
        isHls,
        resolution: parseResolution(entry.resolutionStr ?? entry.resolution),
        qualityLabel: isHls ? 'Auto' : formatQualityLabel(entry.resolutionStr ?? entry.resolution),
        raw: entry,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
}

function extractProviderHeaders(
  payload: Pick<DecodedProviderResponse, 'headers' | 'Referer' | 'referer'>,
  fallbackReferer: string,
): Record<string, string> {
  return {
    ...(payload.headers ?? {}),
    Referer: payload.Referer ?? payload.referer ?? payload.headers?.Referer ?? payload.headers?.referer ?? fallbackReferer,
  }
}

function findSubtitleTrackUrl(value: unknown, subtitleContext = false): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const subtitleUrl = findSubtitleTrackUrl(entry, subtitleContext)
      if (subtitleUrl) {
        return subtitleUrl
      }
    }

    return null
  }

  const record = value as Record<string, unknown>
  if (looksLikeSubtitleTrack(record, subtitleContext)) {
    const subtitleUrl = getTrackUrl(record)
    if (subtitleUrl) {
      return subtitleUrl
    }
  }

  for (const [key, entry] of Object.entries(record)) {
    const nextSubtitleContext = subtitleContext || /subtitle|caption|track/i.test(key)
    const subtitleUrl = findSubtitleTrackUrl(entry, nextSubtitleContext)
    if (subtitleUrl) {
      return subtitleUrl
    }
  }

  return null
}

function looksLikeSubtitleTrack(track: Record<string, unknown>, subtitleContext: boolean): boolean {
  if (subtitleContext) {
    return true
  }

  const kind = [track.kind, track.type, track.label, track.language, track.lang]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()

  return /subtitle|caption|vtt|srt|ass/.test(kind)
}

function getTrackUrl(track: Record<string, unknown>): string | null {
  for (const key of ['src', 'file', 'url', 'link']) {
    const value = track[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  return null
}

function inferSubtitleMimeType(url: string | null): string | null {
  if (!url) {
    return null
  }

  const normalized = url.split('?')[0].toLowerCase()
  if (normalized.endsWith('.srt')) {
    return 'application/x-subrip'
  }
  if (normalized.endsWith('.ass')) {
    return 'text/x-ssa'
  }

  return 'text/vtt'
}

function inferMimeTypeFromUrl(url: string, fallback: string): string {
  return url.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : fallback
}

function parseResolution(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return 0
  }

  const numeric = value.match(/\d+/)?.[0]
  return numeric ? Number(numeric) : 0
}

function formatQualityLabel(value: string | number | undefined): string {
  const resolution = parseResolution(value)
  if (resolution > 0) {
    return `${resolution}p`
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return 'Source'
}

function normalizeStatus(status: string | null | undefined): string | null {
  const normalized = status?.trim().toUpperCase()
  if (!normalized || normalized === 'UNKNOWN') {
    return null
  }

  return normalized
}

function needsAniListMetadata(
  show: NonNullable<NonNullable<ShowResponse['data']>['show']>,
  description: string | null,
): boolean {
  return (
    !show.nativeName?.trim() ||
    !show.thumbnail?.trim() ||
    !description ||
    !show.genres?.length ||
    normalizeStatus(show.status) === null ||
    show.score == null ||
    show.season?.year == null ||
    !show.season?.quarter?.trim()
  )
}

function scoreAniListCandidate(candidate: AniListMetadataCandidate, titles: string[], year: number | null): number {
  const candidateTitles = [
    candidate.title?.english,
    candidate.title?.romaji,
    candidate.title?.native,
    ...(candidate.synonyms ?? []),
  ]
    .map((value) => normalizeTitle(value ?? ''))
    .filter(Boolean)

  let bestScore = 0

  for (const title of titles) {
    const normalizedTitle = normalizeTitle(title)
    if (!normalizedTitle) {
      continue
    }

    for (const candidateTitle of candidateTitles) {
      if (candidateTitle === normalizedTitle) {
        bestScore = Math.max(bestScore, 100)
        continue
      }

      if (candidateTitle.startsWith(normalizedTitle) || normalizedTitle.startsWith(candidateTitle)) {
        bestScore = Math.max(bestScore, 82)
        continue
      }

      const overlap = tokenOverlap(normalizedTitle, candidateTitle)
      if (overlap >= 0.8) {
        bestScore = Math.max(bestScore, 72)
      } else if (overlap >= 0.6) {
        bestScore = Math.max(bestScore, 58)
      }
    }
  }

  if (year && candidate.seasonYear === year) {
    bestScore += 12
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
