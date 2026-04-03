/** @vitest-environment node */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppEnv } from '../env.js'
import { AniFlowDatabase } from '../lib/database.js'
import { AniListService } from './aniListService.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()

  while (tempDirs.length > 0) {
    try {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
    } catch {
      continue
    }
  }
})

function createEnv(): AppEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aniflow-anilist-test-'))
  tempDirs.push(dir)

  return {
    host: '127.0.0.1',
    port: 0,
    frontendUrl: 'http://localhost:4173',
    frontendDistDir: path.join(dir, 'dist'),
    appPassword: null,
    dataDir: dir,
    dbPath: path.join(dir, 'test.sqlite'),
    allAnimeReferer: 'https://allmanga.to',
    aniSkipClientId: 'test-client',
    aniListClientId: null,
    aniListClientSecret: null,
    aniListRedirectUri: null,
    cacheTtlMs: 1000,
  }
}

describe('AniListService', () => {
  it('retries the AniList GraphQL request with a fallback endpoint after a 404', async () => {
    const env = createEnv()
    const database = new AniFlowDatabase(env.dbPath)
    const service = new AniListService(env, database, {} as never)

    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null

        if (url === 'https://graphql.anilist.co') {
          return new Response('Not found', { status: 404 })
        }

        if (url === 'https://graphql.anilist.co/') {
          expect(body?.query).toContain('Viewer')
          return new Response(
            JSON.stringify({
              data: {
                Viewer: {
                  id: 7,
                  name: 'mat',
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        throw new Error(`Unexpected fetch: ${url}`)
      })

      const response = await (service as never as { graphql: (query: string) => Promise<{ data: { Viewer: { id: number } } }> }).graphql(
        `query ViewerProfile {
          Viewer {
            id
            name
          }
        }`,
      )

      expect(response.data.Viewer.id).toBe(7)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      database.close()
    }
  })

  it('retries AniList GraphQL requests after a 429 response', async () => {
    const env = createEnv()
    const database = new AniFlowDatabase(env.dbPath)
    const service = new AniListService(env, database, {} as never)

    try {
      let requests = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
        requests += 1

        if (url !== 'https://graphql.anilist.co') {
          throw new Error(`Unexpected fetch: ${url}`)
        }

        if (requests === 1) {
          return new Response('Rate limited', {
            status: 429,
            headers: { 'Retry-After': '0.01' },
          })
        }

        return new Response(
          JSON.stringify({
            data: {
              Viewer: {
                id: 7,
                name: 'mat',
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      })

      const response = await (service as never as { graphql: (query: string) => Promise<{ data: { Viewer: { id: number } } }> }).graphql(
        `query ViewerProfile {
          Viewer {
            id
            name
          }
        }`,
      )

      expect(response.data.Viewer.id).toBe(7)
      expect(requests).toBe(2)
    } finally {
      database.close()
    }
  })

  it('validates and stores a token without running the initial sync when requested', async () => {
    const env = createEnv()
    const database = new AniFlowDatabase(env.dbPath)
    const service = new AniListService(env, database, {} as never)

    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
        const bodyText = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : '{}'
        const body = JSON.parse(bodyText) as { query?: string }

        if (!url.startsWith('https://graphql.anilist.co')) {
          throw new Error(`Unexpected fetch: ${url}`)
        }

        expect(body.query).toContain('ViewerProfile')
        return new Response(
          JSON.stringify({
            data: {
              Viewer: {
                id: 7,
                name: 'mat',
                siteUrl: 'https://anilist.co/user/mat',
                about: 'bio',
                bannerImage: null,
                avatar: {
                  large: 'https://anilist.example/avatar.jpg',
                },
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      })

      const response = await service.connect({ accessToken: 'token', validateOnly: true })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(response).toEqual({
        connected: true,
        username: 'mat',
        avatarUrl: 'https://anilist.example/avatar.jpg',
        bannerUrl: null,
        profileUrl: 'https://anilist.co/user/mat',
        about: 'bio',
        connectedAt: expect.any(String),
        lastPullAt: null,
        lastSyncStatus: 'Connected. Run Sync now to import AniList state.',
      })
    } finally {
      database.close()
    }
  })

  it('backposts local watched, completed, and watch-later state during manual sync', async () => {
    const env = createEnv()
    const database = new AniFlowDatabase(env.dbPath)
    const service = new AniListService(env, database, {} as never)
    const saveCalls: Array<{ mediaId: number; progress: number; status: string | null }> = []

    database.saveProgress({
      showId: 'watched-show',
      episodeNumber: '3',
      title: 'Watched Show',
      currentTime: 1400,
      duration: 1400,
      completed: true,
    })
    database.saveProgress({
      showId: 'completed-show',
      episodeNumber: '12',
      title: 'Completed Show',
      currentTime: 1400,
      duration: 1400,
      completed: true,
    })
    database.updateLibraryEntry({
      showId: 'completed-show',
      title: 'Completed Show',
      completed: true,
    })
    database.updateLibraryEntry({
      showId: 'watch-later-show',
      title: 'Watch Later Show',
      watchLater: true,
    })
    database.setAniListConnection({
      viewerId: 7,
      username: 'mat',
      avatarUrl: null,
      bannerUrl: null,
      profileUrl: 'https://anilist.co/user/mat',
      about: null,
      accessToken: 'token',
      refreshToken: null,
      lastPullAt: null,
      lastSyncStatus: 'Connected',
    })

    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
        const bodyText = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : '{}'
        const body = JSON.parse(bodyText) as { query?: string; variables?: Record<string, unknown> }

        if (!url.startsWith('https://graphql.anilist.co')) {
          throw new Error(`Unexpected fetch: ${url}`)
        }

        if (body.query?.includes('ImportAniList')) {
          return new Response(
            JSON.stringify({
              data: {
                Viewer: {
                  id: 7,
                  name: 'mat',
                  siteUrl: 'https://anilist.co/user/mat',
                  about: null,
                  bannerImage: null,
                  avatar: {
                    large: null,
                  },
                  favourites: {
                    anime: {
                      nodes: [],
                    },
                  },
                },
                MediaListCollection: {
                  lists: [],
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        if (body.query?.includes('LookupAniListMedia')) {
          const search = String(body.variables?.search ?? '')
          const mediaByTitle: Record<string, { id: number; episodes: number }> = {
            'Completed Show': { id: 101, episodes: 12 },
            'Watched Show': { id: 102, episodes: 24 },
            'Watch Later Show': { id: 103, episodes: 13 },
          }
          const media = mediaByTitle[search]
          if (!media) {
            throw new Error(`Unexpected AniList lookup title: ${search}`)
          }

          return new Response(
            JSON.stringify({
              data: {
                Media: {
                  id: media.id,
                  episodes: media.episodes,
                  isFavourite: false,
                  mediaListEntry: null,
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        if (body.query?.includes('SaveAniListEntry')) {
          saveCalls.push({
            mediaId: Number(body.variables?.mediaId),
            progress: Number(body.variables?.progress),
            status: typeof body.variables?.status === 'string' ? body.variables.status : null,
          })

          return new Response(
            JSON.stringify({
              data: {
                SaveMediaListEntry: {
                  id: 1,
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        if (body.query?.includes('ToggleAniListFavourite')) {
          return new Response(
            JSON.stringify({
              data: {
                ToggleFavourite: {
                  anime: {
                    nodes: [],
                  },
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        throw new Error(`Unexpected AniList query: ${body.query}`)
      })

      await service.syncNow()

      expect(saveCalls).toEqual(
        expect.arrayContaining([
          { mediaId: 101, progress: 12, status: 'COMPLETED' },
          { mediaId: 102, progress: 3, status: 'CURRENT' },
          { mediaId: 103, progress: 0, status: 'PLANNING' },
        ]),
      )
    } finally {
      database.close()
    }
  }, 15000)
})
