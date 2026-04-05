import type {
  EpisodeSummary,
  ShowDetail,
  ShowPageAniListDetails,
  ShowPageAudienceStat,
  ShowPageDate,
  ShowPageMediaCard,
  ShowPageRanking,
  ShowPageRecommendation,
  ShowPageRelation,
  ShowPageReviewPreview,
  ShowPageTag,
  ShowSummary,
  TrailerAsset,
  TranslationType,
} from '../../../../shared/contracts.js'
import type { AppEnv } from '../../env.js'
import { AniFlowDatabase } from '../../lib/database.js'
import { cleanSynopsis, normalizeTitle, parseEpisodeNumericValue, sortEpisodeNumbers, stripHtml } from '../../lib/utils.js'
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

interface AniListShowPageResponse {
  data?: {
    Media?: AniListShowPageMedia | null
  } | null
  errors?: Array<{ message?: string }>
}

interface AniListShowPageMedia extends AniListMetadataCandidate {
  siteUrl?: string | null
  format?: string | null
  episodes?: number | null
  duration?: number | null
  popularity?: number | null
  favourites?: number | null
  startDate?: AniListFuzzyDate | null
  endDate?: AniListFuzzyDate | null
  trailer?: {
    id?: string | null
    site?: string | null
    thumbnail?: string | null
  } | null
  rankings?: AniListMediaRanking[] | null
  stats?: {
    statusDistribution?: AniListStatusDistribution[] | null
  } | null
  tags?: AniListMediaTag[] | null
  relations?: {
    edges?: AniListRelationEdge[] | null
  } | null
  recommendations?: {
    nodes?: AniListRecommendationNode[] | null
  } | null
  reviews?: {
    nodes?: AniListReviewNode[] | null
  } | null
}

interface AniListFuzzyDate {
  year?: number | null
  month?: number | null
  day?: number | null
}

interface AniListMediaRanking {
  rank?: number | null
  type?: string | null
  context?: string | null
  season?: string | null
  year?: number | null
  allTime?: boolean | null
}

interface AniListStatusDistribution {
  status?: string | null
  amount?: number | null
}

interface AniListMediaTag {
  name?: string | null
  description?: string | null
  category?: string | null
  rank?: number | null
  isMediaSpoiler?: boolean | null
}

interface AniListRelationEdge {
  relationType?: string | null
  node?: AniListRelatedMedia | null
}

interface AniListRecommendationNode {
  rating?: number | null
  mediaRecommendation?: AniListRelatedMedia | null
}

interface AniListRelatedMedia {
  id: number
  siteUrl?: string | null
  season?: string | null
  seasonYear?: number | null
  status?: string | null
  format?: string | null
  averageScore?: number | null
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
}

interface AniListReviewNode {
  id?: number | null
  summary?: string | null
  rating?: number | null
  ratingAmount?: number | null
  siteUrl?: string | null
  createdAt?: number | null
  user?: {
    name?: string | null
    avatar?: {
      large?: string | null
    } | null
  } | null
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
        romajiTitle: entry.name ?? null,
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

    const providerDescription = cleanSynopsis(show.description)
    const aniListMetadata = needsAniListMetadata(show, providerDescription)
      ? await this.lookupAniListMetadata([show.englishName, show.name, show.nativeName], show.season?.year ?? null).catch(
          () => null,
        )
      : null

