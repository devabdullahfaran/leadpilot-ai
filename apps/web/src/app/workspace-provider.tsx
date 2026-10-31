import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/api/session'
import { queryKeys } from '@/api/keys'
import { getStoredWorkspaceId, setStoredWorkspaceId } from '@/lib/storage'
import { useDataMode } from './data-mode'
import { WorkspaceContext, type WorkspaceContextValue } from './workspace'

/**
 * Resolves the active workspace in user mode: the stored choice if the session confirms membership,
 * else the API's default (`activeWorkspaceId`), else the first membership. Preview mode has none.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { mode } = useDataMode()
  const queryClient = useQueryClient()
  const session = useSession()
  const [selectedId, setSelectedId] = useState<string | null>(() => getStoredWorkspaceId())

  const data = mode === 'user' ? session.data : undefined
  const workspaces = useMemo(() => data?.workspaces ?? [], [data])
  const workspace =
    workspaces.find((w) => w.id === selectedId) ??
    workspaces.find((w) => w.id === data?.activeWorkspaceId) ??
    workspaces[0] ??
    null

  useEffect(() => {
    if (workspace && workspace.id !== getStoredWorkspaceId()) setStoredWorkspaceId(workspace.id)
  }, [workspace])

  const setActiveWorkspace = useCallback(
    (id: string) => {
      setStoredWorkspaceId(id)
      setSelectedId(id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.user })
    },
    [queryClient],
  )

  const { refetch } = session
  const retry = useCallback(() => void refetch(), [refetch])

  const value = useMemo<WorkspaceContextValue>(() => {
    if (mode === 'demo') {
      return { status: 'ready', workspace: null, workspaces: [], role: null, error: null, retry, setActiveWorkspace }
    }
    const status = !data ? (session.isError ? 'error' : 'loading') : workspace ? 'ready' : 'empty'
    return {
      status,
      workspace,
      workspaces,
      role: workspace?.role ?? null,
      error: session.error,
      retry,
      setActiveWorkspace,
    }
  }, [mode, session.isError, session.error, data, workspace, workspaces, retry, setActiveWorkspace])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
