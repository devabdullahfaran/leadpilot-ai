import { ChevronsUpDown, Eye, LogOut, Settings } from 'lucide-react'
import { Link } from 'react-router'
import { useSession } from '@/api/session'
import { useAuth } from '@/auth/auth-context'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { initials } from '@/lib/format'

export function UserMenu() {
  const { user, signOut } = useAuth()
  const { data: session } = useSession()
  const name = session?.user.fullName || (user?.user_metadata?.full_name as string | undefined) || null
  const email = session?.user.email ?? user?.email ?? null
  const display = name ?? email ?? 'Account'

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />
            }
          >
            <Avatar size="sm" className="size-8">
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {initials(name ?? email)}
              </AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium text-sidebar-accent-foreground">{display}</span>
              {name && email ? <span className="truncate text-xs text-muted-foreground">{email}</span> : null}
            </span>
            <ChevronsUpDown className="ml-auto text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="grid gap-0.5 py-1.5">
                <span className="truncate text-sm font-medium text-foreground">{display}</span>
                {name && email ? <span className="truncate font-normal">{email}</span> : null}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/settings" />}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link to="/preview/dashboard" />}>
              <Eye />
              Portfolio preview
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut()}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
