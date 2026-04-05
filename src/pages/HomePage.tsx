import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Play, Star, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'

import type {
  DiscoverShow,
  HomePayload,
  LibraryEntry,
  LibraryUpdateInput,
  ShowSummary,
  TranslationType,
  WatchProgress,
} from '../../shared/contracts'
import { PosterImage } from '../components/PosterImage'
import { RatingStars } from '../components/RatingStars'
import { ApiError, createApi } from '../lib/api'
import { pickAvailableTranslation, withMode } from '../lib/appPreferences'
import { useSession } from '../session'

const HERO_ROTATE_MS = 9000
const EMPTY_LIBRARY: LibraryEntry[] = []
const EMPTY_PROGRESS: WatchProgress[] = []
const EMPTY_DISCOVER: HomePayload['discover'] = {
  trending: [],
  popularThisSeason: [],
  upcomingNextSeason: [],
}
const RAIL_SKELETON_COUNT = 6

interface RailItem {
  id: string
  kind: 'continue' | 'watchLater' | 'completed' | 'discover'
  showId: string | null
  href: string | null
  title: string
  posterUrl: string | null
  rating: number | null
  libraryEntry: LibraryEntry | null
  episodeLabel: string
  hasNewEpisode?: boolean
  progressPercent?: number
  progressLabel?: string | null
}

interface ContextMenuState {
  item: RailItem
  x: number
  y: number
}

interface ContextMenuAction {
  key: string
  label: string
  icon: 'watchLater' | 'complete' | 'remove'
  tone?: 'default' | 'danger'
  update: LibraryUpdateInput
}

const CONTEXT_MENU_WIDTH = 248
const CONTEXT_MENU_HEIGHT = 220

