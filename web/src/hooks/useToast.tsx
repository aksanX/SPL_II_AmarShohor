import { CircleCheckBig, CircleX, Info, X } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AppError } from '../lib/api'

type Tone = 'success' | 'error' | 'info'
interface Toast { id: number; tone: Tone; message: string }

interface ToastApi {
  success: (message: string) => void
  error: (err: unknown) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function errorMessage(err: unknown) {
  if (err instanceof AppError || err instanceof Error) return err.message
  return 'Something went wrong. Please try again.'
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((tone: Tone, message: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tone, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500)
  }, [])

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (e) => push('error', errorMessage(e)),
    info: (m) => push('info', m),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[2000] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="card pointer-events-auto flex w-full max-w-md items-start gap-3 p-3 text-sm shadow-lg"
          >
            {t.tone === 'success' && <CircleCheckBig className="mt-0.5 size-5 shrink-0 text-brand" />}
            {t.tone === 'error' && <CircleX className="mt-0.5 size-5 shrink-0 text-danger" />}
            {t.tone === 'info' && <Info className="mt-0.5 size-5 shrink-0 text-info" />}
            <p className="flex-1">{t.message}</p>
            <button
              aria-label="Dismiss"
              className="text-muted hover:text-ink"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
