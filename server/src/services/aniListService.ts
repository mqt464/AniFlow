import type { AniListConnection, DiscoverShow, HomePayload, ShowSummary, TrailerAsset } from '../../../shared/contracts.js'
import type { AppEnv } from '../env.js'
import { type AniListSyncSnapshot, AniFlowDatabase } from '../lib/database.js'
import { nowIso, normalizeTitle, stripHtml } from '../lib/utils.js'
import { AllAnimeAdapter } from './provider/allAnimeAdapter.js'

interface AniListViewer {
  id: number
  name: string
  avatar?: {
    large?: string | null
  } | null
  bannerImage?: string | null
  siteUrl?: string | null
  about?: string | null
}

interface AniListViewerResponse {
  data?: {
    Viewer?: AniListViewer | null
  }
  errors?: Array<{ message?: string }>
}

interface AniListMediaListEntry {
  id: number
  status?: string | null
  progress?: number | null
}

interface AniListLibraryMedia {
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
  seasonYear?: number | null
  episodes?: number | null
  isFavourite?: boolean | null
}

interface AniListMediaLookupResponse {
  data?: {
    Media?: {
      id: number
      episodes?: number | null
      isFavourite?: boolean | null
      mediaListEntry?: AniListMediaListEntry | null
    } | null
  }
  errors?: Array<{ message?: string }>
}

interface AniListImportResponse {
  data?: {
    Viewer?: (AniListViewer & {
      favourites?: {
        anime?: {
          nodes?: AniListLibraryMedia[] | null
        } | null
      } | null
    }) | null
    MediaListCollection?: {
      lists?: Array<{
        entries?: Array<{
          status?: string | null
          progress?: number | null
          updatedAt?: number | null
          media?: AniListLibraryMedia | null
        }> | null
      }> | null
    } | null
  }
  errors?: Array<{ message?: string }>
}

interface AniListDiscoverResponse {
  data?: {
    Page?: {
      media?: AniListDiscoverMedia[]
    }
  }
  errors?: Array<{ message?: string }>
}

interface AniListDiscoverMedia extends AniListLibraryMedia {
  description?: string | null
  bannerImage?: string | null
  genres?: string[] | null
  status?: string | null
  season?: string | null
  averageScore?: number | null
  trailer?: {
    id?: string | null
    site?: string | null
    thumbnail?: string | null
  } | null
}

type HomeDiscoverPayload = HomePayload['discover']
type AniListSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'

const BACKGROUND_IMPORT_INTERVAL_MS = 10 * 60 * 1000
const ANILIST_GRAPHQL_ENDPOINTS = ['https://graphql.anilist.co', 'https://graphql.anilist.co/'] as const
const ANILIST_GRAPHQL_MIN_INTERVAL_MS = 750
const ANILIST_GRAPHQL_MAX_RETRIES = 4

export class AniListService {
  private timer: NodeJS.Timeout | null = null
  private syncing = false
  private graphqlQueue: Promise<void> = Promise.resolve()
  private lastGraphqlRequestAt = 0

  constructor(
    private readonly env: AppEnv,
    private readonly database: AniFlowDatabase,
    private readonly provider: AllAnimeAdapter,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.runBackgroundSync()
    }, 30_000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getPublicConnection(): AniListConnection {
    const connection = this.database.getAniListConnection()
    return (
      connection ?? {
        connected: false,
        username: null,
        avatarUrl: null,
        bannerUrl: null,
        profileUrl: null,
        about: null,
        connectedAt: null,
        lastPullAt: null,
        lastSyncStatus: null,
      }
    )
  }

  async getHomeDiscover(): Promise<HomeDiscoverPayload> {
    const cacheKey = 'anilist:home:discover:v1'
    const cached = this.database.getCachedJson<HomeDiscoverPayload>(cacheKey)
    if (cached) {
      return cached
    }

    const currentSeason = getAniListSeason(new Date())
    const nextSeason = getNextAniListSeason(currentSeason)

    const results = await Promise.allSettled([
      this.fetchDiscoverList({ sort: ['TRENDING_DESC'] }),
      this.fetchDiscoverList({
        season: currentSeason.season,
        seasonYear: currentSeason.year,
        sort: ['POPULARITY_DESC'],
      }),
      this.fetchDiscoverList({
        season: nextSeason.season,
        seasonYear: nextSeason.year,
        sort: ['POPULARITY_DESC'],
        statusIn: ['NOT_YET_RELEASED', 'RELEASING'],
      }),
    ])

    const discover: HomeDiscoverPayload = {
      trending: results[0].status === 'fulfilled' ? results[0].value : [],
      popularThisSeason: results[1].status === 'fulfilled' ? results[1].value : [],
      upcomingNextSeason: results[2].status === 'fulfilled' ? results[2].value : [],
    }

    if (discover.trending.length || discover.popularThisSeason.length || discover.upcomingNextSeason.length) {
      this.database.setCachedJson(cacheKey, discover, this.env.cacheTtlMs)
    }

    return discover
  }

