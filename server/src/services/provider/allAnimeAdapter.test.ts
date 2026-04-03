/** @vitest-environment node */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppEnv } from '../../env.js'
import { AniFlowDatabase } from '../../lib/database.js'
import { AllAnimeAdapter, parseAllAnimeProviderPayload } from './allAnimeAdapter.js'

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aniflow-allanime-test-'))
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

describe('parseAllAnimeProviderPayload', () => {
  it('parses the current JSON hls payload shape', () => {
    const candidate = parseAllAnimeProviderPayload(
      JSON.stringify({
        links: [
          {
            link: 'https://example.com/master.m3u8',
            hls: true,
            resolutionStr: 'Hls',
          },
        ],
      }),
      'https://allmanga.to',
    )

    expect(candidate).toEqual({
      url: 'https://example.com/master.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
      headers: { Referer: 'https://allmanga.to' },
      subtitleUrl: null,
      subtitleMimeType: null,
      qualityLabel: 'Auto',
    })
  })

  it('extracts subtitle tracks from structured payloads', () => {
    const candidate = parseAllAnimeProviderPayload(
      JSON.stringify({
        links: [
          {
            link: 'https://example.com/master.m3u8',
            hls: true,
            resolutionStr: 'Hls',
          },
        ],
        subtitles: [
          {
            src: 'https://example.com/subtitles.vtt',
            label: 'English',
          },
        ],
      }),
      'https://allmanga.to',
    )

    expect(candidate?.subtitleUrl).toBe('https://example.com/subtitles.vtt')
    expect(candidate?.subtitleMimeType).toBe('text/vtt')
  })

  it('keeps mp4 sources and subtitle mime types aligned', () => {
    const candidate = parseAllAnimeProviderPayload(
      JSON.stringify({
        links: [
          {
            link: 'https://example.com/video-720.mp4',
            mp4: true,
            resolutionStr: '720',
          },
          {
            link: 'https://example.com/video-1080.mp4',
            mp4: true,
            resolutionStr: '1080',
          },
        ],
        tracks: [
          {
            kind: 'captions',
            file: 'https://example.com/subtitles.srt',
          },
        ],
      }),
      'https://allmanga.to',
    )

    expect(candidate).toEqual({
      url: 'https://example.com/video-1080.mp4',
      mimeType: 'video/mp4',
      headers: { Referer: 'https://allmanga.to' },
      subtitleUrl: 'https://example.com/subtitles.srt',
      subtitleMimeType: 'application/x-subrip',
      qualityLabel: '1080p',
    })
  })

  it('falls back to the legacy text payload parser', () => {
    const candidate = parseAllAnimeProviderPayload(
      '{"hls","url":"https://example.com/master.m3u8","Referer":"https://embed.example","src":"https://example.com/subtitles.vtt"}',
      'https://allmanga.to',
    )

    expect(candidate).toEqual({
      url: 'https://example.com/master.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
      headers: { Referer: 'https://embed.example' },
      subtitleUrl: 'https://example.com/subtitles.vtt',
      subtitleMimeType: 'text/vtt',
      qualityLabel: 'Auto',
    })
  })
})

describe('AllAnimeAdapter AniList metadata lookup', () => {
  it('retries the fallback AniList GraphQL endpoint after a 404', async () => {
    const env = createEnv()
    const database = new AniFlowDatabase(env.dbPath)
    const adapter = new AllAnimeAdapter(env, database)

    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
        const bodyText = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : '{}'
        const body = JSON.parse(bodyText) as { query?: string; variables?: { search?: string; seasonYear?: number | null } }

        if (url === 'https://graphql.anilist.co') {
          return new Response('Not found', { status: 404 })
        }

        if (url === 'https://graphql.anilist.co/') {
          expect(body.query).toContain('SearchAniListMetadata')
          expect(body.variables).toEqual({
            search: 'Cowboy Bebop',
            seasonYear: 1998,
          })

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

        throw new Error(`Unexpected fetch: ${url}`)
      })

      const response = await (
        adapter as never as {
          queryAniList: (search: string, seasonYear: number | null) => Promise<{ data?: { Page?: { media?: unknown[] } | null } }>
        }
      ).queryAniList('Cowboy Bebop', 1998)

      expect(response.data?.Page?.media).toEqual([])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      database.close()
    }
  })
})
