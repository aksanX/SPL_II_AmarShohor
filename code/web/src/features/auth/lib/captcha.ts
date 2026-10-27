// Cloudflare Turnstile, the CAPTCHA Supabase Auth supports. Off unless VITE_TURNSTILE_SITE_KEY is set.
// Turn it on in both places at once: the key here, and the secret in Supabase → Authentication → Bot and
// Abuse Protection. Supabase then refuses sign-ups and logins without a fresh token.

export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || null
export const captchaEnabled = TURNSTILE_SITE_KEY !== null

export interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string
  reset(id: string): void
  remove(id: string): void
}

declare global {
  interface Window { turnstile?: Turnstile }
}

let loading: Promise<Turnstile> | null = null

/** Loads Cloudflare's script once, however many forms are on the page. */
export function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('CAPTCHA failed to load')))
    script.onerror = () => {
      loading = null
      reject(new Error('Could not load the CAPTCHA. Check your connection and try again.'))
    }
    document.head.appendChild(script)
  })
  return loading
}
