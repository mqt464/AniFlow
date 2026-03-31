import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { GlobalSearch } from './GlobalSearch'

describe('GlobalSearch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('animates a trending anime title in the placeholder', async () => {
    vi.useFakeTimers()

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
              trending: [
                {
                  id: 'solo-leveling',
                  providerShowId: 'solo-leveling',
                  title: 'Solo Leveling',
                  originalTitle: null,
                  bannerUrl: null,
                  posterUrl: null,
                  description: null,
                  genres: [],
                  status: 'RELEASING',
                  year: 2026,
                  season: 'WINTER',
                  score: 92,
                  availableEpisodes: { sub: 12, dub: 12 },
                  trailer: null,
                },
              ],
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
            query: '',
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

    render(
      <MemoryRouter>
        <GlobalSearch password="" preferredTranslationType="sub" />
      </MemoryRouter>,
    )

    const input = screen.getByRole('searchbox', { name: /search anime/i })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(input).toHaveAttribute('placeholder', 'Search S')

    act(() => {
      vi.advanceTimersByTime(2200)
    })

    expect(input).toHaveAttribute('placeholder', 'Search Solo Leveling...')

    act(() => {
      vi.advanceTimersByTime(1550)
    })

    expect(input).toHaveAttribute('placeholder', 'Search ')
  })
})
