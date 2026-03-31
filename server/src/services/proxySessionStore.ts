import { randomUUID } from 'node:crypto'

interface ProxySession {
  id: string
  targetUrl: string
  mimeType: string
  headers: Record<string, string>
  expiresAt: number
}

export class ProxySessionStore {
  private readonly sessions = new Map<string, ProxySession>()

  create(session: Omit<ProxySession, 'id' | 'expiresAt'>): ProxySession {
    const id = randomUUID()
    const value: ProxySession = {
      ...session,
      id,
      expiresAt: Date.now() + 1000 * 60 * 60,
    }

    this.sessions.set(id, value)
    return value
  }

  get(id: string): ProxySession | null {
    const session = this.sessions.get(id)
    if (!session) {
      return null
    }

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id)
      return null
    }

    return session
  }
}
