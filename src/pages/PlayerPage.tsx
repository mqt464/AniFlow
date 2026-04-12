import {
  ArrowLeft,
  Bug,
  Captions,
  FastForward,
  List,
  LoaderCircle,
  Maximize,
  Minimize,
  PictureInPicture2,
  Settings2,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import Hls from 'hls.js'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { translationTypes, type ResolvedStream, type ShowPagePayload, type TranslationType } from '../../shared/contracts'
import { PosterImage } from '../components/PosterImage'
import { ApiError, createApi } from '../lib/api'
import { readStoredSkipDebugPreference, resolveTranslationType, withMode, writeStoredSkipDebugPreference } from '../lib/appPreferences'
import { useSession } from '../session'

const CONTROL_IDLE_MS = 2200
const SEEK_INTERVAL_SECONDS = 10
const EPISODES_PER_RANGE = 50
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const
const BACKGROUND_REQUEST_COOLDOWN_MS = 30_000
const AUTO_SKIP_DELAY_SECONDS = 3
const SKIP_PROMPT_MAX_SECONDS = 10
const SKIP_PROMPT_EXIT_ANIMATION_MS = 180
const SCRUBBER_PREVIEW_SEEK_DELAY_MS = 50
const SCRUBBER_PREVIEW_FRAME_TOLERANCE_SECONDS = 0.18
const EPISODE_COMPLETION_THRESHOLD = 0.93
const PLAYER_PROGRESS_STORAGE_KEY_PREFIX = 'aniflow-player-progress'
const LOCAL_PROGRESS_WRITE_GRANULARITY_SECONDS = 1
const PLAYBACK_REFRESH_COOLDOWN_MS = 2_000

export function PlayerPage() {
  const { showId = '', episodeNumber = '' } = useParams()
  const {
    password,
    preferredTranslationType,
    autoNextEnabled,
    setAutoNextEnabled,
    autoSkipSegmentsEnabled,
    setAutoSkipSegmentsEnabled,
  } = useSession()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const playerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const settingsMenuRef = useRef<HTMLDivElement | null>(null)
  const hideControlsTimerRef = useRef<number | null>(null)
  const pendingSeekTimeRef = useRef<number | null>(null)
  const skipPromptExitTimerRef = useRef<number | null>(null)
  const previewSeekTimerRef = useRef<number | null>(null)
  const previewSourceReadyRef = useRef(false)
  const pendingPreviewTimeRef = useRef<number | null>(null)
  const resumePlaybackRef = useRef(false)
  const backgroundRequestBlockedUntilRef = useRef(0)
  const backgroundedWhilePlayingRef = useRef(false)
  const playbackRefreshInFlightRef = useRef(false)
  const lastPlaybackRefreshAtRef = useRef(0)
  const lastLocalProgressSecondRef = useRef(-1)
  const lastVolumeRef = useRef(1)
  const persistProgressSnapshotRef = useRef<
    (completed: boolean, options?: { keepalive?: boolean; advanceToEpisodeNumber?: string | null }) => void
  >(() => undefined)
  const recoverPlaybackStateRef = useRef<(shouldResumePlayback: boolean) => void>(() => undefined)
  const [stream, setStream] = useState<ResolvedStream | null>(null)
  const [showPage, setShowPage] = useState<ShowPagePayload | null>(null)
  const [showPageLoading, setShowPageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [videoReady, setVideoReady] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [availableTextTrackCount, setAvailableTextTrackCount] = useState(0)
  const [captionsEnabled, setCaptionsEnabled] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isInPictureInPicture, setIsInPictureInPicture] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false)
  const [showRemainingTime, setShowRemainingTime] = useState(false)
  const [selectedQualityId, setSelectedQualityId] = useState<string | null>(null)
  const [selectedRangeKey, setSelectedRangeKey] = useState('all')
  const [dismissedSkipSegmentKey, setDismissedSkipSegmentKey] = useState<string | null>(null)
  const [renderedSkipSegment, setRenderedSkipSegment] = useState<ResolvedStream['skipSegments'][number] | null>(null)
  const [skipPromptPhase, setSkipPromptPhase] = useState<'hidden' | 'entering' | 'visible' | 'exiting'>('hidden')
  const [skipPromptStartedAt, setSkipPromptStartedAt] = useState<number | null>(null)
  const [scrubberPreview, setScrubberPreview] = useState<{ left: number; time: number; visible: boolean }>({
    left: 0,
    time: 0,
    visible: false,
  })
  const [scrubberPreviewFrameReady, setScrubberPreviewFrameReady] = useState(false)
  const [volumeTooltipVisible, setVolumeTooltipVisible] = useState(false)
  const [availableTranslations, setAvailableTranslations] = useState<Record<TranslationType, boolean>>({
    sub: true,
    dub: true,
  })
  const translationType = resolveTranslationType(searchParams.get('mode'), preferredTranslationType)
  const [skipDebugEnabled, setSkipDebugEnabled] = useState(() => {
    const storedPreference = readStoredSkipDebugPreference()
    return storedPreference ?? searchParams.get('debug') === 'skip'
  })
  const [playbackRefreshToken, setPlaybackRefreshToken] = useState(0)
  const episodes = showPage?.episodes ?? []
  const currentEpisodeDetails = episodes.find((episode) => episode.number === episodeNumber) ?? null
  const explicitResumeAt = parseSeekValue(searchParams.get('t'))
  const initialLocalResumeSnapshot = useMemo(() => readPlayerProgressSnapshot(showId, episodeNumber), [episodeNumber, showId])
  const resumeAt = selectResumeTime(explicitResumeAt, initialLocalResumeSnapshot, currentEpisodeDetails?.progress ?? null)
  const activeQuality = stream?.qualities.find((quality) => quality.id === selectedQualityId) ?? stream?.qualities[0] ?? null
  const streamQualityKey = stream?.qualities.map((quality) => `${quality.id}:${quality.proxyUrl}`).join('|') ?? ''
  const streamConfigurationKey = stream
    ? [
        stream.showId,
        stream.episodeNumber,
        stream.translationType,
        stream.streamUrl,
        stream.mimeType,
        stream.subtitleUrl ?? '',
        streamQualityKey,
      ].join('|')
    : null
  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const bufferedPercent = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0
  const displayedVolume = isMuted ? 0 : volume
  const volumePercent = Math.round(displayedVolume * 100)
  const captionsAvailable = Boolean(stream?.subtitleUrl) || availableTextTrackCount > 0
  const pictureInPictureSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled
  const nextEpisodeDetails =
    stream?.nextEpisodeNumber ? episodes.find((episode) => episode.number === stream.nextEpisodeNumber) ?? null : null
  const episodeRanges = useMemo(() => buildEpisodeRanges(episodes), [episodes])
  const activeRange = episodeRanges.find((range) => range.key === selectedRangeKey) ?? episodeRanges[0] ?? null
  const visibleEpisodes = activeRange
    ? episodes.filter((episode) => activeRange.episodeNumbers.has(episode.number))
    : episodes
  const finishesShow = shouldMarkShowCompleted(episodes, episodeNumber)
  const resolvedSkipSegments = useMemo(
    () => normalizeSkipSegmentsForDuration(stream?.skipSegments ?? [], duration),
    [duration, stream?.skipSegments],
  )
  const normalizedSkipDebug = useMemo(() => {
    if (!stream?.skipDebug) {
      return null
    }

    return {
      rawAniSkipSegments: normalizeSkipSegmentsForDuration(stream.skipDebug.rawAniSkipSegments, duration),
      rawLocalSegments: normalizeSkipSegmentsForDuration(stream.skipDebug.rawLocalSegments, duration),
      mergedSegments: normalizeSkipSegmentsForDuration(stream.skipDebug.mergedSegments, duration),
    }
  }, [duration, stream?.skipDebug])

  useEffect(() => {
    if (!skipDebugEnabled || !stream?.skipDebug) {
      return
    }

    console.debug('[AniFlow skip debug]', {
      showId,
      episodeNumber,
      mediaDuration: duration,
      raw: stream.skipDebug,
      normalized: normalizedSkipDebug,
    })
  }, [duration, episodeNumber, normalizedSkipDebug, showId, skipDebugEnabled, stream?.skipDebug])

  const requestPlaybackRefresh = (shouldResumePlayback: boolean) => {
    const now = Date.now()
    if (playbackRefreshInFlightRef.current || now - lastPlaybackRefreshAtRef.current < PLAYBACK_REFRESH_COOLDOWN_MS) {
      return
    }

    const video = videoRef.current
    playbackRefreshInFlightRef.current = true
    lastPlaybackRefreshAtRef.current = now
    pendingSeekTimeRef.current = video?.currentTime ?? currentTime ?? null
    resumePlaybackRef.current = shouldResumePlayback
    setVideoReady(false)
    setError(null)
    setPlaybackRefreshToken((value) => value + 1)
  }

  const buildProgressSnapshot = (completed: boolean, advanceToEpisodeNumber?: string | null) => {
    const video = videoRef.current
    if (!video || !stream) {
      return null
    }

    const safeDuration = Number.isFinite(video.duration) ? video.duration : duration
    const isAdvancingToLaterEpisode =
      parseEpisodeValue(advanceToEpisodeNumber) > parseEpisodeValue(episodeNumber)
    const shouldMarkCompleted =
      completed || isAdvancingToLaterEpisode || shouldTreatEpisodeAsCompleted(video.currentTime, safeDuration)
    return {
      showId,
      episodeNumber,
      title: stream.showTitle,
      posterUrl: showPage?.show.posterUrl ?? null,
      currentTime: shouldMarkCompleted ? safeDuration : video.currentTime,
      duration: safeDuration,
      completed: shouldMarkCompleted,
      advanceToEpisodeNumber: isAdvancingToLaterEpisode ? advanceToEpisodeNumber : undefined,
    }
  }

  const persistProgressSnapshot = (
    completed: boolean,
    options: { keepalive?: boolean; advanceToEpisodeNumber?: string | null } = {},
  ) => {
    const snapshot = buildProgressSnapshot(completed, options.advanceToEpisodeNumber)
    if (!snapshot) {
      return
    }

    writePlayerProgressSnapshot({
      showId: snapshot.showId,
      episodeNumber: snapshot.episodeNumber,
      currentTime: snapshot.currentTime,
      duration: snapshot.duration,
      completed: snapshot.completed,
      updatedAt: Date.now(),
    })

    if (Date.now() < backgroundRequestBlockedUntilRef.current) {
      return
    }

    const api = createApi(password)
    void api
      .saveProgress(snapshot, options)
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.status >= 500) {
          backgroundRequestBlockedUntilRef.current = Date.now() + BACKGROUND_REQUEST_COOLDOWN_MS
        }
      })

    if (snapshot.completed && finishesShow) {
      void api
        .updateLibrary({
          showId,
          title: stream.showTitle,
          posterUrl: showPage?.show.posterUrl ?? null,
          completed: true,
        }, options)
        .catch((reason: unknown) => {
          if (reason instanceof ApiError && reason.status >= 500) {
            backgroundRequestBlockedUntilRef.current = Date.now() + BACKGROUND_REQUEST_COOLDOWN_MS
          }
        })
    }
  }

  const recoverPlaybackState = (shouldResumePlayback: boolean) => {
    const video = videoRef.current
    if (!video || !stream) {
      return
    }

    const shouldRecoverSource =
      Boolean(video.error) ||
      !video.currentSrc ||
      video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
      (shouldResumePlayback && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)

    if (shouldRecoverSource) {
      requestPlaybackRefresh(shouldResumePlayback)
      return
    }

    if (!shouldResumePlayback || !video.paused || document.pictureInPictureElement === video) {
      return
    }

    void video.play().catch(() => {
      requestPlaybackRefresh(true)
    })
  }

  persistProgressSnapshotRef.current = persistProgressSnapshot
  recoverPlaybackStateRef.current = recoverPlaybackState

  useEffect(() => {
    const api = createApi(password)
    let active = true
    const isPlaybackRefresh = playbackRefreshInFlightRef.current

    if (!isPlaybackRefresh) {
      resumePlaybackRef.current = true
      setStream(null)
      setCurrentTime(0)
      setDuration(0)
      setBufferedEnd(0)
      setControlsVisible(true)
      setIsPlaying(false)
      setSettingsOpen(false)
      setEpisodePickerOpen(false)
    }

    setError(null)
    setVideoReady(false)
    lastLocalProgressSecondRef.current = -1

    void api
      .resolvePlayback({ showId, episodeNumber, translationType, debugSkip: skipDebugEnabled })
      .then((resolved) => {
        if (!active) {
          return
        }

        playbackRefreshInFlightRef.current = false
        setStream(resolved)
      })
      .catch((reason: unknown) => {
        if (!active) {
          return
        }

        playbackRefreshInFlightRef.current = false
        setError(reason instanceof ApiError ? reason.message : 'Unable to resolve this stream right now')
      })

    return () => {
      active = false
    }
  }, [episodeNumber, password, playbackRefreshToken, showId, skipDebugEnabled, translationType])

  useEffect(() => {
    const api = createApi(password)
    let active = true

    setShowPage(null)
    setShowPageLoading(true)

    void api
      .getShowPage(showId, translationType)
      .then((value) => {
        if (!active) {
          return
        }

        setShowPage(value)
      })
      .catch(() => {
        if (!active) {
          return
        }

        setShowPage(null)
      })
      .finally(() => {
        if (active) {
          setShowPageLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [password, showId, translationType])

  useEffect(() => {
    const api = createApi(password)
    let active = true

    setAvailableTranslations({ sub: true, dub: true })

    void Promise.all(
      translationTypes.map(async (mode) => {
        try {
          const response = await api.getEpisodes(showId, mode)
          return [mode, response.episodes.some((episode) => episode.number === episodeNumber)] as const
        } catch {
          return [mode, mode === translationType] as const
        }
      }),
    ).then((entries) => {
      if (!active) {
        return
      }

      setAvailableTranslations({
        sub: entries.find(([mode]) => mode === 'sub')?.[1] ?? translationType === 'sub',
        dub: entries.find(([mode]) => mode === 'dub')?.[1] ?? translationType === 'dub',
      })
    })

    return () => {
      active = false
    }
  }, [episodeNumber, password, showId, translationType])

  useEffect(() => {
    setSelectedQualityId((previous) => {
      if (!stream) {
        return null
      }

      if (previous && stream.qualities.some((quality) => quality.id === previous)) {
        return previous
      }

      return stream.qualities[0]?.id ?? null
    })
    setAvailableTextTrackCount(0)
    setCaptionsEnabled(true)
    setVideoReady(false)
  }, [streamConfigurationKey])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) {
      return
    }

    const sourceUrl = activeQuality?.proxyUrl ?? stream.streamUrl
    const initialRestoreTime = pendingSeekTimeRef.current ?? resumeAt
    const shouldResumePlayback = resumePlaybackRef.current
    let restoreApplied = false

    const syncReadyState = () => {
      setVideoReady(true)
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
      if (!restoreApplied && initialRestoreTime !== null) {
        const maxSeekTime = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.25) : initialRestoreTime
        const nextTime = Math.min(Math.max(initialRestoreTime, 0), maxSeekTime)
        video.currentTime = nextTime
        setCurrentTime(nextTime)
        pendingSeekTimeRef.current = null
        restoreApplied = true
      }

      if (shouldResumePlayback) {
        void video.play().catch(() => undefined)
      }
    }

    const cleanup = attachVideoSource(video, sourceUrl, stream.mimeType)

    video.addEventListener('loadedmetadata', syncReadyState)
    video.addEventListener('canplay', syncReadyState, { once: true })

    return () => {
      video.removeEventListener('loadedmetadata', syncReadyState)
      video.removeEventListener('canplay', syncReadyState)
      cleanup()
    }
  }, [activeQuality?.proxyUrl, resumeAt, stream?.episodeNumber, stream?.mimeType, stream?.showId, stream?.streamUrl, stream?.translationType])

  useEffect(() => {
    const previewVideo = previewVideoRef.current
    if (!previewVideo || !stream) {
      return
    }

    const sourceUrl = activeQuality?.proxyUrl ?? stream.streamUrl
    previewSourceReadyRef.current = false
    setScrubberPreviewFrameReady(false)

    const handleSourceReady = () => {
      previewSourceReadyRef.current = true
      if (pendingPreviewTimeRef.current !== null) {
        schedulePreviewSeek(pendingPreviewTimeRef.current, previewVideoRef, previewSourceReadyRef, previewSeekTimerRef, drawPreviewFrame)
      }
    }

    const handleSeeked = () => {
      drawPreviewFrame()
    }

    const cleanup = attachVideoSource(previewVideo, sourceUrl, stream.mimeType)
    previewVideo.muted = true
    previewVideo.defaultMuted = true
    previewVideo.playsInline = true

    previewVideo.addEventListener('loadedmetadata', handleSourceReady)
    previewVideo.addEventListener('canplay', handleSourceReady)
    previewVideo.addEventListener('seeked', handleSeeked)

    return () => {
      previewSourceReadyRef.current = false
      clearTimer(previewSeekTimerRef)
      previewVideo.removeEventListener('loadedmetadata', handleSourceReady)
      previewVideo.removeEventListener('canplay', handleSourceReady)
      previewVideo.removeEventListener('seeked', handleSeeked)
      cleanup()
    }
  }, [activeQuality?.proxyUrl, stream?.episodeNumber, stream?.showId, stream?.streamUrl, stream?.translationType])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    video.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    video.muted = isMuted
    if (!isMuted) {
      video.volume = volume
    }
  }, [isMuted, volume])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) {
      return
    }

    const api = createApi(password)
    let lastPersist = video.currentTime

    const runBackgroundRequest = (task: Promise<unknown>) => {
      void task.catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.status >= 500) {
          backgroundRequestBlockedUntilRef.current = Date.now() + BACKGROUND_REQUEST_COOLDOWN_MS
        }
      })
    }

    const persistProgress = (completed: boolean) => {
      if (Date.now() < backgroundRequestBlockedUntilRef.current) {
        return
      }

      const safeDuration = Number.isFinite(video.duration) ? video.duration : duration
      runBackgroundRequest(api.saveProgress({
        showId,
        episodeNumber,
        title: stream.showTitle,
        posterUrl: showPage?.show.posterUrl ?? null,
        currentTime: completed || shouldTreatEpisodeAsCompleted(video.currentTime, safeDuration) ? safeDuration : video.currentTime,
        duration: safeDuration,
        completed: completed || shouldTreatEpisodeAsCompleted(video.currentTime, safeDuration),
      }))
    }

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime)
      const currentSecond = Math.floor(video.currentTime)
      if (
        lastLocalProgressSecondRef.current < 0 ||
        Math.abs(currentSecond - lastLocalProgressSecondRef.current) >= LOCAL_PROGRESS_WRITE_GRANULARITY_SECONDS
      ) {
        lastLocalProgressSecondRef.current = currentSecond
        writePlayerProgressSnapshot({
          showId,
          episodeNumber,
          currentTime: video.currentTime,
          duration: Number.isFinite(video.duration) ? video.duration : duration,
          completed: false,
          updatedAt: Date.now(),
        })
      }

      if (video.currentTime - lastPersist < 10) {
        return
      }

      lastPersist = video.currentTime
      persistProgress(false)
    }

    const onEnded = () => {
      setCurrentTime(Number.isFinite(video.duration) ? video.duration : 0)
      setIsPlaying(false)
      setControlsVisible(true)
      clearHideTimer(hideControlsTimerRef)
      writePlayerProgressSnapshot({
        showId,
        episodeNumber,
        currentTime: Number.isFinite(video.duration) ? video.duration : duration,
        duration: Number.isFinite(video.duration) ? video.duration : duration,
        completed: true,
        updatedAt: Date.now(),
      })
      persistProgress(true)

      if (finishesShow) {
        runBackgroundRequest(api.updateLibrary({
          showId,
          title: stream.showTitle,
          posterUrl: showPage?.show.posterUrl ?? null,
          completed: true,
        }))
      }

      if (autoNextEnabled && stream.nextEpisodeNumber) {
        navigate(`/player/${showId}/${stream.nextEpisodeNumber}?mode=${translationType}`)
      }
    }

    const onPlay = () => {
      setIsPlaying(true)
      revealControls(hideControlsTimerRef, setControlsVisible, video)
    }

    const onPause = () => {
      setIsPlaying(false)
      setControlsVisible(true)
      clearHideTimer(hideControlsTimerRef)
      persistProgressSnapshotRef.current(false)
    }

    const onDurationChange = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
    }

    const onProgress = () => {
      if (video.buffered.length === 0) {
        setBufferedEnd(0)
        return
      }

      setBufferedEnd(video.buffered.end(video.buffered.length - 1))
    }

    const onVolumeChange = () => {
      setVolume(video.volume)
      setIsMuted(video.muted || video.volume === 0)
      if (video.volume > 0) {
        lastVolumeRef.current = video.volume
      }
    }

    const onRateChange = () => {
      setPlaybackRate(video.playbackRate)
    }

    const onEnterPictureInPicture = () => {
      setIsInPictureInPicture(true)
    }

    const onLeavePictureInPicture = () => {
      setIsInPictureInPicture(false)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('progress', onProgress)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('ratechange', onRateChange)
    video.addEventListener('enterpictureinpicture', onEnterPictureInPicture)
    video.addEventListener('leavepictureinpicture', onLeavePictureInPicture)

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('progress', onProgress)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('ratechange', onRateChange)
      video.removeEventListener('enterpictureinpicture', onEnterPictureInPicture)
      video.removeEventListener('leavepictureinpicture', onLeavePictureInPicture)
    }
  }, [
    autoNextEnabled,
    duration,
    episodeNumber,
    finishesShow,
    navigate,
    password,
    showId,
    showPage?.show.posterUrl,
    stream,
    translationType,
  ])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    syncTextTrack(video, captionsEnabled && captionsAvailable)
  }, [captionsAvailable, captionsEnabled])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    const textTracks = video.textTracks
    const syncAvailability = () => {
      setAvailableTextTrackCount(textTracks.length)
      syncTextTrack(video, captionsEnabled)
    }
    const canListenForTrackChanges =
      typeof textTracks.addEventListener === 'function' && typeof textTracks.removeEventListener === 'function'

    syncAvailability()
    if (canListenForTrackChanges) {
      textTracks.addEventListener('addtrack', syncAvailability)
      textTracks.addEventListener('removetrack', syncAvailability)
    }

    return () => {
      if (canListenForTrackChanges) {
        textTracks.removeEventListener('addtrack', syncAvailability)
        textTracks.removeEventListener('removetrack', syncAvailability)
      }
    }
  }, [activeQuality?.proxyUrl, captionsEnabled, stream?.episodeNumber, stream?.showId, stream?.subtitleUrl, stream?.translationType])

  useEffect(() => {
    if (!settingsOpen) {
      return
    }

    setControlsVisible(true)
    clearHideTimer(hideControlsTimerRef)

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && settingsMenuRef.current?.contains(target)) {
        return
      }

      setSettingsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [settingsOpen])

  useEffect(() => {
    if (!episodePickerOpen) {
      return
    }

    setControlsVisible(true)
    clearHideTimer(hideControlsTimerRef)
  }, [episodePickerOpen])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === playerRef.current)
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  useEffect(() => {
    const handlePageHide = () => {
      const video = videoRef.current
      backgroundedWhilePlayingRef.current = Boolean(video && !video.paused && !video.ended)
      persistProgressSnapshotRef.current(false, { keepalive: true })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handlePageHide()
        return
      }

      recoverPlaybackStateRef.current(backgroundedWhilePlayingRef.current)
    }

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted || document.visibilityState === 'visible') {
        recoverPlaybackStateRef.current(backgroundedWhilePlayingRef.current)
      }
    }

    window.addEventListener('beforeunload', handlePageHide)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handlePageHide)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    return () => {
      persistProgressSnapshotRef.current(false, { keepalive: true })
      clearHideTimer(hideControlsTimerRef)
      clearTimer(skipPromptExitTimerRef)
      clearTimer(previewSeekTimerRef)
    }
  }, [])

  useEffect(() => {
    if (!episodeRanges.length) {
      setSelectedRangeKey('all')
      return
    }

    const currentRange = episodeRanges.find((range) => range.episodeNumbers.has(episodeNumber))
    setSelectedRangeKey(currentRange?.key ?? episodeRanges[episodeRanges.length - 1]?.key ?? 'all')
  }, [episodeNumber, episodeRanges])

  const activeSegment =
    resolvedSkipSegments.find(
      (segment) => currentTime >= Math.max(0, segment.startTime - 2) && currentTime < segment.endTime,
    ) ?? null
  const activeSegmentKey = activeSegment ? getSegmentKey(activeSegment.label, activeSegment.startTime, activeSegment.endTime) : null
  const activeSegmentAutoSkippable = activeSegment ? isAutoSkippableSegment(activeSegment.label) : false
  const activeSegmentAutoSkipEnabled = Boolean(activeSegment && activeSegmentAutoSkippable && autoSkipSegmentsEnabled)
  const shouldShowActiveSkipPrompt = Boolean(activeSegment && activeSegmentKey !== dismissedSkipSegmentKey)
  const promptSegment = shouldShowActiveSkipPrompt ? activeSegment : renderedSkipSegment
  const promptSegmentAutoSkipEnabled = Boolean(promptSegment && isAutoSkippableSegment(promptSegment.label) && autoSkipSegmentsEnabled)
  const playerLoading = !error && (!stream || !videoReady)

  useEffect(() => {
    setSkipPromptStartedAt(activeSegment ? currentTime : null)
    setDismissedSkipSegmentKey(null)
  }, [activeSegmentKey])

  useEffect(() => {
    if (!activeSegment || skipPromptStartedAt === null || !activeSegmentAutoSkipEnabled) {
      return
    }

    if (currentTime - skipPromptStartedAt < AUTO_SKIP_DELAY_SECONDS) {
      return
    }

    seekTo(activeSegment.endTime)
  }, [activeSegment, activeSegmentAutoSkipEnabled, currentTime, skipPromptStartedAt])

  useEffect(() => {
    clearTimer(skipPromptExitTimerRef)

    if (shouldShowActiveSkipPrompt && activeSegment) {
      setRenderedSkipSegment(activeSegment)
      setSkipPromptPhase((currentPhase) =>
        currentPhase === 'hidden' || currentPhase === 'exiting' ? 'entering' : currentPhase,
      )
      return
    }

    if (!renderedSkipSegment) {
      setSkipPromptPhase('hidden')
      return
    }

    setSkipPromptPhase('exiting')
    skipPromptExitTimerRef.current = window.setTimeout(() => {
      setRenderedSkipSegment(null)
      setSkipPromptPhase('hidden')
      skipPromptExitTimerRef.current = null
    }, SKIP_PROMPT_EXIT_ANIMATION_MS)
  }, [activeSegment, renderedSkipSegment, shouldShowActiveSkipPrompt])

  useEffect(() => {
    if (!activeSegment || activeSegmentAutoSkipEnabled || skipPromptStartedAt === null) {
      return
    }

    const promptVisibleFor = getSkipPromptVisibleSeconds(activeSegment, skipPromptStartedAt)
    if (currentTime - skipPromptStartedAt < promptVisibleFor) {
      return
    }

    setDismissedSkipSegmentKey(activeSegmentKey)
  }, [activeSegment, activeSegmentAutoSkipEnabled, activeSegmentKey, currentTime, skipPromptStartedAt])

  const drawPreviewFrame = () => {
    const previewVideo = previewVideoRef.current
    const previewCanvas = previewCanvasRef.current
    if (!previewVideo || !previewCanvas || previewVideo.readyState < 2) {
      return
    }

    const canvasContext = previewCanvas.getContext('2d')
    if (!canvasContext || previewVideo.videoWidth === 0 || previewVideo.videoHeight === 0) {
      return
    }

    try {
      drawVideoCover(previewVideo, previewCanvas, canvasContext)
      setScrubberPreviewFrameReady(true)
    } catch {
      setScrubberPreviewFrameReady(false)
    }
  }

  const handlePointerActivity = () => {
    const video = videoRef.current
    if (!video) {
      return
    }

    revealControls(hideControlsTimerRef, setControlsVisible, video)
  }

  const handlePointerLeave = () => {
    clearHideTimer(hideControlsTimerRef)
    if (settingsOpen || episodePickerOpen) {
      return
    }

    if (videoRef.current && !videoRef.current.paused) {
      setControlsVisible(false)
    }
  }

  const seekTo = (nextTime: number) => {
    const video = videoRef.current
    if (!video) {
      return
    }

    const safeDuration = Number.isFinite(video.duration) ? video.duration : duration
    const boundedTime = Math.min(Math.max(nextTime, 0), safeDuration || Math.max(nextTime, 0))
    const targetSegment =
      resolvedSkipSegments.find(
        (segment) => boundedTime >= Math.max(0, segment.startTime - 2) && boundedTime < segment.endTime,
      ) ?? null
    video.currentTime = boundedTime
    setCurrentTime(boundedTime)
    setSkipPromptStartedAt(targetSegment ? boundedTime : null)
    setDismissedSkipSegmentKey(null)
    writePlayerProgressSnapshot({
      showId,
      episodeNumber,
      currentTime: boundedTime,
      duration: safeDuration,
      completed: shouldTreatEpisodeAsCompleted(boundedTime, safeDuration),
      updatedAt: Date.now(),
    })
    handlePointerActivity()
  }

  const updateScrubberPreview = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (duration <= 0) {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0) {
      return
    }

    const relativeX = clamp(event.clientX - bounds.left, 0, bounds.width)
    const previewTime = (relativeX / bounds.width) * duration
    pendingPreviewTimeRef.current = previewTime
    setScrubberPreview({
      left: clamp(relativeX, 84, Math.max(bounds.width - 84, 84)),
      time: previewTime,
      visible: true,
    })
    schedulePreviewSeek(previewTime, previewVideoRef, previewSourceReadyRef, previewSeekTimerRef, drawPreviewFrame)
  }

  const hideScrubberPreview = () => {
    setScrubberPreview((previous) => ({ ...previous, visible: false }))
    clearTimer(previewSeekTimerRef)
  }

  const togglePlayPause = () => {
    const video = videoRef.current
    if (!video) {
      return
    }

    if (video.paused) {
      void video.play().catch(() => {
        requestPlaybackRefresh(true)
      })
    } else {
      video.pause()
    }

    handlePointerActivity()
  }

  const setVideoVolume = (nextVolume: number) => {
    const video = videoRef.current
    if (!video) {
      return
    }

    const boundedVolume = Math.min(Math.max(nextVolume, 0), 1)
    video.muted = boundedVolume === 0
    video.volume = boundedVolume
    setVolume(boundedVolume)
    setIsMuted(boundedVolume === 0)
    if (boundedVolume > 0) {
      lastVolumeRef.current = boundedVolume
    }
    handlePointerActivity()
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) {
      return
    }

    if (video.muted || video.volume === 0) {
      video.muted = false
      video.volume = Math.max(lastVolumeRef.current, 0.1)
    } else {
      video.muted = true
    }

    handlePointerActivity()
  }

  const updatePlaybackRate = (nextRate: number) => {
    setPlaybackRate(nextRate)
    handlePointerActivity()
  }

  const selectQuality = (qualityId: string) => {
    pendingSeekTimeRef.current = videoRef.current?.currentTime ?? currentTime
    resumePlaybackRef.current = Boolean(videoRef.current && !videoRef.current.paused)
    setSelectedQualityId(qualityId)
    setSettingsOpen(false)
    handlePointerActivity()
  }

  const toggleCaptions = () => {
    if (!captionsAvailable) {
      return
    }

    setCaptionsEnabled((previous) => !previous)
    handlePointerActivity()
  }

  const navigateToTranslation = (nextMode: TranslationType) => {
    if (nextMode === translationType || !availableTranslations[nextMode]) {
      return
    }

    persistProgressSnapshot(false)
    setSettingsOpen(false)
    const timeToken = Math.floor(videoRef.current?.currentTime ?? currentTime)
    navigate(`/player/${showId}/${episodeNumber}?mode=${nextMode}${timeToken > 0 ? `&t=${timeToken}` : ''}`)
  }

  const navigateToEpisode = (nextEpisodeNumber: string) => {
    const isAdvancingToLaterEpisode = parseEpisodeValue(nextEpisodeNumber) > parseEpisodeValue(episodeNumber)
    persistProgressSnapshot(false, {
      advanceToEpisodeNumber: isAdvancingToLaterEpisode ? nextEpisodeNumber : null,
    })
    setEpisodePickerOpen(false)
    navigate(`/player/${showId}/${nextEpisodeNumber}?mode=${translationType}`)
  }

  const goToNextEpisode = () => {
    if (!stream?.nextEpisodeNumber) {
      return
    }

    navigateToEpisode(stream.nextEpisodeNumber)
  }

  const goToEpisode = (nextEpisodeNumber: string) => {
    if (nextEpisodeNumber === episodeNumber) {
      setEpisodePickerOpen(false)
      return
    }

    navigateToEpisode(nextEpisodeNumber)
  }

  const toggleFullscreen = async () => {
    const player = playerRef.current
    if (!player) {
      return
    }

    try {
      if (document.fullscreenElement === player) {
        await document.exitFullscreen()
      } else {
        await player.requestFullscreen()
      }
    } catch {
      return
    } finally {
      handlePointerActivity()
    }
  }

  const togglePictureInPicture = async () => {
    const video = videoRef.current
    if (!video || !pictureInPictureSupported) {
      return
    }

    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture()
      } else {
        await video.requestPictureInPicture()
      }
    } catch {
      return
    } finally {
      handlePointerActivity()
    }
  }

  const toggleSettings = () => {
    setEpisodePickerOpen(false)
    setSettingsOpen((previous) => !previous)
    handlePointerActivity()
  }

  const toggleEpisodePicker = () => {
    setSettingsOpen(false)
    setEpisodePickerOpen((previous) => !previous)
    handlePointerActivity()
  }

  const toggleAutoNext = () => {
    setAutoNextEnabled(!autoNextEnabled)
    handlePointerActivity()
  }

  const toggleAutoSkipSegments = () => {
    setAutoSkipSegmentsEnabled(!autoSkipSegmentsEnabled)
    handlePointerActivity()
  }

  const toggleSkipDebug = () => {
    playbackRefreshInFlightRef.current = true
    setSkipDebugEnabled((previous) => {
      const nextValue = !previous
      writeStoredSkipDebugPreference(nextValue)
      return nextValue
    })
    handlePointerActivity()
  }

  const handlePlayerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, a, input')) {
      return
    }

    switch (event.key.toLowerCase()) {
      case ' ':
      case 'k':
        event.preventDefault()
        togglePlayPause()
        break
      case 'arrowleft':
        event.preventDefault()
        seekTo(currentTime - SEEK_INTERVAL_SECONDS)
        break
      case 'arrowright':
        event.preventDefault()
        seekTo(currentTime + SEEK_INTERVAL_SECONDS)
        break
      case 'enter':
        if (!shouldShowActiveSkipPrompt || !activeSegment) {
          break
        }

        event.preventDefault()
        seekTo(activeSegment.endTime)
        break
      case 'f':
        event.preventDefault()
        void toggleFullscreen()
        break
      case 'm':
        event.preventDefault()
        toggleMute()
        break
      case 'c':
        event.preventDefault()
        toggleCaptions()
        break
      case 'escape':
        setSettingsOpen(false)
        setEpisodePickerOpen(false)
        break
      default:
        break
    }
  }

  const skipPromptCountdown = getSkipPromptCountdown(promptSegment, currentTime, skipPromptStartedAt, promptSegmentAutoSkipEnabled)
  const skipPromptMeta = promptSegment
    ? promptSegmentAutoSkipEnabled
      ? `Auto skips in ${formatSecondsCountdown(skipPromptCountdown)}. Press Enter to skip now.`
      : `Disappears in ${formatSecondsCountdown(skipPromptCountdown)}. Press Enter to skip.`
    : ''

  return (
    <section className="page player-page">
      <div className="player-layout">
        <div
          ref={playerRef}
          className={`video-frame custom-player ${controlsVisible ? 'controls-visible' : ''}`}
          onKeyDown={handlePlayerKeyDown}
          onPointerDown={handlePointerActivity}
          onPointerEnter={handlePointerActivity}
          onPointerMove={handlePointerActivity}
          onPointerLeave={handlePointerLeave}
          tabIndex={0}
        >
          <video ref={videoRef} playsInline onClick={togglePlayPause}>
            {stream?.subtitleUrl ? (
              <track default kind="subtitles" label="English" src={stream.subtitleUrl} srcLang="en" />
            ) : null}
          </video>
          <video ref={previewVideoRef} aria-hidden="true" className="player-preview-source" muted playsInline tabIndex={-1} />

          {playerLoading ? (
            <div className="player-status">
              <div className="player-status-card">
                <LoaderCircle className="spin" size={24} strokeWidth={2} />
                <strong>{stream ? 'Buffering episode...' : 'Resolving stream...'}</strong>
                <span>{showPage?.show.title ? `${showPage.show.title} • Episode ${episodeNumber}` : 'Preparing playback and resume state.'}</span>
              </div>
            </div>
          ) : null}
          {error ? (
            <div className="player-status player-status-error">
              <div className="player-status-card">
                <strong>Playback unavailable</strong>
                <span>{error}</span>
              </div>
            </div>
          ) : null}

          {skipDebugEnabled && stream?.skipDebug ? (
            <aside className="player-skip-debug-panel" aria-label="Skip debug">
              <div className="player-skip-debug-head">
                <strong>Skip debug</strong>
                <span>{stream.skipDebug.source}</span>
              </div>
              <div className="player-skip-debug-grid">
                <div>
                  <span className="player-skip-debug-label">Media duration</span>
                  <code>{duration > 0 ? `${duration.toFixed(2)}s` : 'unknown'}</code>
                </div>
                <div>
                  <span className="player-skip-debug-label">Current time</span>
                  <code>{currentTime.toFixed(2)}s</code>
                </div>
                <div>
                  <span className="player-skip-debug-label">Fallback</span>
                  <code>{stream.skipDebug.usedLocalFallback ? 'used' : 'not used'}</code>
                </div>
                <div>
                  <span className="player-skip-debug-label">Missing AniSkip</span>
                  <code>{stream.skipDebug.missingAniSkipLabels.join(', ') || 'none'}</code>
                </div>
              </div>
              <div className="player-skip-debug-section">
                <span className="player-skip-debug-label">Lookup titles</span>
                <code>{stream.skipDebug.lookupTitles.join(' | ')}</code>
              </div>
              <div className="player-skip-debug-section">
                <span className="player-skip-debug-label">AniSkip raw</span>
                <pre>{formatSkipDebugSegments(stream.skipDebug.rawAniSkipSegments)}</pre>
              </div>
              <div className="player-skip-debug-section">
                <span className="player-skip-debug-label">Local raw</span>
                <pre>{formatSkipDebugSegments(stream.skipDebug.rawLocalSegments)}</pre>
              </div>
              <div className="player-skip-debug-section">
                <span className="player-skip-debug-label">Merged raw</span>
                <pre>{formatSkipDebugSegments(stream.skipDebug.mergedSegments)}</pre>
              </div>
              <div className="player-skip-debug-section">
                <span className="player-skip-debug-label">Normalized</span>
                <pre>{formatSkipDebugSegments(normalizedSkipDebug?.mergedSegments ?? [])}</pre>
              </div>
            </aside>
          ) : null}

          <div className="player-overlay player-overlay-top">
            <div className="player-topbar">
              <div className="player-topbar-group">
                <Link
                  aria-label="Back to episodes"
                  className="player-control player-icon-button player-back-button"
                  to={withMode(`/shows/${showId}`, translationType)}
                  onClick={() => persistProgressSnapshot(false)}
                >
                  <ArrowLeft size={16} strokeWidth={1.8} />
                </Link>
                <div className="player-title-block">
                  {showPage?.show.title ?? stream?.showTitle ? (
                    <>
                      <strong>{showPage?.show.title ?? stream?.showTitle ?? 'AniFlow'}</strong>
                      <span>
                        Episode {episodeNumber}
                        {currentEpisodeDetails?.title ? ` • ${currentEpisodeDetails.title}` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="loading-skeleton loading-skeleton-line player-title-skeleton" />
                      <div className="loading-skeleton loading-skeleton-line player-title-skeleton player-title-skeleton-short" />
                    </>
                  )}
                </div>
              </div>

              <div className="player-topbar-group player-topbar-actions">
                <button
                  aria-expanded={episodePickerOpen}
                  aria-label="Open episode picker"
                  className={`player-control player-text-button ${episodePickerOpen ? 'active' : ''}`}
                  type="button"
                  onClick={toggleEpisodePicker}
                >
                  <List size={16} strokeWidth={1.8} />
                  <span>Episodes</span>
                </button>
              </div>
            </div>
          </div>

          <div className="player-overlay player-overlay-bottom">
            <div className="player-timeline-stack">
              <div className="player-timeline-meta">
                <div />
                <button
                  aria-label={showRemainingTime ? 'Show current and total time' : 'Show remaining time'}
                  className="player-time-toggle"
                  type="button"
                  onClick={() => setShowRemainingTime((previous) => !previous)}
                >
                  {showRemainingTime
                    ? `-${duration > 0 ? formatTime(Math.max(duration - currentTime, 0)) : '--:--'}`
                    : `${formatTime(currentTime)} / ${duration > 0 ? formatTime(duration) : '--:--'}`}
                </button>
              </div>

              {promptSegment ? (
                <button
                  aria-label={`${promptSegment.label}. ${skipPromptMeta}`}
                  className={`skip-segment-prompt ${skipPromptPhase === 'entering' ? 'is-entering' : ''} ${skipPromptPhase === 'exiting' ? 'is-exiting' : ''}`}
                  type="button"
                  onAnimationEnd={() => {
                    if (skipPromptPhase === 'entering') {
                      setSkipPromptPhase('visible')
                    }
                  }}
                  onClick={() => seekTo(promptSegment.endTime)}
                >
                  <span className="skip-segment-prompt-copy">
                    <span className="skip-segment-prompt-label">{promptSegment.label}</span>
                    <span className="skip-segment-prompt-meta">
                      {promptSegmentAutoSkipEnabled
                        ? `Auto skips in ${formatSecondsCountdown(skipPromptCountdown)}`
                        : `Disappears in ${formatSecondsCountdown(skipPromptCountdown)}`}
                    </span>
                  </span>
                </button>
              ) : null}

              <div className="player-timeline-shell">
                {scrubberPreview.visible ? (
                  <div className="player-scrubber-preview" style={{ left: `${scrubberPreview.left}px` }}>
                    <div className="player-scrubber-preview-frame">
                      {!scrubberPreviewFrameReady && showPage?.show.posterUrl ? (
                        <img alt="" className="player-scrubber-preview-poster" src={showPage.show.posterUrl} />
                      ) : null}
                      <canvas
                        ref={previewCanvasRef}
                        aria-hidden="true"
                        className={`player-scrubber-preview-canvas ${scrubberPreviewFrameReady ? 'is-ready' : ''}`}
                      />
                    </div>
                    <div className="player-scrubber-preview-time">{formatTime(scrubberPreview.time)}</div>
                  </div>
                ) : null}
                <div className="player-timeline-track" aria-hidden="true">
                  <div className="player-timeline-buffer" style={{ width: `${bufferedPercent}%` }} />
                  {resolvedSkipSegments.map((segment) => (
                    <div
                      key={`${segment.label}-${segment.startTime}-${segment.endTime}`}
                      className={getTimelineSegmentClassName(segment.label)}
                      style={segmentStyle(segment.startTime, segment.endTime, duration)}
                      title={segment.label}
                    />
                  ))}
                  <div className="player-timeline-progress" style={{ width: `${progressPercent}%` }} />
                  <div className="player-timeline-thumb" style={timelineThumbStyle(progressPercent)} />
                </div>
                <input
                  aria-label="Seek timeline"
                  className="player-scrubber"
                  max={Math.max(duration, 0)}
                  min={0}
                  onChange={(event) => seekTo(Number(event.target.value))}
                  onPointerDown={updateScrubberPreview}
                  onPointerEnter={updateScrubberPreview}
                  onPointerLeave={hideScrubberPreview}
                  onPointerMove={updateScrubberPreview}
                  step={0.1}
                  type="range"
                  value={Math.min(currentTime, duration || 0)}
                />
              </div>
            </div>

            <div className="player-controls-row">
              <div className="player-controls-group">
                <button
                  aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
                  className="player-control player-control-primary player-icon-button"
                  type="button"
                  onClick={togglePlayPause}
                >
                  {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
                </button>
                <div className={`player-volume ${displayedVolume === 0 ? 'is-muted' : ''}`}>
                  <button
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    className="player-control player-icon-button"
                    type="button"
                    onClick={toggleMute}
                  >
                    {isMuted ? <VolumeX size={18} strokeWidth={1.8} /> : <Volume2 size={18} strokeWidth={1.8} />}
                  </button>
                  <div
                    className={`player-volume-slider-shell ${volumeTooltipVisible ? 'is-tooltip-visible' : ''}`}
                    style={{ '--player-volume-progress': `${volumePercent}%` } as CSSProperties}
                  >
                    <div aria-hidden="true" className="player-volume-tooltip">
                      {volumePercent}%
                    </div>
                    <input
                      aria-label="Volume"
                      aria-valuetext={`${volumePercent}%`}
                      className="player-volume-slider"
                      max={1}
                      min={0}
                      onBlur={() => setVolumeTooltipVisible(false)}
                      onChange={(event) => {
                        setVolumeTooltipVisible(true)
                        setVideoVolume(Number(event.target.value))
                      }}
                      onFocus={() => setVolumeTooltipVisible(true)}
                      onPointerCancel={() => setVolumeTooltipVisible(false)}
                      onPointerDown={() => setVolumeTooltipVisible(true)}
                      onPointerUp={() => setVolumeTooltipVisible(false)}
                      step={0.02}
                      type="range"
                      value={displayedVolume}
                    />
                  </div>
                </div>
              </div>

              <div className="player-controls-group player-controls-end">
                {stream?.nextEpisodeNumber ? (
                  <div className="player-next-episode">
                    <button
                      aria-label="Next episode"
                      className="player-control player-icon-button"
                      type="button"
                      onClick={goToNextEpisode}
                    >
                      <SkipForward size={16} strokeWidth={1.8} />
                    </button>
                    <div className="player-next-episode-card" aria-hidden="true">
                      <PosterImage
                        alt={showPage?.show.title ? `${showPage.show.title} poster` : 'Next episode poster'}
                        className="player-next-episode-poster"
                        src={showPage?.show.posterUrl}
                      />
                      <div className="player-next-episode-copy">
                        <span>Next episode</span>
                        <strong>
                          Episode {stream.nextEpisodeNumber}
                          {nextEpisodeDetails?.title ? ` • ${nextEpisodeDetails.title}` : ''}
                        </strong>
                        <small>{showPage?.show.title ?? stream.showTitle}</small>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div ref={settingsMenuRef} className="player-settings">
                  <button
                    aria-label="Playback settings"
                    aria-expanded={settingsOpen}
                    className={`player-control player-icon-button ${settingsOpen ? 'active' : ''}`}
                    type="button"
                    onClick={toggleSettings}
                  >
                    <Settings2 size={16} strokeWidth={1.8} />
                  </button>

                  {settingsOpen ? (
                    <div className="player-settings-menu" role="menu">
                      <div className="player-settings-section">
                        <span className="player-settings-label">Audio</span>
                        <div className="player-settings-options">
                          {translationTypes.map((mode) => (
                            <button
                              key={mode}
                              aria-pressed={translationType === mode}
                              className={`player-settings-option ${translationType === mode ? 'active' : ''}`}
                              disabled={!availableTranslations[mode]}
                              type="button"
                              onClick={() => navigateToTranslation(mode)}
                            >
                              {mode.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="player-settings-section">
                        <span className="player-settings-label">Subtitles</span>
                        <button
                          aria-pressed={captionsEnabled}
                          className={`player-settings-row ${captionsEnabled ? 'active' : ''}`}
                          disabled={!captionsAvailable}
                          type="button"
                          onClick={toggleCaptions}
                        >
                          <span className="player-settings-row-main">
                            <Captions size={16} strokeWidth={1.8} />
                            Closed captions
                          </span>
                          {captionsAvailable ? <span>{captionsEnabled ? 'On' : 'Off'}</span> : null}
                        </button>
                      </div>

                      <div className="player-settings-section">
                        <span className="player-settings-label">Speed</span>
                        <div className="player-settings-slider-row">
                          <input
                            aria-label="Playback speed"
                            className="player-settings-slider"
                            max={PLAYBACK_RATES[PLAYBACK_RATES.length - 1]}
                            min={PLAYBACK_RATES[0]}
                            step={0.25}
                            type="range"
                            value={playbackRate}
                            onChange={(event) => updatePlaybackRate(Number(event.target.value))}
                          />
                          <span className="player-settings-slider-value">{playbackRate.toFixed(2)}x</span>
                        </div>
                      </div>

                      {stream && stream.qualities.length > 1 ? (
                        <div className="player-settings-section">
                          <span className="player-settings-label">Quality</span>
                          <div className="player-settings-options">
                            {stream.qualities.map((quality) => (
                              <button
                                key={quality.id}
                                aria-pressed={activeQuality?.id === quality.id}
                                className={`player-settings-option ${activeQuality?.id === quality.id ? 'active' : ''}`}
                                type="button"
                                onClick={() => selectQuality(quality.id)}
                              >
                                {quality.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="player-settings-section">
                        <span className="player-settings-label">Display</span>
                        <button
                          aria-pressed={autoNextEnabled}
                          className={`player-settings-row ${autoNextEnabled ? 'active' : ''}`}
                          type="button"
                          onClick={toggleAutoNext}
                        >
                          <span className="player-settings-row-main">
                            <SkipForward size={16} strokeWidth={1.8} />
                            Auto next
                          </span>
                          <span>{autoNextEnabled ? 'On' : 'Off'}</span>
                        </button>
                        <button
                          aria-pressed={autoSkipSegmentsEnabled}
                          className={`player-settings-row ${autoSkipSegmentsEnabled ? 'active' : ''}`}
                          type="button"
                          onClick={toggleAutoSkipSegments}
                        >
                          <span className="player-settings-row-main">
                            <FastForward size={16} strokeWidth={1.8} />
                            Autoskip
                          </span>
                          <span>{autoSkipSegmentsEnabled ? 'On' : 'Off'}</span>
                        </button>
                        <button
                          aria-pressed={skipDebugEnabled}
                          className={`player-settings-row ${skipDebugEnabled ? 'active' : ''}`}
                          type="button"
                          onClick={toggleSkipDebug}
                        >
                          <span className="player-settings-row-main">
                            <Bug size={16} strokeWidth={1.8} />
                            Skip debug
                          </span>
                          <span>{skipDebugEnabled ? 'On' : 'Off'}</span>
                        </button>
                        <button
                          aria-pressed={isInPictureInPicture}
                          className={`player-settings-row ${isInPictureInPicture ? 'active' : ''}`}
                          disabled={!pictureInPictureSupported}
                          type="button"
                          onClick={() => void togglePictureInPicture()}
                        >
                          <span className="player-settings-row-main">
                            <PictureInPicture2 size={16} strokeWidth={1.8} />
                            Picture in picture
                          </span>
                          <span>{isInPictureInPicture ? 'On' : 'Off'}</span>
                        </button>
                      </div>

                    </div>
                  ) : null}
                </div>

                <button
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  className="player-control player-icon-button"
                  type="button"
                  onClick={() => void toggleFullscreen()}
                >
                  {isFullscreen ? <Minimize size={16} strokeWidth={1.8} /> : <Maximize size={16} strokeWidth={1.8} />}
                </button>
              </div>
            </div>
          </div>

          {episodePickerOpen ? (
            <div className="player-episode-picker" role="dialog" aria-label="Episode picker" aria-modal="false">
              <button
                aria-label="Close episode picker"
                className="player-episode-picker-backdrop"
                type="button"
                onClick={() => setEpisodePickerOpen(false)}
              />
              <div className="player-episode-panel">
                <div className="player-episode-panel-head">
                  <div>
                    <strong>{showPage?.show.title ?? stream?.showTitle ?? 'Episodes'}</strong>
                  </div>
                  <button className="player-control player-text-button" type="button" onClick={toggleEpisodePicker}>
                    Close
                  </button>
                </div>

                {episodeRanges.length > 1 ? (
                  <div className="player-episode-range-list" aria-label="Episode ranges" role="tablist">
                    {episodeRanges.map((range) => (
                      <button
                        key={range.key}
                        aria-selected={activeRange?.key === range.key}
                        className={activeRange?.key === range.key ? 'active' : ''}
                        role="tab"
                        type="button"
                        onClick={() => setSelectedRangeKey(range.key)}
                      >
                        {range.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="player-episode-list">
                  {showPageLoading ? (
                    Array.from({ length: 7 }, (_, index) => (
                      <div aria-hidden="true" className="player-episode-row player-episode-row-skeleton" key={index}>
                        <div className="loading-skeleton player-skeleton-episode-number" />
                        <div className="player-episode-copy">
                          <div className="loading-skeleton loading-skeleton-line player-skeleton-episode-title" />
                          <div className="loading-skeleton loading-skeleton-line player-skeleton-episode-meta" />
                        </div>
                      </div>
                    ))
                  ) : showPage ? (
                    visibleEpisodes.map((episode) => (
                      <button
                        key={episode.number}
                        className={`player-episode-row ${episode.number === episodeNumber ? 'active' : ''}`}
                        type="button"
                        onClick={() => goToEpisode(episode.number)}
                      >
                        <div className="player-episode-number">
                          <strong>{episode.number}</strong>
                        </div>
                        <div className="player-episode-copy">
                          <strong>{episode.title}</strong>
                          <span>
                            {episode.progress?.completed
                              ? 'Watched'
                              : episode.progress
                                ? `Resume at ${formatTime(episode.progress.currentTime)}`
                                : 'Start episode'}
                          </span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="player-episode-empty">Episode list unavailable.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

interface PlayerProgressSnapshot {
  showId: string
  episodeNumber: string
  currentTime: number
  duration: number
  completed: boolean
  updatedAt: number
}

function getPlayerProgressStorageKey(showId: string, episodeNumber: string) {
  return `${PLAYER_PROGRESS_STORAGE_KEY_PREFIX}:${showId}:${episodeNumber}`
}

function readPlayerProgressSnapshot(showId: string, episodeNumber: string): PlayerProgressSnapshot | null {
  try {
    const rawValue = window.localStorage.getItem(getPlayerProgressStorageKey(showId, episodeNumber))
    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue) as Partial<PlayerProgressSnapshot>
    if (
      typeof parsed.showId !== 'string' ||
      typeof parsed.episodeNumber !== 'string' ||
      typeof parsed.currentTime !== 'number' ||
      typeof parsed.duration !== 'number' ||
      typeof parsed.completed !== 'boolean' ||
      typeof parsed.updatedAt !== 'number'
    ) {
      return null
    }

    return parsed as PlayerProgressSnapshot
  } catch {
    return null
  }
}

function writePlayerProgressSnapshot(snapshot: PlayerProgressSnapshot) {
  try {
    const storageKey = getPlayerProgressStorageKey(snapshot.showId, snapshot.episodeNumber)
    if (snapshot.completed || snapshot.currentTime <= 0) {
      window.localStorage.removeItem(storageKey)
      return
    }

    window.localStorage.setItem(storageKey, JSON.stringify(snapshot))
  } catch {
    return
  }
}

function selectResumeTime(
  explicitResumeAt: number | null,
  localSnapshot: PlayerProgressSnapshot | null,
  episodeProgress: ShowPagePayload['episodes'][number]['progress'] | null,
) {
  if (explicitResumeAt !== null) {
    return explicitResumeAt
  }

  const localResumeTime =
    localSnapshot && !localSnapshot.completed && localSnapshot.currentTime > 0 ? localSnapshot.currentTime : null
  const serverResumeTime =
    episodeProgress && !episodeProgress.completed && episodeProgress.currentTime > 0 ? episodeProgress.currentTime : null

  if (localResumeTime === null) {
    return serverResumeTime
  }

  if (serverResumeTime === null) {
    return localResumeTime
  }

  const serverUpdatedAt = episodeProgress?.updatedAt ? Date.parse(episodeProgress.updatedAt) : 0
  return localSnapshot && localSnapshot.updatedAt >= serverUpdatedAt ? localResumeTime : serverResumeTime
}

function clearHideTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
}

function revealControls(
  timerRef: MutableRefObject<number | null>,
  setControlsVisible: Dispatch<SetStateAction<boolean>>,
  video: HTMLVideoElement,
) {
  setControlsVisible(true)
  clearHideTimer(timerRef)
  if (video.paused) {
    return
  }

  timerRef.current = window.setTimeout(() => {
    setControlsVisible(false)
  }, CONTROL_IDLE_MS)
}

function syncTextTrack(video: HTMLVideoElement, enabled: boolean) {
  for (const track of Array.from(video.textTracks)) {
    track.mode = enabled ? 'showing' : 'disabled'
  }
}

function parseSeekValue(rawValue: string | null): number | null {
  if (!rawValue) {
    return null
  }

  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '--:--'
  }

  const rounded = Math.floor(totalSeconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const seconds = rounded % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function segmentStyle(startTime: number, endTime: number, duration: number) {
  if (!duration || endTime <= startTime) {
    return { left: '0%', width: '0%' }
  }

  const left = Math.max(0, (startTime / duration) * 100)
  const width = Math.max(0, ((endTime - startTime) / duration) * 100)
  return {
    left: `${Math.min(left, 100)}%`,
    width: `${Math.min(width, 100 - left)}%`,
  }
}

function normalizeSkipSegmentsForDuration(
  segments: Array<{ label: string; startTime: number; endTime: number }>,
  duration: number,
) {
  if (!duration || duration <= 0) {
    return segments
  }

  return segments
    .map((segment) => {
      const normalizedLabel = segment.label.toLowerCase()
      const segmentDuration = Math.max(segment.endTime - segment.startTime, 0)

      if (normalizedLabel.includes('outro') && segment.startTime >= duration && segment.endTime > duration) {
        return {
          ...segment,
          startTime: clamp(duration - Math.min(segmentDuration, duration), 0, duration),
          endTime: duration,
        }
      }

      return {
        ...segment,
        startTime: clamp(segment.startTime, 0, duration),
        endTime: clamp(segment.endTime, 0, duration),
      }
    })
    .filter((segment) => segment.endTime > segment.startTime)
}

function formatSkipDebugSegments(segments: Array<{ label: string; startTime: number; endTime: number }>) {
  if (segments.length === 0) {
    return 'none'
  }

  return segments
    .map((segment) => `${segment.label}: ${segment.startTime.toFixed(2)}-${segment.endTime.toFixed(2)}`)
    .join('\n')
}

function getSkipPromptCountdown(
  segment: { label: string; startTime: number; endTime: number } | null,
  currentTime: number,
  skipPromptStartedAt: number | null,
  autoSkipEnabled: boolean,
) {
  if (!segment) {
    return 0
  }

  const promptStartedAt = skipPromptStartedAt ?? currentTime
  if (!autoSkipEnabled) {
    const promptVisibleFor = getSkipPromptVisibleSeconds(segment, promptStartedAt)
    const elapsed = Math.max(currentTime - promptStartedAt, 0)
    return Math.min(promptVisibleFor, Math.max(promptVisibleFor - elapsed, 0))
  }

  return Math.max(AUTO_SKIP_DELAY_SECONDS - (currentTime - promptStartedAt), 0)
}

function formatSecondsCountdown(seconds: number) {
  return formatTime(Math.max(Math.ceil(seconds), 0))
}

function getSkipPromptVisibleSeconds(segment: { startTime: number; endTime: number }, promptStartedAt: number) {
  return Math.min(SKIP_PROMPT_MAX_SECONDS, Math.max(segment.endTime - promptStartedAt, 0))
}

function timelineThumbStyle(progressPercent: number) {
  const boundedPercent = Math.min(Math.max(progressPercent, 0), 100)
  return {
    left: `clamp(5px, ${boundedPercent}%, calc(100% - 5px))`,
  }
}

function attachVideoSource(video: HTMLVideoElement, sourceUrl: string, mimeType: string) {
  let hls: Hls | null = null
  const isHlsStream = mimeType.includes('mpegurl') || sourceUrl.includes('.m3u8')

  if (isHlsStream && Hls.isSupported()) {
    hls = new Hls()
    hls.loadSource(sourceUrl)
    hls.attachMedia(video)
  } else {
    video.src = sourceUrl
    video.load()
  }

  return () => {
    hls?.destroy()
    video.removeAttribute('src')
    video.load()
  }
}

function schedulePreviewSeek(
  previewTime: number,
  previewVideoRef: MutableRefObject<HTMLVideoElement | null>,
  previewSourceReadyRef: MutableRefObject<boolean>,
  previewSeekTimerRef: MutableRefObject<number | null>,
  onFrameReady: () => void,
) {
  clearTimer(previewSeekTimerRef)
  previewSeekTimerRef.current = window.setTimeout(() => {
    previewSeekTimerRef.current = null
    const previewVideo = previewVideoRef.current
    if (!previewVideo || !previewSourceReadyRef.current) {
      return
    }

    const safeDuration = Number.isFinite(previewVideo.duration) ? previewVideo.duration : previewTime
    const boundedPreviewTime = Math.min(Math.max(previewTime, 0), safeDuration || Math.max(previewTime, 0))
    if (Math.abs(previewVideo.currentTime - boundedPreviewTime) < SCRUBBER_PREVIEW_FRAME_TOLERANCE_SECONDS) {
      onFrameReady()
      return
    }

    previewVideo.currentTime = boundedPreviewTime
  }, SCRUBBER_PREVIEW_SEEK_DELAY_MS)
}

function clearTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
}

function drawVideoCover(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  width = 160,
  height = 90,
) {
  canvas.width = width
  canvas.height = height

  const videoAspectRatio = video.videoWidth / video.videoHeight
  const canvasAspectRatio = width / height
  let sourceWidth = video.videoWidth
  let sourceHeight = video.videoHeight
  let sourceX = 0
  let sourceY = 0

  if (videoAspectRatio > canvasAspectRatio) {
    sourceWidth = video.videoHeight * canvasAspectRatio
    sourceX = (video.videoWidth - sourceWidth) / 2
  } else {
    sourceHeight = video.videoWidth / canvasAspectRatio
    sourceY = (video.videoHeight - sourceHeight) / 2
  }

  context.clearRect(0, 0, width, height)
  context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function getTimelineSegmentClassName(label: string) {
  const normalized = label.toLowerCase()
  if (normalized.includes('intro')) {
    return 'player-timeline-segment player-timeline-segment-intro'
  }
  if (normalized.includes('outro')) {
    return 'player-timeline-segment player-timeline-segment-outro'
  }
  if (normalized.includes('recap')) {
    return 'player-timeline-segment player-timeline-segment-recap'
  }

  return 'player-timeline-segment'
}

function isAutoSkippableSegment(label: string) {
  const normalized = label.toLowerCase()
  return normalized.includes('intro') || normalized.includes('outro')
}

function getSegmentKey(label: string, startTime: number, endTime: number) {
  return `${label}-${startTime}-${endTime}`
}

function buildEpisodeRanges(episodes: ShowPagePayload['episodes']) {
  if (episodes.length <= EPISODES_PER_RANGE) {
    return [
      {
        key: 'all',
        label: 'All episodes',
        episodeNumbers: new Set(episodes.map((episode) => episode.number)),
      },
    ]
  }

  const ranges: Array<{ key: string; label: string; episodeNumbers: Set<string> }> = []
  for (let index = 0; index < episodes.length; index += EPISODES_PER_RANGE) {
    const slice = episodes.slice(index, index + EPISODES_PER_RANGE)
    const firstEpisode = slice[0]
    const lastEpisode = slice[slice.length - 1]
    if (!firstEpisode || !lastEpisode) {
      continue
    }

    ranges.push({
      key: `${firstEpisode.number}-${lastEpisode.number}`,
      label: `${firstEpisode.number}-${lastEpisode.number}`,
      episodeNumbers: new Set(slice.map((episode) => episode.number)),
    })
  }

  return ranges
}

function shouldMarkShowCompleted(episodes: ShowPagePayload['episodes'], episodeNumber: string): boolean {
  if (!episodes.length) {
    return false
  }

  return episodes.every((episode) => episode.number === episodeNumber || Boolean(episode.progress?.completed))
}

function shouldTreatEpisodeAsCompleted(currentTime: number, duration: number): boolean {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
    return false
  }

  return currentTime / duration >= EPISODE_COMPLETION_THRESHOLD
}

function parseEpisodeValue(value: string | null | undefined): number {
  if (!value) {
    return -1
  }

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : -1
}

function PlayGlyph() {
  return (
    <svg aria-hidden="true" className="player-glyph player-glyph-play" viewBox="0 0 24 24">
      <path d="M8 6.75v10.5l8.75-5.25z" fill="currentColor" />
    </svg>
  )
}

function PauseGlyph() {
  return (
    <svg aria-hidden="true" className="player-glyph player-glyph-pause" viewBox="0 0 24 24">
      <rect x="7" y="6.5" width="3.75" height="11" rx="1" fill="currentColor" />
      <rect x="13.25" y="6.5" width="3.75" height="11" rx="1" fill="currentColor" />
    </svg>
  )
}
