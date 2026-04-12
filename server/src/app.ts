import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { z } from 'zod'

import type {
  AniListConnectInput,
  EpisodeSummary,
  EpisodeAnnotation,
  HomePayload,
  LibraryUpdateInput,
  PlaybackResolveInput,
  ProgressInput,
  ResolvedStream,
  SkipDebugInfo,
  SearchPayload,
  ShowPagePayload,
  TranslationType,
} from '../../shared/contracts.js'
import { translationTypes } from '../../shared/contracts.js'
import type { AppEnv } from './env.js'
import { AniFlowDatabase } from './lib/database.js'
import { nowIso, withTimeout } from './lib/utils.js'
import { AniListService } from './services/aniListService.js'
import { AniSkipService } from './services/aniSkipService.js'
import { JikanService } from './services/jikanService.js'
import { LocalSkipService } from './services/localSkipService.js'
import { AllAnimeAdapter } from './services/provider/allAnimeAdapter.js'
import { ProxySessionStore } from './services/proxySessionStore.js'

export const PLAYBACK_RESOLVE_TIMEOUT_MS = 12_000
export const PLAYBACK_METADATA_TIMEOUT_MS = 5_000
export const PLAYBACK_SKIP_TIMEOUT_MS = 4_000
const PLAYBACK_SKIP_TIMEOUT_BUFFER_MS = 150

const progressSchema = z.object({
  showId: z.string().min(1),
  episodeNumber: z.string().min(1),
  title: z.string().min(1),
  posterUrl: z.string().nullable().optional(),
  currentTime: z.number().min(0),
  duration: z.number().min(0),
  completed: z.boolean(),
  advanceToEpisodeNumber: z.string().min(1).nullable().optional(),
})

const playbackSchema = z.object({
  showId: z.string().min(1),
  episodeNumber: z.string().min(1),
  translationType: z.enum(translationTypes).default('sub'),
  preferredQuality: z.string().nullable().optional(),
  debugSkip: z.boolean().optional(),
})

const aniListSchema = z.object({
  accessToken: z.string().optional(),
  code: z.string().optional(),
  validateOnly: z.boolean().optional(),
})

const librarySchema = z.object({
  showId: z.string().min(1),
  title: z.string().min(1),
  posterUrl: z.string().nullable().optional(),
  favorited: z.boolean().optional(),
  watchLater: z.boolean().optional(),
  completed: z.boolean().optional(),
  dropped: z.boolean().optional(),
  removeFromContinueWatching: z.boolean().optional(),
})

