import { UserRound } from 'lucide-react'

export function Avatar({ url, name, size = 40, anonymous = false }: {
  url?: string | null; name?: string | null; size?: number; anonymous?: boolean
}) {
  const style = { width: size, height: size }
  if (anonymous) {
    return (
      <div style={style} className="grid shrink-0 place-items-center rounded-full bg-card-hover text-muted" title="Anonymous">
        <UserRound className="size-1/2" />
      </div>
    )
  }
  if (url) return <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  const initials = (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{ ...style, fontSize: size * 0.4 }} className="grid shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand">
      {initials}
    </div>
  )
}
