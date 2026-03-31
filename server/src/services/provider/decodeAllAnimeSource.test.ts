/** @vitest-environment node */

import { describe, expect, it } from 'vitest'

import { decodeAllAnimeSourceUrl } from './decodeAllAnimeSource.js'

describe('decodeAllAnimeSourceUrl', () => {
  it('keeps plain urls unchanged', () => {
    expect(decodeAllAnimeSourceUrl('https://example.com/video.mp4')).toBe('https://example.com/video.mp4')
  })

  it('decodes ani-cli style source ids', () => {
    expect(
      decodeAllAnimeSourceUrl(
        '--504c4c484b0217174c5757544b165e594b4c0c4b485d5d5c164a4b4e481717555d5c51590b174e515c5d574b176a5d575768794068754b70750c73687561174b4d5a1709',
      ),
    ).toBe('https://tools.fast4speed.rsvp//media3/videos/ReooPAxPMsHM4KPMY/sub/1')
  })
})
