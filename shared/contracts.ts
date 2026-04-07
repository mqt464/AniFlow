export const translationTypes = ['sub', 'dub'] as const

export type TranslationType = (typeof translationTypes)[number]

export interface ShowSummary {
  id: string
  title: string
  originalTitle: string | null
  romajiTitle?: string | null
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

export interface ShowPageDate {
  year: number | null
  month: number | null
  day: number | null
}

export interface ShowPageAudienceStat {
  status: 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'PAUSED' | 'DROPPED'
  amount: number
}

export interface ShowPageRanking {
  rank: number
  type: string
  context: string | null
  season: string | null
  year: number | null
  allTime: boolean
}

export interface ShowPageTag {
  name: string
  description: string | null
  category: string | null
  rank: number | null
  isSpoiler: boolean
}

export interface ShowPageMediaCard {
  anilistId: number
  providerShowId: string | null
  availableOnSite: boolean
  title: string
  originalTitle: string | null
  posterUrl: string | null
  format: string | null
  status: string | null
  season: string | null
  year: number | null
  score: number | null
  siteUrl: string | null
}

export interface ShowPageRelation extends ShowPageMediaCard {
  relationType: string | null
}

export interface ShowPageRecommendation extends ShowPageMediaCard {
  rating: number | null
}

export interface ShowPageReviewPreview {
  id: number
  summary: string
  rating: number | null
  ratingAmount: number | null
  siteUrl: string | null
  createdAt: string | null
  userName: string
  userAvatarUrl: string | null
}

export interface ShowPageAniListDetails {
  mediaId: number
  siteUrl: string | null
  title: {
    romaji: string | null
    native: string | null
  }
  synopsis: string | null
  trailer: TrailerAsset | null
  format: string | null
  status: string | null
  episodes: number | null
  duration: number | null
  season: string | null
  seasonYear: number | null
  startDate: ShowPageDate | null
  endDate: ShowPageDate | null
  averageScore: number | null
  popularity: number | null
  favourites: number | null
  genres: string[]
  rankings: ShowPageRanking[]
  audienceStats: ShowPageAudienceStat[]
  tags: ShowPageTag[]
  relations: ShowPageRelation[]
  recommendations: ShowPageRecommendation[]
  reviews: ShowPageReviewPreview[]
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
  thumbnailUrl?: string | null
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
  aniListDetails: ShowPageAniListDetails | null
  translationType: TranslationType
  episodes: ShowEpisode[]
  progress: ShowProgressSummary
  library: LibraryEntry | null
  fillerSource: 'jikan' | null
  fillerMatchTitle: string | null
  malRank: number | null
  malPopularity: number | null
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
  dropped: boolean
  completedAt: string | null
}

export interface LibraryUpdateInput {
  showId: string
  title: string
  posterUrl?: string | null
  favorited?: boolean
  watchLater?: boolean
  completed?: boolean
  dropped?: boolean
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
  dropped: LibraryEntry[]
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
