import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { SkipSegment, TranslationType } from '../../../shared/contracts.js'
import { AniFlowDatabase } from '../lib/database.js'

const execFileAsync = promisify(execFile)
const EPISODE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7
const PROFILE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 90
const OVERRIDE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 365 * 20
const MEDIA_PROBE_TIMEOUT_MS = 12_000
const FRAME_SAMPLE_TIMEOUT_MS = 25_000
const INTRO_SAMPLE_WINDOW_SECONDS = 210
const OUTRO_SAMPLE_WINDOW_SECONDS = 240
const FRAME_MATCH_THRESHOLD = 10
const MIN_INTRO_MATCH_SECONDS = 45
const MIN_OUTRO_MATCH_SECONDS = 45
const MAX_ALIGNMENT_OFFSET_SECONDS = 120

interface SubtitleCue {
  start: number
  end: number
  text: string
}

interface CueCluster {
  start: number
  end: number
  cueCount: number
}

interface SegmentProfile {
  label: string
  startTime: number
  endTime: number
  startRatio: number | null
  endRatio: number | null
}

interface SeasonSkipProfile {
  durationSeconds: number | null
  segments: SegmentProfile[]
}

interface LocalSkipInput {
  showId: string
  episodeNumber: string
  translationType: TranslationType
  subtitleUrl: string | null
  subtitleMimeType: string | null
  streamUrl: string
  headers: Record<string, string>
  referenceStreams?: LocalSkipReferenceStream[]
}

interface LocalSkipOptions {
  probeDuration?: (input: { url: string; headers: Record<string, string> }) => Promise<number | null>
  sampleFrameHashes?: (input: {
    url: string
    headers: Record<string, string>
    startTime: number
    duration: number
  }) => Promise<bigint[]>
}

interface LocalSkipReferenceStream {
  episodeNumber: string
  streamUrl: string
  headers: Record<string, string>
}

export class LocalSkipService {
  constructor(
    private readonly database: AniFlowDatabase,
    private readonly options: LocalSkipOptions = {},
  ) {}

  async getSegments(input: LocalSkipInput): Promise<SkipSegment[]> {
    const override = this.getOverride(input.showId, input.translationType)
    if (override.length > 0) {
      return override
    }

    const cacheKey = getEpisodeCacheKey(input.showId, input.translationType, input.episodeNumber)
    const cached = this.database.getCachedJson<SkipSegment[]>(cacheKey)
    if (cached) {
      return cached
    }

    const cues = await this.loadSubtitleCues(input)
    const duration = await this.estimateDuration(input, cues)
    const subtitleDetected = inferSegmentsFromSubtitles(cues, duration)
    const streamDetected =
      missingSkipLabel(subtitleDetected, 'Skip intro') || missingSkipLabel(subtitleDetected, 'Skip outro')
        ? await this.detectRepeatedSegments(input, duration)
        : []
    const detected = mergeSkipSegments(subtitleDetected, streamDetected)
    const seasonProfile = this.database.getCachedJson<SeasonSkipProfile>(getSeasonProfileKey(input.showId, input.translationType))
    const combined = mergeSkipSegments(detected, materializeSeasonProfile(seasonProfile, duration))

    if (detected.length > 0) {
      const profile = buildSeasonProfile(detected, duration)
      if (profile) {
        this.database.setCachedJson(getSeasonProfileKey(input.showId, input.translationType), profile, PROFILE_CACHE_TTL_MS)
      }
    }

    if (combined.length > 0) {
      this.database.setCachedJson(cacheKey, combined, EPISODE_CACHE_TTL_MS)
    }
    return combined
  }

  getOverride(showId: string, translationType: TranslationType): SkipSegment[] {
    return this.database.getCachedJson<SkipSegment[]>(getOverrideKey(showId, translationType)) ?? []
  }

  setOverride(showId: string, translationType: TranslationType, segments: SkipSegment[]): SkipSegment[] {
    const normalized = normalizeSegments(segments)
    this.database.setCachedJson(getOverrideKey(showId, translationType), normalized, OVERRIDE_CACHE_TTL_MS)
    return normalized
  }

  private async loadSubtitleCues(input: LocalSkipInput): Promise<SubtitleCue[]> {
    if (!input.subtitleUrl) {
      return []
    }

    try {
      const response = await fetch(input.subtitleUrl, {
        headers: {
          ...input.headers,
          Accept: 'text/vtt, application/x-subrip, text/plain;q=0.9, */*;q=0.2',
        },
      })

      if (!response.ok) {
        return []
      }

      const text = await response.text()
      return parseSubtitleCues(text, input.subtitleMimeType)
    } catch {
      return []
    }
  }