    const result: ShowDetail = {
      id: show._id,
      provider: 'allanime',
      title: show.englishName || show.name,
      romajiTitle: show.name ?? null,
      originalTitle:
        show.nativeName ??
        aniListMetadata?.title?.native?.trim() ??
        aniListMetadata?.title?.romaji?.trim() ??
        show.name ??
        null,
      bannerUrl: show.banner ?? aniListMetadata?.bannerImage ?? null,
      posterUrl: show.thumbnail ?? aniListMetadata?.coverImage?.extraLarge ?? aniListMetadata?.coverImage?.large ?? null,
      description: providerDescription ?? cleanSynopsis(aniListMetadata?.description),
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

  async getAniListDetails(show: Pick<ShowDetail, 'id' | 'title' | 'originalTitle' | 'year'>): Promise<ShowPageAniListDetails | null> {
    const cacheKey = `anilist:show-page:${show.id}:v4`
    const cached = this.database.getCachedJson<ShowPageAniListDetails>(cacheKey)
    if (cached) {
      return cached
    }

    const metadata = await this.lookupAniListMetadata([show.title, show.originalTitle], show.year ?? null)
    if (!metadata?.id) {
      return null
    }

    const response = await this.queryAniListDetailsById(metadata.id)
    const media = response.data?.Media
    if (!media) {
      return null
    }

    const providerCache = new Map<string, string | null>()
    const relations = await Promise.all(
      (media.relations?.edges ?? [])
        .filter((edge): edge is AniListRelationEdge & { node: AniListRelatedMedia } => Boolean(edge?.node))
        .slice(0, 8)
        .map((edge) => this.mapAniListMediaCard(edge.node, providerCache, { relationType: edge.relationType ?? null })),
    )
    const recommendations = await Promise.all(
      (media.recommendations?.nodes ?? [])
        .filter((node): node is AniListRecommendationNode & { mediaRecommendation: AniListRelatedMedia } =>
          Boolean(node?.mediaRecommendation),
        )
        .slice(0, 6)
        .map((node) => this.mapAniListMediaCard(node.mediaRecommendation, providerCache, { rating: node.rating ?? null })),
    )

    const result: ShowPageAniListDetails = {
      mediaId: media.id,
      siteUrl: media.siteUrl ?? null,
      title: {
        romaji: media.title?.romaji?.trim() ?? null,
        native: media.title?.native?.trim() ?? null,
      },
      synopsis: cleanSynopsis(media.description),
      trailer: mapTrailer(media.trailer),
      format: media.format ?? null,
      status: normalizeStatus(media.status) ?? null,
      episodes: media.episodes ?? null,
      duration: media.duration ?? null,
      season: media.season ?? null,
      seasonYear: media.seasonYear ?? null,
      startDate: mapFuzzyDate(media.startDate),
      endDate: mapFuzzyDate(media.endDate),
      averageScore: media.averageScore ?? null,
      popularity: media.popularity ?? null,
      favourites: media.favourites ?? null,
      genres: media.genres ?? [],
      rankings: mapRankings(media.rankings),
      audienceStats: mapAudienceStats(media.stats?.statusDistribution),
      tags: mapTags(media.tags),
      relations: relations.filter((item): item is ShowPageRelation => item !== null),
      recommendations: recommendations.filter((item): item is ShowPageRecommendation => item !== null),
      reviews: mapReviews(media.reviews?.nodes),
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
    const response = await fetch('https://api.allanime.day/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: this.env.allAnimeReferer,
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        query,
        variables,
      }),
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
    const titles = buildAniListSearchTitles(rawTitles)

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

  private async mapAniListMediaCard(
    media: AniListRelatedMedia,
    cache: Map<string, string | null>,
    extra: { relationType?: string | null; rating?: number | null },
  ): Promise<ShowPageRelation | ShowPageRecommendation | null> {
    if (!media.id) {
      return null
    }

    const titles = collectAniListTitles(media)
    const cacheKey = `${titles.join('|')}::${media.seasonYear ?? ''}`
    let providerShowId = cache.get(cacheKey) ?? null
    let availableOnSite = false
    if (!cache.has(cacheKey)) {
      const match = await this.resolveProviderMatchByTitles(titles, media.seasonYear ?? null)
      availableOnSite = Boolean(match && ((match.availableEpisodes.sub ?? 0) > 0 || (match.availableEpisodes.dub ?? 0) > 0))
      providerShowId = availableOnSite ? match?.id ?? null : null
      cache.set(cacheKey, providerShowId)
    } else {
      availableOnSite = Boolean(providerShowId)
    }

    const base: ShowPageMediaCard = {
      anilistId: media.id,
      providerShowId,
      availableOnSite,
      title: getPrimaryTitle(media),
      originalTitle: media.title?.native?.trim() || media.title?.romaji?.trim() || null,
      posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
      format: media.format ?? null,
      status: normalizeStatus(media.status) ?? null,
      season: media.season ?? null,
      year: media.seasonYear ?? null,
      score: media.averageScore ?? null,
      siteUrl: media.siteUrl ?? null,
    }

    if ('relationType' in extra) {
      return {
        ...base,
        relationType: extra.relationType ?? null,
      }
    }

    return {
      ...base,
      rating: extra.rating ?? null,
    }
  }

  private async queryAniListDetailsById(id: number): Promise<AniListShowPageResponse> {
    let lastError: Error | null = null

    for (const endpoint of ANILIST_GRAPHQL_ENDPOINTS) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query: `query ShowPageAniListDetails($id: Int!) {
            Media(id: $id, type: ANIME) {
              id
              siteUrl
              title {
                romaji
                native
              }
              description
              format
              status
              season
              seasonYear
              episodes
              duration
              averageScore
              popularity
              favourites
              genres
              startDate {
                year
                month
                day
              }
              endDate {
                year
                month
                day
              }
              trailer {
                id
                site
                thumbnail
              }
              rankings {
                rank
                type
                context
                season
                year
                allTime
              }
              stats {
                statusDistribution {
                  status
                  amount
                }
              }
              tags {
                name
                description
                category
                rank
                isMediaSpoiler
              }
              relations {
                edges {
                  relationType
                  node {
                    id
                    siteUrl
                    season
                    seasonYear
                    status
                    format
                    averageScore
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
                  }
                }
              }
              recommendations(page: 1, perPage: 6, sort: [RATING_DESC]) {
                nodes {
                  rating
                  mediaRecommendation {
                    id
                    siteUrl
                    season
                    seasonYear
                    status
                    format
                    averageScore
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
                  }
                }
              }
              reviews(page: 1, perPage: 3, sort: [RATING_DESC]) {
                nodes {
                  id
                  summary
                  rating
                  ratingAmount
                  siteUrl
                  createdAt
                  user {
                    name
                    avatar {
                      large
                    }
                  }
                }
              }
            }
          }`,
          variables: { id },
        }),
      })

      if (!response.ok) {
        lastError = new Error(`AniList detail lookup failed with status ${response.status}`)
        if (response.status === 404 && endpoint !== ANILIST_GRAPHQL_ENDPOINTS[ANILIST_GRAPHQL_ENDPOINTS.length - 1]) {
          continue
        }

        throw lastError
      }

      const body = (await response.json()) as AniListShowPageResponse
      if (body.errors?.length) {
        throw new Error(body.errors.map((error) => error.message).filter(Boolean).join('; ') || 'AniList detail lookup failed')
      }

      return body
    }

    throw lastError ?? new Error('AniList detail lookup failed')
  }

  private async resolveProviderMatchByTitles(titles: string[], year: number | null): Promise<ShowSummary | null> {
    for (const title of titles.slice(0, 4)) {
      try {
        const results = await this.search(title)
        const match = pickProviderMatch(results, titles, year)
        if (match) {
          return match
        }
      } catch {
        continue
      }
    }

    return null
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

function buildAniListSearchTitles(rawTitles: Array<string | null | undefined>): string[] {
  const titles = new Map<string, string>()

  for (const rawTitle of rawTitles) {
    const trimmed = rawTitle?.trim()
    if (!trimmed) {
      continue
    }

    for (const candidate of [trimmed, stripSeasonSuffix(trimmed)]) {
      const normalized = normalizeTitle(candidate)
      if (!normalized || titles.has(normalized)) {
        continue
      }

      titles.set(normalized, candidate)
    }
  }

  return Array.from(titles.values())
}

function stripSeasonSuffix(input: string): string {
  return input
    .replace(/\s*[:\-]\s*season\s+\d+\s*$/i, '')
    .replace(/\s+\d+(?:st|nd|rd|th)\s+season\s*$/i, '')
    .replace(/\s+season\s+\d+\s*$/i, '')
    .replace(/\s+part\s+\d+\s*$/i, '')
    .replace(/\s+cour\s+\d+\s*$/i, '')
    .trim()
}

function collectAniListTitles(media: {
  title?: {
    english?: string | null
    romaji?: string | null
    native?: string | null
  } | null
  synonyms?: string[] | null
}): string[] {
  const titles = new Map<string, string>()
  const values = [media.title?.english, media.title?.romaji, media.title?.native, ...(media.synonyms ?? [])]

  for (const value of values) {
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

function getPrimaryTitle(media: {
  id: number
  title?: {
    english?: string | null
    romaji?: string | null
    native?: string | null
  } | null
}): string {
  return media.title?.english?.trim() || media.title?.romaji?.trim() || media.title?.native?.trim() || `AniList ${media.id}`
}

function pickProviderMatch(results: ShowSummary[], titles: string[], year: number | null): ShowSummary | null {
  let best: { item: ShowSummary; score: number } | null = null

  for (const result of results) {
    const score = scoreProviderCandidate(result, titles, year)
    if (!best || score > best.score) {
      best = { item: result, score }
    }
  }

  return best && best.score >= 75 ? best.item : null
}

function scoreProviderCandidate(result: ShowSummary, titles: string[], year: number | null): number {
  const candidateTitles = [result.title, result.originalTitle ?? '']
    .map((value) => normalizeTitle(value))
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
        bestScore = Math.max(bestScore, 78)
        continue
      }

      const overlap = tokenOverlap(normalizedTitle, candidateTitle)
      if (overlap >= 0.8) {
        bestScore = Math.max(bestScore, 68)
      } else if (overlap >= 0.6) {
        bestScore = Math.max(bestScore, 54)
      }
    }
  }

  if (year && result.year === year) {
    bestScore += 12
  }

  return bestScore
}

