import clsx from 'clsx'

export function Note({ icon, children, tone = 'muted' }: { icon: React.ReactNode; children: React.ReactNode; tone?: 'muted' | 'brand' | 'warn' | 'danger' }) {
  return (
    <div className={clsx('flex items-start gap-2 rounded-lg p-3 text-sm',
      tone === 'brand' ? 'bg-brand-soft' : tone === 'warn' ? 'bg-warn-soft' : tone === 'danger' ? 'bg-danger-soft' : 'bg-bg')}>
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