  private async estimateDuration(input: LocalSkipInput, cues: SubtitleCue[]): Promise<number> {
    const cueDuration = cues.reduce((max, cue) => Math.max(max, cue.end), 0)
    const cachedDuration = this.database.getCachedJson<number>(getDurationCacheKey(input.showId, input.translationType, input.episodeNumber))
    if (cachedDuration && cachedDuration > 0) {
      return Math.max(cachedDuration, cueDuration)
    }

    const probeDuration = this.options.probeDuration ?? probeMediaDuration
    const probed = await probeDuration({ url: input.streamUrl, headers: input.headers })
    if (probed && probed > 0) {
      this.database.setCachedJson(getDurationCacheKey(input.showId, input.translationType, input.episodeNumber), probed, EPISODE_CACHE_TTL_MS)
      return Math.max(probed, cueDuration)
    }

    return cueDuration
  }

  private async detectRepeatedSegments(input: LocalSkipInput, duration: number): Promise<SkipSegment[]> {
    if (!input.referenceStreams?.length || duration <= 0) {
      return []
    }

    const sampleFrameHashes = this.options.sampleFrameHashes ?? sampleFrameHashesFromVideo
    const introCurrent = await sampleFrameHashes({
      url: input.streamUrl,
      headers: input.headers,
      startTime: 0,
      duration: INTRO_SAMPLE_WINDOW_SECONDS,
    }).catch(() => [])
    const outroStart = Math.max(0, duration - OUTRO_SAMPLE_WINDOW_SECONDS)
    const outroCurrent = await sampleFrameHashes({
      url: input.streamUrl,
      headers: input.headers,
      startTime: outroStart,
      duration: Math.min(duration, OUTRO_SAMPLE_WINDOW_SECONDS),
    }).catch(() => [])

    let bestIntro: SkipSegment | null = null
    let bestOutro: SkipSegment | null = null

    for (const reference of input.referenceStreams) {
      const referenceDuration = await this.estimateReferenceDuration(input, reference)
      if (referenceDuration <= 0) {
        continue
      }

      if (!bestIntro && introCurrent.length > 0) {
        const introReference = await sampleFrameHashes({
          url: reference.streamUrl,
          headers: reference.headers,
          startTime: 0,
          duration: INTRO_SAMPLE_WINDOW_SECONDS,
        }).catch(() => [])
        bestIntro = inferRepeatedSegment({
          label: 'Skip intro',
          currentHashes: introCurrent,
          referenceHashes: introReference,
          currentWindowStart: 0,
          currentDuration: duration,
          minimumRunSeconds: MIN_INTRO_MATCH_SECONDS,
        })
      }

      if (!bestOutro && outroCurrent.length > 0) {
        const referenceOutroStart = Math.max(0, referenceDuration - OUTRO_SAMPLE_WINDOW_SECONDS)
        const outroReference = await sampleFrameHashes({
          url: reference.streamUrl,
          headers: reference.headers,
          startTime: referenceOutroStart,
          duration: Math.min(referenceDuration, OUTRO_SAMPLE_WINDOW_SECONDS),
        }).catch(() => [])
        bestOutro = inferRepeatedSegment({
          label: 'Skip outro',
          currentHashes: outroCurrent,
          referenceHashes: outroReference,
          currentWindowStart: outroStart,
          currentDuration: duration,
          minimumRunSeconds: MIN_OUTRO_MATCH_SECONDS,
        })
      }

      if (bestIntro && bestOutro) {
        break
      }
    }

    return normalizeSegments([bestIntro, bestOutro].filter((segment): segment is SkipSegment => Boolean(segment)))
  }

  private async estimateReferenceDuration(input: LocalSkipInput, reference: LocalSkipReferenceStream): Promise<number> {
    const cachedDuration = this.database.getCachedJson<number>(
      getDurationCacheKey(input.showId, input.translationType, reference.episodeNumber),
    )
    if (cachedDuration && cachedDuration > 0) {
      return cachedDuration
    }

    const probeDuration = this.options.probeDuration ?? probeMediaDuration
    const probed = await probeDuration({ url: reference.streamUrl, headers: reference.headers })
    if (probed && probed > 0) {
      this.database.setCachedJson(
        getDurationCacheKey(input.showId, input.translationType, reference.episodeNumber),
        probed,
        EPISODE_CACHE_TTL_MS,
      )
      return probed
    }

    return 0
  }
}