function mapFuzzyDate(date: AniListFuzzyDate | null | undefined): ShowPageDate | null {
  if (!date) {
    return null
  }

  if (date.year == null && date.month == null && date.day == null) {
    return null
  }

  return {
    year: date.year ?? null,
    month: date.month ?? null,
    day: date.day ?? null,
  }
}

function mapRankings(rankings: AniListMediaRanking[] | null | undefined): ShowPageRanking[] {
  return (rankings ?? [])
    .filter((ranking): ranking is AniListMediaRanking & { rank: number } => typeof ranking?.rank === 'number')
    .map((ranking) => ({
      rank: ranking.rank,
      type: ranking.type ?? 'UNKNOWN',
      context: ranking.context ?? null,
      season: ranking.season ?? null,
      year: ranking.year ?? null,
      allTime: Boolean(ranking.allTime),
    }))
    .sort((left, right) => left.rank - right.rank)
}

function mapAudienceStats(distribution: AniListStatusDistribution[] | null | undefined): ShowPageAudienceStat[] {
  const totals = new Map<string, number>()

  for (const entry of distribution ?? []) {
    const status = entry?.status?.trim().toUpperCase()
    const amount = entry?.amount ?? 0
    if (!status) {
      continue
    }

    const key = status === 'REPEATING' ? 'CURRENT' : status
    totals.set(key, (totals.get(key) ?? 0) + amount)
  }

  return ['CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED'].map((status) => ({
    status: status as ShowPageAudienceStat['status'],
    amount: totals.get(status) ?? 0,
  }))
}

