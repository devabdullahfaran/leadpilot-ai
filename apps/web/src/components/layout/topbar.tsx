import { Fragment, useEffect } from 'react'
import { Link, useMatches, useNavigation } from 'react-router'
import { buildAppLink, useDataMode } from '@/app/data-mode'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { isRouteHandle } from './nav'
import { usePageTitleContext } from './page-title'

export function Topbar() {
  const matches = useMatches()
  const navigation = useNavigation()
  const { basePath, mode } = useDataMode()
  const { title } = usePageTitleContext()

  const handle = [...matches].reverse().map((m) => m.handle).find(isRouteHandle)
  const current = title ?? handle?.crumb ?? null
  const crumbs = [
    ...(handle?.parent ? [{ label: handle.parent.label, to: buildAppLink(basePath, handle.parent.path) }] : []),
    ...(current ? [{ label: current, to: null }] : []),
  ]

  useEffect(() => {
    const parts = [current, mode === 'demo' ? 'Preview' : null, 'LeadPilot AI'].filter(Boolean)
    document.title = parts.join(' · ')
  }, [current, mode])

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-4">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />
      <Separator orientation="vertical" className="mr-1 self-center data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap text-[13px]">
          {crumbs.map((crumb, i) => (
            <Fragment key={`${crumb.label}-${i}`}>
              {i > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem className="min-w-0">
                {crumb.to ? (
                  <BreadcrumbLink render={<Link to={crumb.to} />}>{crumb.label}</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      {navigation.state === 'loading' ? (
        <div
          role="progressbar"
          aria-label="Loading page"
          className="absolute inset-x-0 -bottom-px h-0.5 overflow-hidden bg-primary/15"
        >
          <div className="h-full w-1/3 animate-[lp-progress_1s_ease-in-out_infinite] bg-primary" />
        </div>
      ) : null}
    </header>
  )
}
