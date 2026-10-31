import { Eye, LogIn } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { buildAppLink, useDataMode } from '@/app/data-mode'
import { useAuth } from '@/auth/auth-context'
import { LogoMark } from '@/components/app/logo'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from './nav'
import { UserMenu } from './user-menu'
import { WorkspaceSwitcher } from './workspace-switcher'

function NavLinkItem({ item }: { item: NavItem }) {
  const { basePath } = useDataMode()
  const { pathname } = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const href = buildAppLink(basePath, item.path)
  const active = pathname === href || pathname.startsWith(`${href}/`)
  const Icon = item.icon

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={item.label}
        render={<Link to={href} aria-current={active ? 'page' : undefined} />}
        onClick={() => {
          if (isMobile) setOpenMobile(false)
        }}
        className="data-active:text-primary data-active:[&_svg]:text-primary"
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function PreviewFooter() {
  const { session, configured } = useAuth()
  const to = session ? '/dashboard' : '/login'
  return (
    <div className="rounded-lg border bg-background p-3 shadow-xs group-data-[collapsible=icon]:hidden">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Eye className="size-3.5 text-primary" aria-hidden="true" />
        Preview
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Read-only sample workspace.</p>
      <Button size="sm" className="mt-2.5 w-full" render={<Link to={to} />} nativeButton={false}>
        <LogIn aria-hidden="true" />
        {session ? 'Open your workspace' : configured ? 'Sign in' : 'About sign-in'}
      </Button>
    </div>
  )
}

export function AppSidebar() {
  const { mode, basePath } = useDataMode()
  const preview = mode === 'demo'

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-1 pb-0">
        <Link
          to={buildAppLink(basePath, '/dashboard')}
          className="flex h-10 items-center gap-2 rounded-md px-2 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:px-0.5"
          aria-label="LeadPilot home"
        >
          <LogoMark className="size-6" />
          <span className="text-[15px] font-semibold tracking-tight text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden">
            LeadPilot
          </span>
        </Link>
        {preview ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex h-12 items-center gap-2 rounded-md px-2 group-data-[collapsible=icon]:hidden">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-dashed bg-background text-xs font-semibold text-muted-foreground">
                  S
                </span>
                <span className="grid min-w-0 leading-tight">
                  <span className="truncate text-sm font-medium text-sidebar-accent-foreground">Sample workspace</span>
                  <span className="truncate text-xs text-muted-foreground">Portfolio preview</span>
                </span>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          <WorkspaceSwitcher />
        )}
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="py-1.5">
            <SidebarGroupLabel className="h-7 text-[11px] tracking-wide text-muted-foreground uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => (
                  <NavLinkItem key={item.path} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <SidebarGroup className="mt-auto py-1.5">
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLinkItem item={SETTINGS_ITEM} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">{preview ? <PreviewFooter /> : <UserMenu />}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
