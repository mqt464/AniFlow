export function stripHtml(input: string | null | undefined): string | null {
  return normalizeHtmlText(input, { stripMalRewriteCredit: false })
}

export function cleanSynopsis(input: string | null | undefined): string | null {
  return normalizeHtmlText(input, { stripMalRewriteCredit: true })
}

function normalizeHtmlText(
  input: string | null | undefined,
  options: {
    stripMalRewriteCredit: boolean
  },
): string | null {
  if (!input) {
    return null
  }

  let value = input
    .replace(/\r/g, '')
    .replace(/<(?:br|\/p|\/div|\/li|\/section|\/article|\/blockquote|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<(?:p|div|li|section|article|blockquote|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  value = decodeHtmlEntities(value)

  if (options.stripMalRewriteCredit) {
    value = value.replace(/\s*\[\s*written by MAL rewrite\s*\]\s*$/i, '')
  }

  const paragraphs = value
    .replace(/\u00a0/g, ' ')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return paragraphs.length ? paragraphs.join('\n\n') : null
}

export function normalizeTitle(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim()
}

export function sortEpisodeNumbers(values: string[]): string[] {
  return [...values].sort((left, right) => Number(left) - Number(right))
}

export function parseEpisodeNumericValue(value: string): number {
  return Number.parseFloat(value)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
  })

  return Promise.race([task, timeout]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer)
    }
  })
}

function decodeHtmlEntities(input: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    apos: "'",
    bull: '•',
    gt: '>',
    hellip: '…',
    ldquo: '“',
    lsquo: '‘',
    lt: '<',
    mdash: '—',
    nbsp: ' ',
    ndash: '–',
    quot: '"',
    rdquo: '”',
    rsquo: '’',
  }

  return input.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase()

    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }

    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }

    return entities[normalized] ?? match
  })
}
