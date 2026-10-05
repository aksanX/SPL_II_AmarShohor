import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

/** Sun / moon button that switches between the light and dark theme. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label}
      className="grid size-9 place-items-center rounded-full text-muted hover:bg-card-hover hover:text-ink">
      {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  )
}
