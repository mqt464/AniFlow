import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  AniListConnection,
  EpisodeProgressState,
  LibraryEntry,
  LibraryUpdateInput,
  ProgressInput,
  ShowProgressSummary,
  WatchProgress,
} from '../../../shared/contracts.js'
import { nowIso } from './utils.js'

interface QueueJob {
  id: number
  action: string
  payload: string
  attempts: number
}

interface WatchProgressRow {
  show_id: string
  episode_number: string
  title: string
  poster_url: string | null
  progress_current_time: number
  duration: number
  completed: number
  updated_at: string
}

interface LibraryEntryRow {
  show_id: string
  title: string
  poster_url: string | null
  latest_episode_number: string | null
  resume_episode_number: string | null
  resume_time: number
  updated_at: string
  favorited: number
  watch_later: number
  completed: number
  completed_at: string | null
  anilist_media_id: number | null
}

export interface AniListSyncSnapshot {
  showId: string
  title: string
  posterUrl: string | null
  latestEpisodeNumber: string | null
  resumeEpisodeNumber: string | null
  resumeTime: number
  updatedAt: string
  favorited: boolean
  watchLater: boolean
  completed: boolean
  anilistMediaId: number | null
}

export class AniFlowDatabase {
  readonly connection: DatabaseSync

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.connection = new DatabaseSync(databasePath)
    this.connection.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS watch_progress (
        show_id TEXT NOT NULL,
        episode_number TEXT NOT NULL,
        title TEXT NOT NULL,
        poster_url TEXT,
        current_time REAL NOT NULL,
        duration REAL NOT NULL,
        completed INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (show_id, episode_number)
      );

      CREATE TABLE IF NOT EXISTS library_entries (
        show_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        poster_url TEXT,
        latest_episode_number TEXT,
        resume_episode_number TEXT,
        resume_time REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        favorited INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS anilist_connection (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        viewer_id INTEGER,
        username TEXT,
        avatar_url TEXT,
        banner_url TEXT,
        profile_url TEXT,
        about TEXT,
        access_token TEXT,
        refresh_token TEXT,
        connected_at TEXT,
        last_pull_at TEXT,
        last_sync_status TEXT
      );

      CREATE TABLE IF NOT EXISTS anilist_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)

