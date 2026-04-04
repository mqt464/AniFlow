import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Heart,
  LoaderCircle,
  Search,
  Star,
} from 'lucide-react'
import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import type {
  LibraryEntry,
  LibraryUpdateInput,
  ShowEpisode,
  ShowPageAniListDetails,
  ShowPagePayload,
  TranslationType,
} from '../../shared/contracts'
import { PosterImage } from '../components/PosterImage'
import { RatingStars } from '../components/RatingStars'
import { ApiError, createApi } from '../lib/api'
import { resolveTranslationType, withMode } from '../lib/appPreferences'
import { useSession } from '../session'

type AudienceStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'PAUSED' | 'DROPPED'
type EpisodeFilter = 'all' | 'continue' | 'watched' | 'unwatched' | 'filler'
type ShowSection = 'overview' | 'episodes'

const SECTION_LINKS: Array<{ id: ShowSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'episodes', label: 'Episodes' },
]
const AUDIENCE_ORDER: AudienceStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED']
const EPISODE_FILTERS: Array<{ value: EpisodeFilter; label: string }> = [
  { value: 'all', label: 'All episodes' },
  { value: 'continue', label: 'Continue' },
  { value: 'watched', label: 'Watched' },
  { value: 'unwatched', label: 'Unwatched' },
  { value: 'filler', label: 'Filler' },
]

