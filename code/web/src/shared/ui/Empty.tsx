import type { ReactNode } from 'react'

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  )
}