    ensureColumnExists(this.connection, 'library_entries', 'watch_later', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumnExists(this.connection, 'library_entries', 'completed', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumnExists(this.connection, 'library_entries', 'completed_at', 'TEXT')
    ensureColumnExists(this.connection, 'library_entries', 'anilist_media_id', 'INTEGER')
    ensureColumnExists(this.connection, 'anilist_connection', 'viewer_id', 'INTEGER')
    ensureColumnExists(this.connection, 'anilist_connection', 'avatar_url', 'TEXT')
    ensureColumnExists(this.connection, 'anilist_connection', 'banner_url', 'TEXT')
    ensureColumnExists(this.connection, 'anilist_connection', 'profile_url', 'TEXT')
    ensureColumnExists(this.connection, 'anilist_connection', 'about', 'TEXT')
    ensureColumnExists(this.connection, 'anilist_connection', 'last_pull_at', 'TEXT')
  }

  close(): void {
    this.connection.close()
  }

  getCachedJson<T>(key: string): T | null {
    const row = this.connection
      .prepare('SELECT value, expires_at FROM cache_entries WHERE key = ?')
      .get(key) as { value: string; expires_at: string } | undefined

    if (!row) {
      return null
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.connection.prepare('DELETE FROM cache_entries WHERE key = ?').run(key)
      return null
    }

    return JSON.parse(row.value) as T
  }

  setCachedJson(key: string, value: unknown, ttlMs: number): void {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()
    this.connection
      .prepare(`
        INSERT INTO cache_entries (key, value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
      `)
      .run(key, JSON.stringify(value), expiresAt)
  }

  saveProgress(input: ProgressInput): WatchProgress {
    const updatedAt = nowIso()
    this.connection
      .prepare(`
        INSERT INTO watch_progress (
          show_id, episode_number, title, poster_url, current_time, duration, completed, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(show_id, episode_number) DO UPDATE SET
          title = excluded.title,
          poster_url = excluded.poster_url,
          current_time = excluded.current_time,
          duration = excluded.duration,
          completed = excluded.completed,
          updated_at = excluded.updated_at
      `)
      .run(
        input.showId,
        input.episodeNumber,
        input.title,
        input.posterUrl ?? null,
        input.currentTime,
        input.duration,
        input.completed ? 1 : 0,
        updatedAt,
      )

    const existingEntry = this.getLibraryEntryRow(input.showId)
    const posterUrl = input.posterUrl ?? existingEntry?.poster_url ?? null
    const shouldResetShowCompletion = !input.completed && existingEntry?.completed === 1

    this.connection
      .prepare(`
        INSERT INTO library_entries (
          show_id,
          title,
          poster_url,
          latest_episode_number,
          resume_episode_number,
          resume_time,
          updated_at,
          favorited,
          watch_later,
          completed,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(show_id) DO UPDATE SET
          title = excluded.title,
          poster_url = excluded.poster_url,
          latest_episode_number = excluded.latest_episode_number,
          resume_episode_number = excluded.resume_episode_number,
          resume_time = excluded.resume_time,
          updated_at = excluded.updated_at,
          watch_later = excluded.watch_later,
          completed = excluded.completed,
          completed_at = excluded.completed_at
      `)
      .run(
        input.showId,
        input.title,
        posterUrl,
        input.episodeNumber,
        input.completed ? null : input.episodeNumber,
        input.completed ? 0 : input.currentTime,
        updatedAt,
        existingEntry?.favorited ?? 0,
        0,
        shouldResetShowCompletion ? 0 : existingEntry?.completed ?? 0,
        shouldResetShowCompletion ? null : existingEntry?.completed_at ?? null,
      )

    return {
      showId: input.showId,
      episodeNumber: input.episodeNumber,
      title: input.title,
      posterUrl: input.posterUrl ?? null,
      currentTime: input.currentTime,
      duration: input.duration,
      completed: input.completed,
      updatedAt,
    }
  }

  getRecentProgress(limit = 12): WatchProgress[] {
    const rows = this.connection
      .prepare(`
        SELECT show_id, episode_number, title, poster_url, watch_progress.current_time AS progress_current_time, duration, completed, updated_at
        FROM watch_progress
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(limit) as unknown as WatchProgressRow[]

    return rows.map(mapWatchProgress)
  }

  getContinueWatching(limit = 12): LibraryEntry[] {
    const rows = this.connection
      .prepare(`
        SELECT
          show_id,
          title,
          poster_url,
          latest_episode_number,
          resume_episode_number,
          resume_time,
          updated_at,
          favorited,
          watch_later,
          completed,
          completed_at,
          anilist_media_id
        FROM library_entries
        WHERE resume_episode_number IS NOT NULL
          AND completed = 0
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(limit) as unknown as LibraryEntryRow[]

    return rows.map(mapLibraryEntry)
  }

  getFavorites(limit = 12): LibraryEntry[] {
    const rows = this.connection
      .prepare(`
        SELECT
          show_id,
          title,
          poster_url,
          latest_episode_number,
          resume_episode_number,
          resume_time,
          updated_at,
          favorited,
          watch_later,
          completed,
          completed_at,
          anilist_media_id
        FROM library_entries
        WHERE favorited = 1
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(limit) as unknown as LibraryEntryRow[]

    return rows.map(mapLibraryEntry)
  }

  getWatchLater(limit = 12): LibraryEntry[] {
    const rows = this.connection
      .prepare(`
        SELECT
          show_id,
          title,
          poster_url,
          latest_episode_number,
          resume_episode_number,
          resume_time,
          updated_at,
          favorited,
          watch_later,
          completed,
          completed_at,
          anilist_media_id
        FROM library_entries
        WHERE watch_later = 1
          AND completed = 0
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(limit) as unknown as LibraryEntryRow[]

    return rows.map(mapLibraryEntry)
  }

  getCompleted(limit = 12): LibraryEntry[] {
    const rows = this.connection
      .prepare(`
        SELECT
          show_id,
          title,
          poster_url,
          latest_episode_number,
          resume_episode_number,
          resume_time,
          updated_at,
          favorited,
          watch_later,
          completed,
          completed_at,
          anilist_media_id
        FROM library_entries
        WHERE completed = 1
        ORDER BY COALESCE(completed_at, updated_at) DESC
        LIMIT ?
      `)
      .all(limit) as unknown as LibraryEntryRow[]

    return rows.map(mapLibraryEntry)
  }

  getLibraryEntry(showId: string): LibraryEntry | null {
    const row = this.getLibraryEntryRow(showId)
    return row ? mapLibraryEntry(row) : null
  }

  private getLibraryEntryRow(showId: string): LibraryEntryRow | undefined {
    return this.connection
      .prepare(`
        SELECT
          show_id,
          title,
          poster_url,
          latest_episode_number,
          resume_episode_number,
          resume_time,
          updated_at,
          favorited,
          watch_later,
          completed,
          completed_at,
          anilist_media_id
        FROM library_entries
        WHERE show_id = ?
      `)
      .get(showId) as LibraryEntryRow | undefined
  }

  updateLibraryEntry(input: LibraryUpdateInput): LibraryEntry {
    const existing = this.getLibraryEntryRow(input.showId)
    const updatedAt = nowIso()
    const nextTitle = input.title || existing?.title || input.showId
    const nextPosterUrl = input.posterUrl === undefined ? existing?.poster_url ?? null : input.posterUrl ?? null
    const nextFavorited = input.favorited === undefined ? existing?.favorited ?? 0 : input.favorited ? 1 : 0
    const nextWatchLater = input.watchLater === undefined ? existing?.watch_later ?? 0 : input.watchLater ? 1 : 0
    const nextCompleted = input.completed === undefined ? existing?.completed ?? 0 : input.completed ? 1 : 0

    let latestEpisodeNumber = existing?.latest_episode_number ?? null
    let resumeEpisodeNumber = existing?.resume_episode_number ?? null
    let resumeTime = existing?.resume_time ?? 0
    let completedAt =
      input.completed === true ? updatedAt : input.completed === false ? null : existing?.completed_at ?? null

    if (input.removeFromContinueWatching || nextCompleted === 1) {
      resumeEpisodeNumber = null
      resumeTime = 0
    }

    if (nextCompleted === 1) {
      completedAt ??= updatedAt
    }

    this.connection
      .prepare(`
        INSERT INTO library_entries (
          show_id,
          title,
          poster_url,
          latest_episode_number,
          resume_episode_number,
          resume_time,
          updated_at,
          favorited,
          watch_later,
          completed,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(show_id) DO UPDATE SET
          title = excluded.title,
          poster_url = excluded.poster_url,
          latest_episode_number = excluded.latest_episode_number,
          resume_episode_number = excluded.resume_episode_number,
          resume_time = excluded.resume_time,
          updated_at = excluded.updated_at,
          favorited = excluded.favorited,
          watch_later = excluded.watch_later,
          completed = excluded.completed,
          completed_at = excluded.completed_at
      `)
      .run(
        input.showId,
        nextTitle,
        nextPosterUrl,
        latestEpisodeNumber,
        resumeEpisodeNumber,
        resumeTime,
        updatedAt,
        nextFavorited,
        nextCompleted === 1 ? 0 : nextWatchLater,
        nextCompleted,
        completedAt,
      )

    return this.getLibraryEntry(input.showId) as LibraryEntry
  }

  getAniListSyncSnapshot(showId: string): AniListSyncSnapshot | null {
    const row = this.getLibraryEntryRow(showId)
    if (!row) {
      return null
    }

    return {
      showId: row.show_id,
      title: row.title,
      posterUrl: row.poster_url,
      latestEpisodeNumber: row.latest_episode_number,
      resumeEpisodeNumber: row.resume_episode_number,
      resumeTime: row.resume_time,
      updatedAt: row.updated_at,
      favorited: row.favorited === 1,
      watchLater: row.watch_later === 1,
      completed: row.completed === 1,
      anilistMediaId: row.anilist_media_id,
    }
  }

  getShowIdByAniListMediaId(mediaId: number): string | null {
    const row = this.connection
      .prepare('SELECT show_id FROM library_entries WHERE anilist_media_id = ? LIMIT 1')
      .get(mediaId) as { show_id: string } | undefined

    return row?.show_id ?? null
  }

  setLibraryAniListMediaId(showId: string, mediaId: number): void {
    this.connection
      .prepare('UPDATE library_entries SET anilist_media_id = ? WHERE show_id = ?')
      .run(mediaId, showId)
  }

  importAniListLibraryEntry(input: {
    showId: string
    mediaId: number
    title: string
    posterUrl: string | null
    status: string | null
    progress: number
    episodes: number | null
    favorited: boolean
    updatedAt: string
  }): LibraryEntry {
    const existing = this.getLibraryEntryRow(input.showId)
    const remoteTimestamp = Date.parse(input.updatedAt)
    const localTimestamp = existing ? Date.parse(existing.updated_at) : Number.NEGATIVE_INFINITY

    if (existing && Number.isFinite(remoteTimestamp) && Number.isFinite(localTimestamp) && localTimestamp > remoteTimestamp) {
      return mapLibraryEntry(existing)
    }

    const normalizedProgress = input.progress > 0 ? String(input.progress) : null
    const isCurrent = input.status === 'CURRENT' || input.status === 'REPEATING'
    const isWatchLater = input.status === 'PLANNING' || input.status === 'PAUSED'
    const isCompleted = input.status === 'COMPLETED'

    const latestEpisodeNumber =
      normalizedProgress ??
      (isCompleted && input.episodes && input.episodes > 0 ? String(input.episodes) : existing?.latest_episode_number ?? null)

    this.connection
      .prepare(`
        INSERT INTO library_entries (
          show_id,
          title,
          poster_url,
          latest_episode_number,
          resume_episode_number,
          resume_time,
          updated_at,
          favorited,
          watch_later,
          completed,
          completed_at,
          anilist_media_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(show_id) DO UPDATE SET
          title = excluded.title,
          poster_url = excluded.poster_url,
          latest_episode_number = excluded.latest_episode_number,
          resume_episode_number = excluded.resume_episode_number,
          resume_time = excluded.resume_time,
          updated_at = excluded.updated_at,
          favorited = excluded.favorited,
          watch_later = excluded.watch_later,
          completed = excluded.completed,
          completed_at = excluded.completed_at,
          anilist_media_id = excluded.anilist_media_id
      `)
      .run(
        input.showId,
        input.title,
        input.posterUrl,
        latestEpisodeNumber,
        isCurrent ? normalizedProgress ?? existing?.resume_episode_number ?? '1' : null,
        0,
        input.updatedAt,
        input.favorited ? 1 : 0,
        isCompleted ? 0 : isWatchLater ? 1 : 0,
        isCompleted ? 1 : 0,
        isCompleted ? input.updatedAt : null,
        input.mediaId,
      )

    return this.getLibraryEntry(input.showId) as LibraryEntry
  }

  getShowEpisodeProgress(showId: string): Record<string, EpisodeProgressState> {
    const rows = this.connection
      .prepare(`
        SELECT show_id, episode_number, title, poster_url, watch_progress.current_time AS progress_current_time, duration, completed, updated_at
        FROM watch_progress
        WHERE show_id = ?
        ORDER BY updated_at DESC
      `)
      .all(showId) as unknown as WatchProgressRow[]

    return Object.fromEntries(
      rows.map((row) => [
        row.episode_number,
        {
          currentTime: row.progress_current_time,
          duration: row.duration,
          completed: row.completed === 1,
          updatedAt: row.updated_at,
        } satisfies EpisodeProgressState,
      ]),
    )
  }

  getShowProgressSummary(showId: string): ShowProgressSummary {
    const progressRows = this.connection
      .prepare(`
        SELECT show_id, episode_number, title, poster_url, watch_progress.current_time AS progress_current_time, duration, completed, updated_at
        FROM watch_progress
        WHERE show_id = ?
        ORDER BY updated_at DESC
      `)
      .all(showId) as unknown as WatchProgressRow[]

    const libraryRow = this.connection
      .prepare(`
        SELECT
          show_id,
          title,
          poster_url,
          latest_episode_number,
          resume_episode_number,
          resume_time,
          updated_at,
          favorited,
          watch_later,
          completed,
          completed_at,
          anilist_media_id
        FROM library_entries
        WHERE show_id = ?
      `)
      .get(showId) as LibraryEntryRow | undefined

    const latestEpisodeNumber =
      libraryRow?.latest_episode_number ??
      [...progressRows]
        .sort((left, right) => parseEpisodeNumber(right.episode_number) - parseEpisodeNumber(left.episode_number))[0]
        ?.episode_number ??
      null

    return {
      completedEpisodeCount: progressRows.filter((row) => row.completed === 1).length,
      startedEpisodeCount: progressRows.length,
      currentEpisodeNumber: libraryRow?.resume_episode_number ?? null,
      currentTime: libraryRow?.resume_time ?? 0,
      latestEpisodeNumber,
      updatedAt: libraryRow?.updated_at ?? progressRows[0]?.updated_at ?? null,
    }
  }

  setAniListConnection(input: {
    viewerId: number
    username: string
    avatarUrl: string | null
    bannerUrl: string | null
    profileUrl: string | null
    about: string | null
    accessToken: string
    refreshToken: string | null
    lastPullAt: string | null
    lastSyncStatus: string | null
  }): AniListConnection {
    const connectedAt = nowIso()
    this.connection
      .prepare(`
        INSERT INTO anilist_connection (
          id,
          viewer_id,
          username,
          avatar_url,
          banner_url,
          profile_url,
          about,
          access_token,
          refresh_token,
          connected_at,
          last_pull_at,
          last_sync_status
        )
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          viewer_id = excluded.viewer_id,
          username = excluded.username,
          avatar_url = excluded.avatar_url,
          banner_url = excluded.banner_url,
          profile_url = excluded.profile_url,
          about = excluded.about,
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          connected_at = excluded.connected_at,
          last_pull_at = excluded.last_pull_at,
          last_sync_status = excluded.last_sync_status
      `)
      .run(
        input.viewerId,
        input.username,
        input.avatarUrl,
        input.bannerUrl,
        input.profileUrl,
        input.about,
        input.accessToken,
        input.refreshToken,
        connectedAt,
        input.lastPullAt,
        input.lastSyncStatus,
      )

    return {
      connected: true,
      username: input.username,
      avatarUrl: input.avatarUrl,
      bannerUrl: input.bannerUrl,
      profileUrl: input.profileUrl,
      about: input.about,
      connectedAt,
      lastPullAt: input.lastPullAt,
      lastSyncStatus: input.lastSyncStatus,
    }
  }

  updateAniListConnectionProfile(input: {
    viewerId: number
    username: string
    avatarUrl: string | null
    bannerUrl: string | null
    profileUrl: string | null
    about: string | null
  }): void {
    this.connection
      .prepare(`
        UPDATE anilist_connection
        SET viewer_id = ?, username = ?, avatar_url = ?, banner_url = ?, profile_url = ?, about = ?
        WHERE id = 1
      `)
      .run(input.viewerId, input.username, input.avatarUrl, input.bannerUrl, input.profileUrl, input.about)
  }

  getAniListConnection(): (AniListConnection & {
    viewerId?: number | null
    accessToken?: string
    refreshToken?: string | null
  }) | null {
    const row = this.connection
      .prepare(`
        SELECT
          viewer_id,
          username,
          avatar_url,
          banner_url,
          profile_url,
          about,
          access_token,
          refresh_token,
          connected_at,
          last_pull_at,
          last_sync_status
        FROM anilist_connection
        WHERE id = 1
      `)
      .get() as
      | {
          viewer_id: number | null
          username: string | null
          avatar_url: string | null
          banner_url: string | null
          profile_url: string | null
          about: string | null
          access_token: string | null
          refresh_token: string | null
          connected_at: string | null
          last_pull_at: string | null
          last_sync_status: string | null
        }
      | undefined

    if (!row?.access_token) {
      return null
    }

    return {
      connected: true,
      username: row.username,
      avatarUrl: row.avatar_url,
      bannerUrl: row.banner_url,
      profileUrl: row.profile_url,
      about: row.about,
      connectedAt: row.connected_at,
      lastPullAt: row.last_pull_at,
      lastSyncStatus: row.last_sync_status,
      viewerId: row.viewer_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
    }
  }

  setAniListPullTimestamp(timestamp: string): void {
    this.connection
      .prepare('UPDATE anilist_connection SET last_pull_at = ? WHERE id = 1')
      .run(timestamp)
  }

  setAniListStatus(status: string): void {
    this.connection
      .prepare('UPDATE anilist_connection SET last_sync_status = ? WHERE id = 1')
      .run(status)
  }

  clearAniListConnection(): void {
    this.connection.prepare('DELETE FROM anilist_connection WHERE id = 1').run()
    this.connection.prepare('DELETE FROM anilist_queue').run()
  }

  enqueueAniListSync(action: string, payload: unknown): void {
    const timestamp = nowIso()
    this.connection
      .prepare(`
        INSERT INTO anilist_queue (action, payload, status, attempts, created_at, updated_at)
        VALUES (?, ?, 'pending', 0, ?, ?)
      `)
      .run(action, JSON.stringify(payload), timestamp, timestamp)
  }

  takePendingAniListJobs(limit = 10): QueueJob[] {
    const rows = this.connection
      .prepare(`
        SELECT id, action, payload, attempts
        FROM anilist_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?
      `)
      .all(limit) as unknown as QueueJob[]

    if (rows.length > 0) {
      const mark = this.connection.prepare(
        `UPDATE anilist_queue SET status = 'processing', updated_at = ? WHERE id = ?`,
      )
      const timestamp = nowIso()
      for (const row of rows) {
        mark.run(timestamp, row.id)
      }
    }

    return rows
  }

  completeAniListJob(id: number): void {
    this.connection.prepare('DELETE FROM anilist_queue WHERE id = ?').run(id)
  }

  failAniListJob(id: number, error: string): void {
    this.connection
      .prepare(`
        UPDATE anilist_queue
        SET status = 'pending', attempts = attempts + 1, last_error = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(error.slice(0, 500), nowIso(), id)
  }
}

function mapWatchProgress(row: WatchProgressRow): WatchProgress {
  return {
    showId: row.show_id,
    episodeNumber: row.episode_number,
    title: row.title,
    posterUrl: row.poster_url,
    currentTime: row.progress_current_time,
    duration: row.duration,
    completed: row.completed === 1,
    updatedAt: row.updated_at,
  }
}

function mapLibraryEntry(row: LibraryEntryRow): LibraryEntry {
  return {
    showId: row.show_id,
    title: row.title,
    posterUrl: row.poster_url,
    latestEpisodeNumber: row.latest_episode_number,
    resumeEpisodeNumber: row.resume_episode_number,
    resumeTime: row.resume_time,
    updatedAt: row.updated_at,
    favorited: row.favorited === 1,
    watchLater: row.watch_later === 1,
    completed: row.completed === 1,
    completedAt: row.completed_at,
  }
}

function ensureColumnExists(connection: DatabaseSync, tableName: string, columnName: string, definition: string): void {
  const columns = connection.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  if (columns.some((column) => column.name === columnName)) {
    return
  }

  connection.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
}

function parseEpisodeNumber(value: string | null | undefined): number {
  if (!value) {
    return -1
  }

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : -1
}