async function probeMediaDuration(input: { url: string; headers: Record<string, string> }): Promise<number | null> {
  const headerLines = buildHeaderLines(input.headers)

  try {
    const result = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        ...(headerLines ? ['-headers', `${headerLines}\r\n`] : []),
        input.url,
      ],
      { timeout: MEDIA_PROBE_TIMEOUT_MS },
    )
    const value = Number.parseFloat(result.stdout.trim())
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

async function sampleFrameHashesFromVideo(input: {
  url: string
  headers: Record<string, string>
  startTime: number
  duration: number
}): Promise<bigint[]> {
  const headerLines = buildHeaderLines(input.headers)

  try {
    const result = await execFileAsync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-ss',
        `${Math.max(0, input.startTime)}`,
        ...(headerLines ? ['-headers', `${headerLines}\r\n`] : []),
        '-i',
        input.url,
        '-t',
        `${Math.max(1, input.duration)}`,
        '-vf',
        'fps=1,scale=8:8:flags=area,format=gray',
        '-f',
        'rawvideo',
        'pipe:1',
      ],
      {
        encoding: 'buffer',
        maxBuffer: 1024 * 1024 * 4,
        timeout: FRAME_SAMPLE_TIMEOUT_MS,
      },
    )

    const frames = result.stdout instanceof Buffer ? result.stdout : Buffer.from(result.stdout)
    const hashes: bigint[] = []
    for (let offset = 0; offset + 64 <= frames.length; offset += 64) {
      hashes.push(computeAverageHash(frames.subarray(offset, offset + 64)))
    }
    return hashes
  } catch {
    return []
  }
}

function buildHeaderLines(headers: Record<string, string>) {
  return Object.entries({
    ...headers,
    'User-Agent': headers['User-Agent'] ?? 'Mozilla/5.0',
  })
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n')
}

function parseSubtitleCues(text: string, mimeType: string | null): SubtitleCue[] {
  const normalizedMimeType = mimeType?.toLowerCase() ?? ''
  if (normalizedMimeType.includes('ssa') || normalizedMimeType.includes('ass')) {
    return parseAssCues(text)
  }

  if (normalizedMimeType.includes('subrip') || normalizedMimeType.includes('srt')) {
    return parseTimedTextCues(text, /(\d{1,2}:\d{2}:\d{2},\d{2,3})\s+-->\s+(\d{1,2}:\d{2}:\d{2},\d{2,3})/)
  }

  return parseTimedTextCues(text, /(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{2,3})?)\s+-->\s+(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{2,3})?)/)
}

function parseTimedTextCues(text: string, timestampPattern: RegExp): SubtitleCue[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const cues: SubtitleCue[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ''
    const match = line.match(timestampPattern)
    if (!match) {
      continue
    }

    const start = parseTimestamp(match[1] ?? '')
    const end = parseTimestamp(match[2] ?? '')
    if (start === null || end === null || end <= start) {
      continue
    }

    const cueLines: string[] = []
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const cueLine = lines[nextIndex] ?? ''
      if (!cueLine.trim()) {
        index = nextIndex
        break
      }
      cueLines.push(cueLine)
      if (nextIndex === lines.length - 1) {
        index = nextIndex
      }
    }

    const textValue = cleanSubtitleText(cueLines.join(' '))
    if (!textValue) {
      continue
    }

    cues.push({ start, end, text: textValue })
  }

  return cues
}

function parseAssCues(text: string): SubtitleCue[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Dialogue:'))
    .map((line) => {
      const parts = line.split(',', 10)
      if (parts.length < 10) {
        return null
      }

      const start = parseTimestamp(parts[1] ?? '')
      const end = parseTimestamp(parts[2] ?? '')
      if (start === null || end === null || end <= start) {
        return null
      }

      const textValue = cleanSubtitleText(parts.slice(9).join(','))
      if (!textValue) {
        return null
      }

      return { start, end, text: textValue }
    })
    .filter((cue): cue is SubtitleCue => Boolean(cue))
}

function parseTimestamp(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length !== 3) {
    return null
  }

  const hours = Number.parseInt(parts[0] ?? '', 10)
  const minutes = Number.parseInt(parts[1] ?? '', 10)
  const seconds = Number.parseFloat(parts[2] ?? '')
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null
  }

  return hours * 3600 + minutes * 60 + seconds
}

