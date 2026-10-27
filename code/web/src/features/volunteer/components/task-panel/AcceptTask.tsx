import { useQuery } from '@tanstack/react-query'
import { Hourglass, HandHelping, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Issue } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { Spinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { Note } from '@/features/volunteer/components/task-panel/Note'
import { ledTaskCount, plural } from '@/features/volunteer/lib/volunteer'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'

export function AcceptTask({ issue, isVolunteer }: { issue: Issue; isVolunteer: boolean }) {
  const { user, role } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  // Same list as the volunteer dashboard (shared cache), to know how many tasks this volunteer already leads.
  const myTasks = useQuery({ queryKey: ['tasks', 'mine'], queryFn: volunteerService.getMyTasks, enabled: Boolean(user) && isVolunteer })

  if (!user) return <Note icon={<HandHelping className="size-5" />}><Link to="/login" className="font-semibold text-brand">Log in</Link> to volunteer for this task.</Note>
  // Volunteering is for citizens, and nobody takes their own report.
  if (issue.is_mine || role !== 'citizen') return null
  if (!isVolunteer) {
    return (
      <Note icon={<HandHelping className="size-5" />}>
        <Link to="/volunteer" className="font-semibold text-brand">Become a volunteer</Link> to take it on.
      </Note>
    )
  }

  const lockHours = settings?.lock_hours ?? 72
  const maxTasks = settings?.max_active_tasks ?? 3
  const atLimit = myTasks.isSuccess && ledTaskCount(myTasks.data, user.id) >= maxTasks

  async function accept() {
    setBusy(true)
    try {
      await volunteerService.acceptTask(issue.id)
      toast.success(`It's yours! Post an update at least every ${lockHours} hours.`)
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
      invalidate(issue.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Taking this task locks it for you. Post a progress update at least every{' '}
        <strong>{lockHours} hours</strong> or it returns to the pool (and you lose {Math.abs(settings?.rep_task_expired ?? 5)} reputation).
        You can release it any time without penalty.
      </p>
      <p className="flex items-start gap-2 text-xs text-muted">
        <Users className="mt-0.5 size-3.5 shrink-0" />
        Too big for one person? After accepting, tap "Ask for more volunteers" and people nearby can join you.
      </p>
      {atLimit && (
        <Note icon={<Hourglass className="size-5" />} tone="warn">
          You already lead {plural(maxTasks, 'task')}, the most allowed at once. Finish or release one first.{' '}
          <Link to="/volunteer" className="font-semibold text-brand">See my tasks</Link>
        </Note>
      )}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || atLimit} onClick={accept}>
          {busy ? <Spinner className="size-4 text-brand-ink" /> : <HandHelping className="size-4" />}
          Accept this task
        </button>
        <button className="btn-soft" onClick={() => navigate('/volunteer')}>More tasks</button>
      </div>
    </div>
  )
}
