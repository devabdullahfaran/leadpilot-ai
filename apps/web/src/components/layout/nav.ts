import {
  Bot,
  ChartColumn,
  LayoutDashboard,
  Plug,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  /** Mode-relative path; prefixed with the data-mode base path when rendered. */
  path: string
  icon: LucideIcon
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { label: 'Analytics', path: '/analytics', icon: ChartColumn },
    ],
  },
  {
    label: 'CRM',
    items: [{ label: 'Leads', path: '/leads', icon: Users }],
  },
  {
    label: 'Automation',
    items: [
      { label: 'AI Qualification', path: '/qualification', icon: Bot },
      { label: 'Workflows', path: '/workflows', icon: Workflow },
      { label: 'Integrations', path: '/integrations', icon: Plug },
    ],
  },
]

export const SETTINGS_ITEM: NavItem = { label: 'Settings', path: '/settings', icon: Settings }

/** Route `handle` used for breadcrumbs and document titles. */
export interface RouteHandle {
  crumb: string
  /** Mode-relative parent, e.g. Leads for a lead detail page. */
  parent?: { label: string; path: string }
}

export function isRouteHandle(value: unknown): value is RouteHandle {
  return typeof value === 'object' && value !== null && typeof (value as RouteHandle).crumb === 'string'
}
