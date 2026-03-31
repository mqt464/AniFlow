import { Check, ChevronRight, Clock3, Filter, LoaderCircle, Play, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import type { LibraryUpdateInput, ShowEpisode, ShowPagePayload, TranslationType } from '../../shared/contracts'
import { PosterImage } from '../components/PosterImage'
import { ApiError, createApi } from '../lib/api'
import { resolveTranslationType, withMode } from '../lib/appPreferences'
import { useSession } from '../session'

type EpisodeFilter = 'all' | 'continue' | 'watched' | 'filler' | 'recap'

const EPISODES_PER_RANGE = 50
const FILTERS: Array<{ label: string; value: EpisodeFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Continue', value: 'continue' },
  { label: 'Watched', value: 'watched' },
  { label: 'Filler', value: 'filler' },
  { label: 'Recap', value: 'recap' },
]

export function ShowPage() {
  const { showId = '' } = useParams()
  const { password, preferredTranslationType } = useSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<ShowPagePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [libraryAction, setLibraryAction] = useState<string | null>(null)
  const [pageRevision, setPageRevision] = useState(0)
  const [episodeQuery, setEpisodeQuery] = useState('')
  const [episodeFilter, setEpisodeFilter] = useState<EpisodeFilter>('all')
  const [selectedRangeKey, setSelectedRangeKey] = useState('all')
  const translationType = resolveTranslationType(searchParams.get('mode'), preferredTranslationType)

  useEffect(() => {
    const api = createApi(password)
    let active = true

    setData(null)
    setError(null)
    setLoading(true)

    void api
      .getShowPage(showId, translationType)
      .then((value) => {
        if (!active) {
          return
        }

        setData(value)
      })
      .catch((reason: unknown) => {
        if (!active) {
          return
        }

        setError(reason instanceof ApiError ? reason.message : 'Unable to load this show right now')
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [pageRevision, password, showId, translationType])

  const episodes = data?.episodes ?? []
  const progress = data?.progress
  const ranges = useMemo(() => buildEpisodeRanges(episodes), [episodes])
  const activeRange = ranges.find((range) => range.key === selectedRangeKey) ?? ranges[0] ?? null
  const currentEpisode = progress?.currentEpisodeNumber
    ? episodes.find((episode) => episode.number === progress.currentEpisodeNumber) ?? null
    : null
  const latestEpisode = progress?.latestEpisodeNumber
    ? episodes.find((episode) => episode.number === progress.latestEpisodeNumber) ?? null
    : null
  const firstEpisode = episodes[0] ?? null
  const show = data?.show ?? null
  const libraryEntry = data?.library ?? null
  const libraryButtonsDisabled = libraryAction !== null || !show
  const showCompleted = Boolean(libraryEntry?.completed)
  const nextUnseenEpisode = useMemo(
    () => episodes.find((episode) => !episode.progress?.completed) ?? episodes[episodes.length - 1] ?? null,
    [episodes],
  )
  const filterCounts = useMemo(
    () => ({
      all: episodes.length,
      continue: episodes.filter((episode) => Boolean(episode.progress && !episode.progress.completed)).length,
      watched: episodes.filter((episode) => Boolean(episode.progress?.completed)).length,
      filler: episodes.filter((episode) => Boolean(episode.annotation?.isFiller)).length,
      recap: episodes.filter((episode) => Boolean(episode.annotation?.isRecap)).length,
    }),
    [episodes],
  )

  useEffect(() => {
    if (!ranges.length) {
      setSelectedRangeKey('all')
      return
    }

    const currentRange = currentEpisode ? ranges.find((range) => range.episodeNumbers.has(currentEpisode.number)) : null
    setSelectedRangeKey(currentRange?.key ?? ranges[ranges.length - 1]?.key ?? 'all')
  }, [currentEpisode, ranges])

  const query = episodeQuery.trim().toLowerCase()
  const useRangeFilter = query.length === 0 && episodeFilter === 'all' && Boolean(activeRange)
  const visibleEpisodes = episodes.filter((episode) => {
    if (useRangeFilter && activeRange && !activeRange.episodeNumbers.has(episode.number)) {
      return false
    }

    if (query) {
      const haystack = `${episode.number} ${episode.title}`.toLowerCase()
      if (!haystack.includes(query)) {
        return false
      }
    }

    switch (episodeFilter) {
      case 'continue':
        return Boolean(episode.progress && !episode.progress.completed)
      case 'watched':
        return Boolean(episode.progress?.completed)
      case 'filler':
        return Boolean(episode.annotation?.isFiller)
      case 'recap':
        return Boolean(episode.annotation?.isRecap)
      default:
        return true
    }
  })

  const primaryEpisode = showCompleted ? firstEpisode ?? latestEpisode : currentEpisode ?? nextUnseenEpisode ?? latestEpisode ?? firstEpisode
  const primaryLabel = currentEpisode
    ? `Resume episode ${currentEpisode.number}`
    : showCompleted
      ? firstEpisode
        ? `Watch again from episode ${firstEpisode.number}`
        : null
    : nextUnseenEpisode
      ? `Continue with episode ${nextUnseenEpisode.number}`
      : latestEpisode
        ? `Replay episode ${latestEpisode.number}`
        : firstEpisode
          ? 'Start watching'
          : null
  const primaryHref = primaryEpisode ? episodeHref(showId, primaryEpisode, translationType) : null
  const latestHref = episodes.length ? withMode(`/player/${showId}/${episodes[episodes.length - 1].number}`, translationType) : null
  const isInitialLoading = loading && !data && !error
  const isRefreshing = loading && Boolean(data)

  if (isInitialLoading) {
    return <ShowPageSkeleton />
  }

  const runLibraryAction = async (key: string, input: LibraryUpdateInput) => {
    try {
      setLibraryAction(key)
      await createApi(password).updateLibrary(input)
      setError(null)
      setPageRevision((current) => current + 1)
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to update your library right now')
    } finally {
      setLibraryAction(null)
    }
  }

  const baseLibraryUpdate = show
    ? {
        showId,
        title: show.title,
        posterUrl: show.posterUrl ?? show.bannerUrl ?? null,
      }
    : null

  return (
    <section className="page show-page">
      {error ? <div className="notice error">{error}</div> : null}

      <section className="show-shell">
        <div className="show-overview">
          <div className="show-overview-art">
            <PosterImage
              alt={show ? `${show.title} poster` : 'Show poster'}
              className="show-overview-poster"
              src={show?.posterUrl ?? show?.bannerUrl}
            />
          </div>

          <div className="show-overview-copy">
            <div className="show-kicker">
              {show?.year ? <span>{show.year}</span> : null}
              {show?.season ? <span>{toTitleCase(show.season)}</span> : null}
              {show?.status ? <span>{toTitleCase(show.status)}</span> : null}
            </div>

            <h1>{show?.title ?? 'Loading show...'}</h1>

            {show?.originalTitle && show.originalTitle !== show.title ? (
              <p className="show-original-title">{show.originalTitle}</p>
            ) : null}

            <p className="show-description">
              {show?.description ?? 'Fetching metadata, progress, and episode details.'}
            </p>

            <div className="show-metadata-strip">
              <div>
                <span>Episodes</span>
                <strong>{episodes.length || show?.availableEpisodes?.[translationType] || 0}</strong>
              </div>
              <div>
                <span>Seen</span>
                <strong>{progress?.completedEpisodeCount ?? 0}</strong>
              </div>
              <div>
                <span>Current</span>
                <strong>{progress?.currentEpisodeNumber ? `Ep ${progress.currentEpisodeNumber}` : 'None'}</strong>
              </div>
              <div>
                <span>Audio</span>
                <strong>{translationType.toUpperCase()}</strong>
              </div>
            </div>

            <div className="show-actions">
              {primaryHref && primaryLabel ? (
                <Link className="primary-button" to={primaryHref}>
                  <Play size={16} strokeWidth={1.9} />
                  {primaryLabel}
                </Link>
              ) : null}

              {latestHref ? (
                <Link className="secondary-button" to={latestHref}>
                  <ChevronRight size={16} strokeWidth={1.9} />
                  Play latest
                </Link>
              ) : null}

              <button
                className={libraryEntry?.watchLater ? 'secondary-button' : 'primary-button'}
                disabled={libraryButtonsDisabled}
                type="button"
                onClick={() =>
                  baseLibraryUpdate
                    ? void runLibraryAction('watch-later', {
                        ...baseLibraryUpdate,
                        watchLater: !libraryEntry?.watchLater,
                        completed: false,
                        removeFromContinueWatching: !libraryEntry?.watchLater && Boolean(libraryEntry?.resumeEpisodeNumber),
                      })
                    : undefined
                }
              >
                {libraryAction === 'watch-later' ? (
                  <>
                    <LoaderCircle className="spin" size={16} strokeWidth={2} />
                    Saving...
                  </>
                ) : libraryEntry?.watchLater ? (
                  'Remove from watch later'
                ) : libraryEntry?.resumeEpisodeNumber ? (
                  'Move to watch later'
                ) : (
                  'Add to watch later'
                )}
              </button>

              <button
                className="secondary-button"
                disabled={libraryButtonsDisabled}
                type="button"
                onClick={() =>
                  baseLibraryUpdate
                    ? void runLibraryAction('completed', {
                        ...baseLibraryUpdate,
                        completed: !libraryEntry?.completed,
                        watchLater: libraryEntry?.completed ? libraryEntry.watchLater : false,
                      })
                    : undefined
                }
              >
                {libraryAction === 'completed' ? (
                  <>
                    <LoaderCircle className="spin" size={16} strokeWidth={2} />
                    Saving...
                  </>
                ) : libraryEntry?.completed ? (
                  'Remove from completed'
                ) : (
                  'Mark as completed'
                )}
              </button>
            </div>

            <div className="show-toolbar-row">
              <div className="show-mode-switch" role="tablist" aria-label="Audio version">
                <button
                  className={translationType === 'sub' ? 'active' : ''}
                  aria-selected={translationType === 'sub'}
                  role="tab"
                  type="button"
                  onClick={() => setSearchParams({ mode: 'sub' })}
                >
                  Sub
                </button>
                <button
                  className={translationType === 'dub' ? 'active' : ''}
                  aria-selected={translationType === 'dub'}
                  role="tab"
                  type="button"
                  onClick={() => setSearchParams({ mode: 'dub' })}
                >
                  Dub
                </button>
              </div>

              {show?.genres?.length ? (
                <div className="show-genre-list">
                  {show.genres.slice(0, 5).map((genre) => (
                    <span key={genre}>{genre}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <section className="show-browser" aria-labelledby="episode-browser-title">
          <div className="show-browser-head">
            <div>
              <h2 id="episode-browser-title">Episode browser</h2>
              <p>
                {showCompleted
                  ? 'This show is marked completed in your library.'
                  : currentEpisode
                  ? `You are mid-watch on episode ${currentEpisode.number}.`
                  : progress?.completedEpisodeCount
                    ? `${progress.completedEpisodeCount} episodes marked watched so far.`
                  : 'Start from any episode or jump to the latest release.'}
              </p>
            </div>

            {isRefreshing ? (
              <div className="show-loading-chip">
                <LoaderCircle className="spin" size={15} strokeWidth={2} />
                <span>Updating {translationType.toUpperCase()} episodes...</span>
              </div>
            ) : null}

            {data?.fillerSource ? (
              <div className="show-filler-note">
                <Sparkles size={15} strokeWidth={1.8} />
                <span>
                  Filler and recap flags matched from {data.fillerSource === 'jikan' ? 'Jikan / MyAnimeList' : data.fillerSource}
                  {data.fillerMatchTitle ? ` as ${data.fillerMatchTitle}` : ''}.
                </span>
              </div>
            ) : null}
          </div>

          <div className="show-browser-controls">
            <label className="show-browser-search">
              <span className="sr-only">Search episodes</span>
              <input
                placeholder="Search episode number or title"
                type="search"
                value={episodeQuery}
                onChange={(event) => setEpisodeQuery(event.target.value)}
              />
            </label>

            <div aria-label="Episode filters" className="show-filter-group" role="tablist">
              {FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  aria-selected={episodeFilter === filter.value}
                  className={episodeFilter === filter.value ? 'active' : ''}
                  role="tab"
                  type="button"
                  onClick={() => setEpisodeFilter(filter.value)}
                >
                  {filter.label}
                  <span>{filterCounts[filter.value]}</span>
                </button>
              ))}
            </div>

            {ranges.length > 1 ? (
              <div aria-label="Episode ranges" className="show-range-group" role="tablist">
                {ranges.map((range) => (
                  <button
                    key={range.key}
                    aria-selected={selectedRangeKey === range.key}
                    className={selectedRangeKey === range.key ? 'active' : ''}
                    disabled={episodeFilter !== 'all' || query.length > 0}
                    role="tab"
                    type="button"
                    onClick={() => setSelectedRangeKey(range.key)}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="show-list-summary">
            <div>
              <Filter size={15} strokeWidth={1.8} />
              <span>
                Showing {visibleEpisodes.length} of {episodes.length} episodes
              </span>
            </div>
            {activeRange && useRangeFilter ? <span>{activeRange.label}</span> : null}
          </div>

          <div className="show-episode-list">
            {visibleEpisodes.map((episode) => (
              <Link
                className={`show-episode-row ${episode.isCurrent ? 'current' : ''}`}
                key={episode.number}
                to={episodeHref(showId, episode, translationType)}
              >
                <div className="show-episode-number">
                  <strong>{episode.number}</strong>
                  <span>EP</span>
                </div>

                <div className="show-episode-copy">
                  <div className="show-episode-header">
                    <strong>{episode.title}</strong>
                    <span>{episodeStatusLabel(episode)}</span>
                  </div>

                  {hasEpisodeMeta(episode) ? (
                    <div className="show-episode-flags">
                      {episode.progress?.completed ? (
                        <span className="show-episode-flag show-episode-flag-success">
                          <Check size={12} strokeWidth={2.1} />
                          Watched
                        </span>
                      ) : null}
                      {episode.isCurrent ? (
                        <span className="show-episode-flag show-episode-flag-current">
                          <Clock3 size={12} strokeWidth={1.9} />
                          Current
                        </span>
                      ) : null}
                      {episode.annotation?.isFiller ? <span className="show-episode-flag">Filler</span> : null}
                      {episode.annotation?.isRecap ? <span className="show-episode-flag">Recap</span> : null}
                      {episode.progress && !episode.progress.completed ? (
                        <span className="show-episode-flag">
                          Resume {formatShortTime(episode.progress.currentTime)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {episode.progress && episode.progress.duration > 0 ? (
                    <div aria-hidden="true" className="show-episode-progress">
                      <div
                        className="show-episode-progress-fill"
                        style={{
                          width: `${episode.progress.completed ? 100 : Math.min(100, (episode.progress.currentTime / episode.progress.duration) * 100)}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="show-episode-action">
                  <ChevronRight size={16} strokeWidth={1.9} />
                </div>
              </Link>
            ))}

            {!visibleEpisodes.length ? (
              <div className="empty-state media-empty">
                No episodes matched this view. Try another filter or clear the search.
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </section>
  )
}

function ShowPageSkeleton() {
  return (
    <section aria-busy="true" className="page show-page">
      <section className="show-shell">
        <section className="show-overview show-overview-skeleton">
          <div className="show-overview-art">
            <div className="loading-skeleton show-overview-poster" />
          </div>

          <div className="show-overview-copy">
            <div className="show-kicker">
              <div className="loading-skeleton loading-skeleton-chip" />
              <div className="loading-skeleton loading-skeleton-chip" />
              <div className="loading-skeleton loading-skeleton-chip" />
            </div>

            <div className="loading-skeleton loading-skeleton-title show-skeleton-title" />
            <div className="loading-skeleton loading-skeleton-line show-skeleton-line" />
            <div className="loading-skeleton loading-skeleton-line show-skeleton-line show-skeleton-line-short" />

            <div className="show-metadata-strip">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index}>
                  <div className="loading-skeleton loading-skeleton-line show-skeleton-stat-label" />
                  <div className="loading-skeleton loading-skeleton-line show-skeleton-stat-value" />
                </div>
              ))}
            </div>

            <div className="show-actions">
              <div className="loading-skeleton loading-skeleton-button" />
              <div className="loading-skeleton loading-skeleton-button loading-skeleton-button-secondary" />
              <div className="loading-skeleton loading-skeleton-button loading-skeleton-button-secondary" />
            </div>
          </div>
        </section>

        <section className="show-browser show-browser-skeleton">
          <div className="show-browser-head">
            <div>
              <div className="loading-skeleton loading-skeleton-line show-skeleton-section-title" />
              <div className="loading-skeleton loading-skeleton-line show-skeleton-line" />
            </div>
          </div>

          <div className="show-browser-controls">
            <div className="loading-skeleton show-skeleton-input" />
            <div className="show-filter-group">
              {Array.from({ length: 5 }, (_, index) => (
                <div className="loading-skeleton loading-skeleton-chip show-skeleton-filter" key={index} />
              ))}
            </div>
          </div>

          <div className="show-episode-list">
            {Array.from({ length: 8 }, (_, index) => (
              <div className="show-episode-row show-episode-row-skeleton" key={index}>
                <div className="loading-skeleton show-skeleton-episode-number" />
                <div className="show-episode-copy">
                  <div className="loading-skeleton loading-skeleton-line show-skeleton-episode-title" />
                  <div className="loading-skeleton loading-skeleton-line show-skeleton-episode-meta" />
                </div>
                <div className="loading-skeleton show-skeleton-episode-arrow" />
              </div>
            ))}
          </div>
        </section>
      </section>
    </section>
  )
}

function buildEpisodeRanges(episodes: ShowEpisode[]) {
  if (episodes.length <= EPISODES_PER_RANGE) {
    return [
      {
        key: 'all',
        label: 'All episodes',
        episodeNumbers: new Set(episodes.map((episode) => episode.number)),
      },
    ]
  }

  const ranges: Array<{ key: string; label: string; episodeNumbers: Set<string> }> = []
  for (let index = 0; index < episodes.length; index += EPISODES_PER_RANGE) {
    const slice = episodes.slice(index, index + EPISODES_PER_RANGE)
    const first = slice[0]?.number ?? String(index + 1)
    const last = slice[slice.length - 1]?.number ?? String(index + slice.length)
    ranges.push({
      key: `${first}-${last}`,
      label: `${first}-${last}`,
      episodeNumbers: new Set(slice.map((episode) => episode.number)),
    })
  }

  return ranges
}

function episodeHref(showId: string, episode: ShowEpisode, translationType: TranslationType) {
  const baseHref = withMode(`/player/${showId}/${episode.number}`, translationType)
  if (episode.progress && !episode.progress.completed && episode.progress.currentTime > 0) {
    return `${baseHref}&t=${Math.floor(episode.progress.currentTime)}`
  }

  return baseHref
}

function episodeStatusLabel(episode: ShowEpisode) {
  if (episode.isCurrent) {
    return 'Currently watching'
  }

  if (episode.progress?.completed) {
    return 'Completed'
  }

  if (episode.progress) {
    return 'In progress'
  }

  return 'Not started'
}

function hasEpisodeMeta(episode: ShowEpisode) {
  return Boolean(
    episode.progress?.completed ||
      episode.isCurrent ||
      episode.annotation?.isFiller ||
      episode.annotation?.isRecap ||
      (episode.progress && !episode.progress.completed),
  )
}

function formatShortTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0:00'
  }

  const rounded = Math.floor(totalSeconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const seconds = rounded % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function toTitleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}
