import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  autoNextEnabled: true,
  setAutoNextEnabled: vi.fn(),
  autoSkipSegmentsEnabled: false,
  setAutoSkipSegmentsEnabled: vi.fn(),
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
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    })),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('PlayerPage', () => {
  it('starts playback automatically when opening an episode', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play')

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
          nextEpisodeNumber: '2',
          title: 'Arrival',
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
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '2',
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

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(container.querySelector('video')).toHaveAttribute('src', 'https://cdn.example.com/1.mp4')
    })

    const video = container.querySelector('video')
    expect(video).not.toBeNull()

    await act(async () => {
      fireEvent(video!, new Event('loadedmetadata'))
    })

    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled()
    })
  })

  it('shows subtitles as a disabled option without unavailable text when captions are missing', async () => {
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
          nextEpisodeNumber: '2',
          title: 'Arrival',
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
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '2',
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
      expect(screen.getByLabelText('Playback settings')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByLabelText('Playback settings'))

    const subtitlesButton = screen.getByRole('button', { name: /closed captions/i })
    expect(subtitlesButton).toBeDisabled()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
  })

  it('renders intro and outro markers on the playback scrubber', async () => {
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
          skipSegments: [
            { label: 'Skip intro', startTime: 30, endTime: 95 },
            { label: 'Skip outro', startTime: 1260, endTime: 1380 },
          ],
          nextEpisodeNumber: '2',
          title: 'Arrival',
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
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '2',
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

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(container.querySelector('.player-timeline-segment-intro')).not.toBeNull()
      expect(container.querySelector('.player-timeline-segment-outro')).not.toBeNull()
    })
  })

  it('shows a scrubber hover preview with a timestamp', async () => {
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
          nextEpisodeNumber: '2',
          title: 'Arrival',
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
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '2',
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

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(container.querySelectorAll('video')[0]).toHaveAttribute('src', 'https://cdn.example.com/1.mp4')
      expect(container.querySelectorAll('video')[1]).toHaveAttribute('src', 'https://cdn.example.com/1.mp4')
    })

    const [mainVideo, previewVideo] = Array.from(container.querySelectorAll('video'))
    expect(mainVideo).toBeDefined()
    expect(previewVideo).toBeDefined()

    Object.defineProperty(mainVideo!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(previewVideo!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(previewVideo!, 'readyState', {
      configurable: true,
      value: 2,
    })
    Object.defineProperty(previewVideo!, 'videoWidth', {
      configurable: true,
      value: 1920,
    })
    Object.defineProperty(previewVideo!, 'videoHeight', {
      configurable: true,
      value: 1080,
    })
    Object.defineProperty(previewVideo!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      fireEvent(mainVideo!, new Event('loadedmetadata'))
      fireEvent(mainVideo!, new Event('canplay'))
      fireEvent(mainVideo!, new Event('durationchange'))
      fireEvent(previewVideo!, new Event('loadedmetadata'))
      fireEvent(previewVideo!, new Event('canplay'))
    })

    const scrubber = screen.getByLabelText('Seek timeline')
    Object.defineProperty(scrubber, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        width: 200,
        left: 0,
        right: 200,
        top: 0,
        bottom: 16,
        height: 16,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })

    await waitFor(() => {
      expect(scrubber).toHaveAttribute('max', '1440')
    })

    await act(async () => {
      fireEvent.pointerEnter(scrubber, { clientX: 100 })
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      fireEvent(previewVideo!, new Event('seeked'))
    })

    expect(screen.getByText('12:00')).toBeInTheDocument()
    expect(container.querySelector('.player-scrubber-preview')).not.toBeNull()
  })

  it('rescales skip markers when the reported segment duration exceeds the media duration', async () => {
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
          skipSegments: [
            { label: 'Skip intro', startTime: 0, endTime: 90.04 },
            { label: 'Skip outro', startTime: 1460.08, endTime: 1559.9 },
          ],
          nextEpisodeNumber: '2',
          title: 'Arrival',
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
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '1',
            updatedAt: null,
          },
          library: null,
          fillerSource: null,
          fillerMatchTitle: null,
        })
      }

      if (url.startsWith('/api/shows/demo-show/episodes?translationType=')) {
        return jsonResponse({
          episodes: [{ showId: 'demo-show', number: '1', title: 'Arrival', translationType: 'sub', durationSeconds: 1440 }],
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

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    const video = await waitFor(() => {
      const element = container.querySelector('video')
      expect(element).not.toBeNull()
      return element
    })

    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: 1440,
    })

    await act(async () => {
      fireEvent(video, new Event('loadedmetadata'))
    })

    await waitFor(() => {
      const outro = container.querySelector('.player-timeline-segment-outro') as HTMLDivElement | null
      expect(outro).not.toBeNull()
      expect(outro?.style.left).not.toBe('100%')
    })
  })

  it('shows skip countdown text and allows Enter to skip the active segment', async () => {
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
          skipSegments: [{ label: 'Skip intro', startTime: 30, endTime: 95 }],
          nextEpisodeNumber: '2',
          title: 'Arrival',
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
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '1',
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

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    const video = container.querySelector('video')
    const player = container.querySelector('.custom-player') as HTMLDivElement | null
    expect(video).not.toBeNull()
    expect(player).not.toBeNull()

    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(video!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      fireEvent(video!, new Event('loadedmetadata'))
      fireEvent(video!, new Event('canplay'))
      fireEvent(video!, new Event('durationchange'))
    })

    await act(async () => {
      video!.currentTime = 31
      fireEvent(video!, new Event('timeupdate'))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /skip intro/i })).toBeInTheDocument()
      expect(screen.getByText(/Disappears in 0:10/i)).toBeInTheDocument()
    })

    player!.focus()
    fireEvent.keyDown(player!, { key: 'Enter' })

    expect(video!.currentTime).toBe(95)
  })

  it('hides the manual skip prompt after ten seconds even if the segment is longer', async () => {
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
          skipSegments: [{ label: 'Skip intro', startTime: 30, endTime: 95 }],
          nextEpisodeNumber: '2',
          title: 'Arrival',
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
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '1',
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

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    const video = container.querySelector('video')
    expect(video).not.toBeNull()

    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(video!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      fireEvent(video!, new Event('loadedmetadata'))
      fireEvent(video!, new Event('canplay'))
      fireEvent(video!, new Event('durationchange'))
    })

    await act(async () => {
      video!.currentTime = 31
      fireEvent(video!, new Event('timeupdate'))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /skip intro/i })).toBeInTheDocument()
      expect(screen.getByText(/Disappears in 0:10/i)).toBeInTheDocument()
    })

    await act(async () => {
      video!.currentTime = 41
      fireEvent(video!, new Event('timeupdate'))
      await new Promise((resolve) => window.setTimeout(resolve, 220))
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /skip intro/i })).not.toBeInTheDocument()
    })
  })

  it('keeps the manual skip countdown capped at ten seconds when scrubbing backward inside the segment', async () => {
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
          skipSegments: [{ label: 'Skip intro', startTime: 30, endTime: 95 }],
          nextEpisodeNumber: '2',
          title: 'Arrival',
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
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '1',
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

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    const video = container.querySelector('video')
    const scrubber = screen.getByLabelText('Seek timeline')
    expect(video).not.toBeNull()

    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(video!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      fireEvent(video!, new Event('loadedmetadata'))
      fireEvent(video!, new Event('canplay'))
      fireEvent(video!, new Event('durationchange'))
    })

    await act(async () => {
      video!.currentTime = 31
      fireEvent(video!, new Event('timeupdate'))
    })

    await waitFor(() => {
      expect(screen.getByText(/Disappears in 0:10/i)).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.change(scrubber, { target: { value: '50' } })
    })

    await waitFor(() => {
      expect(screen.getByText(/Disappears in 0:10/i)).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.change(scrubber, { target: { value: '31' } })
    })

    await waitFor(() => {
      expect(screen.getByText(/Disappears in 0:10/i)).toBeInTheDocument()
    })
  })

  it('automatically skips intro segments after three seconds when enabled', async () => {
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
          skipSegments: [{ label: 'Skip intro', startTime: 30, endTime: 95 }],
          nextEpisodeNumber: '2',
          title: 'Arrival',
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
          ],
          progress: {
            completedEpisodeCount: 0,
            startedEpisodeCount: 0,
            currentEpisodeNumber: null,
            currentTime: 0,
            latestEpisodeNumber: '1',
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

    const autoSkipSessionValue: SessionContextValue = {
      ...sessionValue,
      autoSkipSegmentsEnabled: true,
      setAutoSkipSegmentsEnabled: vi.fn(),
    }

    const { container } = render(
      <SessionContext.Provider value={autoSkipSessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    const video = container.querySelector('video')
    expect(video).not.toBeNull()

    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(video!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      fireEvent(video!, new Event('loadedmetadata'))
      fireEvent(video!, new Event('canplay'))
      fireEvent(video!, new Event('durationchange'))
    })

    await act(async () => {
      video!.currentTime = 30
      fireEvent(video!, new Event('timeupdate'))
    })

    await waitFor(() => {
      expect(screen.getByText(/Auto skips in 0:03/i)).toBeInTheDocument()
    })

    await act(async () => {
      video!.currentTime = 33
      fireEvent(video!, new Event('timeupdate'))
    })

    expect(video!.currentTime).toBe(95)
  })

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

  it('marks an episode completed when leaving during the outro', async () => {
    const progressRequests: Array<Record<string, unknown>> = []

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
        const payload = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
        progressRequests.push(payload)
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
    const { container } = render(
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

    const video = container.querySelector('video')
    expect(video).not.toBeNull()

    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(video!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 1350,
    })

    await user.click(screen.getByRole('button', { name: 'Next episode' }))

    await waitFor(() => {
      expect(progressRequests).toContainEqual(
        expect.objectContaining({
          episodeNumber: '1',
          currentTime: 1440,
          duration: 1440,
          completed: true,
        }),
      )
    })
  })

  it('automatically advances to the next episode when auto next is enabled', async () => {
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

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Episode 2 • Training Day')).toBeInTheDocument()
    })

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })

    fireEvent(video!, new Event('ended'))

    await waitFor(() => {
      expect(screen.getByText('Episode 3 • Final Strike')).toBeInTheDocument()
    })
  })

  it('restores the saved episode progress on reload without a time token', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      createPlayerFetchMock({
        episodeProgress: {
          currentTime: 420,
          duration: 1440,
          completed: false,
          updatedAt: '2026-04-03T00:00:00.000Z',
        },
      }),
    )

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Episode 1 • Arrival')).toBeInTheDocument()
    })

    const video = container.querySelector('video')
    expect(video).not.toBeNull()

    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(video!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      fireEvent(video!, new Event('loadedmetadata'))
      fireEvent(video!, new Event('canplay'))
      fireEvent(video!, new Event('durationchange'))
    })

    expect(video!.currentTime).toBe(420)
  })

  it('does not reapply the initial resume time when canplay fires after playback has advanced', async () => {
    window.localStorage.setItem(
      'aniflow-player-progress:demo-show:1',
      JSON.stringify({
        showId: 'demo-show',
        episodeNumber: '1',
        currentTime: 420,
        duration: 1440,
        completed: false,
        updatedAt: Date.now(),
      }),
    )

    vi.spyOn(globalThis, 'fetch').mockImplementation(createPlayerFetchMock())

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Episode 1 • Arrival')).toBeInTheDocument()
    })

    const video = container.querySelector('video')
    expect(video).not.toBeNull()

    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(video!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      fireEvent(video!, new Event('loadedmetadata'))
    })

    expect(video!.currentTime).toBe(420)

    await act(async () => {
      video!.currentTime = 422
      fireEvent(video!, new Event('timeupdate'))
      fireEvent(video!, new Event('canplay'))
    })

    expect(video!.currentTime).toBe(422)
  })

  it('does not reload the video source when local progress updates during playback', async () => {
    const loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load')
    vi.spyOn(globalThis, 'fetch').mockImplementation(createPlayerFetchMock())

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Episode 1 • Arrival')).toBeInTheDocument()
    })

    const video = container.querySelector('video')
    expect(video).not.toBeNull()

    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(video!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      fireEvent(video!, new Event('loadedmetadata'))
      fireEvent(video!, new Event('canplay'))
      fireEvent(video!, new Event('durationchange'))
    })

    const loadCallsBeforeProgressUpdate = loadSpy.mock.calls.length

    await act(async () => {
      video!.currentTime = 1
      fireEvent(video!, new Event('timeupdate'))
    })

    expect(loadSpy.mock.calls.length).toBe(loadCallsBeforeProgressUpdate)
  })

  it('persists progress when the tab is hidden and resumes from that snapshot after a refresh', async () => {
    const progressRequests: Array<{ body: Record<string, unknown>; init: RequestInit | undefined }> = []
    const originalVisibilityState = document.visibilityState

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      createPlayerFetchMock({
        progressRequests,
      }),
    )

    const firstRender = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Episode 1 • Arrival')).toBeInTheDocument()
    })

    const initialVideo = firstRender.container.querySelector('video')
    expect(initialVideo).not.toBeNull()

    Object.defineProperty(initialVideo!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(initialVideo!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 125,
    })

    await act(async () => {
      fireEvent(initialVideo!, new Event('loadedmetadata'))
      fireEvent(initialVideo!, new Event('canplay'))
      fireEvent(initialVideo!, new Event('durationchange'))
    })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(progressRequests).toContainEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          episodeNumber: '1',
          currentTime: 125,
          duration: 1440,
          completed: false,
        }),
        init: expect.objectContaining({
          keepalive: true,
        }),
      }),
    )

    firstRender.unmount()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })

    const secondRender = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Episode 1 • Arrival')).toBeInTheDocument()
    })

    const resumedVideo = secondRender.container.querySelector('video')
    expect(resumedVideo).not.toBeNull()

    Object.defineProperty(resumedVideo!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(resumedVideo!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      fireEvent(resumedVideo!, new Event('loadedmetadata'))
      fireEvent(resumedVideo!, new Event('canplay'))
      fireEvent(resumedVideo!, new Event('durationchange'))
    })

    expect(resumedVideo!.currentTime).toBe(125)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState,
    })
  })

  it('re-resolves the playback stream when returning to a stale tab', async () => {
    const originalVisibilityState = document.visibilityState
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      createPlayerFetchMock({
        resolveUrls: ['https://cdn.example.com/1-initial.mp4', 'https://cdn.example.com/1-refreshed.mp4'],
      }),
    )

    const { container } = render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={['/player/demo-show/1']}>
          <Routes>
            <Route path="/player/:showId/:episodeNumber" element={<PlayerPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => {
      expect(container.querySelector('video')).toHaveAttribute('src', 'https://cdn.example.com/1-initial.mp4')
    })

    const video = container.querySelector('video')
    expect(video).not.toBeNull()

    Object.defineProperty(video!, 'duration', {
      configurable: true,
      value: 1440,
    })
    Object.defineProperty(video!, 'currentTime', {
      configurable: true,
      writable: true,
      value: 180,
    })
    Object.defineProperty(video!, 'currentSrc', {
      configurable: true,
      value: 'https://cdn.example.com/1-initial.mp4',
    })
    Object.defineProperty(video!, 'readyState', {
      configurable: true,
      value: 3,
    })
    Object.defineProperty(video!, 'paused', {
      configurable: true,
      writable: true,
      value: false,
    })

    await act(async () => {
      fireEvent(video!, new Event('loadedmetadata'))
      fireEvent(video!, new Event('canplay'))
      fireEvent(video!, new Event('durationchange'))
    })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })

    Object.defineProperty(video!, 'paused', {
      configurable: true,
      writable: true,
      value: false,
    })

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    Object.defineProperty(video!, 'currentSrc', {
      configurable: true,
      value: '',
    })
    Object.defineProperty(video!, 'readyState', {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(video!, 'paused', {
      configurable: true,
      writable: true,
      value: true,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => {
      expect(container.querySelector('video')).toHaveAttribute('src', 'https://cdn.example.com/1-refreshed.mp4')
    })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState,
    })
  })
})