  async connect(input: { accessToken?: string; code?: string }): Promise<AniListConnection> {
    let accessToken = input.accessToken?.trim() || null
    let refreshToken: string | null = null

    if (!accessToken && input.code) {
      if (!this.env.aniListClientId || !this.env.aniListClientSecret || !this.env.aniListRedirectUri) {
        throw new Error('AniList OAuth is not fully configured')
      }

      const response = await fetch('https://anilist.co/api/v2/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: this.env.aniListClientId,
          client_secret: this.env.aniListClientSecret,
          redirect_uri: this.env.aniListRedirectUri,
          code: input.code,
        }),
      })

      if (!response.ok) {
        throw new Error(`AniList OAuth exchange failed with status ${response.status}`)
      }

      const data = (await response.json()) as { access_token?: string; refresh_token?: string | null }
      accessToken = data.access_token ?? null
      refreshToken = data.refresh_token ?? null
    }

    if (!accessToken) {
      throw new Error('AniList access token was not provided')
    }

    const viewer = await this.fetchViewer(accessToken)
    this.database.setAniListConnection({
      viewerId: viewer.id,
      username: viewer.name,
      avatarUrl: viewer.avatar?.large ?? null,
      bannerUrl: viewer.bannerImage ?? null,
      profileUrl: viewer.siteUrl ?? null,
      about: stripHtml(viewer.about),
      accessToken,
      refreshToken,
      lastPullAt: null,
      lastSyncStatus: 'Connected',
    })

    return this.syncNow()
  }

  enqueueShowSync(showId: string): void {
    if (!this.database.getAniListConnection()) {
      return
    }

    const snapshot = this.database.getAniListSyncSnapshot(showId)
    if (!snapshot) {
      return
    }

    this.database.enqueueAniListSync('state', snapshot)
  }

  async syncNow(): Promise<AniListConnection> {
    const importedCount = await this.importRemoteState(true)
    const backpostedCount = await this.backpostLocalState()
    this.database.setAniListStatus(
      `Two-way sync complete (${importedCount} AniList items imported, ${backpostedCount} AniFlow items backposted)`,
    )
    return this.getPublicConnection()
  }

  disconnect(): AniListConnection {
    this.database.clearAniListConnection()
    return this.getPublicConnection()
  }

  private async runBackgroundSync(): Promise<void> {
    if (this.syncing) {
      return
    }

    this.syncing = true
    try {
      const pushedCount = await this.flushPending()

      const connection = this.database.getAniListConnection()
      if (!connection?.accessToken) {
        return
      }

      if (pushedCount > 0) {
        this.database.setAniListStatus(`Pushed ${pushedCount} AniFlow change${pushedCount === 1 ? '' : 's'} to AniList`)
      }

      if (shouldImportNow(connection.lastPullAt)) {
        await this.importRemoteState(false)
      }
    } finally {
      this.syncing = false
    }
  }

  private async backpostLocalState(): Promise<number> {
    const snapshots = this.database.getAniListSyncSnapshots()
    this.database.replaceAniListStateQueue(snapshots)
    return this.flushPending()
  }

  private async flushPending(): Promise<number> {
    const connection = this.database.getAniListConnection()
    if (!connection?.accessToken) {
      return 0
    }

    let pushedCount = 0
    while (true) {
      const jobs = this.database.takePendingAniListJobs(5)
      if (jobs.length === 0) {
        break
      }

      for (const job of jobs) {
        try {
          if (job.action !== 'state') {
            this.database.completeAniListJob(job.id)
            continue
          }

          const payload = JSON.parse(job.payload) as AniListSyncSnapshot
          await this.syncSnapshotToAniList(payload, connection.accessToken)
          this.database.completeAniListJob(job.id)
          pushedCount += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : 'AniList sync failed'
          this.database.failAniListJob(job.id, message)
          this.database.setAniListStatus(message)
        }
      }
    }

    return pushedCount
  }

  private async importRemoteState(manual: boolean): Promise<number> {
    const connection = this.database.getAniListConnection()
    if (!connection?.accessToken) {
      return 0
    }

    const response = await this.graphql<AniListImportResponse>(
      `query ImportAniList($userId: Int, $userName: String) {
        Viewer {
          id
          name
          siteUrl
          about
          bannerImage
          avatar {
            large
          }
          favourites {
            anime {
              nodes {
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
                seasonYear
                episodes
              }
            }
          }
        }
        MediaListCollection(userId: $userId, userName: $userName, type: ANIME) {
          lists {
            entries {
              status
              progress
              updatedAt
              media {
                id
                isFavourite
                episodes
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
                seasonYear
              }
            }
          }
        }
      }`,
      {
        userId: connection.viewerId ?? null,
        userName: connection.username,
      },
      connection.accessToken,
    )

    const viewer = response.data?.Viewer
    if (!viewer) {
      throw new Error('AniList did not return the connected viewer profile')
    }

    this.database.updateAniListConnectionProfile({
      viewerId: viewer.id,
      username: viewer.name,
      avatarUrl: viewer.avatar?.large ?? null,
      bannerUrl: viewer.bannerImage ?? null,
      profileUrl: viewer.siteUrl ?? null,
      about: stripHtml(viewer.about),
    })

    const merged = new Map<
      number,
      {
        media: AniListLibraryMedia
        status: string | null
        progress: number
        favorited: boolean
        updatedAt: string
      }
    >()

    for (const list of response.data?.MediaListCollection?.lists ?? []) {
      for (const entry of list?.entries ?? []) {
        const media = entry?.media
        if (!media?.id) {
          continue
        }

        merged.set(media.id, {
          media,
          status: entry?.status ?? null,
          progress: Math.max(0, entry?.progress ?? 0),
          favorited: Boolean(media.isFavourite),
          updatedAt: fromUnixTimestamp(entry?.updatedAt) ?? nowIso(),
        })
      }
    }

    for (const media of viewer.favourites?.anime?.nodes ?? []) {
      if (!media?.id) {
        continue
      }

      const existing = merged.get(media.id)
      if (existing) {
        existing.favorited = true
        continue
      }

      merged.set(media.id, {
        media,
        status: null,
        progress: 0,
        favorited: true,
        updatedAt: nowIso(),
      })
    }

    let importedCount = 0
    const providerCache = new Map<string, string | null>()
    for (const item of merged.values()) {
      const showId = await this.resolveProviderShowId(item.media, providerCache)
      if (!showId) {
        continue
      }

      this.database.importAniListLibraryEntry({
        showId,
        mediaId: item.media.id,
        title: getPrimaryTitle(item.media),
        posterUrl: item.media.coverImage?.extraLarge ?? item.media.coverImage?.large ?? null,
        status: item.status,
        progress: item.progress,
        episodes: item.media.episodes ?? null,
        favorited: item.favorited,
        updatedAt: item.updatedAt,
      })
      importedCount += 1
    }

    const pulledAt = nowIso()
    this.database.setAniListPullTimestamp(pulledAt)
    this.database.setAniListStatus(
      manual ? `Two-way sync complete (${importedCount} AniList items imported)` : `Imported ${importedCount} AniList items`,
    )
    return importedCount
  }

  private async syncSnapshotToAniList(payload: AniListSyncSnapshot, accessToken: string): Promise<void> {
    const media = await this.lookupMedia(payload, accessToken)
    if (!media) {
      throw new Error('AniList could not match this title')
    }

    this.database.setLibraryAniListMediaId(payload.showId, media.id)

    const desiredStatus = resolveDesiredStatus(payload)
    const desiredProgress = resolveDesiredProgress(payload, media.episodes ?? null, media.mediaListEntry?.progress ?? null)

    if (desiredStatus) {
      await this.graphql(
        `mutation SaveAniListEntry($mediaId: Int!, $progress: Int!, $status: MediaListStatus) {
          SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
            id
          }
        }`,
        {
          mediaId: media.id,
          progress: desiredProgress,
          status: desiredStatus,
        },
        accessToken,
      )
    } else if (media.mediaListEntry?.id) {
      await this.graphql(
        `mutation DeleteAniListEntry($id: Int!) {
          DeleteMediaListEntry(id: $id) {
            deleted
          }
        }`,
        { id: media.mediaListEntry.id },
        accessToken,
      )
    }

    const remoteFavourite = Boolean(media.isFavourite)
    if (payload.favorited !== remoteFavourite) {
      await this.graphql(
        `mutation ToggleAniListFavourite($animeId: Int) {
          ToggleFavourite(animeId: $animeId) {
            anime {
              nodes {
                id
              }
            }
          }
        }`,
        { animeId: media.id },
        accessToken,
      )
    }
  }

  private async lookupMedia(
    payload: AniListSyncSnapshot,
    accessToken: string,
  ): Promise<NonNullable<AniListMediaLookupResponse['data']>['Media']> {
    const response = await this.graphql<AniListMediaLookupResponse>(
      `query LookupAniListMedia($id: Int, $search: String) {
        Media(id: $id, search: $search, type: ANIME) {
          id
          episodes
          isFavourite
          mediaListEntry {
            id
            status
            progress
          }
        }
      }`,
      {
        id: payload.anilistMediaId,
        search: payload.anilistMediaId ? undefined : payload.title,
      },
      accessToken,
    )

    return response.data?.Media ?? null
  }

  private async fetchViewer(accessToken: string): Promise<AniListViewer> {
    const viewer = await this.graphql<AniListViewerResponse>(
      `query ViewerProfile {
        Viewer {
          id
          name
          siteUrl
          about
          bannerImage
          avatar {
            large
          }
        }
      }`,
      undefined,
      accessToken,
    )

    const result = viewer.data?.Viewer
    if (!result) {
      throw new Error('AniList token did not return a viewer profile')
    }

    return result
  }

  private async fetchDiscoverList(input: {
    sort: string[]
    season?: AniListSeason
    seasonYear?: number
    statusIn?: string[]
  }): Promise<DiscoverShow[]> {
    const response = await this.graphql<AniListDiscoverResponse>(
      `query (
        $perPage: Int!
        $sort: [MediaSort]
        $season: MediaSeason
        $seasonYear: Int
        $statusIn: [MediaStatus]
      ) {
        Page(page: 1, perPage: $perPage) {
          media(
            type: ANIME
            isAdult: false
            sort: $sort
            season: $season
            seasonYear: $seasonYear
            status_in: $statusIn
          ) {
            id
            title {
              english
              romaji
              native
            }
            synonyms
            description
            bannerImage
            coverImage {
              extraLarge
              large
            }
            genres
            status
            season
            seasonYear
            averageScore
            trailer {
              id
              site
              thumbnail
            }
          }
        }
      }`,
      {
        perPage: 12,
        sort: input.sort,
        season: input.season,
        seasonYear: input.seasonYear,
        statusIn: input.statusIn,
      },
      null,
    )

    const media = response.data?.Page?.media ?? []
    return Promise.all(media.map((entry) => this.mapDiscoverShow(entry)))
  }

  private async mapDiscoverShow(media: AniListDiscoverMedia): Promise<DiscoverShow> {
    const providerMatch = await this.resolveProviderMatchByTitles(collectAniListTitles(media), media.seasonYear ?? null)

    return {
      id: `anilist:${media.id}`,
      providerShowId: providerMatch?.id ?? null,
      title: getPrimaryTitle(media),
      originalTitle: media.title?.native?.trim() || media.title?.romaji?.trim() || null,
      bannerUrl: media.bannerImage ?? null,
      posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
      description: stripHtml(media.description),
      genres: media.genres ?? [],
      status: media.status ?? null,
      year: media.seasonYear ?? null,
      season: media.season ?? null,
      score: media.averageScore ?? null,
      availableEpisodes: providerMatch?.availableEpisodes ?? { sub: 0, dub: 0 },
      trailer: mapTrailer(media.trailer),
    }
  }

  private async resolveProviderShowId(
    media: AniListLibraryMedia,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    const existing = this.database.getShowIdByAniListMediaId(media.id)
    if (existing) {
      return existing
    }

    const titles = collectAniListTitles(media)
    const cacheKey = `${titles.join('|')}::${media.seasonYear ?? ''}`
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null
    }

    const match = await this.resolveProviderMatchByTitles(titles, media.seasonYear ?? null)
    const showId = match?.id ?? null
    cache.set(cacheKey, showId)
    return showId
  }

  private async resolveProviderMatchByTitles(titles: string[], year: number | null): Promise<ShowSummary | null> {
    for (const title of titles.slice(0, 4)) {
      try {
        const results = await this.provider.search(title)
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

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown> | undefined,
    accessToken?: string | null,
  ): Promise<T> {
    return this.enqueueGraphqlRequest(() => this.executeGraphqlRequest<T>(query, variables, accessToken))
  }

  private async executeGraphqlRequest<T>(
    query: string,
    variables: Record<string, unknown> | undefined,
    accessToken?: string | null,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    }

    headers.Accept = 'application/json'

    let lastError: Error | null = null
    for (const endpoint of ANILIST_GRAPHQL_ENDPOINTS) {
      try {
        for (let attempt = 0; attempt <= ANILIST_GRAPHQL_MAX_RETRIES; attempt += 1) {
          await this.waitForGraphqlSlot()
          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables }),
          })

          if (!response.ok) {
            if (response.status === 404 && endpoint !== ANILIST_GRAPHQL_ENDPOINTS[ANILIST_GRAPHQL_ENDPOINTS.length - 1]) {
              lastError = new Error(`AniList GraphQL request failed with status ${response.status}`)
              break
            }

            if (response.status === 429 && attempt < ANILIST_GRAPHQL_MAX_RETRIES) {
              await sleep(resolveRetryDelayMs(response.headers.get('retry-after'), attempt))
              continue
            }

            throw new Error(`AniList GraphQL request failed with status ${response.status}`)
          }

          const body = (await response.json()) as { errors?: Array<{ message?: string }> }
          if (body.errors?.length) {
            throw new Error(body.errors.map((error) => error.message).filter(Boolean).join('; ') || 'AniList request failed')
          }

          return body as T
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('AniList request failed')
      }
    }

    throw lastError ?? new Error('AniList request failed')
  }

  private async enqueueGraphqlRequest<T>(task: () => Promise<T>): Promise<T> {
    const run = this.graphqlQueue.then(task, task)
    this.graphqlQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async waitForGraphqlSlot(): Promise<void> {
    const waitMs = this.lastGraphqlRequestAt + ANILIST_GRAPHQL_MIN_INTERVAL_MS - Date.now()
    if (waitMs > 0) {
      await sleep(waitMs)
    }

    this.lastGraphqlRequestAt = Date.now()
  }
}

