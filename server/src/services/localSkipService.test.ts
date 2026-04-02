/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { LocalSkipService } from './localSkipService.js'

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

const sparseSubtitleFixture = `WEBVTT

00:04:00.000 --> 00:04:03.000
We are finally here.

00:11:10.000 --> 00:11:13.000
That is bad.
`

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocalSkipService', () => {
  it('detects intro and outro segments from subtitle timing gaps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(subtitleFixture, {
        status: 200,
        headers: { 'Content-Type': 'text/vtt' },
      }),
    )

    const service = new LocalSkipService(createDatabaseStub() as never, {
      probeDuration: async () => null,
    })

    await expect(
      service.getSegments({
        showId: 'demo-show',
        episodeNumber: '1',
        translationType: 'sub',
        subtitleUrl: 'https://media.example/subtitles.vtt',
        subtitleMimeType: 'text/vtt',
        streamUrl: 'https://media.example/video.m3u8',
        headers: { Referer: 'https://allmanga.to' },
      }),
    ).resolves.toEqual([
      { label: 'Skip intro', startTime: 0, endTime: 92 },
      { label: 'Skip outro', startTime: 1303, endTime: 1335 },
    ])
  })

  it('reuses the cached season profile for later episodes with weaker subtitle signals', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      if (url.endsWith('/episode-1.vtt')) {
        return new Response(subtitleFixture, {
          status: 200,
          headers: { 'Content-Type': 'text/vtt' },
        })
      }

      if (url.endsWith('/episode-2.vtt')) {
        return new Response(sparseSubtitleFixture, {
          status: 200,
          headers: { 'Content-Type': 'text/vtt' },
        })
      }

      throw new Error(`Unexpected fetch in test: ${url}`)
    })

    const service = new LocalSkipService(createDatabaseStub() as never, {
      probeDuration: async () => 1400,
    })

    await expect(
      service.getSegments({
        showId: 'demo-show',
        episodeNumber: '1',
        translationType: 'sub',
        subtitleUrl: 'https://media.example/episode-1.vtt',
        subtitleMimeType: 'text/vtt',
        streamUrl: 'https://media.example/video-1.m3u8',
        headers: {},
      }),
    ).resolves.toEqual([
      { label: 'Skip intro', startTime: 0, endTime: 92 },
      { label: 'Skip outro', startTime: 1303, endTime: 1400 },
    ])

    await expect(
      service.getSegments({
        showId: 'demo-show',
        episodeNumber: '2',
        translationType: 'sub',
        subtitleUrl: 'https://media.example/episode-2.vtt',
        subtitleMimeType: 'text/vtt',
        streamUrl: 'https://media.example/video-2.m3u8',
        headers: {},
      }),
    ).resolves.toEqual([
      { label: 'Skip intro', startTime: 0, endTime: 92 },
      { label: 'Skip outro', startTime: 1303, endTime: 1400 },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to repeated frame matches when subtitles are unavailable', async () => {
    const service = new LocalSkipService(createDatabaseStub() as never, {
      probeDuration: async ({ url }) => (url.includes('current') ? 1421 : 1420),
      sampleFrameHashes: async ({ url, startTime }) => {
        if (url.includes('current') && startTime === 0) {
          return [...Array<bigint>(90).fill(1n), ...buildUniqueHashes(120, 1000)]
        }

        if (url.includes('reference') && startTime === 0) {
          return [...Array<bigint>(90).fill(1n), ...buildUniqueHashes(120, 2000)]
        }

        if (url.includes('current') && startTime > 0) {
          return [...buildUniqueHashes(174, 3000), ...Array<bigint>(66).fill(2n)]
        }

        if (url.includes('reference') && startTime > 0) {
          return [...buildUniqueHashes(162, 4000), ...Array<bigint>(66).fill(2n), ...buildUniqueHashes(12, 5000)]
        }

        return []
      },
    })

    await expect(
      service.getSegments({
        showId: 'demo-show',
        episodeNumber: '1',
        translationType: 'sub',
        subtitleUrl: null,
        subtitleMimeType: null,
        streamUrl: 'https://media.example/current.m3u8',
        headers: {},
        referenceStreams: [
          {
            episodeNumber: '2',
            streamUrl: 'https://media.example/reference.m3u8',
            headers: {},
          },
        ],
      }),
    ).resolves.toEqual([
      { label: 'Skip intro', startTime: 0, endTime: 90 },
      { label: 'Skip outro', startTime: 1355, endTime: 1421 },
    ])
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

function buildUniqueHashes(length: number, start: number) {
  return Array.from({ length }, (_value, index) =>
    BigInt.asUintN(64, BigInt(start + index + 1) * 0x9e3779b97f4a7c15n),
  )
}