function createPlayerFetchMock(options: {
  episodeProgress?: {
    currentTime: number
    duration: number
    completed: boolean
    updatedAt: string
  } | null
  progressRequests?: Array<{ body: Record<string, unknown>; init: RequestInit | undefined }>
  resolveUrls?: string[]
} = {}) {
  const resolveUrls = options.resolveUrls ?? ['https://cdn.example.com/1.mp4']
  let resolveCount = 0

  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

    if (url === '/api/playback/resolve') {
      const payload = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { episodeNumber: string }
      const sourceUrl = resolveUrls[Math.min(resolveCount, resolveUrls.length - 1)] ?? `https://cdn.example.com/${payload.episodeNumber}.mp4`
      resolveCount += 1

      return jsonResponse({
        showId: 'demo-show',
        episodeNumber: payload.episodeNumber,
        translationType: 'sub',
        showTitle: 'Demo Show',
        streamUrl: sourceUrl,
        mimeType: 'video/mp4',
        subtitleUrl: null,
        subtitleMimeType: null,
        qualities: [
          {
            id: 'default',
            label: 'Auto',
            proxyUrl: sourceUrl,
          },
        ],
        skipSegments: [],
        nextEpisodeNumber: '2',
        title: payload.episodeNumber === '1' ? 'Arrival' : 'Training Day',
      })
    }

    if (url === '/api/shows/demo-show/page?translationType=sub') {
      return jsonResponse(buildShowPagePayload(options.episodeProgress ?? null))
    }

    if (url.startsWith('/api/shows/demo-show/episodes?translationType=')) {
      return jsonResponse({
        episodes: [
          { showId: 'demo-show', number: '1', title: 'Arrival', translationType: 'sub', durationSeconds: 1440 },
          { showId: 'demo-show', number: '2', title: 'Training Day', translationType: 'sub', durationSeconds: 1440 },
        ],
      })
    }

    if (url === '/api/progress') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
      options.progressRequests?.push({ body, init })
      return jsonResponse({
        progress: {
          ...body,
          updatedAt: '2026-04-03T00:00:00.000Z',
        },
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }
}

function buildShowPagePayload(
  episodeProgress: {
    currentTime: number
    duration: number
    completed: boolean
    updatedAt: string
  } | null,
) {
  return {
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
        sub: 2,
        dub: 2,
      },
      provider: 'allanime',
    },
    aniListDetails: null,
    translationType: 'sub',
    episodes: [
      {
        showId: 'demo-show',
        number: '1',
        title: 'Arrival',
        translationType: 'sub',
        durationSeconds: 1440,
        progress: episodeProgress,
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
    ],
    progress: {
      completedEpisodeCount: episodeProgress?.completed ? 1 : 0,
      startedEpisodeCount: episodeProgress ? 1 : 0,
      currentEpisodeNumber: episodeProgress?.completed ? null : episodeProgress ? '1' : null,
      currentTime: episodeProgress?.currentTime ?? 0,
      latestEpisodeNumber: '2',
      updatedAt: episodeProgress?.updatedAt ?? null,
    },
    library: null,
    fillerSource: null,
    fillerMatchTitle: null,
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
