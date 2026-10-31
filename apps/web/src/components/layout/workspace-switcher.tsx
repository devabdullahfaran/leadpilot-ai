import { Check, ChevronsUpDown } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useWorkspace } from '@/app/workspace'
import { RoleBadge, SampleBadge } from '@/components/app/badges'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { initials } from '@/lib/format'

function WorkspaceTile({ name }: { name: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-semibold text-foreground shadow-xs">
      {initials(name)}
    </span>
  )
}

/** Active workspace + switcher (user mode). Switching persists the choice and refetches scoped data. */
export function WorkspaceSwitcher() {
  const { status, workspace, workspaces, setActiveWorkspace } = useWorkspace()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex h-12 items-center gap-2 px-2">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-4 flex-1 group-data-[collapsible=icon]:hidden" />
      </div>
    )
  }
  if (!workspace) return null

  function select(id: string) {
    if (id === workspace?.id) return
    const target = workspaces.find((w) => w.id === id)
    setActiveWorkspace(id)
    // Detail pages belong to the old workspace; go back to the section root.
    const section = pathname.split('/')[1]
    if (pathname.split('/').length > 2 && section) navigate(`/${section}`)
    toast.success(`Switched to ${target?.name ?? 'workspace'}`)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent"
                aria-label={`Workspace: ${workspace.name}. Switch workspace`}
              />
            }
          >
            <WorkspaceTile name={workspace.name} />
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium text-sidebar-accent-foreground">{workspace.name}</span>
              <span className="truncate text-xs text-muted-foreground capitalize">{workspace.role}</span>
            </span>
            <ChevronsUpDown className="ml-auto text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-60" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem key={w.id} onClick={() => select(w.id)} className="gap-2">
                  <WorkspaceTile name={w.name} />
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.isDemo ? <SampleBadge /> : <RoleBadge role={w.role} />}
                  {w.id === workspace.id ? (
                    <Check className="text-primary" aria-label="Active workspace" />
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
