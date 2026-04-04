import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('App shell', () => {
  it('renders primary navigation and loads the home page', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url.includes('/api/home')) {
        return new Response(
          JSON.stringify({
            continueWatching: [],
            watchLater: [],
            completed: [],
            recentProgress: [],
            favorites: [],
            discover: {
              trending: [],
              popularThisSeason: [],
              upcomingNextSeason: [],
            },
            anilist: {
              connected: false,
              username: null,
              avatarUrl: null,
              bannerUrl: null,
              profileUrl: null,
              about: null,
              connectedAt: null,
              lastPullAt: null,
              lastSyncStatus: null,
            },
            requiresPassword: false,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      if (url.includes('/api/search')) {
        return new Response(
          JSON.stringify({
            query: 'test',
            results: [],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      return new Response('Not found', { status: 404 })
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('AniFlow')).toBeInTheDocument()
      expect(within(screen.getByRole('navigation', { name: /primary/i })).getByRole('link', { name: /home/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /open profile menu/i })).toBeInTheDocument()
      expect(screen.getByText(/Nothing in progress yet/i)).toBeInTheDocument()
    })
  })

  it('renders homepage row scroll controls when a rail overflows', async () => {
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    const scrollLeftDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollLeft')

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList?.contains('poster-rail') ? 320 : 0
      },
    })

    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return this.classList?.contains('poster-rail') ? 1280 : 0
      },
    })

    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get() {
        return 0
      },
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url.includes('/api/home')) {
        return new Response(
          JSON.stringify({
            continueWatching: [],
            watchLater: [],
            completed: [],
            recentProgress: [],
            favorites: [],
            discover: {
              trending: Array.from({ length: 6 }, (_, index) => ({
                id: `discover-${index + 1}`,
                providerShowId: `show-${index + 1}`,
                title: `Trending Show ${index + 1}`,
                originalTitle: null,
                bannerUrl: 'https://example.com/banner.jpg',
                posterUrl: 'https://example.com/poster.jpg',
                description: 'Test description',
                genres: ['Action'],
                status: 'RELEASING',
                year: 2026,
                season: 'SPRING',
                score: 82,
                availableEpisodes: {
                  sub: 12,
                  dub: 0,
                },
                trailer: null,
              })),
              popularThisSeason: [],
              upcomingNextSeason: [],
            },
            anilist: {
              connected: false,
              username: null,
              avatarUrl: null,
              bannerUrl: null,
              profileUrl: null,
              about: null,
              connectedAt: null,
              lastPullAt: null,
              lastSyncStatus: null,
            },
            requiresPassword: false,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      if (url.includes('/api/search')) {
        return new Response(
          JSON.stringify({
            query: 'test',
            results: [],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      return new Response('Not found', { status: 404 })
    })

    try {
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /scroll trending now left/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /scroll trending now right/i })).toBeInTheDocument()
      })
    } finally {
      if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
      }
      if (scrollWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidthDescriptor)
      }
      if (scrollLeftDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollLeft', scrollLeftDescriptor)
      }
    }
  })

  it('shows an improved context menu when right-clicking a homepage show', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url.includes('/api/home')) {
        return new Response(
          JSON.stringify({
            continueWatching: [],
            watchLater: [
              {
                id: 'watch-later-1',
                showId: 'show-1',
                title: 'Orbital Drift',
                posterUrl: 'https://example.com/poster.jpg',
                bannerUrl: null,
                latestEpisodeNumber: null,
                resumeEpisodeNumber: null,
                resumeTimeSeconds: null,
                watchedDurationSeconds: null,
                totalDurationSeconds: null,
                completed: false,
                watchLater: true,
                score: null,
                providerShowId: 'show-1',
                availableEpisodes: {
                  sub: 12,
                  dub: 0,
                },
              },
            ],
            completed: [],
            recentProgress: [],
            favorites: [],
            discover: {
              trending: [],
              popularThisSeason: [],
              upcomingNextSeason: [],
            },
            anilist: {
              connected: false,
              username: null,
              avatarUrl: null,
              bannerUrl: null,
              profileUrl: null,
              about: null,
              connectedAt: null,
              lastPullAt: null,
              lastSyncStatus: null,
            },
            requiresPassword: false,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      if (url.includes('/api/search')) {
        return new Response(JSON.stringify({ query: 'test', results: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    render(<App />)

    const card = (await screen.findByText('Orbital Drift')).closest('a')
    expect(card).not.toBeNull()
    fireEvent.contextMenu(card as HTMLElement, { clientX: 120, clientY: 160 })

    const menu = await screen.findByRole('menu', { name: /orbital drift actions/i })
    expect(within(menu).getByText('Orbital Drift')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /open show/i })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /remove from watch later/i })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /mark as completed/i })).toBeInTheDocument()
  })
})