function cleanSubtitleText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\\N/gi, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferRepeatedSegment(input: {
  label: string
  currentHashes: bigint[]
  referenceHashes: bigint[]
  currentWindowStart: number
  currentDuration: number
  minimumRunSeconds: number
}): SkipSegment | null {
  if (input.currentHashes.length === 0 || input.referenceHashes.length === 0) {
    return null
  }

  const bestMatch = findBestFrameRun(input.currentHashes, input.referenceHashes)
  if (!bestMatch || bestMatch.runLength < input.minimumRunSeconds) {
    return null
  }

  const startTime = input.currentWindowStart + bestMatch.startCurrent
  let endTime = startTime + bestMatch.runLength

  if (input.label === 'Skip intro' && startTime <= 10) {
    return {
      label: input.label,
      startTime: 0,
      endTime,
    }
  }

  if (input.label === 'Skip outro' && input.currentDuration - endTime <= 30) {
    endTime = input.currentDuration
  }

  return {
    label: input.label,
    startTime,
    endTime,
  }
}

function findBestFrameRun(currentHashes: bigint[], referenceHashes: bigint[]) {
  let best: { runLength: number; startCurrent: number } | null = null

  for (let offset = -MAX_ALIGNMENT_OFFSET_SECONDS; offset <= MAX_ALIGNMENT_OFFSET_SECONDS; offset += 1) {
    let runLength = 0

    for (let currentIndex = 0; currentIndex < currentHashes.length; currentIndex += 1) {
      const referenceIndex = currentIndex + offset
      if (referenceIndex < 0 || referenceIndex >= referenceHashes.length) {
        runLength = 0
        continue
      }

      if (getHammingDistance(currentHashes[currentIndex], referenceHashes[referenceIndex]) <= FRAME_MATCH_THRESHOLD) {
        runLength += 1
        if (!best || runLength > best.runLength) {
          best = {
            runLength,
            startCurrent: currentIndex - runLength + 1,
          }
        }
      } else {
        runLength = 0
      }
    }
  }

  return best
}

function computeAverageHash(frame: Uint8Array): bigint {
  const average = frame.reduce((sum, value) => sum + value, 0) / frame.length
  let hash = 0n

  for (let index = 0; index < frame.length; index += 1) {
    if (frame[index] >= average) {
      hash |= 1n << BigInt(index)
    }
  }

  return hash
}

function getHammingDistance(left: bigint, right: bigint): number {
  let value = left ^ right
  let count = 0

  while (value > 0n) {
    count += Number(value & 1n)
    value >>= 1n
  }

  return count
}

function inferSegmentsFromSubtitles(cues: SubtitleCue[], totalDuration: number): SkipSegment[] {
  const dialogueCues = cues.filter((cue) => !isLikelyNonDialogueCue(cue.text))
  if (dialogueCues.length === 0) {
    return []
  }

  const clusters = buildCueClusters(dialogueCues)
  const segments: SkipSegment[] = []
  const intro = inferIntroSegment(clusters)
  if (intro) {
    segments.push(intro)
  }

  const outro = inferOutroSegment(clusters, totalDuration)
  if (outro) {
    segments.push(outro)
  }

  return normalizeSegments(segments)
}

function buildCueClusters(cues: SubtitleCue[], maxGapSeconds = 8): CueCluster[] {
  if (cues.length === 0) {
    return []
  }

  const clusters: CueCluster[] = []
  let current: CueCluster = {
    start: cues[0].start,
    end: cues[0].end,
    cueCount: 1,
  }

  for (let index = 1; index < cues.length; index += 1) {
    const cue = cues[index]
    if (cue.start - current.end <= maxGapSeconds) {
      current.end = cue.end
      current.cueCount += 1
      continue
    }

    clusters.push(current)
    current = {
      start: cue.start,
      end: cue.end,
      cueCount: 1,
    }
  }

  clusters.push(current)
  return clusters
}

function inferIntroSegment(clusters: CueCluster[]): SkipSegment | null {
  const earlyClusters = clusters.filter((cluster) => cluster.start <= 210)
  if (earlyClusters.length === 0) {
    return null
  }

  const firstCluster = earlyClusters[0]
  if (firstCluster.start >= 55 && firstCluster.start <= 210) {
    return {
      label: 'Skip intro',
      startTime: 0,
      endTime: firstCluster.start,
    }
  }

  const secondCluster = earlyClusters[1]
  if (
    firstCluster.end <= 60 &&
    secondCluster &&
    secondCluster.start - firstCluster.end >= 30 &&
    secondCluster.start <= 210
  ) {
    return {
      label: 'Skip intro',
      startTime: firstCluster.end,
      endTime: secondCluster.start,
    }
  }

  return null
}

