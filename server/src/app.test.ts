/** @vitest-environment node */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildApp, PLAYBACK_SKIP_TIMEOUT_MS } from './app.js'
import type { AppEnv } from './env.js'
import { AniFlowDatabase } from './lib/database.js'
import { AniSkipService } from './services/aniSkipService.js'
import { AllAnimeAdapter } from './services/provider/allAnimeAdapter.js'

const tempDirs: string[] = []
const subtitleFixture = `WEBVTT

00:01:32.000 --> 00:01:34.000
Hello there.

00:01:36.000 --> 00:01:38.000
We need to move.

00:03:05.000 --> 00:03:07.000
Now.

00:03:09.000 --> 00:03:11.000
Keep going.

00:21:35.000 --> 00:21:38.000
We made it.

00:21:40.000 --> 00:21:43.000
That should do it.

00:22:10.000 --> 00:22:15.000
See you next time.
`

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
        if (search === 'Demo Show') {
          return new Response(
            JSON.stringify({
              data: {
                Page: {
                  media: [
                    {
                      id: 101,
                      title: {
                        english: 'Demo Show',
                        romaji: 'Demo Show',
                        native: 'Demo Show Native',
                      },
                      synonyms: ['Demo Show'],
                      coverImage: {
                        extraLarge: 'https://anilist.example/demo-poster.jpg',
                        large: 'https://anilist.example/demo-poster-large.jpg',
                      },
                      bannerImage: 'https://anilist.example/demo-banner.jpg',
                      description:
                        '<p>Following the exam&#x2014;Fern &amp; Frieren keep moving forward. [Written by MAL Rewrite]</p>',
                      genres: ['Action', 'Adventure'],
                      status: 'FINISHED',
                      averageScore: 91,
                      season: 'SPRING',
                      seasonYear: 2024,
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

      if (body.query?.includes('ShowPageAniListDetails')) {
        const mediaId = typeof body.variables?.id === 'number' ? body.variables.id : null
        if (mediaId === 101 || mediaId === 202) {
          return new Response(
            JSON.stringify({
              data: {
                Media: {
                  id: mediaId,
                  siteUrl: `https://anilist.co/anime/${mediaId}`,
                  title: {
                    romaji: mediaId === 101 ? 'Sousou no Frieren' : 'Kusuriya no Hitorigoto',
                    native: mediaId === 101 ? '葬送のフリーレン' : '薬屋のひとりごと',
                  },
                  description:
                    '<p>Following the First-Class Mage Exam, the trio&#x2014;Frieren, Fern &amp; Stark&#x2014;heads north. [Written by MAL Rewrite]</p>',
                  format: 'TV',
                  status: mediaId === 101 ? 'FINISHED' : 'RELEASING',
                  season: 'SPRING',
                  seasonYear: mediaId === 101 ? 2024 : 2025,
                  episodes: mediaId === 101 ? 24 : 12,
                  duration: 24,
                  averageScore: mediaId === 101 ? 91 : 87,
                  popularity: mediaId === 101 ? 221004 : 40012,
                  favourites: mediaId === 101 ? 18230 : 3201,
                  genres: ['Action', 'Adventure', 'Drama'],
                  startDate: {
                    year: mediaId === 101 ? 2024 : 2025,
                    month: 4,
                    day: 5,
                  },
                  endDate: {
                    year: mediaId === 101 ? 2024 : null,
                    month: mediaId === 101 ? 9 : null,
                    day: mediaId === 101 ? 27 : null,
                  },
                  trailer: {
                    id: 'demo-trailer',
                    site: 'youtube',
                    thumbnail: 'https://img.youtube.com/vi/demo-trailer/hqdefault.jpg',
                  },
                  rankings: [
                    {
                      rank: 3,
                      type: 'RATED',
                      context: 'Highest Rated All Time',
                      season: null,
                      year: null,
                      allTime: true,
                    },
                    {
                      rank: 12,
                      type: 'POPULAR',
                      context: 'Most Popular All Time',
                      season: null,
                      year: null,
                      allTime: true,
                    },
                  ],
                  stats: {
                    statusDistribution: [
                      { status: 'CURRENT', amount: 50312 },
                      { status: 'PLANNING', amount: 110204 },
                      { status: 'COMPLETED', amount: 82311 },
                      { status: 'PAUSED', amount: 6230 },
                      { status: 'DROPPED', amount: 1830 },
                    ],
                  },
                  tags: [
                    {
                      name: 'Elf Protagonist',
                      description: 'Features an elf lead.',
                      category: 'Cast-Main Cast',
                      rank: 88,
                      isMediaSpoiler: false,
                    },
                  ],
                  relations: {
                    edges: [
                      {
                        relationType: 'PREQUEL',
                        node: {
                          id: 301,
                          siteUrl: 'https://anilist.co/anime/301',
                          season: 'FALL',
                          seasonYear: 2023,
                          status: 'FINISHED',
                          format: 'TV',
                          averageScore: 95,
                          title: {
                            english: 'Frieren: Beyond Journey’s End',
                            romaji: 'Sousou no Frieren',
                            native: '葬送のフリーレン',
                          },
                          synonyms: ['Frieren'],
                          coverImage: {
                            extraLarge: 'https://anilist.example/relation-poster.jpg',
                            large: 'https://anilist.example/relation-poster-large.jpg',
                          },
                        },
                      },
                    ],
                  },
                  recommendations: {
                    nodes: [
                      {
                        rating: 145,
                        mediaRecommendation: {
                          id: 401,
                          siteUrl: 'https://anilist.co/anime/401',
                          season: 'WINTER',
                          seasonYear: 2024,
                          status: 'RELEASING',
                          format: 'TV',
                          averageScore: 89,
                          title: {
                            english: 'The Apothecary Diaries',
                            romaji: 'Kusuriya no Hitorigoto',
                            native: '薬屋のひとりごと',
                          },
                          synonyms: ['Apothecary Diaries'],
                          coverImage: {
                            extraLarge: 'https://anilist.example/recommendation-poster.jpg',
                            large: 'https://anilist.example/recommendation-poster-large.jpg',
                          },
                        },
                      },
                    ],
                  },
                  reviews: {
                    nodes: [
                      {
                        id: 501,
                        summary: 'Measured pacing and strong character work.',
                        rating: 92,
                        ratingAmount: 18,
                        siteUrl: 'https://anilist.co/review/501',
                        createdAt: 1714780800,
                        user: {
                          name: 'mat',
                          avatar: {
                            large: 'https://anilist.example/reviewer.jpg',
                          },
                        },
                      },
                    ],
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
              title: 'Sousou no Frieren',
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

    if (url === 'https://api.jikan.moe/v4/anime/101/full') {
      return new Response(
        JSON.stringify({
          data: {
            title: 'Sousou no Frieren',
            rank: 17,
            popularity: 317,
          },
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
    aniListGraphqlMinIntervalMs: 0,
  }
}

function getRequestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
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

  it('disconnects AniList and clears pending sync jobs', async () => {
    const env = createEnv()
    const database = new AniFlowDatabase(env.dbPath)
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
    database.enqueueAniListSync('state', { showId: 'demo-show' })
    database.close()

    const app = buildApp(env)
    const response = await app.inject({
      method: 'POST',
      url: '/api/integrations/anilist/disconnect',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      connection: {
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
    })

    const reopened = new AniFlowDatabase(env.dbPath)
    expect(reopened.getAniListConnection()).toBeNull()
    expect(reopened.takePendingAniListJobs()).toEqual([])
    reopened.close()

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

  it('falls back to subtitle-derived intro and outro markers when AniSkip has no match', async () => {
    vi.spyOn(AllAnimeAdapter.prototype, 'resolvePlayback').mockResolvedValue({
      url: 'https://media.example/video.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
      headers: { Referer: 'https://allmanga.to' },
      subtitleUrl: 'https://media.example/subtitles.vtt',
      subtitleMimeType: 'text/vtt',
      qualityLabel: 'Auto',
    })
    vi.spyOn(AniSkipService.prototype, 'getSegments').mockResolvedValue([])

    const fetchMock = vi.mocked(globalThis.fetch)
    const originalFetch = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (input, init) => {
      const url = getRequestUrl(input as string | URL | Request)
      if (url === 'https://media.example/subtitles.vtt') {
        return new Response(subtitleFixture, {
          status: 200,
          headers: { 'Content-Type': 'text/vtt' },
        })
      }

      if (!originalFetch) {
        throw new Error(`Unexpected fetch in test: ${url}`)
      }

      return originalFetch(input, init)
    })

    const app = buildApp(createEnv())
    const response = await app.inject({
      method: 'POST',
      url: '/api/playback/resolve',
      payload: {
        showId: 'demo-show',
        episodeNumber: '1',
        translationType: 'sub',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      showId: 'demo-show',
      episodeNumber: '1',
      skipSegments: [
        { label: 'Skip intro', startTime: 0, endTime: 92 },
        { label: 'Skip outro', startTime: 1303, endTime: 1335 },
      ],
    })

    await app.close()
  })

  it('preserves AniSkip timings and only backfills missing labels from local detection', async () => {
    vi.spyOn(AllAnimeAdapter.prototype, 'resolvePlayback').mockResolvedValue({
      url: 'https://media.example/video.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
      headers: { Referer: 'https://allmanga.to' },
      subtitleUrl: 'https://media.example/subtitles.vtt',
      subtitleMimeType: 'text/vtt',
      qualityLabel: 'Auto',
    })
    vi.spyOn(AniSkipService.prototype, 'getSegments').mockResolvedValue([
      { label: 'Skip intro', startTime: 88, endTime: 179 },
    ])

    const fetchMock = vi.mocked(globalThis.fetch)
    const originalFetch = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (input, init) => {
      const url = getRequestUrl(input as string | URL | Request)
      if (url === 'https://media.example/subtitles.vtt') {
        return new Response(subtitleFixture, {
          status: 200,
          headers: { 'Content-Type': 'text/vtt' },
        })
      }

      if (!originalFetch) {
        throw new Error(`Unexpected fetch in test: ${url}`)
      }

      return originalFetch(input, init)
    })

    const app = buildApp(createEnv())
    const response = await app.inject({
      method: 'POST',
      url: '/api/playback/resolve',
      payload: {
        showId: 'demo-show',
        episodeNumber: '1',
        translationType: 'sub',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().skipSegments).toEqual([
      { label: 'Skip intro', startTime: 88, endTime: 179 },
      { label: 'Skip outro', startTime: 1303, endTime: 1335 },
    ])

    await app.close()
  })

  it('does not block playback when skip marker enrichment stalls', async () => {
    vi.useFakeTimers()
    vi.spyOn(AllAnimeAdapter.prototype, 'resolvePlayback').mockResolvedValue({
      url: 'https://media.example/video.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
      headers: { Referer: 'https://allmanga.to' },
      subtitleUrl: 'https://media.example/subtitles.vtt',
      subtitleMimeType: 'text/vtt',
      qualityLabel: 'Auto',
    })
    vi.spyOn(AniSkipService.prototype, 'getSegments').mockImplementation(
      () => new Promise<never>(() => undefined),
    )

    const app = buildApp(createEnv())

    try {
      const responsePromise = app.inject({
        method: 'POST',
        url: '/api/playback/resolve',
        payload: {
          showId: 'demo-show',
          episodeNumber: '1',
          translationType: 'sub',
        },
      })

      await vi.advanceTimersByTimeAsync(PLAYBACK_SKIP_TIMEOUT_MS + 1)
      const response = await responsePromise

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        showId: 'demo-show',
        episodeNumber: '1',
        skipSegments: [],
      })
      expect(response.json().streamUrl).toMatch(/^\/api\/playback\/proxy\//)
    } finally {
      vi.useRealTimers()
      await app.close()
    }
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
      aniListDetails: {
        mediaId: 101,
        title: {
          romaji: 'Sousou no Frieren',
          native: '葬送のフリーレン',
        },
        synopsis: 'Following the First-Class Mage Exam, the trio—Frieren, Fern & Stark—heads north.',
        format: 'TV',
        episodes: 24,
        duration: 24,
        popularity: 221004,
        favourites: 18230,
        rankings: expect.arrayContaining([
          expect.objectContaining({
            rank: 3,
            type: 'RATED',
          }),
        ]),
        audienceStats: expect.arrayContaining([
          expect.objectContaining({
            status: 'CURRENT',
            amount: 50312,
          }),
        ]),
        tags: expect.arrayContaining([
          expect.objectContaining({
            name: 'Elf Protagonist',
          }),
        ]),
        relations: expect.arrayContaining([
          expect.objectContaining({
            relationType: 'PREQUEL',
            title: 'Frieren: Beyond Journey’s End',
          }),
        ]),
        recommendations: expect.arrayContaining([
          expect.objectContaining({
            title: 'The Apothecary Diaries',
            rating: 145,
          }),
        ]),
        reviews: expect.arrayContaining([
          expect.objectContaining({
            summary: 'Measured pacing and strong character work.',
            userName: 'mat',
          }),
        ]),
      },
      translationType: 'sub',
      progress: {
        currentEpisodeNumber: '2',
        completedEpisodeCount: 0,
        startedEpisodeCount: 1,
      },
      fillerSource: 'jikan',
      fillerMatchTitle: 'Sousou no Frieren',
      malRank: 17,
      malPopularity: 317,
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

  it('falls back cleanly when AniList detail lookups fail on the show page route', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    const originalFetch = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (input, init) => {
      const url = getRequestUrl(input as string | URL | Request)
      if (url === 'https://graphql.anilist.co') {
        const bodyText = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : '{}'
        const body = JSON.parse(bodyText) as { query?: string }
        if (body.query?.includes('ShowPageAniListDetails')) {
          return new Response('rate limited', { status: 429 })
        }
      }

      if (!originalFetch) {
        throw new Error(`Unexpected fetch in test: ${url}`)
      }

      return originalFetch(input, init)
    })

    const app = buildApp(createEnv())
    const response = await app.inject({
      method: 'GET',
      url: '/api/shows/demo-show/page?translationType=sub',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      show: expect.objectContaining({
        id: 'demo-show',
      }),
      aniListDetails: null,
    })

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

  it('skips AniList metadata lookups when the provider payload is already complete enough', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    const originalFetch = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (input, init) => {
      const url = getRequestUrl(input as string | URL | Request)
      if (url === 'https://graphql.anilist.co') {
        throw new Error('AniList should not be queried for demo-show')
      }

      if (!originalFetch) {
        throw new Error(`Unexpected fetch in test: ${url}`)
      }

      return originalFetch(input, init)
    })

    const app = buildApp(createEnv())
    const response = await app.inject({
      method: 'GET',
      url: '/api/shows/demo-show',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: 'demo-show',
      title: 'Demo Show',
      originalTitle: 'Demo Show Native',
      posterUrl: 'https://example.com/poster.jpg',
      description: 'Demo description',
      genres: ['Action'],
      status: 'FINISHED',
      score: 81,
      season: 'SPRING',
      year: 2024,
    })

    await app.close()
  })

  it('returns provider data when AniList metadata is rate limited', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    const originalFetch = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (input, init) => {
      const url = getRequestUrl(input as string | URL | Request)
      if (url === 'https://graphql.anilist.co') {
        return new Response('rate limited', { status: 429 })
      }

      if (!originalFetch) {
        throw new Error(`Unexpected fetch in test: ${url}`)
      }

      return originalFetch(input, init)
    })

    const app = buildApp(createEnv())
    const response = await app.inject({
      method: 'GET',
      url: '/api/shows/fallback-show',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: 'fallback-show',
      title: 'Fallback Show',
      originalTitle: 'Fallback Show',
      posterUrl: null,
      bannerUrl: null,
      description: null,
      genres: [],
      status: null,
      score: null,
      season: null,
      year: 2025,
      availableEpisodes: {
        sub: 12,
        dub: 0,
      },
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
