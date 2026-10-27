import clsx from 'clsx'

export function ActionButton({ icon, label, onClick, active, activeClass, disabled, title, hideLabelOnMobile }: {
  icon: React.ReactNode; label: string; onClick?: () => void; active?: boolean; activeClass?: string
  disabled?: boolean; title?: string; hideLabelOnMobile?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={clsx(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-semibold transition-colors',
        'hover:bg-card-hover disabled:cursor-not-allowed disabled:hover:bg-transparent',
        active ? activeClass : 'text-muted',
        disabled && !active && 'opacity-50',
      )}
    >
      {icon}
      <span className={clsx('hidden', hideLabelOnMobile ? 'md:inline' : 'sm:inline')}>{label}</span>
    </button>
  )
}
