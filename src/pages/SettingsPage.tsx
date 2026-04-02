import { CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { AniListConnection, TranslationType } from '../../shared/contracts'
import { ApiError, createApi } from '../lib/api'
import { readStoredAniListToken, writeStoredAniListToken } from '../lib/appPreferences'
import { useSession } from '../session'

type TokenState = 'idle' | 'checking' | 'valid' | 'invalid'

const PIN_REDIRECT_URL = 'https://anilist.co/api/v2/oauth/pin'
const ANILIST_SYNC_FEATURES = [
  {
    title: 'Currently watching',
    detail: 'Keeps your active episode progress aligned with AniList current entries.',
  },
  {
    title: 'Watch later',
    detail: 'Pushes queued shows to AniList as planning entries.',
  },
  {
    title: 'Completed',
    detail: 'Marks finished anime as completed on AniList.',
  },
] as const

export function SettingsPage() {
  const {
    password,
    setPassword,
    preferredTranslationType,
    setPreferredTranslationType,
    autoNextEnabled,
    setAutoNextEnabled,
    autoSkipSegmentsEnabled,
    setAutoSkipSegmentsEnabled,
  } = useSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const [token, setToken] = useState(readStoredAniListToken)
  const [connection, setConnection] = useState<AniListConnection | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<string | null>(
    searchParams.get('anilist') === 'connected' ? 'AniList connected. Refreshing account details.' : null,
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tokenState, setTokenState] = useState<TokenState>('idle')
  const [tokenMessage, setTokenMessage] = useState<string | null>(null)
  const configuredAuthorizeUrl = import.meta.env.VITE_ANILIST_CLIENT_ID
    ? `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(import.meta.env.VITE_ANILIST_CLIENT_ID)}&response_type=token`
    : null

  useEffect(() => {
    if (searchParams.get('anilist') !== 'connected') {
      return
    }

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('anilist')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

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
        setError(null)

        if (payload.anilist.connected && payload.anilist.username && status?.includes('Refreshing')) {
          setStatus(`Connected as ${payload.anilist.username}`)
        }
      })
      .catch((reason: unknown) => {
        if (!active) {
          return
        }

        setConnection(null)
        setError(reason instanceof ApiError ? reason.message : 'Unable to load current settings')
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [password, status])

  useEffect(() => {
    writeStoredAniListToken(token)

    const nextToken = token.trim()
    if (!nextToken) {
      setTokenState('idle')
      setTokenMessage(null)
      return
    }

    const api = createApi(password)
    let active = true
    const timeoutId = window.setTimeout(() => {
      setTokenState('checking')
      setTokenMessage('Checking AniList token...')

      void api
        .connectAniList({ accessToken: nextToken })
        .then((result) => {
          if (!active) {
            return
          }

          setConnection(result)
          setStatus(`Connected as ${result.username}`)
          setTokenState('valid')
          setTokenMessage(`Token valid for ${result.username}`)
        })
        .catch((reason: unknown) => {
          if (!active) {
            return
          }

          setTokenState('invalid')
          setTokenMessage(reason instanceof ApiError ? reason.message : 'AniList token check failed')
        })
    }, 700)

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [password, token])

  const syncNow = async () => {
    try {
      setSyncing(true)
      setError(null)
      const result = await createApi(password).syncAniList()
      setConnection(result.connection)
      setStatus(result.connection.lastSyncStatus ?? 'AniList sync finished')
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : 'AniList sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const disconnect = async () => {
    try {
      setSyncing(true)
      setError(null)
      const result = await createApi(password).disconnectAniList()
      setConnection(result.connection)
      setStatus('AniList disconnected')
      setToken('')
      setTokenState('idle')
      setTokenMessage(null)
      writeStoredAniListToken('')
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to disconnect AniList right now')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="page page-narrow settings-page">
      <header className="page-header settings-page-header">
        <h1>Settings</h1>
      </header>

      {status ? <div className="notice success">{status}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <section className="settings-section panel" id="playback">
        <div className="settings-section-heading">
          <h2>Playback</h2>
        </div>

        <div className="settings-row">
          <label className="settings-label-block">
            <span>Preferred audio</span>
            <span className="form-hint">Applied when you open a title.</span>
          </label>

          <div className="settings-segmented" role="group" aria-label="Preferred audio">
            {(['sub', 'dub'] as TranslationType[]).map((mode) => (
              <button
                key={mode}
                aria-pressed={preferredTranslationType === mode}
                className={preferredTranslationType === mode ? 'active' : ''}
                type="button"
                onClick={() => setPreferredTranslationType(mode)}
              >
                {mode === 'sub' ? 'Sub' : 'Dub'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label-block">
            <span>Auto next</span>
            <span className="form-hint">Automatically start the next episode when playback ends.</span>
          </label>

          <div className="settings-segmented" role="group" aria-label="Auto next">
            {[true, false].map((enabled) => (
              <button
                key={enabled ? 'on' : 'off'}
                aria-pressed={autoNextEnabled === enabled}
                className={autoNextEnabled === enabled ? 'active' : ''}
                type="button"
                onClick={() => setAutoNextEnabled(enabled)}
              >
                {enabled ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label-block">
            <span>Auto skip intros and outros</span>
            <span className="form-hint">Skips AniSkip intro and outro segments after 3 seconds in the player.</span>
          </label>

          <div className="settings-segmented" role="group" aria-label="Auto skip intros and outros">
            {[true, false].map((enabled) => (
              <button
                key={enabled ? 'on' : 'off'}
                aria-pressed={autoSkipSegmentsEnabled === enabled}
                className={autoSkipSegmentsEnabled === enabled ? 'active' : ''}
                type="button"
                onClick={() => setAutoSkipSegmentsEnabled(enabled)}
              >
                {enabled ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section panel" id="access">
        <div className="settings-section-heading">
          <h2>Access</h2>
        </div>

        <div className="settings-row">
          <label className="settings-label-block" htmlFor="lan-password">
            <span>LAN password</span>
            <span className="form-hint">Stored on this device.</span>
          </label>

          <input
            id="lan-password"
            placeholder="Optional"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </section>

      <section className="settings-section panel" id="anilist">
        <div className="settings-section-heading">
          <h2>AniList sync</h2>
          <div className={`settings-connection-pill ${connection?.connected ? 'connected' : ''}`}>
            {connection?.connected ? 'Connected' : 'Not connected'}
          </div>
        </div>

        <div className="settings-connection-meta" aria-label="AniList connection details">
          {loading ? (
            Array.from({ length: 4 }, (_, index) => (
              <div className="settings-connection-meta-skeleton" key={index}>
                <div className="loading-skeleton loading-skeleton-line settings-skeleton-label" />
                <div className="loading-skeleton loading-skeleton-line settings-skeleton-value" />
              </div>
            ))
          ) : (
            <>
              <div>
                <span>Account</span>
                <strong>{connection?.username ?? 'None'}</strong>
              </div>
              <div>
                <span>Connected</span>
                <strong>{formatTimestamp(connection?.connectedAt)}</strong>
              </div>
              <div>
                <span>Last import</span>
                <strong>{formatTimestamp(connection?.lastPullAt)}</strong>
              </div>
              <div>
                <span>Last sync</span>
                <strong>{connection?.lastSyncStatus ?? 'No sync status yet'}</strong>
              </div>
            </>
          )}
        </div>

        {loading ? (
          <div aria-hidden="true" className="settings-anilist-profile settings-anilist-profile-skeleton">
            <div className="loading-skeleton settings-anilist-profile-art" />
            <div className="settings-anilist-profile-copy">
              <div className="loading-skeleton loading-skeleton-line settings-skeleton-value" />
              <div className="loading-skeleton loading-skeleton-line settings-skeleton-line" />
              <div className="loading-skeleton loading-skeleton-line settings-skeleton-line" />
              <div className="loading-skeleton loading-skeleton-line settings-skeleton-line settings-skeleton-line-short" />
            </div>
          </div>
        ) : connection?.connected ? (
          <div className="settings-anilist-profile">
            <div className="settings-anilist-profile-art">
              {connection.avatarUrl ? <img alt="" src={connection.avatarUrl} /> : <span>{connection.username?.slice(0, 1) ?? 'A'}</span>}
            </div>

            <div className="settings-anilist-profile-copy">
              <strong>{connection.username}</strong>
              <span>{connection.profileUrl ? trimProfileUrl(connection.profileUrl) : 'Connected AniList account'}</span>
              {connection.about ? <p>{connection.about}</p> : <p>No AniList bio is available for this account yet.</p>}
            </div>

            <div className="button-row settings-actions">
              <button disabled={syncing} type="button" onClick={() => void syncNow()}>
                {syncing ? <LoaderCircle className="spin" size={16} strokeWidth={2} /> : <RefreshCw size={16} strokeWidth={1.9} />}
                {syncing ? 'Syncing...' : 'Sync now'}
              </button>

              <button className="secondary-button" disabled={syncing} type="button" onClick={() => void disconnect()}>
                Disconnect
              </button>

              {connection.profileUrl ? (
                <a className="secondary-button" href={connection.profileUrl} rel="noreferrer" target="_blank">
                  <ExternalLink size={16} strokeWidth={1.9} />
                  Open AniList
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="settings-anilist-scope" aria-label="AniList sync features">
          {ANILIST_SYNC_FEATURES.map((feature) => (
            <div className="settings-anilist-scope-item" key={feature.title}>
              <strong>{feature.title}</strong>
              <span>{feature.detail}</span>
            </div>
          ))}
        </div>

        <div className="settings-anilist-instructions">
          <strong>Get a token</strong>
          <p className="form-hint">
            AniFlow syncs currently watching progress, <span className="settings-inline-code">Watch later</span>, and{' '}
            <span className="settings-inline-code">Completed</span> with AniList.
          </p>
          <ol className="settings-steps">
            <li>
              Sign in and open <a href="https://anilist.co/settings/developer" rel="noreferrer" target="_blank">AniList Developer Settings</a>.
            </li>
            <li>
              Click <span className="settings-inline-code">Create New Client</span>.
            </li>
            <li>
              In the client settings, set the redirect URL to <a href={PIN_REDIRECT_URL} rel="noreferrer" target="_blank">{PIN_REDIRECT_URL}</a>.
            </li>
            <li>
              Save the client, then copy the Client ID shown for that app.
            </li>
            <li>
              Open this authorize URL in your browser, replacing <span className="settings-inline-code">YOUR_CLIENT_ID</span> with the Client ID you just copied:
              {' '}
              <span className="settings-inline-code">https://anilist.co/api/v2/oauth/authorize?client_id=YOUR_CLIENT_ID&amp;response_type=token</span>.
              {configuredAuthorizeUrl ? (
                <>
                  {' '}
                  Or <a href={configuredAuthorizeUrl} rel="noreferrer" target="_blank">open the authorize URL with this app&apos;s configured client ID</a>.
                </>
              ) : null}
            </li>
            <li>
              Approve access when AniList prompts you, then copy the access token shown on the PIN page.
            </li>
            <li>
              Paste that token into the field below. AniFlow will check it automatically. Reference:
              {' '}
              <a href="https://anilist.gitbook.io/anilist-apiv2-docs" rel="noreferrer" target="_blank">AniList API docs</a>.
            </li>
          </ol>
        </div>

        <div className="settings-row settings-row-stack">
          <label className="settings-label-block" htmlFor="anilist-token">
            <span>Personal access token</span>
            <span className="form-hint">Saved locally and checked automatically.</span>
          </label>

          <div className={`token-field-shell ${tokenState}`}>
            <input
              id="anilist-token"
              autoComplete="off"
              placeholder="Paste an AniList token"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <span aria-hidden="true" className="token-field-status">
              {tokenState === 'checking' ? <LoaderCircle className="spin" size={16} strokeWidth={2} /> : null}
              {tokenState === 'valid' ? <CheckCircle2 size={16} strokeWidth={2} /> : null}
              {tokenState === 'invalid' ? <XCircle size={16} strokeWidth={2} /> : null}
            </span>
          </div>

          {tokenMessage ? (
            <div className={`token-field-message ${tokenState === 'invalid' ? 'error' : tokenState === 'valid' ? 'success' : ''}`}>
              {tokenMessage}
            </div>
          ) : null}
        </div>
      </section>
    </section>
  )
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return 'Not available'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function trimProfileUrl(value: string) {
  return value.replace(/^https?:\/\//, '')
}
