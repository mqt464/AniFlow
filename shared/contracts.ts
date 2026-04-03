export const translationTypes = ['sub', 'dub'] as const

export type TranslationType = (typeof translationTypes)[number]

export interface ShowSummary {
  id: string
  title: string
  originalTitle: string | null
  bannerUrl: string | null
  posterUrl: string | null
  description: string | null
  genres: string[]
  status: string | null
  year: number | null
  season: string | null
  score: number | null
  availableEpisodes: Record<TranslationType, number>
}

export interface TrailerAsset {
  id: string
  site: string
  thumbnailUrl: string | null
  videoUrl: string | null
  embedUrl: string | null
}

export interface ShowDetail extends ShowSummary {
  provider: 'allanime'
}

export interface DiscoverShow {
  id: string
  providerShowId: string | null
  title: string
  originalTitle: string | null
  bannerUrl: string | null
  posterUrl: string | null
  description: string | null
  genres: string[]
  status: string | null
  year: number | null
  season: string | null
  score: number | null
  availableEpisodes: Record<TranslationType, number>
  trailer: TrailerAsset | null
}

export interface EpisodeSummary {
  showId: string
  number: string
  title: string
  translationType: TranslationType
  durationSeconds: number | null
}

export interface EpisodeProgressState {
  currentTime: number
  duration: number
  completed: boolean
  updatedAt: string
}

export interface EpisodeAnnotation {
  isFiller: boolean
  isRecap: boolean
  source: 'jikan' | null
}

export interface ShowEpisode extends EpisodeSummary {
  progress: EpisodeProgressState | null
  isCurrent: boolean
  annotation: EpisodeAnnotation | null
}

export interface ShowProgressSummary {
  completedEpisodeCount: number
  startedEpisodeCount: number
  currentEpisodeNumber: string | null
  currentTime: number
  latestEpisodeNumber: string | null
  updatedAt: string | null
}

export interface ShowPagePayload {
  show: ShowDetail
  translationType: TranslationType
  episodes: ShowEpisode[]
  progress: ShowProgressSummary
  library: LibraryEntry | null
  fillerSource: 'jikan' | null
  fillerMatchTitle: string | null
}

export interface SkipSegment {
  label: string
  startTime: number
  endTime: number
}

export interface StreamVariant {
  id: string
  label: string
  proxyUrl: string
}

export interface ResolvedStream {
  showId: string
  episodeNumber: string
  translationType: TranslationType
  showTitle: string
  streamUrl: string
  mimeType: string
  subtitleUrl: string | null
  subtitleMimeType: string | null
  qualities: StreamVariant[]
  skipSegments: SkipSegment[]
  nextEpisodeNumber: string | null
  title: string
}

export interface WatchProgress {
  showId: string
  episodeNumber: string
  title: string
  posterUrl: string | null
  currentTime: number
  duration: number
  completed: boolean
  updatedAt: string
}

export interface LibraryEntry {
  showId: string
  title: string
  posterUrl: string | null
  latestEpisodeNumber: string | null
  resumeEpisodeNumber: string | null
  resumeTime: number
  updatedAt: string
  favorited: boolean
  watchLater: boolean
  completed: boolean
  completedAt: string | null
}

export interface LibraryUpdateInput {
  showId: string
  title: string
  posterUrl?: string | null
  favorited?: boolean
  watchLater?: boolean
  completed?: boolean
  removeFromContinueWatching?: boolean
}

export interface AniListConnection {
  connected: boolean
  username: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  profileUrl: string | null
  about: string | null
  connectedAt: string | null
  lastPullAt: string | null
  lastSyncStatus: string | null
}

export interface HomePayload {
  continueWatching: LibraryEntry[]
  watchLater: LibraryEntry[]
  completed: LibraryEntry[]
  recentProgress: WatchProgress[]
  favorites: LibraryEntry[]
  discover: {
    trending: DiscoverShow[]
    popularThisSeason: DiscoverShow[]
    upcomingNextSeason: DiscoverShow[]
  }
  anilist: AniListConnection
  requiresPassword: boolean
}

export interface SearchPayload {
  query: string
  results: ShowSummary[]
}

export interface PlaybackResolveInput {
  showId: string
  episodeNumber: string
  translationType?: TranslationType
  preferredQuality?: string | null
}

export interface ProgressInput {
  showId: string
  episodeNumber: string
  title: string
  posterUrl?: string | null
  currentTime: number
  duration: number
  completed: boolean
}

export interface AniListConnectInput {
  accessToken?: string
  code?: string
  validateOnly?: boolean
}
