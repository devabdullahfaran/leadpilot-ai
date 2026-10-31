import { createContext, useContext, useEffect } from 'react'

export interface PageTitleContextValue {
  title: string | null
  setTitle: (title: string | null) => void
}

export const PageTitleContext = createContext<PageTitleContextValue>({ title: null, setTitle: () => {} })

export function usePageTitleContext(): PageTitleContextValue {
  return useContext(PageTitleContext)
}

/**
 * Overrides the last breadcrumb (and the document title) with a dynamic label,
 * e.g. `usePageTitle(lead?.name)` on the lead detail page. Cleared on unmount.
 */
export function usePageTitle(title: string | null | undefined): void {
  const { setTitle } = usePageTitleContext()
  useEffect(() => {
    setTitle(title ?? null)
    return () => setTitle(null)
  }, [title, setTitle])
}