function mapTags(tags: AniListMediaTag[] | null | undefined): ShowPageTag[] {
  return (tags ?? [])
    .filter((tag): tag is AniListMediaTag & { name: string } => typeof tag?.name === 'string' && tag.name.trim().length > 0)
    .map((tag) => ({
      name: tag.name.trim(),
      description: stripHtml(tag.description),
      category: tag.category?.trim() || null,
      rank: tag.rank ?? null,
      isSpoiler: Boolean(tag.isMediaSpoiler),
    }))
    .sort((left, right) => (right.rank ?? 0) - (left.rank ?? 0))
}

function mapReviews(reviews: AniListReviewNode[] | null | undefined): ShowPageReviewPreview[] {
  return (reviews ?? [])
    .filter(
      (review): review is AniListReviewNode & { id: number; summary: string; user: { name: string; avatar?: { large?: string | null } | null } } =>
        typeof review?.id === 'number' && typeof review?.summary === 'string' && Boolean(review.summary.trim()) && typeof review.user?.name === 'string',
    )
    .map((review) => ({
      id: review.id,
      summary: review.summary.trim(),
      rating: review.rating ?? null,
      ratingAmount: review.ratingAmount ?? null,
      siteUrl: review.siteUrl ?? null,
      createdAt: typeof review.createdAt === 'number' && review.createdAt > 0 ? new Date(review.createdAt * 1000).toISOString() : null,
      userName: review.user.name.trim(),
      userAvatarUrl: review.user.avatar?.large ?? null,
    }))
}

function mapTrailer(
  trailer:
    | {
        id?: string | null
        site?: string | null
        thumbnail?: string | null
      }
    | null
    | undefined,
): TrailerAsset | null {
  const id = trailer?.id?.trim()
  const site = trailer?.site?.trim()

  if (!id || !site) {
    return null
  }

  const normalizedSite = site.toLowerCase()
  let videoUrl: string | null = null
  let embedUrl: string | null = null

  if (normalizedSite === 'youtube') {
    videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
    embedUrl =
      `https://www.youtube.com/embed/${encodeURIComponent(id)}` +
      `?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0&loop=1&playlist=${encodeURIComponent(id)}`
  } else if (normalizedSite === 'dailymotion') {
    videoUrl = `https://www.dailymotion.com/video/${encodeURIComponent(id)}`
    embedUrl = `https://www.dailymotion.com/embed/video/${encodeURIComponent(id)}?autoplay=1&mute=1&controls=0`
  }

  return {
    id,
    site,
    thumbnailUrl: trailer?.thumbnail ?? null,
    videoUrl,
    embedUrl,
  }
}
