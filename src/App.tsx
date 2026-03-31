import { CircleUserRound, ExternalLink, Home, LoaderCircle, Settings } from 'lucide-react'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'

import { GlobalSearch } from './components/GlobalSearch'
import type { AniListConnection } from '../shared/contracts'
import {
  readStoredPassword,
  readStoredPreferredTranslation,
  writeStoredPassword,
  writeStoredPreferredTranslation,
} from './lib/appPreferences'
import { createApi } from './lib/api'
import { SessionContext, type SessionContextValue, useSession } from './session'

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const SearchPage = lazy(() => import('./pages/SearchPage').then((module) => ({ default: module.SearchPage })))
const ShowPage = lazy(() => import('./pages/ShowPage').then((module) => ({ default: module.ShowPage })))
const PlayerPage = lazy(() => import('./pages/PlayerPage').then((module) => ({ default: module.PlayerPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))

function AppShell() {
  const { password, preferredTranslationType } = useSession()
  const location = useLocation()
  const isPlayerRoute = location.pathname.startsWith('/player/')

  return (
    <div className={`app-shell ${isPlayerRoute ? 'app-shell-player' : ''}`}>
      {!isPlayerRoute ? (
        <header className="app-header">
          <div className="app-header-side app-header-side-start">
            <div aria-label="AniFlow" className="brand">
              AniFlow
            </div>

            <nav aria-label="Primary" className="nav">
              <NavLink to="/">
                <Home size={16} />
                <span>Home</span>
              </NavLink>
            </nav>
          </div>

          <div className="app-header-search">
            <GlobalSearch password={password} preferredTranslationType={preferredTranslationType} />
          </div>

          <div className="app-header-side app-header-side-end">
            <ProfileMenu />
          </div>
        </header>
      ) : null}

      <main className={`main-content ${isPlayerRoute ? 'main-content-player' : ''}`}>
        <Outlet />
      </main>
    </div>
  )
}

function ProfileMenu() {
  const { password, setPassword } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState<AniListConnection | null>(null)
  const [libraryStats, setLibraryStats] = useState({
    watching: 0,
    watchLater: 0,
    completed: 0,
    favorites: 0,
  })
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const api = createApi(password)
    let active = true

    setLoading(true)
    void api
      .getHome()
      .then((payload) => {
        if (!active) {
          return
        }

        setConnection(payload.anilist)
        setLibraryStats({
          watching: payload.continueWatching.length,
          watchLater: payload.watchLater.length,
          completed: payload.completed.length,
          favorites: payload.favorites.length,
        })
      })
      .catch(() => {
        if (!active) {
          return
        }

        setConnection(null)
        setLibraryStats({
          watching: 0,
          watchLater: 0,
          completed: 0,
          favorites: 0,
        })
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [password])

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

  return (
    <div ref={containerRef} className="profile-menu">
      <button
        aria-expanded={isOpen}
        aria-busy={loading}
        aria-label="Open profile menu"
        className="profile-button"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        {loading ? (
          <LoaderCircle className="spin" size={18} strokeWidth={2} />
        ) : connection?.connected && connection.avatarUrl ? (
          <img alt="" className="profile-avatar" src={connection.avatarUrl} />
        ) : (
          <CircleUserRound size={20} strokeWidth={1.9} />
        )}
      </button>

      {isOpen ? (
        <div className="profile-dropdown">
          <div className="profile-summary">
            <div className="profile-summary-art">
              {connection?.connected && connection.avatarUrl ? (
                <img alt="" className="profile-summary-avatar" src={connection.avatarUrl} />
              ) : (
                <CircleUserRound size={22} strokeWidth={1.9} />
              )}
            </div>

            <div className="profile-summary-copy">
              <strong>{loading ? 'Loading profile...' : connection?.username ?? 'Local profile'}</strong>
              <span>
                {connection?.connected
                  ? connection.lastSyncStatus ?? 'AniList connected'
                  : loading
                    ? 'Checking AniList connection'
                    : 'AniList not connected'}
              </span>
            </div>

            {loading ? <LoaderCircle className="spin profile-summary-spinner" size={16} strokeWidth={2} /> : null}
          </div>

          <div className="profile-stats" aria-label="Library summary">
            <div className="profile-stat">
              <span>Watching</span>
              <strong>{loading ? '...' : libraryStats.watching}</strong>
            </div>
            <div className="profile-stat">
              <span>Watch later</span>
              <strong>{loading ? '...' : libraryStats.watchLater}</strong>
            </div>
            <div className="profile-stat">
              <span>Completed</span>
              <strong>{loading ? '...' : libraryStats.completed}</strong>
            </div>
            <div className="profile-stat">
              <span>My list</span>
              <strong>{loading ? '...' : libraryStats.favorites}</strong>
            </div>
          </div>

          {connection?.connected && connection.profileUrl ? (
            <a
              className="profile-action"
              href={connection.profileUrl}
              rel="noreferrer"
              target="_blank"
              onClick={() => setIsOpen(false)}
            >
              <ExternalLink size={16} strokeWidth={1.9} />
              <span>Open AniList profile</span>
            </a>
          ) : null}

          <Link className="profile-action" to="/settings" onClick={() => setIsOpen(false)}>
            <Settings size={16} strokeWidth={1.9} />
            <span>Settings</span>
          </Link>

          <div className="profile-field">
            <label htmlFor="lan-password">LAN password</label>
            <input
              id="lan-password"
              placeholder="Optional"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/shows/:showId" element={<ShowPage />} />
          <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

function RouteLoadingFallback() {
  return (
    <section aria-busy="true" className="page page-narrow route-loading-page">
      <div className="route-loading-hero panel">
        <div className="route-loading-copy">
          <div className="loading-skeleton loading-skeleton-title route-loading-title" />
          <div className="loading-skeleton loading-skeleton-line route-loading-line" />
          <div className="loading-skeleton loading-skeleton-line route-loading-line route-loading-line-short" />
        </div>
      </div>

      <div className="route-loading-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="route-loading-card" key={index}>
            <div className="loading-skeleton route-loading-poster" />
            <div className="route-loading-card-copy">
              <div className="loading-skeleton loading-skeleton-line route-loading-card-line" />
              <div className="loading-skeleton loading-skeleton-line route-loading-card-line route-loading-card-line-short" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function App() {
  const [password, setPasswordState] = useState(readStoredPassword)
  const [preferredTranslationType, setPreferredTranslationTypeState] = useState(readStoredPreferredTranslation)

  const value: SessionContextValue = {
    password,
    setPassword: (nextValue: string) => {
      setPasswordState(nextValue)
      writeStoredPassword(nextValue)
    },
    preferredTranslationType,
    setPreferredTranslationType: (nextValue) => {
      setPreferredTranslationTypeState(nextValue)
      writeStoredPreferredTranslation(nextValue)
    },
  }

  return (
    <SessionContext.Provider value={value}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </SessionContext.Provider>
  )
}
