import { ChevronLeft, ChevronRight, Film, Play, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
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
  showId: string | null
  href: string | null
  title: string
  posterUrl: string | null
  rating: number | null
  libraryEntry: LibraryEntry | null
  progressPercent?: number
  availabilityLabel?: string | null
}

interface ContextMenuState {
  item: RailItem
  x: number
  y: number
}

interface ContextMenuAction {
  key: string
  label: string
  update: LibraryUpdateInput
}

const CONTEXT_MENU_WIDTH = 216
const CONTEXT_MENU_HEIGHT = 220

export function HomePage() {
  const { password, preferredTranslationType } = useSession()
  const [data, setData] = useState<HomePayload | null>(null)
  const [showMetadata, setShowMetadata] = useState<Record<string, ShowSummary>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [homeRevision, setHomeRevision] = useState(0)
  const [activeHeroIndex, setActiveHeroIndex] = useState(0)
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
  const favorites = data?.favorites ?? EMPTY_LIBRARY
  const discover = data?.discover ?? EMPTY_DISCOVER

  const libraryByShowId = useMemo(() => {
    const map = new Map<string, LibraryEntry>()

    for (const entry of favorites) {
      map.set(entry.showId, entry)
    }

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
  }, [completed, continueWatching, favorites, watchLater])

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

    for (const entry of favorites) {
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
  }, [completed, continueWatching, favorites, recentByShowId, watchLater])

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

    return {
      id: entry.showId,
      showId: entry.showId,
      href: withMode(`/player/${entry.showId}/${resumeSnapshot.episodeNumber}`, preferredTranslationType),
      title: metadata?.title ?? entry.title,
      posterUrl: entry.posterUrl ?? metadata?.posterUrl ?? metadata?.bannerUrl ?? null,
      rating: metadata?.score ?? null,
      libraryEntry: entry,
      progressPercent: resumeSnapshot.progressPercent,
    } satisfies RailItem
  })

  const watchLaterItems = watchLater.map((entry) => {
    const metadata = metadataByShowId[entry.showId]

    return {
      id: entry.showId,
      showId: entry.showId,
      href: withMode(`/shows/${entry.showId}`, preferredTranslationType),
      title: metadata?.title ?? entry.title,
      posterUrl: entry.posterUrl ?? metadata?.posterUrl ?? metadata?.bannerUrl ?? null,
      rating: metadata?.score ?? null,
      libraryEntry: entry,
    } satisfies RailItem
  })

  const favoriteItems = favorites.map((entry) => {
    const metadata = metadataByShowId[entry.showId]
    return {
      id: entry.showId,
      showId: entry.showId,
      href: resolveShowHref(entry.showId, libraryByShowId, recentByShowId, preferredTranslationType),
      title: metadata?.title ?? entry.title,
      posterUrl: entry.posterUrl ?? metadata?.posterUrl ?? metadata?.bannerUrl ?? null,
      rating: metadata?.score ?? null,
      libraryEntry: entry,
    } satisfies RailItem
  })

  const completedItems = completed.map((entry) => {
    const metadata = metadataByShowId[entry.showId]
    return {
      id: entry.showId,
      showId: entry.showId,
      href: withMode(`/shows/${entry.showId}`, preferredTranslationType),
      title: metadata?.title ?? entry.title,
      posterUrl: entry.posterUrl ?? metadata?.posterUrl ?? metadata?.bannerUrl ?? null,
      rating: metadata?.score ?? null,
      libraryEntry: entry,
    } satisfies RailItem
  })

  const recentItems = Array.from(recentByShowId.values()).map((item) => {
    const libraryEntry = libraryByShowId.get(item.showId)
    const metadata = metadataByShowId[item.showId]

    return {
      id: item.showId,
      showId: item.showId,
      href: libraryEntry
        ? withMode(`/player/${item.showId}/${getResumeSnapshot(libraryEntry, recentProgress).episodeNumber}`, preferredTranslationType)
        : withMode(`/player/${item.showId}/${item.episodeNumber}`, preferredTranslationType),
      title: metadata?.title ?? item.title,
      posterUrl: libraryEntry?.posterUrl ?? item.posterUrl ?? metadata?.posterUrl ?? metadata?.bannerUrl ?? null,
      rating: metadata?.score ?? null,
      progressPercent: libraryEntry ? getResumeSnapshot(libraryEntry, recentProgress).progressPercent : undefined,
    } satisfies RailItem
  })

  const trendingItems = buildDiscoverRail(discover.trending, libraryByShowId, recentByShowId, preferredTranslationType)
  const seasonalItems = buildDiscoverRail(discover.popularThisSeason, libraryByShowId, recentByShowId, preferredTranslationType)
  const upcomingItems = buildDiscoverRail(discover.upcomingNextSeason, libraryByShowId, recentByShowId, preferredTranslationType)
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
                const showHref = resolveDiscoverHref(show, libraryByShowId, recentByShowId, preferredTranslationType)

                return (
                  <article className="featured-slide" key={show.id}>
                    <div className="featured-artwork">
                      {show.bannerUrl || show.posterUrl ? (
                        <img alt="" className="featured-backdrop" src={show.bannerUrl ?? show.posterUrl ?? ''} />
                      ) : null}
                    </div>

                    <div className="featured-overlay">
                      <div className="featured-content">
                        <h2>{show.title}</h2>
                        <div className="featured-meta-line">
                          {buildFeaturedMeta(show).map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                        </div>
                        <p>{show.description ?? 'Open the title page to inspect catalog availability and metadata.'}</p>

                        <div className="featured-actions">
                          {showHref ? (
                            <Link className="primary-button" to={showHref}>
                              <Play aria-hidden="true" size={16} strokeWidth={1.9} />
                              {show.providerShowId && (libraryByShowId.has(show.providerShowId) || recentByShowId.has(show.providerShowId))
                                ? 'Resume'
                                : 'Open show'}
                            </Link>
                          ) : (
                            <span className="featured-inline-status">{describeDiscoverAvailability(show)}</span>
                          )}

                          {show.trailer?.videoUrl ? (
                            <a
                              className="featured-inline-link"
                              href={show.trailer.videoUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <Film aria-hidden="true" size={16} strokeWidth={1.9} />
                              Trailer
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

      {isInitialLoading || favoriteItems.length ? (
        <PosterRail
          emptyMessage="This row will fill in after you save a show."
          items={favoriteItems}
          loading={isInitialLoading}
          onItemContextMenu={handleItemContextMenu}
          title="My list"
        />
      ) : null}

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
              className="library-context-menu-action"
              role="menuitem"
              type="button"
              onClick={() => void handleLibraryAction(action.update)}
            >
              {action.label}
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
                <div className="loading-skeleton poster-card-image" />
                <div className="poster-card-overlay poster-card-overlay-visible">
                  <div className="loading-skeleton loading-skeleton-line poster-card-skeleton-line" />
                  <div className="loading-skeleton loading-skeleton-chip poster-card-skeleton-chip" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : items.length ? (
        <div className="poster-rail-shell">
          {hasOverflow && canScrollLeft ? (
            <button
              aria-label={`Scroll ${title} left`}
              className="rail-scroll-button rail-scroll-button-left"
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

          {hasOverflow && canScrollRight ? (
            <button
              aria-label={`Scroll ${title} right`}
              className="rail-scroll-button rail-scroll-button-right"
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
      <PosterImage alt={`${item.title} poster`} className="poster-card-image" src={item.posterUrl} />
      <div className="poster-card-overlay">
        <strong>{item.title}</strong>
        <span className="poster-card-rating">
          <Star aria-hidden="true" size={14} strokeWidth={1.9} />
          {item.rating ? Math.round(item.rating) : 'NR'}
        </span>
        {item.availabilityLabel ? <span className="poster-card-status">{item.availabilityLabel}</span> : null}
      </div>
      {typeof item.progressPercent === 'number' ? (
        <div aria-hidden="true" className="poster-progress">
          <div className="poster-progress-fill" style={{ width: `${item.progressPercent}%` }} />
        </div>
      ) : null}
    </>
  )
}

function buildDiscoverRail(
  shows: DiscoverShow[],
  libraryByShowId: Map<string, LibraryEntry>,
  recentByShowId: Map<string, WatchProgress>,
  preferredTranslationType: TranslationType,
): RailItem[] {
  return shows.map((show) => ({
    id: show.id,
    showId: show.providerShowId,
    href: resolveDiscoverHref(show, libraryByShowId, recentByShowId, preferredTranslationType),
    title: show.title,
    posterUrl: show.posterUrl ?? show.bannerUrl,
    rating: show.score ?? null,
    libraryEntry: show.providerShowId ? libraryByShowId.get(show.providerShowId) ?? null : null,
    availabilityLabel: resolveAvailabilityLabel(show),
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

function buildFeaturedMeta(show: DiscoverShow): string[] {
  const items: string[] = []

  if (show.year) {
    items.push(String(show.year))
  }

  if (show.season) {
    items.push(toTitleCase(show.season))
  }

  if (show.score) {
    items.push(`${Math.round(show.score)}%`)
  }

  items.push(describeDiscoverAvailability(show))

  if (show.genres.length) {
    items.push(show.genres.slice(0, 2).join(', '))
  }

  return items
}

function resolveAvailabilityLabel(show: DiscoverShow): string | null {
  if (show.availableEpisodes.sub > 0 || show.availableEpisodes.dub > 0) {
    return null
  }

  if (show.status === 'NOT_YET_RELEASED') {
    return 'Soon'
  }

  return show.providerShowId ? 'Info only' : 'No stream yet'
}

function resolveDiscoverHref(
  show: DiscoverShow,
  libraryByShowId: Map<string, LibraryEntry>,
  recentByShowId: Map<string, WatchProgress>,
  preferredTranslationType: TranslationType,
): string | null {
  if (!show.providerShowId) {
    return null
  }

  return resolveShowHref(show.providerShowId, libraryByShowId, recentByShowId, pickAvailableTranslation(show.availableEpisodes, preferredTranslationType))
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
    progressPercent: progressEntry?.completed ? 100 : progressPercent,
  }
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
      update: {
        ...baseUpdate,
        removeFromContinueWatching: true,
      },
    })
    actions.push({
      key: 'move-watch-later',
      label: 'Move to watch later',
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
      update: {
        ...baseUpdate,
        watchLater: !item.libraryEntry?.watchLater,
      },
    })
  }

  actions.push({
    key: item.libraryEntry?.favorited ? 'remove-favorites' : 'add-favorites',
    label: item.libraryEntry?.favorited ? 'Remove from my list' : 'Add to my list',
    update: {
      ...baseUpdate,
      favorited: !item.libraryEntry?.favorited,
    },
  })

  actions.push({
    key: item.libraryEntry?.completed ? 'unmark-complete' : 'mark-complete',
    label: item.libraryEntry?.completed ? 'Remove from completed' : 'Mark as completed',
    update: {
      ...baseUpdate,
      completed: !item.libraryEntry?.completed,
      watchLater: item.libraryEntry?.completed ? item.libraryEntry.watchLater : false,
    },
  })

  return actions
}

function clampMenuCoordinate(value: number, menuSize: number, viewportSize: number): number {
  const padding = 12
  return Math.max(padding, Math.min(value, viewportSize - menuSize - padding))
}
