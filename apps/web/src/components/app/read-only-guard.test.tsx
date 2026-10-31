import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataModeProvider } from '@/app/data-mode-provider'
import { WorkspaceContext, type WorkspaceContextValue } from '@/app/workspace'
import { Button } from '@/components/ui/button'
import { ReadOnlyGuard } from './read-only-guard'

function withWorkspace(role: WorkspaceContextValue['role'], children: ReactNode) {
  const value: WorkspaceContextValue = {
    status: 'ready',
    workspace: role ? { id: 'ws-1', name: 'Acme', slug: 'acme', role, isDemo: false } : null,
    workspaces: [],
    role,
    error: null,
    retry: () => {},
    setActiveWorkspace: () => {},
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

describe('ReadOnlyGuard', () => {
  it('disables the control in preview mode and explains why', () => {
    const onClick = vi.fn()
    render(
      <DataModeProvider mode="demo">
        <ReadOnlyGuard action="create leads">
          <Button onClick={onClick}>New lead</Button>
        </ReadOnlyGuard>
      </DataModeProvider>,
    )
    const button = screen.getByRole('button', { name: 'New lead' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByText('Sign in to create leads')).toBeInTheDocument()
  })

  it('leaves the control untouched for a member in user mode', () => {
    const onClick = vi.fn()
    render(
      <DataModeProvider mode="user">
        {withWorkspace(
          'member',
          <ReadOnlyGuard action="create leads" minRole="member">
            <Button onClick={onClick}>New lead</Button>
          </ReadOnlyGuard>,
        )}
      </DataModeProvider>,
    )
    const button = screen.getByRole('button', { name: 'New lead' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Sign in to/)).not.toBeInTheDocument()
  })

  it('disables the control when the role is insufficient', () => {
    render(
      <DataModeProvider mode="user">
        {withWorkspace(
          'viewer',
          <ReadOnlyGuard action="delete leads" minRole="admin">
            <Button>Delete</Button>
          </ReadOnlyGuard>,
        )}
      </DataModeProvider>,
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByText('Requires the Admin role or higher')).toBeInTheDocument()
  })
})