export function buildApp(env: AppEnv) {
  const app = Fastify({ logger: false })
  const database = new AniFlowDatabase(env.dbPath)
  const provider = new AllAnimeAdapter(env, database)
  const aniSkip = new AniSkipService(env, database)
  const localSkip = new LocalSkipService(database)
  const aniList = new AniListService(env, database, provider)
  const jikan = new JikanService(env, database)
  const proxySessions = new ProxySessionStore()

  void app.register(cors, { origin: true })
  aniList.start()

  app.addHook('onClose', async () => {
    aniList.stop()
    database.close()
  })

  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/api/health') {
      return
    }

    if (!env.appPassword) {
      return
    }

    const headerPassword = request.headers['x-aniflow-password']
    const provided = Array.isArray(headerPassword) ? headerPassword[0] : headerPassword
    if (provided === env.appPassword) {
      return
    }

    reply.code(401).send({ message: 'AniFlow is password protected on this LAN host.' })
  })

  app.get('/api/health', async () => ({
    ok: true,
    at: nowIso(),
  }))

  app.get('/api/home', async (): Promise<HomePayload> => ({
    continueWatching: database.getContinueWatching(),
    watchLater: database.getWatchLater(),
    completed: database.getCompleted(),
    dropped: database.getDropped(),
    recentProgress: database.getRecentProgress(),
    favorites: database.getFavorites(),
    discover: await aniList.getHomeDiscover(),
    anilist: aniList.getPublicConnection(),
    requiresPassword: Boolean(env.appPassword),
  }))

  app.get('/api/search', async (request): Promise<SearchPayload> => {
    const query = z.string().parse((request.query as { q?: string }).q ?? '')
    return {
      query,
      results: query.trim() ? await provider.search(query) : [],
    }
  })

  app.get('/api/shows/:id', async (request) => {
    const { id } = request.params as { id: string }
    return provider.getShow(id)
  })

  app.get('/api/shows/:id/page', async (request): Promise<ShowPagePayload> => {
    const { id } = request.params as { id: string }
    const translationType = ((request.query as { translationType?: TranslationType }).translationType ??
      'sub') as TranslationType
    const alternateTranslationType: TranslationType = translationType === 'sub' ? 'dub' : 'sub'

    const [show, preferredEpisodes, alternateEpisodes] = await Promise.all([
      provider.getShow(id),
      provider.getEpisodes(id, translationType),
      provider.getEpisodes(id, alternateTranslationType).catch(() => []),
    ])
    const episodes = mergeShowPageEpisodes(preferredEpisodes, alternateEpisodes, translationType)
    const [aniListDetails, progressByEpisode, progressSummary, annotations] = await Promise.all([
      provider.getAniListDetails(show).catch(() => null),
      Promise.resolve(database.getShowEpisodeProgress(id)),
      Promise.resolve(database.getShowProgressSummary(id)),
      jikan.getEpisodeAnnotations(show).catch(() => ({
        annotations: {},
        titles: {},
        matchedTitle: null,
        rank: null,
        popularity: null,
      })),
    ])
    const episodeAnnotations = annotations.annotations as Record<string, EpisodeAnnotation>
    const episodeTitles = (annotations.titles ?? {}) as Record<string, string>

    return {
      show,
      aniListDetails,
      translationType,
      episodes: episodes.map((episode) => ({
        ...episode,
        title: episodeTitles[episode.number] ?? episode.title,
        progress: progressByEpisode[episode.number] ?? null,
        isCurrent: progressSummary.currentEpisodeNumber === episode.number,
        annotation: episodeAnnotations[episode.number] ?? null,
      })),
      progress: progressSummary,
      library: database.getLibraryEntry(id),
      fillerSource: annotations.matchedTitle ? 'jikan' : null,
      fillerMatchTitle: annotations.matchedTitle,
      malRank: annotations.rank,
      malPopularity: annotations.popularity,
    }
  })

  app.get('/api/shows/:id/episodes', async (request) => {
    const { id } = request.params as { id: string }
    const translationType = ((request.query as { translationType?: TranslationType }).translationType ??
      'sub') as TranslationType
    return {
      episodes: await provider.getEpisodes(id, translationType),
    }
  })

  app.post('/api/playback/resolve', async (request, reply): Promise<ResolvedStream | void> => {
    const input = playbackSchema.parse(request.body) as PlaybackResolveInput
    const translationType = input.translationType ?? 'sub'
    const showPromise = withTimeout(
      provider.getShow(input.showId),
      PLAYBACK_METADATA_TIMEOUT_MS,
      'Timed out loading playback show details',
    ).catch(() => null)
    const episodesPromise = withTimeout(
      provider.getEpisodes(input.showId, translationType),
      PLAYBACK_METADATA_TIMEOUT_MS,
      'Timed out loading playback episode list',
    ).catch(() => [])
    const candidate = await withTimeout(
      provider.resolvePlayback(input.showId, input.episodeNumber, translationType),
      PLAYBACK_RESOLVE_TIMEOUT_MS,
      'Timed out resolving this stream',
    ).catch((error: unknown) => {
      const failure = mapPlaybackResolveFailure(error)
      return reply.code(failure.statusCode).send({ message: failure.message })
    })
    if (!candidate) {
      return
    }
    const [show, episodes] = await Promise.all([showPromise, episodesPromise])

    const mainSession = proxySessions.create({
      targetUrl: candidate.url,
      mimeType: candidate.mimeType,
      headers: candidate.headers,
    })
    const subtitleSession = candidate.subtitleUrl
      ? proxySessions.create({
          targetUrl: candidate.subtitleUrl,
          mimeType: candidate.subtitleMimeType ?? 'text/vtt',
          headers: candidate.headers,
        })
      : null

    const skipResolution =
      show && episodes.length > 0
        ? await withTimeout(
            resolvePlaybackSkipSegments({
              aniSkip,
              localSkip,
              provider,
              input,
              show,
              candidate,
              episodes,
              translationType,
            }),
            PLAYBACK_SKIP_TIMEOUT_MS,
            'Timed out loading playback markers',
          ).catch(() => ({
            skipSegments: [],
            skipDebug: null,
          }))
        : {
            skipSegments: [],
            skipDebug: null,
          }
    const nextEpisodeNumber = episodes.length > 0 ? provider.getNextEpisodeNumber(episodes, input.episodeNumber) : null
    const showTitle = show?.title ?? input.showId

    return {
      showId: input.showId,
      episodeNumber: input.episodeNumber,
      translationType,
      showTitle,
      streamUrl: `/api/playback/proxy/${mainSession.id}`,
      mimeType: candidate.mimeType,
      subtitleUrl: subtitleSession ? `/api/playback/proxy/${subtitleSession.id}` : null,
      subtitleMimeType: candidate.subtitleMimeType,
      qualities: [
        {
          id: mainSession.id,
          label: candidate.qualityLabel,
          proxyUrl: `/api/playback/proxy/${mainSession.id}`,
        },
      ],
      skipSegments: skipResolution.skipSegments,
      skipDebug: skipResolution.skipDebug,
      nextEpisodeNumber,
      title: `${showTitle} • Episode ${input.episodeNumber}`,
    }
  })

  app.get('/api/playback/proxy/*', async (request, reply) => {
    const wildcard = (request.params as { '*': string })['*']
    const token = wildcard.split('/')[0]
    const session = proxySessions.get(token)
    if (!session) {
      return reply.code(404).send({ message: 'Playback session expired' })
    }

    const rangeHeader = request.headers.range
    const upstream = await fetch(session.targetUrl, {
      headers: {
        ...session.headers,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
    })

    if (!upstream.ok && upstream.status !== 206) {
      return reply.code(upstream.status).send({ message: 'Upstream media request failed' })
    }

    const contentType = upstream.headers.get('content-type') ?? session.mimeType
    reply.header('Content-Type', contentType)
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) {
      reply.header('Content-Length', contentLength)
    }
    const acceptRanges = upstream.headers.get('accept-ranges')
    if (acceptRanges) {
      reply.header('Accept-Ranges', acceptRanges)
    }
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) {
      reply.header('Content-Range', contentRange)
      reply.code(206)
    }

    if (contentType.includes('mpegurl') || session.targetUrl.endsWith('.m3u8')) {
      const playlist = await upstream.text()
      const rewritten = rewritePlaylist(playlist, session.targetUrl, session.headers, proxySessions)
      return reply.send(rewritten)
    }

    if (!upstream.body) {
      return reply.send(Buffer.alloc(0))
    }

    return reply.send(Readable.fromWeb(upstream.body as globalThis.ReadableStream<Uint8Array>))
  })

  app.post('/api/progress', async (request) => {
    const input = progressSchema.parse(request.body) as ProgressInput
    const saved = database.saveProgress(input)
    aniList.enqueueShowSync(input.showId)
    return { progress: saved }
  })

  app.post('/api/library', async (request) => {
    const input = librarySchema.parse(request.body) as LibraryUpdateInput
    const entry = database.updateLibraryEntry(input)
    aniList.enqueueShowSync(input.showId)
    return { entry }
  })

  app.post('/api/integrations/anilist/connect', async (request) => {
    const input = aniListSchema.parse(request.body) as AniListConnectInput
    const connection = await aniList.connect(input)
    return connection
  })

  app.get('/api/integrations/anilist/callback', async (request, reply) => {
    const code = (request.query as { code?: string }).code
    if (!code) {
      return reply.code(400).send({ message: 'AniList callback was missing a code value' })
    }

    await aniList.connect({ code })
    return reply.redirect(`${env.frontendUrl}/settings?anilist=connected`)
  })

  app.post('/api/integrations/anilist/sync', async () => ({
    connection: await aniList.syncNow(),
  }))

  app.post('/api/integrations/anilist/disconnect', async () => ({
    connection: aniList.disconnect(),
  }))

  app.get('/', async (_request, reply) => serveFrontendRequest('', reply, env))
  app.get('/*', async (request, reply) => {
    const requestPath = (request.params as { '*': string })['*'] ?? ''
    if (requestPath.startsWith('api/')) {
      return reply.code(404).send({ message: 'Not found' })
    }

    return serveFrontendRequest(requestPath, reply, env)
  })

  return app
}

