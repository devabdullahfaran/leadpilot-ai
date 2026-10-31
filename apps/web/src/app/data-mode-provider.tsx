import type { ReactNode } from 'react'
import { DataModeContext, DEMO_MODE, USER_MODE } from './data-mode'
import type { DataMode } from '@/lib/api-client'

export function DataModeProvider({ mode, children }: { mode: DataMode; children: ReactNode }) {
  return <DataModeContext.Provider value={mode === 'demo' ? DEMO_MODE : USER_MODE}>{children}</DataModeContext.Provider>
}
