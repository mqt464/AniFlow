import { createContext, useContext } from 'react'

import type { TranslationType } from '../shared/contracts'

export interface SessionContextValue {
  password: string
  setPassword: (value: string) => void
  preferredTranslationType: TranslationType
  setPreferredTranslationType: (value: TranslationType) => void
  autoNextEnabled: boolean
  setAutoNextEnabled: (value: boolean) => void
  autoSkipSegmentsEnabled: boolean
  setAutoSkipSegmentsEnabled: (value: boolean) => void
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) {
    throw new Error('Session context was not mounted')
  }

  return value
}
