import os from 'node:os'

import type { AppEnv } from './env.js'

export function printStartupBanner(env: AppEnv) {
  const localUrl = buildOrigin('localhost', env.port)
  const lanUrls = getLanOrigins(env.port)
  const frontendOrigin = env.frontendUrl
  const lines = [
    '',
    colorize('cyan', 'AniFlow is live'),
    divider(),
    row('App', localUrl),
    row('API', `${localUrl}/api/health`),
    row('LAN', lanUrls.length > 0 ? lanUrls.join(', ') : 'No LAN IPv4 address detected'),
    row('Frontend dist', env.frontendDistDir),
    row('Database', env.dbPath),
    row('Password', env.appPassword ? 'Enabled' : 'Disabled'),
    row('AniList callback', `${buildOrigin(resolveCallbackHost(env, lanUrls), env.port)}/api/integrations/anilist/callback`),
    row('Configured frontend URL', frontendOrigin),
    divider(),
    colorize('dim', 'Press Ctrl+C to stop AniFlow.'),
    '',
  ]

  console.log(lines.join('\n'))
}

function resolveCallbackHost(env: AppEnv, lanUrls: string[]) {
  if (env.aniListRedirectUri) {
    try {
      return new URL(env.aniListRedirectUri).hostname
    } catch {
      return 'localhost'
    }
  }

  if (lanUrls.length > 0 && env.host === '0.0.0.0') {
    try {
      return new URL(lanUrls[0]).hostname
    } catch {
      return 'localhost'
    }
  }

  return env.host === '0.0.0.0' ? 'localhost' : env.host
}

function getLanOrigins(port: number) {
  const interfaces = os.networkInterfaces()
  const ips = new Set<string>()

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue
      }

      ips.add(entry.address)
    }
  }

  return [...ips].sort().map((ip) => buildOrigin(ip, port))
}

function buildOrigin(host: string, port: number) {
  return `http://${host}:${port}`
}

function row(label: string, value: string) {
  return `${colorize('yellow', label.padEnd(22, ' '))} ${value}`
}

function divider() {
  return colorize('dim', '-'.repeat(72))
}

function colorize(color: 'cyan' | 'dim' | 'yellow', value: string) {
  if (!process.stdout.isTTY) {
    return value
  }

  const palette = {
    cyan: '\u001b[36m',
    dim: '\u001b[2m',
    yellow: '\u001b[33m',
  }

  return `${palette[color]}${value}\u001b[0m`
}
