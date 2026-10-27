import { Link } from 'react-router-dom'

export function Logo() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2">
      <img src="/favicon.svg" alt="" className="size-9" />
      <span className="hidden text-xl font-extrabold tracking-tight text-brand lg:inline">AmarShohor</span>
    </Link>
  )
}
