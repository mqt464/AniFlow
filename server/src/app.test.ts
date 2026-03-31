/** @vitest-environment node */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from './app.js'
import type { AppEnv } from './env.js'
import { AniFlowDatabase } from './lib/database.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()

  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

    if (url === 'https://graphql.anilist.co') {
      const bodyText =
        typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : null
      const body = bodyText ? (JSON.parse(bodyText) as { query?: string; variables?: Record<string, unknown> }) : {}

      if (body.query?.includes('SearchAniListMetadata')) {
        const search = typeof body.variables?.search === 'string' ? body.variables.search : ''
        if (search === 'Fallback Show') {
          return new Response(
            JSON.stringify({
              data: {
                Page: {
                  media: [
                    {
                      id: 202,
                      title: {
                        english: 'Fallback Show',
                        romaji: 'Fallback Show',
                        native: 'Fallback Show Native',
                      },
                      synonyms: ['Fallback Show'],
                      coverImage: {
                        extraLarge: 'https://anilist.example/poster.jpg',
                        large: 'https://anilist.example/poster-large.jpg',
                      },
                      bannerImage: 'https://anilist.example/banner.jpg',
                      description: '<p>AniList description</p>',
                      genres: ['Drama'],
                      status: 'RELEASING',
                      averageScore: 87,
                      season: 'SPRING',
                      seasonYear: 2025,
                    },
                  ],
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      }

      return new Response(
        JSON.stringify({
          data: {
            Page: {
              media: [],
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    if (url.startsWith('https://api.allanime.day/api')) {
      const parsed = new URL(url)
      const query = parsed.searchParams.get('query') ?? ''
      const variables = JSON.parse(parsed.searchParams.get('variables') ?? '{}') as { showId?: string }

      if (query.includes('availableEpisodesDetail')) {
        return new Response(
          JSON.stringify({
            data: {
              show: {
                _id: 'demo-show',
                availableEpisodesDetail: {
                  sub: ['1', '2', '3'],
                  dub: ['1', '2'],
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

      if (query.includes('description')) {
        if (variables.showId === 'fallback-show') {
          return new Response(
            JSON.stringify({
              data: {
                show: {
                  _id: 'fallback-show',
                  name: 'Fallback Show',
                  englishName: 'Fallback Show',
                  nativeName: null,
                  thumbnail: null,
                  banner: null,
                  description: null,
                  genres: null,
                  status: 'UNKNOWN',
                  score: null,
                  season: { quarter: null, year: 2025 },
                  availableEpisodes: { sub: 12, dub: 0 },
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        return new Response(
          JSON.stringify({
            data: {
              show: {
                _id: 'demo-show',
                name: 'Demo Show',
                englishName: 'Demo Show',
                nativeName: 'Demo Show Native',
                thumbnail: 'https://example.com/poster.jpg',
                banner: null,
                description: '<p>Demo description</p>',
                genres: ['Action'],
                status: 'FINISHED',
                score: 81,
                season: { quarter: 'SPRING', year: 2024 },
                availableEpisodes: { sub: 3, dub: 2 },
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }
    }

    if (url.startsWith('https://api.jikan.moe/v4/anime?q=')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              mal_id: 101,
              title: 'Demo Show',
              title_english: 'Demo Show',
              title_japanese: 'Demo Show Native',
              year: 2024,
              type: 'TV',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    if (url === 'https://api.jikan.moe/v4/anime/101/episodes?page=1') {
      return new Response(
        JSON.stringify({
          pagination: {
            has_next_page: false,
            current_page: 1,
          },
          data: [
            { title: 'Arrival', filler: false, recap: false },
            { title: 'Training Day', filler: true, recap: false },
            { title: 'What Came Before', filler: false, recap: true },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    throw new Error(`Unexpected fetch in test: ${url}`)
  })
})

function createEnv(): AppEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aniflow-test-'))
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

describe('app api', () => {
  it('returns empty home payload on a clean database', async () => {
    const app = buildApp(createEnv())

    const response = await app.inject({ method: 'GET', url: '/api/home' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
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
      requiresPassword: false,
    })

    await app.close()
  })

  it('updates explicit library lists and exposes the state on the show page', async () => {
    const app = buildApp(createEnv())

    const libraryResponse = await app.inject({
      method: 'POST',
      url: '/api/library',
      payload: {
        showId: 'demo-show',
        title: 'Demo Show',
        posterUrl: 'https://example.com/poster.jpg',
        favorited: true,
        watchLater: true,
      },
    })

    expect(libraryResponse.statusCode).toBe(200)
    expect(libraryResponse.json().entry).toMatchObject({
      showId: 'demo-show',
      favorited: true,
      watchLater: true,
      completed: false,
    })

    const home = await app.inject({ method: 'GET', url: '/api/home' })
    expect(home.json()).toMatchObject({
      watchLater: [expect.objectContaining({ showId: 'demo-show' })],
      favorites: [expect.objectContaining({ showId: 'demo-show' })],
      completed: [],
    })

    const showPage = await app.inject({
      method: 'GET',
      url: '/api/shows/demo-show/page?translationType=sub',
    })
    expect(showPage.json()).toMatchObject({
      library: {
        showId: 'demo-show',
        favorited: true,
        watchLater: true,
        completed: false,
      },
    })

    await app.close()
  })

  it('marks a show completed in the library and removes it from continue watching', async () => {
    const app = buildApp(createEnv())

    await app.inject({
      method: 'POST',
      url: '/api/progress',
      payload: {
        showId: 'demo-show',
        episodeNumber: '2',
        title: 'Demo Show',
        currentTime: 540,
        duration: 1440,
        completed: false,
      },
    })

    const libraryResponse = await app.inject({
      method: 'POST',
      url: '/api/library',
      payload: {
        showId: 'demo-show',
        title: 'Demo Show',
        completed: true,
      },
    })

    expect(libraryResponse.statusCode).toBe(200)
    expect(libraryResponse.json().entry).toMatchObject({
      showId: 'demo-show',
      completed: true,
      resumeEpisodeNumber: null,
    })

    const home = await app.inject({ method: 'GET', url: '/api/home' })
    expect(home.json()).toMatchObject({
      continueWatching: [],
      completed: [expect.objectContaining({ showId: 'demo-show', completed: true })],
    })

    await app.close()
  })

  it('stores playback progress', async () => {
    const app = buildApp(createEnv())

    const response = await app.inject({
      method: 'POST',
      url: '/api/progress',
      payload: {
        showId: 'demo-show',
        episodeNumber: '1',
        title: 'Demo Show',
        currentTime: 120,
        duration: 1400,
        completed: false,
      },
    })

    expect(response.statusCode).toBe(200)

    const home = await app.inject({ method: 'GET', url: '/api/home' })
    expect(home.json().continueWatching[0]).toMatchObject({
      showId: 'demo-show',
      title: 'Demo Show',
      resumeEpisodeNumber: '1',
    })

    await app.close()
  })

  it('returns a merged show page payload with progress and filler flags', async () => {
    const app = buildApp(createEnv())

    await app.inject({
      method: 'POST',
      url: '/api/progress',
      payload: {
        showId: 'demo-show',
        episodeNumber: '2',
        title: 'Demo Show',
        currentTime: 540,
        duration: 1440,
        completed: false,
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/shows/demo-show/page?translationType=sub',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      translationType: 'sub',
      progress: {
        currentEpisodeNumber: '2',
        completedEpisodeCount: 0,
        startedEpisodeCount: 1,
      },
      fillerSource: 'jikan',
      fillerMatchTitle: 'Demo Show',
    })

    expect(response.json().episodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          number: '2',
          title: 'Training Day',
          isCurrent: true,
          progress: expect.objectContaining({
            currentTime: 540,
            completed: false,
          }),
          annotation: expect.objectContaining({
            isFiller: true,
            isRecap: false,
            source: 'jikan',
          }),
        }),
        expect.objectContaining({
          number: '3',
          title: 'What Came Before',
          annotation: expect.objectContaining({
            isFiller: false,
            isRecap: true,
            source: 'jikan',
          }),
        }),
      ]),
    )

    await app.close()
  })

  it('handles legacy jikan cache entries that do not include episode titles', async () => {
    const env = createEnv()
    const seedDb = new AniFlowDatabase(env.dbPath)
    seedDb.setCachedJson(
      'jikan:episodes:demo show:2024',
      {
        annotations: {
          '1': {
            isFiller: false,
            isRecap: false,
            source: 'jikan',
          },
        },
        matchedTitle: 'Demo Show',
      },
      1000 * 60 * 60,
    )
    seedDb.close()

    const app = buildApp(env)
    const response = await app.inject({
      method: 'GET',
      url: '/api/shows/demo-show/page?translationType=sub',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      fillerSource: 'jikan',
      fillerMatchTitle: 'Demo Show',
    })
    expect(response.json().episodes[0]).toMatchObject({
      number: '1',
      title: 'Episode 1',
      annotation: {
        isFiller: false,
        isRecap: false,
        source: 'jikan',
      },
    })

    await app.close()
  })

  it('falls back to AniList metadata when the provider status or artwork is missing', async () => {
    const app = buildApp(createEnv())

    const response = await app.inject({
      method: 'GET',
      url: '/api/shows/fallback-show',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: 'fallback-show',
      title: 'Fallback Show',
      originalTitle: 'Fallback Show Native',
      posterUrl: 'https://anilist.example/poster.jpg',
      bannerUrl: 'https://anilist.example/banner.jpg',
      description: 'AniList description',
      genres: ['Drama'],
      status: 'RELEASING',
      score: 87,
      season: 'SPRING',
      year: 2025,
    })

    await app.close()
  })

  it('serves the built frontend and preserves api 404s', async () => {
    const env = createEnv()
    fs.mkdirSync(path.join(env.frontendDistDir, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(env.frontendDistDir, 'index.html'), '<!doctype html><div id="root"></div>')
    fs.writeFileSync(path.join(env.frontendDistDir, 'assets', 'app.js'), 'console.log("ok")')

    const app = buildApp(env)

    const rootResponse = await app.inject({ method: 'GET', url: '/' })
    expect(rootResponse.statusCode).toBe(200)
    expect(rootResponse.headers['content-type']).toContain('text/html')

    const assetResponse = await app.inject({ method: 'GET', url: '/assets/app.js' })
    expect(assetResponse.statusCode).toBe(200)
    expect(assetResponse.headers['content-type']).toContain('text/javascript')

    const spaResponse = await app.inject({ method: 'GET', url: '/settings' })
    expect(spaResponse.statusCode).toBe(200)
    expect(spaResponse.headers['content-type']).toContain('text/html')

    const apiResponse = await app.inject({ method: 'GET', url: '/api/missing' })
    expect(apiResponse.statusCode).toBe(404)

    await app.close()
  })
})
