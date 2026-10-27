import clsx from 'clsx'

export function MenuItem({ icon, children, onClick, danger }: {
  icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={clsx('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-card-hover', danger && 'text-danger')}
    >
      {icon}
      {children}
    </button>
  )
}
