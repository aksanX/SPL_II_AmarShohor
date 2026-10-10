import { useEffect, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY, loadTurnstile } from '../lib/captcha'

/**
 * The "I'm not a robot" check. Calls onToken with a one-time token, or null when it expires.
 * Change `round` after every attempt: Supabase accepts each token once, so the check starts again.
 * Renders nothing when the CAPTCHA is off.
 */
export function Captcha({ onToken, round }: { onToken: (token: string | null) => void; round: number }) {
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const callback = useRef(onToken)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { callback.current = onToken }, [onToken])

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false
    loadTurnstile()
      .then((t) => {
        if (cancelled || !box.current) return
        widget.current = t.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(null),
          'error-callback': () => callback.current(null),
        })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [])

  useEffect(() => {
    if (round > 0 && widget.current) {
      window.turnstile?.reset(widget.current)
      callback.current(null)
    }
  }, [round])

  if (!TURNSTILE_SITE_KEY) return null
  return (
    <div>
      <div ref={box} className="flex min-h-[65px] justify-center" />
      {error && <p className="text-center text-xs text-danger">{error}</p>}
    </div>
  )
}