function shouldImportNow(lastPullAt: string | null | undefined): boolean {
  if (!lastPullAt) {
    return true
  }

  const timestamp = Date.parse(lastPullAt)
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= BACKGROUND_IMPORT_INTERVAL_MS
}

function resolveDesiredStatus(payload: AniListSyncSnapshot): 'CURRENT' | 'PLANNING' | 'COMPLETED' | null {
  if (payload.completed) {
    return 'COMPLETED'
  }

  if (payload.resumeEpisodeNumber || parseEpisodeValue(payload.latestEpisodeNumber) > 0) {
    return 'CURRENT'
  }

  if (payload.watchLater) {
    return 'PLANNING'
  }

  return null
}

function resolveDesiredProgress(payload: AniListSyncSnapshot, remoteEpisodes: number | null, remoteProgress: number | null): number {
  const latest = parseEpisodeValue(payload.latestEpisodeNumber)
  const resume = parseEpisodeValue(payload.resumeEpisodeNumber)

  if (payload.completed) {
    return latest || resume || remoteEpisodes || remoteProgress || 0
  }

  if (payload.resumeEpisodeNumber || latest > 0) {
    return resume || latest || remoteProgress || 0
  }

  return 0
}

function parseEpisodeValue(value: string | null | undefined): number {
  if (!value) {
    return 0
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function resolveRetryDelayMs(retryAfter: string | null, attempt: number): number {
  const retryAfterSeconds = Number.parseFloat(retryAfter ?? '')
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1000)
  }

  return Math.min(1000 * 2 ** attempt, 8000)
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function fromUnixTimestamp(value: number | null | undefined): string | null {
  if (!value || value <= 0) {
    return null
  }

  return new Date(value * 1000).toISOString()
}

function getAniListSeason(date: Date): { season: AniListSeason; year: number } {
  const month = date.getUTCMonth() + 1
  const year = date.getUTCFullYear()

  if (month <= 3) {
    return { season: 'WINTER', year }
  }

  if (month <= 6) {
    return { season: 'SPRING', year }
  }

  if (month <= 9) {
    return { season: 'SUMMER', year }
  }

  return { season: 'FALL', year }
}

function getNextAniListSeason(current: { season: AniListSeason; year: number }): { season: AniListSeason; year: number } {
  switch (current.season) {
    case 'WINTER':
      return { season: 'SPRING', year: current.year }
    case 'SPRING':
      return { season: 'SUMMER', year: current.year }
    case 'SUMMER':
      return { season: 'FALL', year: current.year }
    case 'FALL':
      return { season: 'WINTER', year: current.year + 1 }
  }
}

function collectAniListTitles(media: AniListLibraryMedia): string[] {
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

function getPrimaryTitle(media: AniListLibraryMedia): string {
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
