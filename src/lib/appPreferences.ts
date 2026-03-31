import type { TranslationType } from '../../shared/contracts'

const PASSWORD_STORAGE_KEY = 'aniflow:password'
const PREFERRED_TRANSLATION_STORAGE_KEY = 'aniflow:preferred-translation'
const ANILIST_TOKEN_STORAGE_KEY = 'aniflow:anilist-token'
const AUTO_NEXT_STORAGE_KEY = 'aniflow:auto-next'

export function readStoredPassword(): string {
  return window.localStorage.getItem(PASSWORD_STORAGE_KEY) ?? ''
}

export function writeStoredPassword(value: string): void {
  window.localStorage.setItem(PASSWORD_STORAGE_KEY, value)
}

export function readStoredPreferredTranslation(): TranslationType {
  const value = window.localStorage.getItem(PREFERRED_TRANSLATION_STORAGE_KEY)
  return isTranslationType(value) ? value : 'sub'
}

export function writeStoredPreferredTranslation(value: TranslationType): void {
  window.localStorage.setItem(PREFERRED_TRANSLATION_STORAGE_KEY, value)
}

export function readStoredAniListToken(): string {
  return window.localStorage.getItem(ANILIST_TOKEN_STORAGE_KEY) ?? ''
}

export function writeStoredAniListToken(value: string): void {
  window.localStorage.setItem(ANILIST_TOKEN_STORAGE_KEY, value)
}

export function readStoredAutoNext(): boolean {
  const value = window.localStorage.getItem(AUTO_NEXT_STORAGE_KEY)
  return value === null ? true : value !== 'false'
}

export function writeStoredAutoNext(value: boolean): void {
  window.localStorage.setItem(AUTO_NEXT_STORAGE_KEY, String(value))
}

export function isTranslationType(value: string | null | undefined): value is TranslationType {
  return value === 'sub' || value === 'dub'
}

export function resolveTranslationType(value: string | null | undefined, fallback: TranslationType): TranslationType {
  return isTranslationType(value) ? value : fallback
}

export function pickAvailableTranslation(
  availableEpisodes: Record<TranslationType, number> | null | undefined,
  preferred: TranslationType,
): TranslationType {
  if (!availableEpisodes) {
    return preferred
  }

  if (availableEpisodes[preferred] > 0) {
    return preferred
  }

  const fallback = preferred === 'sub' ? 'dub' : 'sub'
  return availableEpisodes[fallback] > 0 ? fallback : preferred
}

export function withMode(path: string, translationType: TranslationType): string {
  return `${path}${path.includes('?') ? '&' : '?'}mode=${encodeURIComponent(translationType)}`
}
