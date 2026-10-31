// localStorage access that never throws (private mode, blocked storage, SSR-less tests).

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the choice simply is not remembered.
  }
}

const WORKSPACE_KEY = 'leadpilot.activeWorkspaceId'

export function getStoredWorkspaceId(): string | null {
  return readStorage(WORKSPACE_KEY)
}

export function setStoredWorkspaceId(id: string | null): void {
  writeStorage(WORKSPACE_KEY, id)
}
