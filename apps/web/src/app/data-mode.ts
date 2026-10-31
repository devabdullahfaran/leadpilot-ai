import { createContext, useCallback, useContext } from 'react'
import type { DataMode } from '@/lib/api-client'

export type { DataMode }

export interface DataModeValue {
  /** `user` = signed-in workspace data, `demo` = public read-only portfolio preview. */
  mode: DataMode
  /** Route prefix for this mode: '' or '/preview'. */
  basePath: '' | '/preview'
  /** True in preview mode: every mutating control must be disabled (see ReadOnlyGuard). */
  readOnly: boolean
}

export const USER_MODE: DataModeValue = { mode: 'user', basePath: '', readOnly: false }
export const DEMO_MODE: DataModeValue = { mode: 'demo', basePath: '/preview', readOnly: true }

export const DataModeContext = createContext<DataModeValue>(USER_MODE)

export function useDataMode(): DataModeValue {
  return useContext(DataModeContext)
}

/** Prefixes an app path with the mode's base path: '/leads/1' → '/preview/leads/1' in preview mode. */
export function buildAppLink(basePath: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${basePath}${normalized}`
}

/** `const link = useAppLink(); <Link to={link(`/leads/${id}`)} />` */
export function useAppLink(): (path: string) => string {
  const { basePath } = useDataMode()
  return useCallback((path: string) => buildAppLink(basePath, path), [basePath])
}
