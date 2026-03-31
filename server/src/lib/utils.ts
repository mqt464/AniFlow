export function stripHtml(input: string | null | undefined): string | null {
  if (!input) {
    return null
  }

  return input.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim()
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
