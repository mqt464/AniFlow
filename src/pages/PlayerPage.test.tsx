import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { PlayerPage } from './PlayerPage'
import { SessionContext, type SessionContextValue } from '../session'

vi.mock('hls.js', () => ({
  default: class MockHls {
    static isSupported() {
      return false
    }

    loadSource() {}
    attachMedia() {}
    destroy() {}
  },
}))

const sessionValue: SessionContextValue = {
  password: '',
  setPassword: vi.fn(),
  preferredTranslationType: 'sub',
  setPreferredTranslationType: vi.fn(),
}

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('PlayerPage', () => {
  it('keeps the next episode poster when navigating between episodes in the same show', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url === '/api/playback/resolve') {
        const payload = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { episodeNumber: string }
        return jsonResponse({
          showId: 'demo-show',
          episodeNumber: payload.episodeNumber,
          translationType: 'sub',
          showTitle: 'Demo Show',
          streamUrl: `https://cdn.example.com/${payload.episodeNumber}.mp4`,
          mimeType: 'video/mp4',
          subtitleUrl: null,
          subtitleMimeType: null,
          qualities: [
            {
              id: 'default',
              label: 'Auto',
              proxyUrl: `https://cdn.example.com/${payload.episodeNumber}.mp4`,
            },
          ],
          skipSegments: [],
          nextEpisodeNumber: payload.episodeNumber === '1' ? '2' : '3',
          title: payload.episodeNumber === '1' ? 'Arrival' : 'Training Day',
        })
      }

      if (url === '/api/shows/demo-show/page?translationType=sub') {
        return jsonResponse({
          show: {
            id: 'demo-show',
            title: 'Demo Show',
            originalTitle: null,
            bannerUrl: null,
            posterUrl: 'https://example.com/poster.jpg',
            description: null,
            genres: [],
            status: null,
            year: 2024,
            season: 'SPRING',
            score: null,
            availableEpisodes: {
              sub: 3,
              dub: 3,
            },
            provider: 'allanime',
          },
          translationType: 'sub',
          episodes: [
            {
              showId: 'demo-show',
              number: '1',
              title: 'Arrival',
              translationType: 'sub',
              durationSeconds: 1440,
              progress: null,
              isCurrent: true,
              annotation: null,
            },
            {
              showId: 'demo-show',
              number: '2',
              title: 'Training Day',
              translationType: 'sub',
              durationSeconds: 1440,
              progress: null,
              isCurrent: false,
              annotation: null,
            },
            {
              showId: 'demo-show',
              number: '3',
              title: 'Final Strike',
              translationType: 'sub',
              durationSeconds: 1440,
              progress: null,
              isCurrent: false,
              annotation: null,
            },
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '3',
            updatedAt: null,
          },
          library: null,
          fillerSource: null,
          fillerMatchTitle: null,
        })
      }

      if (url.startsWith('/api/shows/demo-show/episodes?translationType=')) {
        return jsonResponse({
          episodes: [
            { showId: 'demo-show', number: '1', title: 'Arrival', translationType: 'sub', durationSeconds: 1440 },
            { showId: 'demo-show', number: '2', title: 'Training Day', translationType: 'sub', durationSeconds: 1440 },
            { showId: 'demo-show', number: '3', title: 'Final Strike', translationType: 'sub', durationSeconds: 1440 },
          ],
        })
      }

      if (url === '/api/progress') {
        const payload = JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
        return jsonResponse({
          progress: {
            ...payload,
            updatedAt: '2026-03-31T08:00:00.000Z',
          },
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    const user = userEvent.setup()

    render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByAltText('Demo Show poster')).toHaveAttribute('src', 'https://example.com/poster.jpg')
    })

    await user.click(screen.getByRole('button', { name: 'Next episode' }))

    await waitFor(() => {
      expect(screen.getByText('Episode 3 • Final Strike')).toBeInTheDocument()
      expect(screen.getByAltText('Demo Show poster')).toHaveAttribute('src', 'https://example.com/poster.jpg')
    })
  })
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