function inferOutroSegment(clusters: CueCluster[], totalDuration: number): SkipSegment | null {
  if (!Number.isFinite(totalDuration) || totalDuration < 600 || clusters.length === 0) {
    return null
  }

  const lastCluster = clusters[clusters.length - 1]
  const previousCluster = clusters.length > 1 ? clusters[clusters.length - 2] : null
  const endingGap = totalDuration - lastCluster.end

  if (
    previousCluster &&
    lastCluster.cueCount <= 2 &&
    lastCluster.end - lastCluster.start <= 30 &&
    lastCluster.start - previousCluster.end >= 25 &&
    previousCluster.end >= totalDuration * 0.55
  ) {
    return {
      label: 'Skip outro',
      startTime: previousCluster.end,
      endTime: totalDuration,
    }
  }

  if (lastCluster.end >= totalDuration * 0.6 && endingGap >= 45 && endingGap <= 240) {
    return {
      label: 'Skip outro',
      startTime: lastCluster.end,
      endTime: totalDuration,
    }
  }

  return null
}

function isLikelyNonDialogueCue(text: string): boolean {
  const normalized = text.toLowerCase()
  return /♪|karaoke|opening theme|ending theme|\(music\)|\[music\]|\[applause\]|\[singing\]/.test(normalized)
}

function buildSeasonProfile(segments: SkipSegment[], duration: number): SeasonSkipProfile | null {
  if (!Number.isFinite(duration) || duration <= 0 || segments.length === 0) {
    return null
  }

  const profileSegments = normalizeSegments(segments).map((segment) => ({
    label: segment.label,
    startTime: segment.startTime,
    endTime: segment.endTime,
    startRatio: segment.startTime / duration,
    endRatio: segment.endTime / duration,
  }))

  return {
    durationSeconds: duration,
    segments: profileSegments,
  }
}

function materializeSeasonProfile(profile: SeasonSkipProfile | null, duration: number): SkipSegment[] {
  if (!profile || profile.segments.length === 0) {
    return []
  }

  return normalizeSegments(
    profile.segments.map((segment) => {
      if (Number.isFinite(duration) && duration > 0) {
        return {
          label: segment.label,
          startTime:
            profile.durationSeconds && Math.abs(profile.durationSeconds - duration) <= 60
              ? segment.startTime
              : Math.max(0, (segment.startRatio ?? 0) * duration),
          endTime:
            profile.durationSeconds && Math.abs(profile.durationSeconds - duration) <= 60
              ? segment.endTime
              : Math.max(0, (segment.endRatio ?? 0) * duration),
        }
      }

      return {
        label: segment.label,
        startTime: segment.startTime,
        endTime: segment.endTime,
      }
    }),
  )
}

function mergeSkipSegments(primary: SkipSegment[], fallback: SkipSegment[]): SkipSegment[] {
  const byLabel = new Map<string, SkipSegment>()

  for (const segment of normalizeSegments(primary)) {
    byLabel.set(segment.label, segment)
  }

  for (const segment of normalizeSegments(fallback)) {
    if (!byLabel.has(segment.label)) {
      byLabel.set(segment.label, segment)
    }
  }

  return [...byLabel.values()].sort((left, right) => left.startTime - right.startTime)
}

function missingSkipLabel(segments: SkipSegment[], label: string) {
  return !segments.some((segment) => segment.label.toLowerCase() === label.toLowerCase())
}

function normalizeSegments(segments: SkipSegment[]): SkipSegment[] {
  return segments
    .filter((segment) => segment.endTime > segment.startTime)
    .map((segment) => ({
      label: segment.label,
      startTime: Math.max(0, roundSeconds(segment.startTime)),
      endTime: Math.max(0, roundSeconds(segment.endTime)),
    }))
    .filter((segment) => segment.endTime - segment.startTime >= 15)
}

function roundSeconds(value: number): number {
  return Math.round(value * 10) / 10
}

function getEpisodeCacheKey(showId: string, translationType: TranslationType, episodeNumber: string) {
  return `localskip:v3:episode:${showId}:${translationType}:${episodeNumber}`
}

function getDurationCacheKey(showId: string, translationType: TranslationType, episodeNumber: string) {
  return `localskip:v2:duration:${showId}:${translationType}:${episodeNumber}`
}

function getSeasonProfileKey(showId: string, translationType: TranslationType) {
  return `localskip:v2:season:${showId}:${translationType}`
}

function getOverrideKey(showId: string, translationType: TranslationType) {
  return `localskip:v2:override:${showId}:${translationType}`
}