function mergeShowPageEpisodes(
  preferredEpisodes: EpisodeSummary[],
  alternateEpisodes: EpisodeSummary[],
  preferredTranslationType: TranslationType,
): EpisodeSummary[] {
  const merged = new Map<string, EpisodeSummary>()

  for (const episode of alternateEpisodes) {
    merged.set(episode.number, episode)
  }

  for (const episode of preferredEpisodes) {
    merged.set(episode.number, {
      ...episode,
      translationType: preferredTranslationType,
    })
  }

  return Array.from(merged.values()).sort(
    (left, right) => parseEpisodeOrder(left.number) - parseEpisodeOrder(right.number),
  )
}

function parseEpisodeOrder(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function mapPlaybackResolveFailure(error: unknown): { statusCode: number; message: string } {
  const message = error instanceof Error ? error.message : 'Unable to resolve this stream right now'

  if (message.includes('Timed out resolving this stream')) {
    return {
      statusCode: 504,
      message: 'Playback resolution timed out for this episode. Try again in a moment.',
    }
  }

  if (message.includes('No playable sources were available for this episode')) {
    return {
      statusCode: 502,
      message: 'No playable sources were available for this episode right now.',
    }
  }

  if (message.includes('Show not found')) {
    return {
      statusCode: 404,
      message: 'This show could not be found on the provider.',
    }
  }

  return {
    statusCode: 502,
    message: 'Unable to resolve playback for this episode right now.',
  }
}

function hasSkipSegment(segments: ResolvedStream['skipSegments'], label: string) {
  return segments.some((segment) => segment.label.toLowerCase() === label.toLowerCase())
}

function mergeSkipSegments(primary: ResolvedStream['skipSegments'], fallback: ResolvedStream['skipSegments']) {
  const byLabel = new Map<string, ResolvedStream['skipSegments'][number]>()

  for (const segment of primary) {
    byLabel.set(segment.label.toLowerCase(), segment)
  }

  for (const segment of fallback) {
    const key = segment.label.toLowerCase()
    if (!byLabel.has(key)) {
      byLabel.set(key, segment)
    }
  }

  return [...byLabel.values()].sort((left, right) => left.startTime - right.startTime)
}

async function resolvePlaybackSkipSegments(input: {
  aniSkip: AniSkipService
  localSkip: LocalSkipService
  provider: AllAnimeAdapter
  input: PlaybackResolveInput
  show: { title: string; originalTitle: string | null; romajiTitle?: string | null }
  candidate: {
    url: string
    headers: Record<string, string>
    subtitleUrl: string | null
    subtitleMimeType: string | null
  }
  episodes: Array<{ number: string }>
  translationType: TranslationType
}): Promise<{ skipSegments: ResolvedStream['skipSegments']; skipDebug: SkipDebugInfo }> {
  const lookupStartedAt = Date.now()
  const lookupTitles = [input.show.title, input.show.romajiTitle, input.show.originalTitle].filter(
    (title): title is string => Boolean(title?.trim()),
  )
  const aniSkipSegments = await withTimeout(
    input.aniSkip.getSegments(
      input.show.title,
      input.input.episodeNumber,
      null,
      lookupTitles.filter((title) => title !== input.show.title),
    ),
    PLAYBACK_SKIP_TIMEOUT_MS,
    'Timed out loading AniSkip markers',
  ).catch(() => [])
  const missingAniSkipLabels = getMissingSkipSegmentLabels(aniSkipSegments)
  const localDebugRequested = input.input.debugSkip === true
  const localFallbackNeeded = missingAniSkipLabels.length > 0
  const localSegments =
    localFallbackNeeded || localDebugRequested
      ? await (() => {
          const remainingBudgetMs =
            PLAYBACK_SKIP_TIMEOUT_MS - (Date.now() - lookupStartedAt) - PLAYBACK_SKIP_TIMEOUT_BUFFER_MS
          if (remainingBudgetMs <= 0) {
            return Promise.resolve<ResolvedStream['skipSegments']>([])
          }

          return withTimeout(
            (async () =>
              input.localSkip.getSegments({
                showId: input.input.showId,
                episodeNumber: input.input.episodeNumber,
                translationType: input.translationType,
                subtitleUrl: input.candidate.subtitleUrl,
                subtitleMimeType: input.candidate.subtitleMimeType,
                streamUrl: input.candidate.url,
                headers: input.candidate.headers,
                referenceStreams: await resolveReferenceStreams(
                  input.provider,
                  input.input.showId,
                  input.translationType,
                  input.episodes,
                  input.input.episodeNumber,
                ),
              }))(),
            remainingBudgetMs,
            'Timed out loading local skip markers',
          ).catch(() => [])
        })()
      : []

  if (!localFallbackNeeded) {
    return {
      skipSegments: aniSkipSegments,
      skipDebug: {
        source: 'aniskip',
        lookupTitles,
        rawAniSkipSegments: aniSkipSegments,
        rawLocalSegments: localSegments,
        mergedSegments: aniSkipSegments,
        missingAniSkipLabels,
        usedLocalFallback: false,
      },
    }
  }

  const mergedSegments = mergeSkipSegments(aniSkipSegments, localSegments)

  return {
    skipSegments: mergedSegments,
    skipDebug: {
      source: mergedSegments.length > 0 ? 'merged' : 'none',
      lookupTitles,
      rawAniSkipSegments: aniSkipSegments,
      rawLocalSegments: localSegments,
      mergedSegments,
      missingAniSkipLabels,
      usedLocalFallback: localSegments.length > 0,
    },
  }
}

function getMissingSkipSegmentLabels(segments: ResolvedStream['skipSegments']) {
  const missingLabels: string[] = []
  if (!hasSkipSegment(segments, 'Skip intro')) {
    missingLabels.push('Skip intro')
  }
  if (!hasSkipSegment(segments, 'Skip outro')) {
    missingLabels.push('Skip outro')
  }

  return missingLabels
}

async function resolveReferenceStreams(
  provider: AllAnimeAdapter,
  showId: string,
  translationType: TranslationType,
  episodes: Array<{ number: string }>,
  currentEpisodeNumber: string,
) {
  const index = episodes.findIndex((episode) => episode.number === currentEpisodeNumber)
  if (index < 0) {
    return []
  }

  const candidates = [episodes[index + 1], episodes[index - 1]].filter((episode): episode is { number: string } =>
    Boolean(episode),
  )
  const resolved: Array<{ episodeNumber: string; streamUrl: string; headers: Record<string, string> }> = []

  for (const episode of candidates) {
    try {
      const playback = await provider.resolvePlayback(showId, episode.number, translationType)
      resolved.push({
        episodeNumber: episode.number,
        streamUrl: playback.url,
        headers: playback.headers,
      })
    } catch {
      continue
    }
  }

  return resolved
}

async function serveFrontendRequest(requestPath: string, reply: ReturnType<typeof Fastify>['reply'], env: AppEnv) {
  const distDir = path.resolve(env.frontendDistDir)
  const indexPath = path.join(distDir, 'index.html')
  const normalizedPath = requestPath.replace(/^\/+/, '')
  const candidatePath = path.resolve(distDir, normalizedPath || 'index.html')

  if (candidatePath === distDir || candidatePath.startsWith(`${distDir}${path.sep}`)) {
    const candidate = await readFileIfPresent(candidatePath)
    if (candidate) {
      return reply.type(getContentType(candidatePath)).send(candidate)
    }
  }

  if (path.extname(normalizedPath)) {
    return reply.code(404).send({ message: 'Static asset not found' })
  }

  const indexFile = await readFileIfPresent(indexPath)
  if (!indexFile) {
    return reply
      .code(404)
      .send({ message: 'Frontend build output was not found. Run `npm run build` before `npm start`.' })
  }

  return reply.type('text/html; charset=utf-8').send(indexFile)
}

function rewritePlaylist(
  playlist: string,
  baseUrl: string,
  headers: Record<string, string>,
  store: ProxySessionStore,
): string {
  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        return line
      }

      const targetUrl = new URL(trimmed, baseUrl).toString()
      const session = store.create({
        targetUrl,
        mimeType: targetUrl.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream',
        headers,
      })
      return `/api/playback/proxy/${session.id}`
    })
    .join('\n')
}

async function readFileIfPresent(filePath: string): Promise<Buffer | null> {
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) {
      return null
    }

    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

function getContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.html':
      return 'text/html; charset=utf-8'
    case '.ico':
      return 'image/x-icon'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'application/octet-stream'
  }
}
