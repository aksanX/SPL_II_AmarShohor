import { useEffect } from 'react'

const APP_NAME = 'AmarShohor'

/** Browser tab title for the open page: "Map · AmarShohor". Pass nothing while the page's data is still loading. */
export function useTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
    return () => { document.title = APP_NAME }
  }, [title])
}
