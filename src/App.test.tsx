import { render, screen, waitFor, within } from '@testing-library/react'
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
})
