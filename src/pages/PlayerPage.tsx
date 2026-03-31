import {
  ArrowLeft,
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
import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type MutableRefObject, type SetStateAction } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { translationTypes, type ResolvedStream, type ShowPagePayload, type TranslationType } from '../../shared/contracts'
import { PosterImage } from '../components/PosterImage'
import { ApiError, createApi } from '../lib/api'
import { resolveTranslationType, withMode } from '../lib/appPreferences'
import { useSession } from '../session'

const CONTROL_IDLE_MS = 2200
const SEEK_INTERVAL_SECONDS = 10
const EPISODES_PER_RANGE = 50
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const
const BACKGROUND_REQUEST_COOLDOWN_MS = 30_000

export function PlayerPage() {
  const { showId = '', episodeNumber = '' } = useParams()
  const { password, preferredTranslationType, autoNextEnabled, setAutoNextEnabled } = useSession()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const playerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const settingsMenuRef = useRef<HTMLDivElement | null>(null)
  const hideControlsTimerRef = useRef<number | null>(null)
  const pendingSeekTimeRef = useRef<number | null>(null)
  const resumePlaybackRef = useRef(false)
  const backgroundRequestBlockedUntilRef = useRef(0)
  const lastVolumeRef = useRef(1)
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
  const [availableTranslations, setAvailableTranslations] = useState<Record<TranslationType, boolean>>({
    sub: true,
    dub: true,
  })
  const translationType = resolveTranslationType(searchParams.get('mode'), preferredTranslationType)
  const resumeAt = parseSeekValue(searchParams.get('t'))
  const activeQuality = stream?.qualities.find((quality) => quality.id === selectedQualityId) ?? stream?.qualities[0] ?? null
  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const bufferedPercent = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0
  const captionsAvailable = Boolean(stream?.subtitleUrl) || availableTextTrackCount > 0
  const pictureInPictureSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled
  const episodes = showPage?.episodes ?? []
  const currentEpisodeDetails = episodes.find((episode) => episode.number === episodeNumber) ?? null
  const nextEpisodeDetails =
    stream?.nextEpisodeNumber ? episodes.find((episode) => episode.number === stream.nextEpisodeNumber) ?? null : null
  const episodeRanges = useMemo(() => buildEpisodeRanges(episodes), [episodes])
  const activeRange = episodeRanges.find((range) => range.key === selectedRangeKey) ?? episodeRanges[0] ?? null
  const visibleEpisodes = activeRange
    ? episodes.filter((episode) => activeRange.episodeNumbers.has(episode.number))
    : episodes
  const finishesShow = shouldMarkShowCompleted(episodes, episodeNumber)

  useEffect(() => {
    const api = createApi(password)
    let active = true

    setStream(null)
    setError(null)
    setCurrentTime(0)
    setDuration(0)
    setBufferedEnd(0)
    setControlsVisible(true)
    setIsPlaying(false)
    setSettingsOpen(false)
    setEpisodePickerOpen(false)
    setVideoReady(false)

    void api
      .resolvePlayback({ showId, episodeNumber, translationType })
      .then((resolved) => {
        if (!active) {
          return
        }

        setStream(resolved)
      })
      .catch((reason: unknown) => {
        if (!active) {
          return
        }

        setError(reason instanceof ApiError ? reason.message : 'Unable to resolve this stream right now')
      })

    return () => {
      active = false
    }
  }, [episodeNumber, password, showId, translationType])

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
    setSelectedQualityId(stream?.qualities[0]?.id ?? null)
    setAvailableTextTrackCount(0)
    setCaptionsEnabled(true)
    setVideoReady(false)
  }, [stream])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) {
      return
    }

    const sourceUrl = activeQuality?.proxyUrl ?? stream.streamUrl
    const restoreTime = pendingSeekTimeRef.current ?? resumeAt
    const shouldResumePlayback = resumePlaybackRef.current
    let hls: Hls | null = null

    const syncReadyState = () => {
      setVideoReady(true)
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
      if (restoreTime !== null) {
        const maxSeekTime = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.25) : restoreTime
        const nextTime = Math.min(Math.max(restoreTime, 0), maxSeekTime)
        video.currentTime = nextTime
        setCurrentTime(nextTime)
        pendingSeekTimeRef.current = null
      }

      if (shouldResumePlayback) {
        void video.play().catch(() => undefined)
      }
    }

    const isHlsStream = stream.mimeType.includes('mpegurl') || sourceUrl.includes('.m3u8')
    if (isHlsStream && Hls.isSupported()) {
      hls = new Hls()
      hls.loadSource(sourceUrl)
      hls.attachMedia(video)
    } else {
      video.src = sourceUrl
      video.load()
    }

    video.addEventListener('loadedmetadata', syncReadyState)
    video.addEventListener('canplay', syncReadyState, { once: true })

    return () => {
      resumePlaybackRef.current = false
      video.removeEventListener('loadedmetadata', syncReadyState)
      video.removeEventListener('canplay', syncReadyState)
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [activeQuality?.proxyUrl, resumeAt, stream])

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

      const safeDuration = Number.isFinite(video.duration) ? video.duration : 0
      runBackgroundRequest(api.saveProgress({
        showId,
        episodeNumber,
        title: stream.showTitle,
        posterUrl: showPage?.show.posterUrl ?? null,
        currentTime: completed ? safeDuration : video.currentTime,
        duration: safeDuration,
        completed,
      }))
    }

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime)
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
  }, [autoNextEnabled, episodeNumber, finishesShow, navigate, password, showId, showPage?.show.posterUrl, stream, translationType])

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
  }, [activeQuality?.proxyUrl, captionsEnabled, stream])

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
    return () => {
      clearHideTimer(hideControlsTimerRef)
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
    stream?.skipSegments.find(
      (segment) => currentTime >= Math.max(0, segment.startTime - 2) && currentTime < segment.endTime,
    ) ?? null
  const playerLoading = !error && (!stream || !videoReady)

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

  const persistProgressSnapshot = (completed: boolean) => {
    const video = videoRef.current
    if (!video || !stream) {
      return
    }

    if (Date.now() < backgroundRequestBlockedUntilRef.current) {
      return
    }

    const api = createApi(password)
    const safeDuration = Number.isFinite(video.duration) ? video.duration : duration
    void api.saveProgress({
      showId,
      episodeNumber,
      title: stream.showTitle,
      posterUrl: showPage?.show.posterUrl ?? null,
      currentTime: completed ? safeDuration : video.currentTime,
      duration: safeDuration,
      completed,
    }).catch((reason: unknown) => {
      if (reason instanceof ApiError && reason.status >= 500) {
        backgroundRequestBlockedUntilRef.current = Date.now() + BACKGROUND_REQUEST_COOLDOWN_MS
      }
    })
  }

  const seekTo = (nextTime: number) => {
    const video = videoRef.current
    if (!video) {
      return
    }

    const safeDuration = Number.isFinite(video.duration) ? video.duration : duration
    const boundedTime = Math.min(Math.max(nextTime, 0), safeDuration || Math.max(nextTime, 0))
    video.currentTime = boundedTime
    setCurrentTime(boundedTime)
    handlePointerActivity()
  }

  const togglePlayPause = () => {
    const video = videoRef.current
    if (!video) {
      return
    }

    if (video.paused) {
      void video.play().catch(() => undefined)
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

  const goToNextEpisode = () => {
    if (!stream?.nextEpisodeNumber) {
      return
    }

    persistProgressSnapshot(false)
    setEpisodePickerOpen(false)
    navigate(`/player/${showId}/${stream.nextEpisodeNumber}?mode=${translationType}`)
  }

  const goToEpisode = (nextEpisodeNumber: string) => {
    if (nextEpisodeNumber === episodeNumber) {
      setEpisodePickerOpen(false)
      return
    }

    persistProgressSnapshot(false)
    setEpisodePickerOpen(false)
    navigate(`/player/${showId}/${nextEpisodeNumber}?mode=${translationType}`)
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

          <div className="player-overlay player-overlay-top">
            <div className="player-topbar">
              <div className="player-topbar-group">
                <Link
                  aria-label="Back to episodes"
                  className="player-control player-icon-button player-back-button"
                  to={withMode(`/shows/${showId}`, translationType)}
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

              {activeSegment ? (
                <button
                  className="skip-segment-prompt"
                  type="button"
                  onClick={() => seekTo(activeSegment.endTime)}
                >
                  <FastForward size={16} strokeWidth={1.8} />
                  {activeSegment.label}
                </button>
              ) : null}

              <div className="player-timeline-shell">
                <div className="player-timeline-track" aria-hidden="true">
                  <div className="player-timeline-buffer" style={{ width: `${bufferedPercent}%` }} />
                  {stream?.skipSegments.map((segment) => (
                    <div
                      key={`${segment.label}-${segment.startTime}-${segment.endTime}`}
                      className="player-timeline-segment"
                      style={segmentStyle(segment.startTime, segment.endTime, duration)}
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
                <div className="player-volume">
                  <button
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    className="player-control player-icon-button"
                    type="button"
                    onClick={toggleMute}
                  >
                    {isMuted ? <VolumeX size={18} strokeWidth={1.8} /> : <Volume2 size={18} strokeWidth={1.8} />}
                  </button>
                  <input
                    aria-label="Volume"
                    className="player-volume-slider"
                    max={1}
                    min={0}
                    onChange={(event) => setVideoVolume(Number(event.target.value))}
                    step={0.05}
                    type="range"
                    value={isMuted ? 0 : volume}
                  />
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
                          <span>{captionsAvailable ? (captionsEnabled ? 'On' : 'Off') : 'Unavailable'}</span>
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
                    <span>{showPage?.show.season ? toTitleCase(showPage.show.season) : 'Season 1'}</span>
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

function timelineThumbStyle(progressPercent: number) {
  const boundedPercent = Math.min(Math.max(progressPercent, 0), 100)
  return {
    left: `min(max(5px, ${boundedPercent}%), calc(100% - 5px))`,
  }
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

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
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
