import type {
  AniListConnection,
  AniListConnectInput,
  HomePayload,
  LibraryEntry,
  LibraryUpdateInput,
  PlaybackResolveInput,
  ProgressInput,
  ResolvedStream,
  SearchPayload,
  ShowDetail,
  EpisodeSummary,
  ShowPagePayload,
} from '../../shared/contracts'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const inflightRequests = new Map<string, Promise<unknown>>()

async function request<T>(path: string, options: RequestInit = {}, password?: string | null): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (password) {
    headers.set('x-aniflow-password', password)
  }

  const method = (options.method ?? 'GET').toUpperCase()
  const isDeduplicatedGet = method === 'GET' && !options.body
  const cacheKey = isDeduplicatedGet ? `${method}:${path}:${password ?? ''}` : null

  if (cacheKey) {
    const inflight = inflightRequests.get(cacheKey)
    if (inflight) {
      return inflight as Promise<T>
    }
  }

  const task = (async () => {
    const response = await fetch(path, {
      ...options,
      headers,
    })

    const body = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : await response.text()

    if (!response.ok) {
      const message =
        typeof body === 'object' && body && 'message' in body && typeof body.message === 'string'
          ? body.message
          : 'Request failed'
      throw new ApiError(message, response.status)
    }

    return body as T
  })()

  if (!cacheKey) {
    return task
  }

  inflightRequests.set(cacheKey, task)
  return task.finally(() => {
    inflightRequests.delete(cacheKey)
  })
}

export function createApi(password?: string | null) {
  return {
    getHome: () => request<HomePayload>('/api/home', {}, password),
    search: (query: string) => request<SearchPayload>(`/api/search?q=${encodeURIComponent(query)}`, {}, password),
    getShow: (showId: string) => request<ShowDetail>(`/api/shows/${showId}`, {}, password),
    getShowPage: (showId: string, translationType: string) =>
      request<ShowPagePayload>(
        `/api/shows/${showId}/page?translationType=${encodeURIComponent(translationType)}`,
        {},
        password,
      ),
    getEpisodes: (showId: string, translationType: string) =>
      request<{ episodes: EpisodeSummary[] }>(
        `/api/shows/${showId}/episodes?translationType=${encodeURIComponent(translationType)}`,
        {},
        password,
      ),
    resolvePlayback: (input: PlaybackResolveInput) =>
      request<ResolvedStream>('/api/playback/resolve', { method: 'POST', body: JSON.stringify(input) }, password),
    saveProgress: (input: ProgressInput, options: RequestInit = {}) =>
      request<{ progress: ProgressInput & { updatedAt: string } }>(
        '/api/progress',
        { ...options, method: 'POST', body: JSON.stringify(input) },
        password,
      ),
    updateLibrary: (input: LibraryUpdateInput, options: RequestInit = {}) =>
      request<{ entry: LibraryEntry }>(
        '/api/library',
        { ...options, method: 'POST', body: JSON.stringify(input) },
        password,
      ),
    connectAniList: (input: AniListConnectInput) =>
      request<AniListConnection>('/api/integrations/anilist/connect', {
        method: 'POST',
        body: JSON.stringify(input),
      }, password),
    syncAniList: () =>
      request<{ connection: AniListConnection }>(
        '/api/integrations/anilist/sync',
        { method: 'POST', body: JSON.stringify({}) },
        password,
      ),
    disconnectAniList: () =>
      request<{ connection: AniListConnection }>(
        '/api/integrations/anilist/disconnect',
        { method: 'POST', body: JSON.stringify({}) },
        password,
      ),
  }
}
