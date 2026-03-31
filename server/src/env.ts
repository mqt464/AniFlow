import path from 'node:path'

export interface AppEnv {
  host: string
  port: number
  frontendUrl: string
  frontendDistDir: string
  appPassword: string | null
  dataDir: string
  dbPath: string
  allAnimeReferer: string
  aniSkipClientId: string
  aniListClientId: string | null
  aniListClientSecret: string | null
  aniListRedirectUri: string | null
  cacheTtlMs: number
}

export function loadEnv(): AppEnv {
  const dataDir = process.env.ANIFLOW_DATA_DIR ?? path.resolve(process.cwd(), 'server/data')
  const port = Number(process.env.ANIFLOW_PORT ?? 8787)
  const frontendPort = Number(process.env.ANIFLOW_WEB_PORT ?? 4173)
  const frontendUrl = process.env.ANIFLOW_FRONTEND_URL?.trim() || `http://localhost:${frontendPort}`

  return {
    host: process.env.ANIFLOW_HOST ?? '0.0.0.0',
    port,
    frontendUrl,
    frontendDistDir: path.resolve(process.cwd(), 'dist'),
    appPassword: process.env.ANIFLOW_APP_PASSWORD?.trim() || null,
    dataDir,
    dbPath: process.env.ANIFLOW_DB_PATH ?? path.join(dataDir, 'aniflow.sqlite'),
    allAnimeReferer: process.env.ANIFLOW_ALLANIME_REFERER ?? 'https://allmanga.to',
    aniSkipClientId: process.env.ANISKIP_CLIENT_ID ?? 'ZGfO0sMF3eCwLYf8yMSCJjlynwNGRXWE',
    aniListClientId: process.env.ANILIST_CLIENT_ID?.trim() || null,
    aniListClientSecret: process.env.ANILIST_CLIENT_SECRET?.trim() || null,
    aniListRedirectUri:
      process.env.ANILIST_REDIRECT_URI?.trim() ||
      `http://localhost:${port}/api/integrations/anilist/callback`,
    cacheTtlMs: Number(process.env.ANIFLOW_CACHE_TTL_MS ?? 1000 * 60 * 60 * 6),
  }
}
