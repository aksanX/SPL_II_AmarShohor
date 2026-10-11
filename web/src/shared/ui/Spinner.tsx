import clsx from 'clsx'
import { LoaderCircle } from 'lucide-react'

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={clsx('animate-spin text-muted', className ?? 'size-6')} aria-label="Loading" />
}

export function PageSpinner() {
  return (
    <div className="grid place-items-center py-16">
      <Spinner className="size-8" />
    </div>
  )
}
