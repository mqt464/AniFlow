/** @vitest-environment node */

import { describe, expect, it } from 'vitest'

import { parseAllAnimeProviderPayload } from './allAnimeAdapter.js'

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
