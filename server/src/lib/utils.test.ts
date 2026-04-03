/** @vitest-environment node */

import { describe, expect, it } from 'vitest'

import { cleanSynopsis, stripHtml } from './utils.js'

describe('cleanSynopsis', () => {
  it('decodes html entities and removes MAL rewrite credits', () => {
    expect(
      cleanSynopsis(
        '<p>Following the trio&#x2014;Fern &amp; Frieren move onward. It&apos;s quiet. [Written by MAL Rewrite]</p>',
      ),
    ).toBe("Following the trio—Fern & Frieren move onward. It's quiet.")
  })
})

describe('stripHtml', () => {
  it('collapses markup into readable text without removing normal suffixes', () => {
    expect(stripHtml('<p>Hello<br />world</p><p>Second&nbsp;line</p>')).toBe('Hello world\n\nSecond line')
  })
})