export function HomePage() {
  const { password, preferredTranslationType } = useSession()
  const [data, setData] = useState<HomePayload | null>(null)
  const [showMetadata, setShowMetadata] = useState<Record<string, ShowSummary>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [homeRevision, setHomeRevision] = useState(0)
  const [activeHeroIndex, setActiveHeroIndex] = useState(0)
  const [expandedFeaturedSynopsisIds, setExpandedFeaturedSynopsisIds] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const api = createApi(password)
    let active = true

    setLoading(true)

    void api
      .getHome()
      .then((value) => {
        if (!active) {
          return
        }

        setData(value)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (!active) {
          return
        }

        setError(reason instanceof ApiError ? reason.message : 'Unable to load AniFlow')
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [homeRevision, password])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && contextMenuRef.current?.contains(target)) {
        return
      }

      setContextMenu(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  const continueWatching = data?.continueWatching ?? EMPTY_LIBRARY
  const watchLater = data?.watchLater ?? EMPTY_LIBRARY
  const completed = data?.completed ?? EMPTY_LIBRARY
  const recentProgress = data?.recentProgress ?? EMPTY_PROGRESS
  const discover = data?.discover ?? EMPTY_DISCOVER

  const libraryByShowId = useMemo(() => {
    const map = new Map<string, LibraryEntry>()

    for (const entry of watchLater) {
      map.set(entry.showId, entry)
    }

    for (const entry of completed) {
      map.set(entry.showId, entry)
    }

    for (const entry of continueWatching) {
      map.set(entry.showId, entry)
    }

    return map
  }, [completed, continueWatching, watchLater])

  const recentByShowId = useMemo(() => {
    const map = new Map<string, WatchProgress>()

    for (const item of recentProgress) {
      const current = map.get(item.showId)
      if (!current || new Date(item.updatedAt).getTime() > new Date(current.updatedAt).getTime()) {
        map.set(item.showId, item)
      }
    }

    return map
  }, [recentProgress])

  const metadataRequests = useMemo(() => {
    const uniqueTitles = new Map<string, { showId: string; title: string }>()

    for (const entry of continueWatching) {
      uniqueTitles.set(entry.showId, { showId: entry.showId, title: entry.title })
    }

    for (const entry of watchLater) {
      uniqueTitles.set(entry.showId, { showId: entry.showId, title: entry.title })
    }

    for (const entry of completed) {
      uniqueTitles.set(entry.showId, { showId: entry.showId, title: entry.title })
    }

    for (const entry of recentByShowId.values()) {
      uniqueTitles.set(entry.showId, { showId: entry.showId, title: entry.title })
    }

    return Array.from(uniqueTitles.values())
  }, [completed, continueWatching, recentByShowId, watchLater])

  useEffect(() => {
    if (!metadataRequests.length) {
      return
    }

    const api = createApi(password)
    let active = true

    void Promise.all(
      metadataRequests.map(async ({ showId, title }) => {
        try {
          const show = await api.getShow(showId)
          return [showId, show] as const
        } catch {
          try {
            const payload = await api.search(title)
            const match =
              payload.results.find((result) => result.id === showId) ??
              payload.results.find((result) => normalizeTitle(result.title) === normalizeTitle(title)) ??
              payload.results[0]

            return match ? ([showId, match] as const) : null
          } catch {
            return null
          }
        }
      }),
    ).then((results) => {
      if (!active) {
        return
      }

      setShowMetadata((current) => {
        const next = { ...current }
        for (const entry of results) {
          if (entry) {
            next[entry[0]] = entry[1]
          }
        }

        return next
      })
    })

    return () => {
      active = false
    }
  }, [metadataRequests, password])

  const metadataByShowId = useMemo(() => {
    const next: Record<string, ShowSummary> = { ...showMetadata }

    for (const show of [...discover.trending, ...discover.popularThisSeason, ...discover.upcomingNextSeason]) {
      if (!show.providerShowId) {
        continue
      }

      next[show.providerShowId] = discoverShowToSummary(show)
    }

    return next
  }, [discover, showMetadata])

  const featuredShows = useMemo(
    () => discover.trending.filter((show) => show.bannerUrl || show.posterUrl).slice(0, 5),
    [discover.trending],
  )
  const safeHeroIndex = featuredShows.length ? activeHeroIndex % featuredShows.length : 0

  useEffect(() => {
    if (featuredShows.length <= 1) {
      return
    }

    const intervalId = window.setInterval(() => {
      setActiveHeroIndex((currentIndex) => (currentIndex + 1) % featuredShows.length)
    }, HERO_ROTATE_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [featuredShows.length])

  const currentWatchingItems = continueWatching.map((entry) => {
    const metadata = metadataByShowId[entry.showId]
    const resumeSnapshot = getResumeSnapshot(entry, recentProgress)
    const latestAvailableEpisode = getLatestAvailableEpisode(metadata?.availableEpisodes)
    const hasNewEpisode = hasNewEpisodeAvailable(entry.latestEpisodeNumber, latestAvailableEpisode)

    return {
      id: entry.showId,
      kind: 'continue',
      showId: entry.showId,
      href: withMode(`/player/${entry.showId}/${resumeSnapshot.episodeNumber}`, preferredTranslationType),
      title: metadata?.title ?? entry.title,
      posterUrl: entry.posterUrl ?? metadata?.posterUrl ?? metadata?.bannerUrl ?? null,
      rating: metadata?.score ?? null,
      libraryEntry: entry,
      episodeLabel: `Episode ${resumeSnapshot.episodeNumber} in progress`,
      hasNewEpisode,
      progressPercent: resumeSnapshot.progressPercent,
      progressLabel: formatTimeRange(resumeSnapshot.currentTime, resumeSnapshot.duration),
    } satisfies RailItem
  })

  const watchLaterItems = watchLater.map((entry) => {
    const metadata = metadataByShowId[entry.showId]
    const latestAvailableEpisode = getLatestAvailableEpisode(metadata?.availableEpisodes)
    const hasNewEpisode = hasNewEpisodeAvailable(entry.latestEpisodeNumber, latestAvailableEpisode)

    return {
      id: entry.showId,
      kind: 'watchLater',
      showId: entry.showId,
      href: withMode(`/shows/${entry.showId}`, preferredTranslationType),
      title: metadata?.title ?? entry.title,
      posterUrl: entry.posterUrl ?? metadata?.posterUrl ?? metadata?.bannerUrl ?? null,
      rating: metadata?.score ?? null,
      libraryEntry: entry,
      episodeLabel: buildQueuedEpisodeLabel(latestAvailableEpisode, metadata?.status),
      hasNewEpisode,
    } satisfies RailItem
  })

  const completedItems = completed.map((entry) => {
    const metadata = metadataByShowId[entry.showId]
    const latestAvailableEpisode = getLatestAvailableEpisode(metadata?.availableEpisodes)
    const hasNewEpisode = hasNewEpisodeAvailable(entry.latestEpisodeNumber, latestAvailableEpisode)
    return {
      id: entry.showId,
      kind: 'completed',
      showId: entry.showId,
      href: withMode(`/shows/${entry.showId}`, preferredTranslationType),
      title: metadata?.title ?? entry.title,
      posterUrl: entry.posterUrl ?? metadata?.posterUrl ?? metadata?.bannerUrl ?? null,
      rating: metadata?.score ?? null,
      libraryEntry: entry,
      episodeLabel: entry.latestEpisodeNumber ? `Completed through ep ${entry.latestEpisodeNumber}` : 'Completed',
      hasNewEpisode,
    } satisfies RailItem
  })

  const trendingItems = buildDiscoverRail(discover.trending, preferredTranslationType)
  const seasonalItems = buildDiscoverRail(discover.popularThisSeason, preferredTranslationType)
  const upcomingItems = buildDiscoverRail(discover.upcomingNextSeason, preferredTranslationType)
  const contextMenuActions = contextMenu ? buildContextMenuActions(contextMenu.item) : []
  const isInitialLoading = loading && !data

  const handleLibraryAction = async (update: LibraryUpdateInput) => {
    try {
      await createApi(password).updateLibrary(update)
      setError(null)
      setContextMenu(null)
      setHomeRevision((current) => current + 1)
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to update your library right now')
    }
  }

  const handleItemContextMenu = (event: ReactMouseEvent<HTMLElement>, item: RailItem) => {
    if (!item.showId) {
      return
    }

    event.preventDefault()
    setContextMenu({
      item,
      x: clampMenuCoordinate(event.clientX, CONTEXT_MENU_WIDTH, window.innerWidth),
      y: clampMenuCoordinate(event.clientY, CONTEXT_MENU_HEIGHT, window.innerHeight),
    })
  }

  return (
    <section className="page home-page">
      <h1 className="sr-only">AniFlow home</h1>

      {error ? <div className="notice error">{error}</div> : null}

      <section aria-label="Trending now" className="featured-carousel">
        {isInitialLoading ? (
          <FeaturedCarouselSkeleton />
        ) : featuredShows.length ? (
          <>
            <div className="featured-track" style={{ transform: `translateX(-${safeHeroIndex * 100}%)` }}>
              {featuredShows.map((show, index) => {
                const showHref = show.providerShowId
                  ? withMode(`/shows/${show.providerShowId}`, pickAvailableTranslation(show.availableEpisodes, preferredTranslationType))
                  : null
                const synopsis = show.description ?? 'Open the title page to inspect catalog availability and metadata.'
                const shouldClampSynopsis = synopsis.length > 220
                const synopsisExpanded = Boolean(expandedFeaturedSynopsisIds[show.id])
                const titleLine = buildFeaturedTitleLine(show)
                const scoreLabel = formatFeaturedScore(show.score)
                const heroTaxonomyItems = buildFeaturedHeroTaxonomyItems(show)

                return (
                  <article className="featured-slide" key={show.id}>
                    <div className="featured-artwork">
                      {show.bannerUrl || show.posterUrl ? (
                        <img alt="" className="featured-backdrop" src={show.bannerUrl ?? show.posterUrl ?? ''} />
                      ) : null}
                    </div>

                    <div className="featured-overlay">
                      <div className="featured-content">
                        <div className="show-canvas-title-block">
                          <div className="show-canvas-title-tags" aria-label="Show highlights">
                            <div className="show-canvas-title-tag">
                              <span>Trending pick</span>
                            </div>
                            {show.score ? (
                              <div className="show-canvas-title-tag">
                                <Star className="show-canvas-title-tag-icon" size={13} strokeWidth={2} />
                                <span>{Math.round(show.score)}%</span>
                              </div>
                            ) : null}
                            {show.status ? <div className="show-canvas-title-tag show-canvas-title-tag-status">{formatFeaturedStatus(show.status)}</div> : null}
                          </div>

                          {titleLine ? (
                            <p className="show-canvas-original">
                              <span>{titleLine.native}</span>
                              <span aria-hidden="true" className="show-canvas-original-separator">
                                ·
                              </span>
                              <span>{titleLine.romaji}</span>
                            </p>
                          ) : null}

                          <h1>{show.title}</h1>

                          {scoreLabel ? (
                            <div className="show-canvas-rating" aria-label="Score and audience">
                              <div className="show-canvas-rating-chip show-canvas-rating-chip-score">
                                <RatingStars valuePercent={show.score ?? 0} />
                                <span className="show-canvas-rating-value">{scoreLabel}</span>
                              </div>
                            </div>
                          ) : null}

                          <div className="show-canvas-synopsis">
                            <p className={`show-canvas-synopsis-copy ${synopsisExpanded ? 'expanded' : ''}`}>{synopsis}</p>
                            {shouldClampSynopsis ? (
                              <button
                                aria-expanded={synopsisExpanded}
                                className={`show-canvas-synopsis-toggle ${synopsisExpanded ? 'expanded' : ''}`}
                                type="button"
                                onClick={() =>
                                  setExpandedFeaturedSynopsisIds((current) => ({
                                    ...current,
                                    [show.id]: !current[show.id],
                                  }))
                                }
                              >
                                <span>{synopsisExpanded ? 'Show less' : 'Show more'}</span>
                                <ChevronDown size={14} strokeWidth={2} />
                              </button>
                            ) : null}

                            {heroTaxonomyItems.length ? (
                              <div className="show-canvas-hero-taxonomy" aria-label="Genres and tags">
                                {heroTaxonomyItems.map((item, itemIndex) => (
                                  <Fragment key={item.key}>
                                    {itemIndex > 0 ? (
                                      <span aria-hidden="true" className="show-canvas-hero-taxonomy-separator">
                                        ·
                                      </span>
                                    ) : null}
                                    <span className={`show-canvas-hero-taxonomy-item ${item.kind === 'tag' ? 'is-tag' : ''}`}>{item.label}</span>
                                  </Fragment>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="featured-actions">
                          {showHref ? (
                            <Link className="featured-primary-action" to={showHref}>
                              <Play aria-hidden="true" size={16} strokeWidth={1.9} />
                              <span>Open show</span>
                            </Link>
                          ) : (
                            <span className="featured-inline-status">{describeDiscoverAvailability(show)}</span>
                          )}

                          {show.trailer?.videoUrl ? (
                            <a
                              className="featured-trailer-action"
                              href={show.trailer.videoUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <Play aria-hidden="true" size={15} strokeWidth={1.9} />
                              <span>Watch trailer</span>
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>

            <div className="featured-controls">
              <div className="carousel-dots" aria-label="Featured titles">
                {featuredShows.map((show, index) => (
                  <button
                    key={show.id}
                    aria-label={`Show ${show.title}`}
                    aria-pressed={index === safeHeroIndex}
                    className={`carousel-dot ${index === safeHeroIndex ? 'active' : ''}`}
                    type="button"
                    onClick={() => setActiveHeroIndex(index)}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="featured-empty">
            <strong>Featured titles will appear here after AniList discovery results load.</strong>
            <span>Use the search bar to jump straight into the library while the home feed warms up.</span>
          </div>
        )}
      </section>

      <PosterRail
        emptyMessage="Nothing in progress yet. Start a show from search and it will land here."
        items={currentWatchingItems}
        loading={isInitialLoading}
        onItemContextMenu={handleItemContextMenu}
        title="Currently watching"
      />

      <PosterRail
        emptyMessage="Use the show page or the right-click menu to stash titles here."
        items={watchLaterItems}
        loading={isInitialLoading}
        onItemContextMenu={handleItemContextMenu}
        title="Watch later"
      />

      <PosterRail
        items={trendingItems}
        loading={isInitialLoading}
        onItemContextMenu={handleItemContextMenu}
        title="Trending now"
      />

      <PosterRail
        items={seasonalItems}
        loading={isInitialLoading}
        onItemContextMenu={handleItemContextMenu}
        title="Popular this season"
      />

      <PosterRail
        items={upcomingItems}
        loading={isInitialLoading}
        onItemContextMenu={handleItemContextMenu}
        title="Upcoming next season"
      />

      {isInitialLoading || completedItems.length ? (
        <PosterRail
          emptyMessage="Completed shows will collect here automatically."
          items={completedItems}
          loading={isInitialLoading}
          onItemContextMenu={handleItemContextMenu}
          title="Completed"
        />
      ) : null}

      {contextMenu && contextMenuActions.length ? (
        <div
          ref={contextMenuRef}
          className="library-context-menu"
          role="menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          {contextMenuActions.map((action) => (
            <button
              key={action.key}
              className={`library-context-menu-action${action.tone === 'danger' ? ' is-danger' : ''}`}
              role="menuitem"
              type="button"
              onClick={() => void handleLibraryAction(action.update)}
            >
              <span className="library-context-menu-action-icon" aria-hidden="true">
                {renderContextMenuIcon(action.icon)}
              </span>
              <span className="library-context-menu-action-copy">{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function PosterRail({
  title,
  items,
  loading = false,
  emptyMessage,
  onItemContextMenu,
}: {
  title: string
  items: RailItem[]
  loading?: boolean
  emptyMessage?: string
  onItemContextMenu?: (event: ReactMouseEvent<HTMLElement>, item: RailItem) => void
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const shouldRenderScrollButtons = items.length > 1

  useEffect(() => {
    const rail = railRef.current
    if (!rail || !items.length) {
      return
    }

    const syncButtons = () => {
      const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth)
      setHasOverflow(maxScroll > 6)
      setCanScrollLeft(rail.scrollLeft > 6)
      setCanScrollRight(rail.scrollLeft < maxScroll - 6)
    }

    const handleScroll = () => {
      syncButtons()
    }

    rail.addEventListener('scroll', handleScroll, { passive: true })
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            syncButtons()
          })

    resizeObserver?.observe(rail)
    window.addEventListener('resize', syncButtons)
    const animationFrameId = window.requestAnimationFrame(syncButtons)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', syncButtons)
      rail.removeEventListener('scroll', handleScroll)
    }
  }, [items.length])

  const scrollRail = (direction: 'left' | 'right') => {
    const rail = railRef.current
    if (!rail) {
      return
    }

    const amount = Math.max(rail.clientWidth - 160, 220)
    rail.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    })
  }

  return (
    <section className="media-section">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
        </div>
      </div>

      {loading ? (
        <div aria-hidden="true" className="poster-rail-shell">
          <div className="poster-rail poster-rail-skeleton" role="presentation">
            {Array.from({ length: RAIL_SKELETON_COUNT }, (_, index) => (
              <div className="poster-card poster-card-large poster-card-skeleton" key={index}>
                <div className="loading-skeleton poster-card-image poster-card-skeleton-media" />
                <div className="poster-card-body">
                  <div className="poster-card-copy">
                    <div className="loading-skeleton loading-skeleton-line poster-card-skeleton-line poster-card-skeleton-line-title" />
                    <div className="poster-card-meta-row">
                      <div className="loading-skeleton loading-skeleton-line poster-card-skeleton-line poster-card-skeleton-line-meta" />
                      <div className="loading-skeleton loading-skeleton-chip poster-card-skeleton-chip" />
                    </div>
                    <div className="loading-skeleton loading-skeleton-line poster-card-skeleton-line poster-card-skeleton-line-progress" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : items.length ? (
        <div className="poster-rail-shell">
          {shouldRenderScrollButtons ? (
            <button
              aria-label={`Scroll ${title} left`}
              className="rail-scroll-button rail-scroll-button-left"
              disabled={!canScrollLeft}
              type="button"
              onClick={() => scrollRail('left')}
            >
              <ChevronLeft size={20} strokeWidth={1.9} />
            </button>
          ) : null}

          <div ref={railRef} className="poster-rail" role="list">
            {items.map((item) =>
              item.href ? (
                <Link
                  className="poster-card poster-card-large"
                  key={item.id}
                  role="listitem"
                  to={item.href}
                  onContextMenu={onItemContextMenu ? (event) => onItemContextMenu(event, item) : undefined}
                >
                  <RailCardContent item={item} />
                </Link>
              ) : (
                <article
                  className="poster-card poster-card-large poster-card-unavailable"
                  key={item.id}
                  role="listitem"
                  onContextMenu={onItemContextMenu ? (event) => onItemContextMenu(event, item) : undefined}
                >
                  <RailCardContent item={item} />
                </article>
              ),
            )}
          </div>

          {shouldRenderScrollButtons ? (
            <button
              aria-label={`Scroll ${title} right`}
              className="rail-scroll-button rail-scroll-button-right"
              disabled={!canScrollRight}
              type="button"
              onClick={() => scrollRail('right')}
            >
              <ChevronRight size={20} strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="empty-state media-empty">{emptyMessage ?? 'This row will fill in after you start watching or save a show.'}</div>
      )}
    </section>
  )
}

function FeaturedCarouselSkeleton() {
  return (
    <div aria-hidden="true" className="featured-skeleton">
      <div className="featured-skeleton-copy">
        <div className="loading-skeleton loading-skeleton-title featured-skeleton-title" />
        <div className="loading-skeleton loading-skeleton-line featured-skeleton-line" />
        <div className="loading-skeleton loading-skeleton-line featured-skeleton-line featured-skeleton-line-short" />
        <div className="featured-skeleton-actions">
          <div className="loading-skeleton loading-skeleton-button" />
          <div className="loading-skeleton loading-skeleton-button loading-skeleton-button-secondary" />
        </div>
      </div>
      <div className="featured-controls" aria-hidden="true">
        <div className="carousel-dots">
          {Array.from({ length: 5 }, (_, index) => (
            <span className="carousel-dot" key={index} />
          ))}
        </div>
      </div>
    </div>
  )
}

function RailCardContent({ item }: { item: RailItem }) {
  return (
    <>
      <div className="poster-card-media">
        <PosterImage alt={`${item.title} poster`} className="poster-card-image" src={item.posterUrl} />

        {typeof item.progressPercent === 'number' ? (
          <div className="poster-card-canvas-progress">
            {item.progressLabel ? <span className="poster-card-canvas-progress-label">{item.progressLabel}</span> : null}
            <div aria-hidden="true" className="poster-progress">
              <div className="poster-progress-fill" style={{ width: `${item.progressPercent}%` }} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="poster-card-body">
        <div className="poster-card-copy">
          <div className="poster-card-meta-row">
            <span className="poster-card-episode-label">{item.episodeLabel}</span>
          </div>

          <strong>{item.title}</strong>
        </div>
      </div>
    </>
  )
}

function buildDiscoverRail(
  shows: DiscoverShow[],
  preferredTranslationType: TranslationType,
): RailItem[] {
  return shows.map((show) => ({
    id: show.id,
    kind: 'discover',
    showId: show.providerShowId,
    href: show.providerShowId ? withMode(`/shows/${show.providerShowId}`, preferredTranslationType) : null,
    title: show.title,
    posterUrl: show.posterUrl ?? show.bannerUrl,
    rating: show.score ?? null,
    libraryEntry: null,
    episodeLabel: buildQueuedEpisodeLabel(getLatestAvailableEpisode(show.availableEpisodes), show.status),
    hasNewEpisode: false,
  }))
}

function discoverShowToSummary(show: DiscoverShow): ShowSummary {
  return {
    id: show.providerShowId ?? show.id,
    title: show.title,
    originalTitle: show.originalTitle,
    bannerUrl: show.bannerUrl,
    posterUrl: show.posterUrl,
    description: show.description,
    genres: show.genres,
    status: show.status,
    year: show.year,
    season: show.season,
    score: show.score,
    availableEpisodes: show.availableEpisodes,
  }
}

function describeDiscoverAvailability(show: DiscoverShow): string {
  if (show.availableEpisodes.sub > 0) {
    return `${show.availableEpisodes.sub} sub episodes`
  }

  if (show.availableEpisodes.dub > 0) {
    return `${show.availableEpisodes.dub} dub episodes`
  }

  if (show.status === 'NOT_YET_RELEASED') {
    return 'Not released yet'
  }

  if (show.providerShowId) {
    return 'Metadata available'
  }

  return 'No stream match yet'
}

function buildAvailabilitySummary(availableEpisodes: Record<TranslationType, number>) {
  const parts: string[] = []

  if (availableEpisodes.sub > 0) {
    parts.push(`${availableEpisodes.sub} sub`)
  }

  if (availableEpisodes.dub > 0) {
    parts.push(`${availableEpisodes.dub} dub`)
  }

  return parts.length ? `${parts.join(' / ')} episodes` : 'Stream match pending'
}

function buildFeaturedTitleLine(show: DiscoverShow) {
  const native = show.originalTitle?.trim() ?? null
  const romaji = show.romajiTitle?.trim() ?? null
  const normalizedTitle = normalizeTitle(show.title)
  const normalizedNative = native ? normalizeTitle(native) : null
  const normalizedRomaji = romaji ? normalizeTitle(romaji) : null

  if (
    native &&
    romaji &&
    normalizedNative !== normalizedTitle &&
    normalizedRomaji !== normalizedTitle &&
    normalizedNative !== normalizedRomaji
  ) {
    return { native, romaji }
  }

  return null
}

function formatFeaturedScore(score: number | null | undefined) {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return null
  }

  return `${Math.round(score)}%`
}

function buildFeaturedHeroTaxonomyItems(show: DiscoverShow) {
  const items: Array<{ key: string; label: string; kind: 'meta' | 'tag' }> = []

  items.push({
    key: 'availability',
    label: buildAvailabilitySummary(show.availableEpisodes),
    kind: 'meta',
  })

  if (show.genres.length) {
    items.push(
      ...show.genres.slice(0, 3).map((genre) => ({
        key: `genre-${genre}`,
        label: genre,
        kind: 'tag' as const,
      })),
    )
  }

  return items
}

function formatFeaturedStatus(status: string) {
  return status
    .toLowerCase()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function resolveShowHref(
  showId: string,
  libraryByShowId: Map<string, LibraryEntry>,
  recentByShowId: Map<string, WatchProgress>,
  translationType: TranslationType,
) {
  const libraryEntry = libraryByShowId.get(showId)
  if (libraryEntry) {
    if (libraryEntry.completed && !libraryEntry.resumeEpisodeNumber) {
      return withMode(`/shows/${showId}`, translationType)
    }

    const episodeNumber = libraryEntry.resumeEpisodeNumber ?? libraryEntry.latestEpisodeNumber ?? '1'
    return withMode(`/player/${showId}/${episodeNumber}`, translationType)
  }

  const recentProgress = recentByShowId.get(showId)
  if (recentProgress) {
    return withMode(`/player/${showId}/${recentProgress.episodeNumber}`, translationType)
  }

  return withMode(`/shows/${showId}`, translationType)
}

function getResumeSnapshot(entry: LibraryEntry, recentProgress: WatchProgress[]) {
  const episodeNumber = entry.resumeEpisodeNumber ?? entry.latestEpisodeNumber ?? '1'
  const progressEntry =
    recentProgress.find((item) => item.showId === entry.showId && item.episodeNumber === episodeNumber) ??
    recentProgress.find((item) => item.showId === entry.showId)

  const currentTime = progressEntry?.currentTime ?? entry.resumeTime
  const duration =
    progressEntry?.duration && progressEntry.duration > 0 ? progressEntry.duration : Math.max(currentTime * 1.6, 24 * 60)
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  return {
    episodeNumber,
    currentTime,
    duration,
    progressPercent: progressEntry?.completed ? 100 : progressPercent,
  }
}

function buildQueuedEpisodeLabel(latestAvailableEpisode: string | null, status: string | null | undefined) {
  if (latestAvailableEpisode) {
    return `Latest episode ${latestAvailableEpisode}`
  }

  if (status === 'NOT_YET_RELEASED') {
    return 'Releases soon'
  }

  return 'Stream status pending'
}

function getLatestAvailableEpisode(availableEpisodes?: Record<TranslationType, number> | null) {
  if (!availableEpisodes) {
    return null
  }

  const highestEpisode = Math.max(availableEpisodes.sub ?? 0, availableEpisodes.dub ?? 0)
  return highestEpisode > 0 ? String(highestEpisode) : null
}

function hasNewEpisodeAvailable(lastKnownEpisode: string | null, latestAvailableEpisode: string | null) {
  const knownEpisode = parseEpisodeNumber(lastKnownEpisode)
  const latestEpisode = parseEpisodeNumber(latestAvailableEpisode)

  if (knownEpisode === null || latestEpisode === null) {
    return false
  }

  return latestEpisode > knownEpisode
}

function parseEpisodeNumber(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function formatTimeRange(currentTime: number, duration: number) {
  return `${formatTimestamp(currentTime)} / ${formatTimestamp(duration)}`
}

function formatTimestamp(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

function buildContextMenuActions(item: RailItem): ContextMenuAction[] {
  if (!item.showId) {
    return []
  }

  const baseUpdate = {
    showId: item.showId,
    title: item.title,
    posterUrl: item.posterUrl,
  }

  const actions: ContextMenuAction[] = []

  if (item.libraryEntry?.resumeEpisodeNumber) {
    actions.push({
      key: 'remove-current',
      label: 'Remove from currently watching',
      icon: 'remove',
      tone: 'danger',
      update: {
        ...baseUpdate,
        removeFromContinueWatching: true,
      },
    })
    actions.push({
      key: 'move-watch-later',
      label: 'Move to watch later',
      icon: 'watchLater',
      update: {
        ...baseUpdate,
        watchLater: true,
        completed: false,
        removeFromContinueWatching: true,
      },
    })
  } else if (!item.libraryEntry?.completed) {
    actions.push({
      key: item.libraryEntry?.watchLater ? 'remove-watch-later' : 'add-watch-later',
      label: item.libraryEntry?.watchLater ? 'Remove from watch later' : 'Add to watch later',
      icon: item.libraryEntry?.watchLater ? 'remove' : 'watchLater',
      tone: item.libraryEntry?.watchLater ? 'danger' : 'default',
      update: {
        ...baseUpdate,
        watchLater: !item.libraryEntry?.watchLater,
      },
    })
  }

  actions.push({
    key: item.libraryEntry?.completed ? 'unmark-complete' : 'mark-complete',
    label: item.libraryEntry?.completed ? 'Remove from completed' : 'Mark as completed',
    icon: item.libraryEntry?.completed ? 'remove' : 'complete',
    tone: item.libraryEntry?.completed ? 'danger' : 'default',
    update: {
      ...baseUpdate,
      completed: !item.libraryEntry?.completed,
      watchLater: item.libraryEntry?.completed ? item.libraryEntry.watchLater : false,
    },
  })

  return actions
}

function renderContextMenuIcon(icon: ContextMenuAction['icon']) {
  switch (icon) {
    case 'watchLater':
      return <Clock3 size={15} strokeWidth={2} />
    case 'complete':
      return <Check size={15} strokeWidth={2} />
    case 'remove':
      return <X size={15} strokeWidth={2} />
    default:
      return null
  }
}

function clampMenuCoordinate(value: number, menuSize: number, viewportSize: number): number {
  const padding = 12
  return Math.max(padding, Math.min(value, viewportSize - menuSize - padding))
}