export function ShowPage() {
  const { showId = '' } = useParams()
  const { password, preferredTranslationType } = useSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<ShowPagePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [libraryAction, setLibraryAction] = useState<string | null>(null)
  const [synopsisExpanded, setSynopsisExpanded] = useState(false)
  const [episodeSearch, setEpisodeSearch] = useState('')
  const [episodeFilter, setEpisodeFilter] = useState<EpisodeFilter>('all')
  const [activeSection, setActiveSection] = useState<ShowSection>('overview')
  const translationType = resolveTranslationType(searchParams.get('mode'), preferredTranslationType)
  const deferredEpisodeSearch = useDeferredValue(episodeSearch)

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
  }, [password, showId, translationType])

  const show = data?.show ?? null
  const details = data?.aniListDetails ?? null
  const episodes = data?.episodes ?? []
  const progress = data?.progress
  const libraryEntry = data?.library ?? null
  const currentEpisode = progress?.currentEpisodeNumber
    ? episodes.find((episode) => episode.number === progress.currentEpisodeNumber) ?? null
    : null
  const latestEpisode = progress?.latestEpisodeNumber
    ? episodes.find((episode) => episode.number === progress.latestEpisodeNumber) ?? null
    : null
  const firstEpisode = episodes[0] ?? null
  const nextUnseenEpisode = useMemo(
    () => episodes.find((episode) => !episode.progress?.completed) ?? episodes[episodes.length - 1] ?? null,
    [episodes],
  )
  const libraryButtonsDisabled = libraryAction !== null || !show
  const showCompleted = Boolean(libraryEntry?.completed)

  useEffect(() => {
    setSynopsisExpanded(false)
    setEpisodeSearch('')
    setEpisodeFilter('all')
    setActiveSection('overview')
  }, [showId, translationType])

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
      setData((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          library: buildUpdatedLibraryEntry(current.library, input),
        }
      })
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

  const setMode = (nextType: TranslationType) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('mode', nextType)
    setSearchParams(nextParams)
  }

  const synopsis = details?.synopsis ?? show?.description ?? 'Synopsis unavailable.'
  const shouldClampSynopsis = synopsis.length > 220
  const bannerUrl = show?.bannerUrl ?? show?.posterUrl ?? null
  const titleNative =
    details?.title.native?.trim() ??
    pickNativeTitle(show?.originalTitle ?? null, show?.title ?? null)
  const titleRomaji =
    pickRomajiTitle(data?.fillerMatchTitle ?? null, show?.romajiTitle ?? null, show?.originalTitle ?? null)
  const titleLine =
    titleNative && titleRomaji && titleNative !== titleRomaji ? { native: titleNative, romaji: titleRomaji } : null
  const totalEpisodes = details?.episodes ?? show?.availableEpisodes?.[translationType] ?? (episodes.length || null)
  const averageDurationMinutes = details?.duration ?? getAverageEpisodeDuration(episodes)
  const visibleGenres = (details?.genres.length ? details.genres : show?.genres ?? []).slice(0, 5)
  const visibleTags = details?.tags.filter((tag) => !tag.isSpoiler).slice(0, 5) ?? []
  const scoreLabel = formatScore(details?.averageScore ?? show?.score ?? null)
  const ratingValue = details?.averageScore ?? show?.score ?? null
  const ratingFill = typeof ratingValue === 'number' && Number.isFinite(ratingValue) ? Math.max(0, Math.min(100, ratingValue)) : 0
  const audienceStats = AUDIENCE_ORDER.map((status) => ({
    status,
    label: audienceStatusLabel(status),
    amount: getAudienceAmount(details, status),
  }))
  const heroRankingTags = buildHeroRankingTags(data?.malRank ?? null, data?.malPopularity ?? null)
  const airingStatusTag = buildAiringStatusTag(details?.status ?? show?.status)
  const heroTaxonomyItems = buildHeroTaxonomyItems(visibleGenres, visibleTags)
  const heroAudienceItems = buildHeroAudienceItems(audienceStats)
  const detailRows = [
    { label: 'Format', value: formatLabel(details?.format) },
    { label: 'Episodes', value: totalEpisodes ? String(totalEpisodes) : null },
    { label: 'Episode duration', value: averageDurationMinutes ? `${averageDurationMinutes} mins` : null },
    { label: 'Start date', value: formatDate(details?.startDate) },
    { label: 'End date', value: formatDate(details?.endDate) },
    { label: 'Season', value: buildSeasonLabel(details?.season ?? show?.season, details?.seasonYear ?? show?.year) },
    { label: 'Status', value: formatStatus(details?.status ?? show?.status) },
  ].filter((row) => Boolean(row.value))
  const relationRows = details?.relations.slice(0, 6) ?? []
  const recommendationRows = details?.recommendations.slice(0, 6) ?? []
  const normalizedEpisodeSearch = deferredEpisodeSearch.trim().toLowerCase()
  const watchedEpisodeCount = episodes.filter((episode) => episode.progress?.completed).length
  const fillerEpisodeCount = episodes.filter((episode) => episode.annotation?.isFiller).length
  const episodeFilterCounts = {
    all: episodes.length,
    continue: episodes.filter((episode) => episode.isCurrent || (episode.progress && !episode.progress.completed)).length,
    watched: watchedEpisodeCount,
    unwatched: episodes.filter((episode) => !episode.progress?.completed).length,
    filler: fillerEpisodeCount,
  } satisfies Record<EpisodeFilter, number>
  const filteredEpisodes = episodes.filter((episode) => {
    if (normalizedEpisodeSearch) {
      const haystack = [episode.number, episode.title].join(' ').toLowerCase()
      if (!haystack.includes(normalizedEpisodeSearch)) {
        return false
      }
    }

    switch (episodeFilter) {
      case 'continue':
        return episode.isCurrent || Boolean(episode.progress && !episode.progress.completed)
      case 'watched':
        return Boolean(episode.progress?.completed)
      case 'unwatched':
        return !episode.progress?.completed
      case 'filler':
        return Boolean(episode.annotation?.isFiller)
      case 'all':
        return true
    }
  })
  const availableEpisodeCounts = show?.availableEpisodes ?? null
  const nextUpEpisode = currentEpisode ?? nextUnseenEpisode
  const episodeSummaryLabel = buildEpisodeSummaryLabel({
    visibleEpisodeCount: filteredEpisodes.length,
    totalEpisodeCount: episodes.length,
    searchTerm: normalizedEpisodeSearch,
    filter: episodeFilter,
  })
  return (
    <section className="page show-page show-page-v3">
      {error ? <div className="notice error">{error}</div> : null}

      <section className="show-canvas-hero">
        {bannerUrl ? (
          <div
            aria-hidden="true"
            className="show-canvas-hero-backdrop"
            style={{ backgroundImage: `url(${bannerUrl})` }}
          />
        ) : null}

        <div className="show-canvas-hero-inner">
          <PosterImage
            alt={show ? `${show.title} poster` : 'Show poster'}
            className="show-canvas-poster"
            src={show?.posterUrl ?? show?.bannerUrl}
          />

          <div className="show-canvas-main">
            <div className="show-canvas-head">
              <div className="show-canvas-title-block">
                {heroRankingTags.length || airingStatusTag ? (
                  <div className="show-canvas-title-tags" aria-label="Show highlights">
                    {heroRankingTags.map((tag) => (
                      <div className="show-canvas-title-tag" key={`${tag.kind}-${tag.label}`}>
                        {tag.kind === 'rated' ? <Star className="show-canvas-title-tag-icon" size={13} strokeWidth={2} /> : null}
                        {tag.kind === 'popular' ? <Heart className="show-canvas-title-tag-icon" size={13} strokeWidth={2} /> : null}
                        <span>{tag.label}</span>
                      </div>
                    ))}
                    {airingStatusTag ? <div className="show-canvas-title-tag show-canvas-title-tag-status">{airingStatusTag}</div> : null}
                  </div>
                ) : null}

                {titleLine ? (
                  <p className="show-canvas-original">
                    <span>{titleLine.native}</span>
                    <span aria-hidden="true" className="show-canvas-original-separator">
                      ·
                    </span>
                    <span>{titleLine.romaji}</span>
                  </p>
                ) : titleNative && titleNative !== show?.title ? (
                  <p className="show-canvas-original">{titleNative}</p>
                ) : titleRomaji && titleRomaji !== show?.title ? (
                  <p className="show-canvas-original">{titleRomaji}</p>
                ) : null}
                <h1>{show?.title ?? 'Loading show...'}</h1>
                {scoreLabel || heroAudienceItems.length ? (
                  <div className="show-canvas-rating" aria-label="Score and audience">
                    {scoreLabel ? (
                      <div className="show-canvas-rating-chip show-canvas-rating-chip-score">
                        <RatingStars valuePercent={ratingFill} />
                        <span className="show-canvas-rating-value">{scoreLabel}</span>
                      </div>
                    ) : null}

                    {heroAudienceItems.map((item) => (
                      <div className={`show-canvas-rating-chip show-canvas-rating-chip-${item.tone}`} key={item.label}>
                        <strong>{item.value}</strong>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="show-canvas-synopsis">
                  <p className={`show-canvas-synopsis-copy ${synopsisExpanded ? 'expanded' : ''}`}>{synopsis}</p>
                  {shouldClampSynopsis ? (
                    <button
                      aria-expanded={synopsisExpanded}
                      className={`show-canvas-synopsis-toggle ${synopsisExpanded ? 'expanded' : ''}`}
                      type="button"
                      onClick={() => setSynopsisExpanded((current) => !current)}
                    >
                      <span>{synopsisExpanded ? 'Show less' : 'Show more'}</span>
                      <ChevronDown size={14} strokeWidth={2} />
                    </button>
                  ) : null}

                  {heroTaxonomyItems.length ? (
                    <div className="show-canvas-hero-taxonomy" aria-label="Genres and tags">
                      {heroTaxonomyItems.map((item, index) => (
                        <Fragment key={item.key}>
                          {index > 0 ? (
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

              <div className="show-canvas-hero-tools" />
            </div>

            <div className="show-canvas-controls">
              <div className="show-canvas-actions">
                {primaryHref && primaryLabel ? (
                  <Link className="show-canvas-primary" to={primaryHref}>
                    <span>{primaryLabel}</span>
                  </Link>
                ) : null}

                {details?.trailer?.videoUrl ? (
                  <a className="show-canvas-trailer" href={details.trailer.videoUrl} rel="noreferrer" target="_blank">
                    <span>Watch trailer</span>
                  </a>
                ) : null}

                <button
                  className={libraryEntry?.watchLater ? 'show-canvas-chip active' : 'show-canvas-chip'}
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
                  ) : (
                    <>
                      <Bookmark className="show-canvas-chip-icon" size={15} strokeWidth={1.9} />
                      <span>Watch later</span>
                    </>
                  )}
                </button>

                <button
                  className={libraryEntry?.completed ? 'show-canvas-chip active' : 'show-canvas-chip'}
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
                  ) : (
                    <>
                      <Check className="show-canvas-chip-icon show-canvas-chip-icon-check" size={15} strokeWidth={2} />
                      <span>{libraryEntry?.completed ? 'Watched' : 'Mark as watched'}</span>
                    </>
                  )}
                </button>
              </div>

              {isRefreshing ? (
                <div className="show-canvas-meta-tools">
                  <div className="show-canvas-status">
                    <LoaderCircle className="spin" size={15} strokeWidth={2} />
                    Updating {translationType.toUpperCase()} episodes...
                  </div>
                </div>
              ) : null}
            </div>

          </div>
        </div>
      </section>

      <section className="show-canvas-board">
        <nav aria-label="Show sections" className="show-canvas-tabs" role="tablist">
          {SECTION_LINKS.map((section) => (
            <button
              key={section.id}
              aria-controls={`show-panel-${section.id}`}
              aria-selected={activeSection === section.id}
              className={activeSection === section.id ? 'show-canvas-tab active' : 'show-canvas-tab'}
              id={`show-tab-${section.id}`}
              role="tab"
              type="button"
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>

        <section
          aria-hidden={activeSection !== 'overview'}
          aria-labelledby="show-tab-overview"
          className={activeSection === 'overview' ? 'show-canvas-stage' : 'show-canvas-stage is-hidden'}
          hidden={activeSection !== 'overview'}
          id="show-panel-overview"
          role="tabpanel"
        >
          <div className="show-canvas-overview">
            <div className="show-canvas-description">
              {relationRows.length ? (
                <section className="show-copy-block">
                  <div className="show-canvas-panel-head">
                    <h2>Relations</h2>
                    <span>{relationRows.length} entries</span>
                  </div>

                  <div className="show-canvas-discovery-grid">
                    {relationRows.map((relation) => {
                      const href = mediaCardHref(relation.providerShowId, relation.siteUrl)
                      const isAvailableHere = relation.availableOnSite
                      const isNavigable = href !== null
                      const meta = [formatLabel(relation.format), buildSeasonLabel(relation.season, relation.year)].filter(Boolean).join(' · ')
                      const availabilityLabel = !isAvailableHere && relation.siteUrl ? 'External source' : null
                      const card = (
                        <>
                          <img
                            alt=""
                            className="show-canvas-discovery-poster"
                            loading="lazy"
                            src={relation.posterUrl ?? show?.posterUrl ?? undefined}
                          />
                          <div className="show-canvas-discovery-copy">
                            <div className="show-canvas-discovery-topline">
                              <span className="show-canvas-discovery-label">{formatLabel(relation.relationType) ?? 'Related'}</span>
                              {availabilityLabel ? (
                                <span className={`show-canvas-discovery-availability ${isAvailableHere ? 'is-available' : ''}`}>
                                  {availabilityLabel}
                                </span>
                              ) : null}
                            </div>
                            <strong>{relation.title}</strong>
                            <small>{meta || relation.originalTitle || (isNavigable ? 'Open entry' : 'Unavailable here')}</small>
                          </div>
                          <ChevronRight className="show-canvas-discovery-arrow" size={16} strokeWidth={1.9} />
                        </>
                      )

                      return href?.startsWith('/shows/') ? (
                        <Link className="show-canvas-discovery-card" key={`relation-${relation.anilistId}`} to={href}>
                          {card}
                        </Link>
                      ) : href ? (
                        <a className="show-canvas-discovery-card" href={href} key={`relation-${relation.anilistId}`} rel="noreferrer" target="_blank">
                          {card}
                        </a>
                      ) : (
                        <div aria-disabled="true" className="show-canvas-discovery-card is-disabled" key={`relation-${relation.anilistId}`}>
                          {card}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              {recommendationRows.length ? (
                <section className="show-copy-block">
                  <div className="show-canvas-panel-head">
                    <h2>Recommendations</h2>
                    <span>{recommendationRows.length} picks</span>
                  </div>

                  <div className="show-canvas-discovery-grid">
                    {recommendationRows.map((recommendation) => {
                      const href = mediaCardHref(recommendation.providerShowId, recommendation.siteUrl)
                      const isAvailableHere = recommendation.availableOnSite
                      const isNavigable = href !== null
                      const meta = [formatLabel(recommendation.format), buildSeasonLabel(recommendation.season, recommendation.year)]
                        .filter(Boolean)
                        .join(' · ')
                      const label = recommendation.rating ? `${formatCompactNumber(recommendation.rating)} community upvotes` : 'Recommended'
                      const availabilityLabel = !isAvailableHere && recommendation.siteUrl ? 'External source' : null
                      const card = (
                        <>
                          <img
                            alt=""
                            className="show-canvas-discovery-poster"
                            loading="lazy"
                            src={recommendation.posterUrl ?? show?.posterUrl ?? undefined}
                          />
                          <div className="show-canvas-discovery-copy">
                            <div className="show-canvas-discovery-topline">
                              <span className="show-canvas-discovery-label">{label}</span>
                              {availabilityLabel ? (
                                <span className={`show-canvas-discovery-availability ${isAvailableHere ? 'is-available' : ''}`}>
                                  {availabilityLabel}
                                </span>
                              ) : null}
                            </div>
                            <strong>{recommendation.title}</strong>
                            <small>{meta || recommendation.originalTitle || (isNavigable ? 'Open entry' : 'Unavailable here')}</small>
                          </div>
                          <ChevronRight className="show-canvas-discovery-arrow" size={16} strokeWidth={1.9} />
                        </>
                      )

                      return href?.startsWith('/shows/') ? (
                        <Link className="show-canvas-discovery-card" key={`recommendation-${recommendation.anilistId}`} to={href}>
                          {card}
                        </Link>
                      ) : href ? (
                        <a className="show-canvas-discovery-card" href={href} key={`recommendation-${recommendation.anilistId}`} rel="noreferrer" target="_blank">
                          {card}
                        </a>
                      ) : (
                        <div aria-disabled="true" className="show-canvas-discovery-card is-disabled" key={`recommendation-${recommendation.anilistId}`}>
                          {card}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ) : null}
            </div>

            <aside className="show-canvas-details">
              <section className="show-copy-block">
                <h2>Details</h2>
                <dl className="show-canvas-detail-list">
                  {detailRows.map((row) => (
                    <div className="show-canvas-detail-row" key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </aside>
          </div>
        </section>

        <section
          aria-hidden={activeSection !== 'episodes'}
          aria-labelledby="show-tab-episodes"
          className={activeSection === 'episodes' ? 'show-canvas-stage show-canvas-stage-episodes' : 'show-canvas-stage show-canvas-stage-episodes is-hidden'}
          hidden={activeSection !== 'episodes'}
          id="show-panel-episodes"
          role="tabpanel"
        >
          <section className="show-run-page">
            <header className="show-run-header">
              <div className="show-run-summary">
                <span>{episodeSummaryLabel}</span>
                {progress?.updatedAt ? <span>Tracking active</span> : null}
              </div>
            </header>

            <div className="show-run-layout">
              <div className="show-run-main">
                <label className="show-run-search" htmlFor="show-episode-search">
                  <Search aria-hidden="true" size={16} strokeWidth={2} />
                  <span className="sr-only">Search episodes</span>
                  <input
                    id="show-episode-search"
                    placeholder="Search episode number or title"
                    type="search"
                    value={episodeSearch}
                    onChange={(event) => setEpisodeSearch(event.target.value)}
                  />
                </label>

                {filteredEpisodes.length ? (
                  <div className="show-run-list">
                    {filteredEpisodes.map((episode) => {
                      const href = episodeHref(showId, episode, translationType)
                      const progressPercent = getEpisodeProgressPercent(episode)
                      const episodeStateLabel = getEpisodeStateLabel(episode)
                      const availabilityLabel = getEpisodeAvailabilityLabel(episode, availableEpisodeCounts)
                      const metaLine = [
                        `Episode ${episode.number}`,
                        formatEpisodeDuration(episode.durationSeconds),
                        episode.annotation?.isRecap ? 'Recap' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')

                      return (
                        <Link
                          className={episode.isCurrent ? 'show-run-entry current' : 'show-run-entry'}
                          key={episode.number}
                          to={href}
                        >
                          <div className="show-run-copy">
                            <div className="show-run-meta">
                              <span>{metaLine}</span>
                              {episodeStateLabel ? <strong>{episodeStateLabel}</strong> : null}
                            </div>

                            <div className="show-run-titleline">
                              <h3>{episode.title}</h3>
                            </div>

                            <div className="show-run-tags">
                              {availabilityLabel ? <span className="show-run-translation-note">{availabilityLabel}</span> : null}
                              {episode.annotation?.isFiller ? <span>Filler</span> : null}
                              {episode.annotation?.isRecap ? <span>Recap</span> : null}
                              {episode.progress?.completed ? <span>Complete</span> : null}
                              {episode.annotation?.source === 'jikan' && (episode.annotation?.isFiller || episode.annotation?.isRecap) ? (
                                <span>Jikan</span>
                              ) : null}
                            </div>

                            {progressPercent !== null ? (
                              <div aria-hidden="true" className="show-run-progress">
                                <div className="show-run-progress-fill" style={{ width: `${progressPercent}%` }} />
                              </div>
                            ) : null}
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                ) : (
                  <div className="show-run-empty">
                    <h3>No matching episodes</h3>
                    <p>Try another title search or switch the filter rail back to a broader view.</p>
                  </div>
                )}
              </div>

              <aside className="show-run-side">
                <div aria-label="Episode filters" className="show-run-filterrail" role="tablist">
                  {EPISODE_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      aria-selected={episodeFilter === filter.value}
                      className={episodeFilter === filter.value ? 'active' : undefined}
                      role="tab"
                      type="button"
                      onClick={() => setEpisodeFilter(filter.value)}
                    >
                      <span>{filter.label}</span>
                      <strong>{episodeFilterCounts[filter.value]}</strong>
                    </button>
                  ))}
                </div>
              </aside>
            </div>
          </section>
        </section>
      </section>
    </section>
  )
}

function ShowPageSkeleton() {
  return (
    <section aria-busy="true" className="page show-page show-page-v3">
      <section className="show-canvas-hero show-canvas-hero-skeleton">
        <div className="show-canvas-hero-inner">
          <div className="loading-skeleton show-canvas-poster" />
          <div className="show-canvas-main">
            <div className="loading-skeleton loading-skeleton-line show-canvas-skeleton-overline" />
            <div className="loading-skeleton loading-skeleton-title show-canvas-skeleton-title" />
            <div className="loading-skeleton loading-skeleton-line show-canvas-skeleton-score" />
            <div className="loading-skeleton loading-skeleton-button show-canvas-skeleton-button" />
          </div>
        </div>
      </section>

      <section className="show-canvas-board">
        <div className="show-canvas-tabs">
          {SECTION_LINKS.map((section) => (
            <div className="loading-skeleton loading-skeleton-chip" key={section.id} />
          ))}
        </div>

        <section className="show-canvas-stage">
          <div className="show-canvas-overview">
            <div className="show-canvas-description">
              <div className="loading-skeleton loading-skeleton-line show-skeleton-section-title" />
              {Array.from({ length: 4 }, (_, index) => (
                <div className="loading-skeleton loading-skeleton-line show-skeleton-copy" key={index} />
              ))}
            </div>
            <div className="show-canvas-details">
              <div className="loading-skeleton loading-skeleton-line show-skeleton-section-title" />
              {Array.from({ length: 6 }, (_, index) => (
                <div className="show-canvas-detail-row" key={index}>
                  <div className="loading-skeleton loading-skeleton-line show-skeleton-detail-key" />
                  <div className="loading-skeleton loading-skeleton-line show-skeleton-detail-value" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </section>
  )
}

function episodeHref(showId: string, episode: ShowEpisode, translationType: TranslationType) {
  const baseHref = withMode(`/player/${showId}/${episode.number}`, translationType)
  if (episode.progress && !episode.progress.completed && episode.progress.currentTime > 0) {
    return `${baseHref}&t=${Math.floor(episode.progress.currentTime)}`
  }

  return baseHref
}

function formatLabel(value: string | null | undefined) {
  if (!value) {
    return null
  }

  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function formatStatus(value: string | null | undefined) {
  const label = formatLabel(value)
  if (!label) {
    return null
  }

  return label.replace('Releasing', 'Ongoing')
}

function buildSeasonLabel(season: string | null | undefined, year: number | null | undefined) {
  const seasonLabel = formatLabel(season)
  if (seasonLabel && year) {
    return `${seasonLabel} ${year}`
  }

  if (seasonLabel) {
    return seasonLabel
  }

  if (year) {
    return String(year)
  }

  return null
}

function formatDate(date: ShowPageAniListDetails['startDate']) {
  if (!date?.year) {
    return null
  }

  const month = date.month ? new Date(Date.UTC(date.year, date.month - 1, 1)).toLocaleString(undefined, { month: 'short' }) : null
  if (month && date.day) {
    return `${month} ${date.day}, ${date.year}`
  }

  if (month) {
    return `${month} ${date.year}`
  }

  return String(date.year)
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null
  }

  return value.toLocaleString()
}

function formatScore(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null
  }

  return `${Math.round(value)}%`
}

function formatCompactNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null
  }

  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: value >= 100000 ? 0 : 1,
  }).format(value)
}

function getAverageEpisodeDuration(episodes: ShowEpisode[]) {
  const durations = episodes
    .map((episode) => episode.durationSeconds)
    .filter((value): value is number => typeof value === 'number' && value > 0)

  if (!durations.length) {
    return null
  }

  return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 60)
}

function getAudienceAmount(details: ShowPageAniListDetails | null, status: AudienceStatus) {
  return details?.audienceStats.find((entry) => entry.status === status)?.amount ?? 0
}

function audienceStatusLabel(status: AudienceStatus) {
  switch (status) {
    case 'CURRENT':
      return 'Watching'
    case 'PLANNING':
      return 'Planning'
    case 'COMPLETED':
      return 'Completed'
    case 'PAUSED':
      return 'Paused'
    case 'DROPPED':
      return 'Dropped'
  }
}

function formatRankingHeadline(rank: number, type: string) {
  const normalizedType = type.toUpperCase()
  if (normalizedType === 'RATED') {
    return `#${rank} rated`
  }

  if (normalizedType === 'POPULAR') {
    return `#${rank} popular`
  }

  return `#${rank} ${formatLabel(type)?.toLowerCase() ?? 'ranked'}`
}

function buildHeroRankingTags(rank: number | null, popularity: number | null) {
  const tags: Array<{ kind: 'rated' | 'popular'; label: string }> = []

  if (typeof rank === 'number' && Number.isFinite(rank) && rank > 0) {
    tags.push({
      kind: 'rated',
      label: `Rated #${rank}`,
    })
  }

  if (typeof popularity === 'number' && Number.isFinite(popularity) && popularity > 0) {
    tags.push({
      kind: 'popular',
      label: `Popular #${popularity}`,
    })
  }

  return tags
}

function buildHeroTaxonomyItems(genres: string[], tags: Array<{ name: string }>) {
  const items: Array<{ key: string; kind: 'genre' | 'tag'; label: string }> = []

  genres.slice(0, 3).forEach((genre) => {
    items.push({
      key: `genre-${genre}`,
      kind: 'genre',
      label: genre,
    })
  })

  tags.slice(0, 2).forEach((tag) => {
    items.push({
      key: `tag-${tag.name}`,
      kind: 'tag',
      label: `#${tag.name}`,
    })
  })

  const remaining = Math.max(0, genres.length - 3) + Math.max(0, tags.length - 2)
  if (remaining > 0) {
    items.push({
      key: 'taxonomy-more',
      kind: 'tag',
      label: `+${remaining}`,
    })
  }

  return items
}

function buildHeroAudienceItems(stats: Array<{ status: AudienceStatus; label: string; amount: number }>) {
  return ['CURRENT', 'PLANNING', 'COMPLETED']
    .map((status) => stats.find((item) => item.status === status))
    .filter((item): item is { status: AudienceStatus; label: string; amount: number } => Boolean(item && item.amount > 0))
    .map((item) => ({
      label: item.status === 'CURRENT' ? 'watching' : item.label.toLowerCase(),
      tone: item.status === 'CURRENT' ? 'watching' : item.status === 'PLANNING' ? 'planning' : 'completed',
      value: formatCompactNumber(item.amount) ?? '0',
    }))
}

function mediaCardHref(providerShowId: string | null, siteUrl: string | null) {
  if (providerShowId) {
    return `/shows/${providerShowId}`
  }

  return siteUrl ?? null
}

function buildAiringStatusTag(status: string | null | undefined) {
  const normalized = status?.trim().toUpperCase()
  if (!normalized) {
    return null
  }

  if (normalized === 'FINISHED' || normalized === 'FINISHED_AIRING') {
    return 'Finished'
  }

  if (normalized === 'RELEASING' || normalized === 'CURRENTLY_AIRING') {
    return 'Airing'
  }

  return formatStatus(normalized)
}

function pickNativeTitle(...values: Array<string | null | undefined>) {
  return values.find((value) => containsJapaneseText(value ?? ''))?.trim() ?? null
}

function pickRomajiTitle(...values: Array<string | null | undefined>) {
  return values.find((value) => isLikelyRomajiTitle(value ?? ''))?.trim() ?? null
}

function containsJapaneseText(value: string) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(value)
}

function isLikelyRomajiTitle(value: string) {
  const trimmed = value.trim()
  if (!trimmed || containsJapaneseText(trimmed)) {
    return false
  }

  return /[A-Za-z]/.test(trimmed)
}

function buildUpdatedLibraryEntry(current: LibraryEntry | null, input: LibraryUpdateInput): LibraryEntry {
  const watchLater = input.watchLater ?? current?.watchLater ?? false
  const completed = input.completed ?? current?.completed ?? false

  return {
    showId: input.showId,
    title: input.title,
    posterUrl: input.posterUrl ?? current?.posterUrl ?? null,
    latestEpisodeNumber: current?.latestEpisodeNumber ?? null,
    resumeEpisodeNumber: input.removeFromContinueWatching ? null : current?.resumeEpisodeNumber ?? null,
    resumeTime: input.removeFromContinueWatching ? 0 : current?.resumeTime ?? 0,
    updatedAt: current?.updatedAt ?? new Date().toISOString(),
    favorited: input.favorited ?? current?.favorited ?? false,
    watchLater,
    completed,
    completedAt: completed ? current?.completedAt ?? new Date().toISOString() : null,
  }
}

function getEpisodeProgressPercent(episode: ShowEpisode) {
  if (!episode.progress) {
    return null
  }

  if (episode.progress.completed) {
    return 100
  }

  if (episode.progress.duration <= 0) {
    return null
  }

  return Math.max(0, Math.min(100, Math.round((episode.progress.currentTime / episode.progress.duration) * 100)))
}

function getEpisodeStateLabel(episode: ShowEpisode) {
  if (episode.isCurrent) {
    return 'Up next'
  }

  if (episode.progress?.completed) {
    return 'Watched'
  }

  if (episode.progress && episode.progress.currentTime > 0) {
    return `In progress ${getEpisodeProgressPercent(episode) ?? 0}%`
  }

  return null
}

function getEpisodeAvailabilityLabel(
  episode: ShowEpisode,
  availableEpisodes: Record<TranslationType, number> | null,
) {
  const episodeNumber = Number(episode.number)

  if (!availableEpisodes || !Number.isFinite(episodeNumber) || episodeNumber <= 0) {
    return null
  }

  const hasSub = episodeNumber <= (availableEpisodes.sub ?? 0)
  const hasDub = episodeNumber <= (availableEpisodes.dub ?? 0)

  if (hasSub && hasDub) {
    return null
  }

  if (hasDub) {
    return 'Dub'
  }

  return 'Sub'
}

function formatEpisodeDuration(durationSeconds: number | null | undefined) {
  if (!durationSeconds || durationSeconds <= 0) {
    return null
  }

  return `${Math.round(durationSeconds / 60)} min`
}

function buildEpisodeSummaryLabel(input: {
  visibleEpisodeCount: number
  totalEpisodeCount: number
  searchTerm: string
  filter: EpisodeFilter
}) {
  if (!input.totalEpisodeCount) {
    return 'No episodes available yet.'
  }

  if (input.visibleEpisodeCount === input.totalEpisodeCount && !input.searchTerm && input.filter === 'all') {
    return `Showing all ${input.totalEpisodeCount} episodes.`
  }

  return `Showing ${input.visibleEpisodeCount} of ${input.totalEpisodeCount} episodes.`
}
