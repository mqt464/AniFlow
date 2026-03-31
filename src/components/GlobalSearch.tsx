import { Search, Star } from 'lucide-react'
import { useDeferredValue, useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { ShowSummary, TranslationType } from '../../shared/contracts'
import { ApiError, createApi } from '../lib/api'
import { pickAvailableTranslation, withMode } from '../lib/appPreferences'
import { PosterImage } from './PosterImage'

const DEFAULT_PLACEHOLDER = 'Search anime, characters, studios'
const PLACEHOLDER_PREFIX = 'Search '
const PLACEHOLDER_TYPING_DELAY_MS = 68
const PLACEHOLDER_BACKSPACE_DELAY_MS = 42
const PLACEHOLDER_HOLD_MS = 2000
const PLACEHOLDER_RESTART_DELAY_MS = 260

interface GlobalSearchProps {
  password: string
  preferredTranslationType: TranslationType
}

export function GlobalSearch({ password, preferredTranslationType }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ShowSummary[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedQuery, setResolvedQuery] = useState('')
  const [trendingTitles, setTrendingTitles] = useState<string[]>([])
  const [placeholder, setPlaceholder] = useState(DEFAULT_PLACEHOLDER)
  const deferredQuery = useDeferredValue(query)
  const navigate = useNavigate()
  const dropdownId = useId()
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && containerRef.current?.contains(target)) {
        return
      }

      setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [])

  useEffect(() => {
    let active = true

    void createApi(password)
      .getHome()
      .then((payload) => {
        if (!active) {
          return
        }

        const nextTitles = Array.from(
          new Set(
            payload.discover.trending
              .map((show) => show.title.trim())
              .filter((title) => title.length > 0),
          ),
        ).slice(0, 12)

        setTrendingTitles(nextTitles)
      })
      .catch(() => {
        if (!active) {
          return
        }

        setTrendingTitles([])
      })

    return () => {
      active = false
    }
  }, [password])

  useEffect(() => {
    if (query.length > 0 || trendingTitles.length === 0) {
      setPlaceholder(DEFAULT_PLACEHOLDER)
      return
    }

    let active = true
    let timeoutId = 0
    let previousTitle: string | null = null

    const schedule = (callback: () => void, delay: number) => {
      timeoutId = window.setTimeout(callback, delay)
    }

    const runCycle = () => {
      if (!active) {
        return
      }

      const title = pickNextTrendingTitle(trendingTitles, previousTitle)
      previousTitle = title
      const fullText = `${PLACEHOLDER_PREFIX}${title}...`
      const minimumLength = PLACEHOLDER_PREFIX.length
      let visibleLength = minimumLength

      setPlaceholder(PLACEHOLDER_PREFIX)

      const typeForward = () => {
        if (!active) {
          return
        }

        visibleLength += 1
        setPlaceholder(fullText.slice(0, visibleLength))

        if (visibleLength < fullText.length) {
          schedule(typeForward, PLACEHOLDER_TYPING_DELAY_MS)
          return
        }

        schedule(typeBackward, PLACEHOLDER_HOLD_MS)
      }

      const typeBackward = () => {
        if (!active) {
          return
        }

        visibleLength -= 1
        setPlaceholder(fullText.slice(0, Math.max(visibleLength, 0)))

        if (visibleLength > minimumLength) {
          schedule(typeBackward, PLACEHOLDER_BACKSPACE_DELAY_MS)
          return
        }

        setPlaceholder(PLACEHOLDER_PREFIX)
        schedule(runCycle, PLACEHOLDER_RESTART_DELAY_MS)
      }

      typeForward()
    }

    runCycle()

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [query, trendingTitles])

  useEffect(() => {
    const trimmedQuery = deferredQuery.trim()
    if (trimmedQuery.length < 2) {
      setResults([])
      setError(null)
      setResolvedQuery('')
      return
    }

    let active = true
    const api = createApi(password)

    setError(null)

    void api
      .search(trimmedQuery)
      .then((payload) => {
        if (!active) {
          return
        }

        setResults(payload.results.slice(0, 6))
        setError(null)
        setResolvedQuery(trimmedQuery)
      })
      .catch((reason: unknown) => {
        if (!active) {
          return
        }

        setResults([])
        setError(reason instanceof ApiError ? reason.message : 'Search is unavailable')
        setResolvedQuery(trimmedQuery)
      })

    return () => {
      active = false
    }
  }, [deferredQuery, password])

  const trimmedQuery = query.trim()
  const showDropdown = isOpen && trimmedQuery.length >= 2
  const isLoading = showDropdown && resolvedQuery !== trimmedQuery && !error
  const visibleResults = resolvedQuery === trimmedQuery ? results : []

  return (
    <div ref={containerRef} className="global-search">
      <form
        className="global-search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          if (!trimmedQuery) {
            return
          }

          navigate(`/search?q=${encodeURIComponent(trimmedQuery)}`)
          setIsOpen(false)
        }}
      >
        <Search aria-hidden="true" size={18} strokeWidth={1.9} />
        <input
          aria-controls={dropdownId}
          aria-expanded={showDropdown}
          aria-label="Search anime"
          placeholder={placeholder}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setError(null)
            setIsOpen(true)
          }}
          onFocus={() => {
            if (trimmedQuery.length >= 2) {
              setIsOpen(true)
            }
          }}
        />
      </form>

      {showDropdown ? (
        <div className="search-dropdown" id={dropdownId} role="listbox">
          {isLoading ? (
            <div aria-hidden="true" className="search-dropdown-loading">
              {Array.from({ length: 4 }, (_, index) => (
                <div className="search-suggestion search-suggestion-skeleton" key={index}>
                  <div className="loading-skeleton search-suggestion-thumb" />
                  <div className="search-suggestion-copy">
                    <div className="loading-skeleton loading-skeleton-line search-suggestion-line" />
                    <div className="loading-skeleton loading-skeleton-line search-suggestion-line search-suggestion-line-short" />
                  </div>
                  <div className="search-suggestion-meta">
                    <div className="loading-skeleton loading-skeleton-chip" />
                    <div className="loading-skeleton loading-skeleton-chip" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {error && !isLoading ? <div className="search-dropdown-state">{error}</div> : null}

          {!error && !isLoading && visibleResults.length === 0 ? (
            <div className="search-dropdown-state">No similar results yet.</div>
          ) : null}

          {!error && !isLoading
            ? visibleResults.map((show) => (
                <Link
                  key={show.id}
                  className="search-suggestion"
                  role="option"
                  to={withMode(`/shows/${show.id}`, pickAvailableTranslation(show.availableEpisodes, preferredTranslationType))}
                  onClick={() => {
                    setQuery(show.title)
                    setIsOpen(false)
                  }}
                >
                  <PosterImage alt={`${show.title} poster`} className="search-suggestion-thumb" src={show.posterUrl ?? show.bannerUrl} />
                  <div className="search-suggestion-copy">
                    <strong>{show.title}</strong>
                    <span>{show.year ?? 'Unknown year'}</span>
                  </div>
                  <div className="search-suggestion-meta">
                    <span className="search-suggestion-score">
                      <Star aria-hidden="true" size={14} strokeWidth={1.9} />
                      {show.score ? Math.round(show.score) : 'NR'}
                    </span>
                    <span>{show.availableEpisodes.sub} eps</span>
                  </div>
                </Link>
              ))
            : null}
        </div>
      ) : null}
    </div>
  )
}

function pickNextTrendingTitle(titles: string[], previousTitle: string | null) {
  if (titles.length <= 1) {
    return titles[0] ?? ''
  }

  const pool = previousTitle ? titles.filter((title) => title !== previousTitle) : titles
  return pool[Math.floor(Math.random() * pool.length)] ?? titles[0]
}
