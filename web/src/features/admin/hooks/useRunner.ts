import { useState } from 'react'
import { useToast } from '@/shared/hooks/useToast'

export function useRunner() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(true)
    try {
      await action()
      toast.success(ok)
      after?.()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}
