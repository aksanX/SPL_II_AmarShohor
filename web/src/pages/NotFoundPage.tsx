import { Compass, Home, MapPin } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'

/** Shown for a link that leads nowhere: an old address, a typo, or a page that was removed. */
export function NotFoundPage() {
  useTitle('Page not found')
  const { pathname } = useLocation()
  return (
    <div className="mx-auto max-w-md p-4">
      <div className="card space-y-4 p-6 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Compass className="size-8" /></div>
        <h1 className="text-xl font-bold">Page not found</h1>
        <p className="break-words text-sm text-muted">
          There is nothing at <code className="rounded bg-bg px-1">{pathname}</code>. The link may be old or mistyped.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/" className="btn-primary"><Home className="size-4" /> Go home</Link>
          <Link to="/map" className="btn-soft"><MapPin className="size-4" /> Open the map</Link>
        </div>
      </div>
    </div>
  )
}
