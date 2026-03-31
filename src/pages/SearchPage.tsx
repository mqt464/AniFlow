import { ArrowRight, Search, Star } from 'lucide-react'
import { useDeferredValue, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type { SearchPayload, ShowSummary } from '../../shared/contracts'
import { ApiError, createApi } from '../lib/api'
import { pickAvailableTranslation, withMode } from '../lib/appPreferences'
import { PosterImage } from '../components/PosterImage'
import { useSession } from '../session'

const SEARCH_SKELETON_COUNT = 6

export function SearchPage() {
  const { password, preferredTranslationType } = useSession()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState<SearchPayload | null>(null)
  const [error, setError] = useState<{ message: string; query: string } | null>(null)
  const query = searchParams.get('q') ?? ''
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    const trimmedQuery = deferredQuery.trim()
    if (!trimmedQuery) {
      return
    }

    let active = true
    const api = createApi(password)

    void api
      .search(trimmedQuery)
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

        setError({
          message: reason instanceof ApiError ? reason.message : 'Search failed',
          query: trimmedQuery,
        })
      })

    return () => {
      active = false
    }
  }, [deferredQuery, password])

  const trimmedQuery = query.trim()
  const resolvedQuery = data?.query.trim() ?? ''
  const visibleError = error?.query === trimmedQuery ? error.message : null
  const isLoading = Boolean(trimmedQuery) && resolvedQuery !== trimmedQuery && !visibleError
  const results = trimmedQuery && resolvedQuery === trimmedQuery ? data?.results ?? [] : []
  const featuredShow = results[0] ?? null
  const remainingResults = featuredShow ? results.slice(1) : []
  const resultCountLabel = isLoading ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'}`

  return (
    <section className="page page-narrow search-page">
      {!trimmedQuery ? (
        <div className="search-empty-shell">
          <Search aria-hidden="true" size={20} strokeWidth={1.9} />
          <p>Use the top search bar to look up a show.</p>
        </div>
      ) : (
        <>
          <header className="search-page-header">
            <h1>{trimmedQuery}</h1>
            <span className="search-page-count">{resultCountLabel}</span>
          </header>

          {visibleError && !isLoading ? <div className="notice error">{visibleError}</div> : null}

          {!visibleError && !isLoading && featuredShow ? (
            <article className="search-featured">
              <div className="search-featured-backdrop">
                <PosterImage
                  alt={`${featuredShow.title} backdrop`}
                  className="search-featured-backdrop-image"
                  src={featuredShow.bannerUrl ?? featuredShow.posterUrl}
                />
              </div>

              <div className="search-featured-content">
                <PosterImage
                  alt={`${featuredShow.title} poster`}
                  className="search-featured-poster"
                  src={featuredShow.posterUrl ?? featuredShow.bannerUrl}
                />

                <div className="search-featured-copy">
                  <div className="search-featured-heading">
                    <h2>{featuredShow.title}</h2>
                    {featuredShow.originalTitle && featuredShow.originalTitle !== featuredShow.title ? (
                      <span>{featuredShow.originalTitle}</span>
                    ) : null}
                  </div>

                  <div className="search-featured-meta">
                    {buildSummaryMeta(featuredShow).map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                    {featuredShow.score ? (
                      <span className="search-featured-score">
                        <Star aria-hidden="true" size={14} strokeWidth={1.9} />
                        {Math.round(featuredShow.score)}
                      </span>
                    ) : null}
                  </div>

                  <p className="search-featured-description">{getDescription(featuredShow)}</p>

                  <div className="search-featured-actions">
                    <Link
                      className="primary-button"
                      to={withMode(`/shows/${featuredShow.id}`, pickAvailableTranslation(featuredShow.availableEpisodes, preferredTranslationType))}
                    >
                      Open title
                      <ArrowRight aria-hidden="true" size={16} strokeWidth={1.9} />
                    </Link>
                    <span className="search-featured-availability">
                      {featuredShow.availableEpisodes.sub} sub / {featuredShow.availableEpisodes.dub} dub
                    </span>
                  </div>
                </div>
              </div>
            </article>
          ) : null}

          {!visibleError && isLoading ? (
            <div aria-hidden="true" className="search-results-grid">
              {Array.from({ length: SEARCH_SKELETON_COUNT }, (_, index) => (
                <div className="search-result-card search-result-card-skeleton" key={index}>
                  <div className="search-result-poster search-skeleton-block" />
                  <div className="search-result-copy">
                    <div className="search-result-heading">
                      <div className="search-skeleton-line search-skeleton-line-title" />
                      <div className="search-skeleton-line search-skeleton-line-subtitle" />
                    </div>
                    <div className="search-skeleton-paragraph">
                      <div className="search-skeleton-line" />
                      <div className="search-skeleton-line" />
                      <div className="search-skeleton-line search-skeleton-line-short" />
                    </div>
                    <div className="search-skeleton-footer">
                      <div className="search-skeleton-chip" />
                      <div className="search-skeleton-chip" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {!visibleError && !isLoading && results.length === 0 ? (
            <div className="search-empty-shell search-empty-shell-compact">
              <p>No results for “{trimmedQuery}”. Try a broader title in the top bar.</p>
            </div>
          ) : null}

          {!visibleError && !isLoading && remainingResults.length > 0 ? (
            <section className="search-results-section" aria-labelledby="search-results-heading">
              <div className="search-results-header">
                <h2 id="search-results-heading">{featuredShow ? 'More results' : 'Results'}</h2>
                <span>{remainingResults.length} titles</span>
              </div>

              <div className="search-results-grid">
                {remainingResults.map((show) => (
                  <Link
                    className="search-result-card"
                    key={show.id}
                    to={withMode(`/shows/${show.id}`, pickAvailableTranslation(show.availableEpisodes, preferredTranslationType))}
                  >
                    <PosterImage alt={`${show.title} poster`} className="search-result-poster" src={show.posterUrl ?? show.bannerUrl} />

                    <div className="search-result-copy">
                      <div className="search-result-heading">
                        <strong>{show.title}</strong>
                        {show.originalTitle && show.originalTitle !== show.title ? (
                          <span className="search-result-original-title">{show.originalTitle}</span>
                        ) : null}
                      </div>

                      <p className="search-result-description">{getDescription(show)}</p>

                      <div className="search-result-footer">
                        {buildSummaryMeta(show).map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                        {show.score ? (
                          <span className="search-result-score">
                            <Star aria-hidden="true" size={14} strokeWidth={1.9} />
                            {Math.round(show.score)}
                          </span>
                        ) : null}
                        <span>
                          {show.availableEpisodes.sub} sub / {show.availableEpisodes.dub} dub
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  )
}

function buildSummaryMeta(show: ShowSummary): string[] {
  return [show.year ? String(show.year) : null, show.season ? formatLabel(show.season) : null, show.status ? formatLabel(show.status) : null].filter(
    (value): value is string => Boolean(value),
  )
}

function formatLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function getDescription(show: ShowSummary): string {
  const cleaned = show.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || 'No synopsis available yet.'
}
