import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

// index.html sets <html data-theme> before the first paint; this keeps React in step with it.
const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem('theme')
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

/** Light / dark theme. A choice made here is remembered; until then it follows the device setting. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // With no saved choice, keep following the device if it switches (e.g. automatic dark mode at night).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => { if (!savedTheme()) setTheme(mq.matches ? 'dark' : 'light') }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('theme', next) } catch { /* private mode: still switches, just not remembered */ }
    setTheme(next)
  }

  return { theme, toggle }
}
