import { useEffect, useState } from 'react'

/** `value`, but only once it has stayed the same for `ms`: search boxes ask the server when typing pauses. */
export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
