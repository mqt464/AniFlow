/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AniSkipService } from './aniSkipService.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AniSkipService', () => {
  it('prefers the episode candidate with usable intro and outro markers', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        query?: string
        variables?: Record<string, string>
      }

      if (body.query?.includes('searchShows')) {
        return jsonResponse({
          data: {
            searchShows: [{ id: 'show-1', name: 'Demo Show', originalName: null }],
          },
        })
      }

      if (body.query?.includes('findEpisodesByShowId')) {
        return jsonResponse({
          data: {
            findEpisodesByShowId: [
              { id: 'episode-bad', number: '1', name: '1', baseDuration: 1440 },
              { id: 'episode-good', number: '1', name: 'Arrival', baseDuration: 1440 },
            ],
          },
        })
      }

      if (body.variables?.episodeId === 'episode-bad') {
        return jsonResponse({
          data: {
            findTimestampsByEpisodeId: [{ at: 0, type: { name: 'Intro' } }],
          },
        })
      }

      if (body.variables?.episodeId === 'episode-good') {
        return jsonResponse({
          data: {
            findTimestampsByEpisodeId: [
              { at: 18, type: { name: 'Intro' } },
              { at: 108, type: { name: 'Canon' } },
              { at: 1334, type: { name: 'Credits' } },
              { at: 1402, type: { name: 'Preview' } },
            ],
          },
        })
      }

      throw new Error(`Unexpected AniSkip query: ${body.query}`)
    })

    const service = new AniSkipService(
      { aniSkipClientId: 'test-client' } as never,
      createDatabaseStub() as never,
    )

    await expect(service.getSegments('Demo Show', '1', null)).resolves.toEqual([
      { label: 'Skip intro', startTime: 18, endTime: 108 },
      { label: 'Skip outro', startTime: 1334, endTime: 1440 },
    ])
  })

  it('does not stretch a lone intro marker across the full episode', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        query?: string
      }

      if (body.query?.includes('searchShows')) {
        return jsonResponse({
          data: {
            searchShows: [{ id: 'show-1', name: 'Demo Show', originalName: null }],
          },
        })
      }

      if (body.query?.includes('findEpisodesByShowId')) {
        return jsonResponse({
          data: {
            findEpisodesByShowId: [{ id: 'episode-bad', number: '1', name: 'Arrival', baseDuration: 1440 }],
          },
        })
      }

      if (body.query?.includes('findTimestampsByEpisodeId')) {
        return jsonResponse({
          data: {
            findTimestampsByEpisodeId: [{ at: 0, type: { name: 'Intro' } }],
          },
        })
      }

      throw new Error(`Unexpected AniSkip query: ${body.query}`)
    })

    const service = new AniSkipService(
      { aniSkipClientId: 'test-client' } as never,
      createDatabaseStub() as never,
    )

    await expect(service.getSegments('Demo Show', '1', null)).resolves.toEqual([])
  })

  it('falls back to broader title queries and prefers the matching season candidate', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        query?: string
        variables?: Record<string, string>
      }

      if (body.query?.includes('searchShows')) {
        if (body.variables?.search === 'My Hero Academia Season 5') {
          return jsonResponse({
            data: {
              searchShows: [],
            },
          })
        }

        if (body.variables?.search === 'My Hero Academia') {
          return jsonResponse({
            data: {
              searchShows: [
                { id: 'season-1', name: 'My Hero Academia', originalName: null },
                { id: 'season-5', name: 'My Hero Academia Season 5', originalName: null },
              ],
            },
          })
        }
      }

      if (body.query?.includes('findEpisodesByShowId')) {
        return jsonResponse({
          data: {
            findEpisodesByShowId: [{ id: `${body.variables?.showId}-episode-1`, number: '1', name: '1', baseDuration: 1440 }],
          },
        })
      }

      if (body.variables?.episodeId === 'season-1-episode-1') {
        return jsonResponse({
          data: {
            findTimestampsByEpisodeId: [],
          },
        })
      }

      if (body.variables?.episodeId === 'season-5-episode-1') {
        return jsonResponse({
          data: {
            findTimestampsByEpisodeId: [
              { at: 90, type: { name: 'Intro' } },
              { at: 180, type: { name: 'Canon' } },
            ],
          },
        })
      }

      throw new Error(`Unexpected AniSkip query: ${body.query}`)
    })

    const service = new AniSkipService(
      { aniSkipClientId: 'test-client' } as never,
      createDatabaseStub() as never,
    )

    await expect(service.getSegments('My Hero Academia Season 5', '1', null)).resolves.toEqual([
      { label: 'Skip intro', startTime: 90, endTime: 180 },
    ])
  })

  it('does not reuse an empty cache entry when later alternate titles provide a match', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        query?: string
        variables?: Record<string, string>
      }

      if (body.query?.includes('searchShows')) {
        if (body.variables?.search === 'English Miss') {
          return jsonResponse({
            data: {
              searchShows: [],
            },
          })
        }

        if (body.variables?.search === 'Romaji Hit') {
          return jsonResponse({
            data: {
              searchShows: [{ id: 'show-1', name: 'Romaji Hit', originalName: null }],
            },
          })
        }
      }

      if (body.query?.includes('findEpisodesByShowId')) {
        return jsonResponse({
          data: {
            findEpisodesByShowId: [{ id: 'episode-1', number: '1', name: '1', baseDuration: 1440 }],
          },
        })
      }

      if (body.variables?.episodeId === 'episode-1') {
        return jsonResponse({
          data: {
            findTimestampsByEpisodeId: [
              { at: 90, type: { name: 'Intro' } },
              { at: 180, type: { name: 'Canon' } },
            ],
          },
        })
      }

      throw new Error(`Unexpected AniSkip query: ${body.query}`)
    })

    const service = new AniSkipService(
      { aniSkipClientId: 'test-client' } as never,
      createDatabaseStub() as never,
    )

    await expect(service.getSegments('English Miss', '1', null)).resolves.toEqual([])
    await expect(service.getSegments('English Miss', '1', null, ['Romaji Hit'])).resolves.toEqual([
      { label: 'Skip intro', startTime: 90, endTime: 180 },
    ])
  })

  it('returns no segments when AniSkip responds with GraphQL errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        query?: string
      }

      if (body.query?.includes('searchShows')) {
        return jsonResponse({
          errors: [{ message: 'upstream unavailable' }],
          data: null,
        })
      }

      throw new Error(`Unexpected AniSkip query: ${body.query}`)
    })

    const service = new AniSkipService(
      { aniSkipClientId: 'test-client' } as never,
      createDatabaseStub() as never,
    )

    await expect(service.getSegments('Demo Show', '1', null)).resolves.toEqual([])
  })
})

function createDatabaseStub() {
  const cache = new Map<string, unknown>()
  return {
    getCachedJson<T>(key: string): T | null {
      return (cache.get(key) as T | undefined) ?? null
    },
    setCachedJson(key: string, value: unknown) {
      cache.set(key, value)
    },
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
