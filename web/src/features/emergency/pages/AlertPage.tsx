import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Clock, ThumbsDown, Wrench, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { EmergencyKind, UploadedMedia } from '@/models'
import { locationService } from '@/shared/geo/location.service'
import { useTitle } from '@/shared/hooks/useTitle'
import { useToast } from '@/shared/hooks/useToast'
import { timeAgo, timeLeft } from '@/shared/lib/format'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { Empty, PageSpinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { AdminRemove } from '@/features/emergency/components/AdminRemove'
import { AlertUpdates } from '@/features/emergency/components/AlertUpdates'
import { CallFirst } from '@/features/emergency/components/CallFirst'
import { EMERGENCY_KINDS, emergencyLabel } from '@/features/emergency/components/emergencyKinds'
import { OfficialTools } from '@/features/emergency/components/OfficialTools'
import { ReviewBox } from '@/features/emergency/components/ReviewBox'
import { emergencyService } from '@/features/emergency/services/emergency.service'
import { MiniMap } from '@/features/map/components/MiniMap'
import { LiveCamera } from '@/features/media/components/LiveCamera'
import { MediaGallery } from '@/features/media/components/MediaGallery'

export function AlertPage() {
  const { id = '' } = useParams()
  const { user, role } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const alert = useQuery({ queryKey: ['alert', id], queryFn: () => emergencyService.getAlert(id), refetchInterval: 30_000 })
  useTitle(alert.data ? emergencyLabel(alert.data.kind) : 'Emergency alert')
  const [busy, setBusy] = useState(false)
  const [witnessMedia, setWitnessMedia] = useState<UploadedMedia[]>([])

  if (alert.isLoading) return <PageSpinner />
  const a = alert.data
  if (!a) return <div className="mx-auto max-w-2xl p-4"><Empty title="Alert not found" /></div>
  const active = a.status === 'active'

  async function respond(r: 'confirm' | 'deny' | 'over', seen: EmergencyKind | null = null) {
    setBusy(true)
    try {
      // "I see it" / "not true" need where you are right now; "it's over" can use your home area.
      const pos = r === 'over'
        ? locationService.getLastKnownPosition() ?? (a!.is_mine ? null : await locationService.getCurrentPosition().catch(() => null))
        : await locationService.getCurrentPosition()
      const status = await emergencyService.respondEmergency(id, r, pos, r === 'confirm' ? witnessMedia : [], seen)
      if (r === 'confirm') setWitnessMedia([])
      toast.success(status === 'over' ? 'Marked as over.' : status === 'hidden' ? 'Thanks. The alert was hidden.' : 'Thanks for letting people know.')
      alert.refetch()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-2 py-4 sm:px-4">
      {active && <CallFirst contacts={a.emergency_contacts} area={a.authority_short_name} />}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx('chip', active ? 'bg-danger text-danger-ink' : 'bg-card-hover text-muted')}>
            {active ? (a.verified_at ? `Verified by ${a.on_site_confirms ?? a.confirm_count} people on site`
              : a.confirm_count > 0 ? `Confirmed by ${a.confirm_count} nearby, not yet verified` : 'Unverified emergency report')
              : a.review_status === 'rejected' ? 'Rejected after a look at the evidence'
              : a.status === 'hidden' ? 'Hidden: people nearby said it was not true' : a.verified_at ? 'Verified · over' : 'Over'}
          </span>
          {a.live_evidence && <span className="chip bg-danger-soft text-danger">Live evidence</span>}
          {a.review_status === 'kept' && <span className="chip bg-brand-soft text-brand">Evidence checked</span>}
          {a.review_status === 'pending' && <span className="chip bg-warn-soft text-warn">Evidence being checked</span>}
          <span className="text-xs text-muted">{timeAgo(a.created_at)}</span>
          {active && <span className="flex items-center gap-1 text-xs text-muted"><Clock className="size-3.5" /> ends {timeLeft(a.expires_at).replace(' left', '')} from now</span>}
        </div>
        <h1 className="text-2xl font-bold">{emergencyLabel(a.kind)}{a.address && <span className="font-normal"> near {a.address}</span>}</h1>
        {a.issue_id && a.issue_title && (
          <p className="text-sm text-muted">
            Raised from the issue <Link to={`/issue/${a.issue_id}`} className="font-semibold text-brand hover:underline">{a.issue_title}</Link>.
          </p>
        )}
        {a.note && <p className="whitespace-pre-line">{a.note}</p>}
        {a.review_status === 'rejected' && a.review_note && (
          <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger">Reviewer: {a.review_note}</p>
        )}
        {a.can_review && <ReviewBox alertId={a.id} onDone={() => alert.refetch()} />}
        {a.can_hide && <AdminRemove alertId={a.id} onDone={() => alert.refetch()} />}
        {(a.can_update || a.can_log_damage) && <OfficialTools a={a} onDone={() => alert.refetch()} />}
        <AlertUpdates updates={a.updates ?? []} />
        {a.media.length > 0 && (
          <div className="overflow-hidden rounded-lg">
            <MediaGallery items={a.media.map((m, i) => ({ id: String(i), kind: 'report', media_type: m.type, path: m.path }))} />
          </div>
        )}
        {(a.witness_media?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-semibold">Live photos from people on site</p>
            <div className="overflow-hidden rounded-lg">
              <MediaGallery items={a.witness_media!.map((m, i) => ({ id: `w${i}`, kind: 'confirmation', media_type: m.type, path: m.path }))} />
            </div>
          </div>
        )}
        <MiniMap lat={a.lat} lng={a.lng} color="#dc2626" />
        {active && !a.verified_at && (
          <p className="text-xs text-muted">
            Verified once {settings?.emergency_verify_confirms ?? 2} people within {settings?.emergency_verify_radius_m ?? 300} m
            say they see {a.kind === 'other' ? 'something dangerous' : `"${emergencyLabel(a.kind).toLowerCase()}"`} and
            there is at least one live photo or video. Then an admin or City Corporation official checks the evidence.
          </p>
        )}
        {active && (
          <div className="rounded-lg bg-warn-soft p-3 text-sm">
            <strong>Stay safe:</strong> don't go near. Keep the road clear for fire trucks and ambulances. Volunteers are not sent to emergencies.
          </div>
        )}

        {/* Witnessing is for residents. Admins and officials review the evidence and keep people informed. */}
        {active && user && role !== 'citizen' && (
          <p className="text-xs text-muted">Residents on site confirm or deny alerts. You review the evidence once it is verified.</p>
        )}
        {active && user && role === 'citizen' && (a.is_mine ? (
          <button className="btn-soft w-full" disabled={busy} onClick={() => respond('over')}>
            <CheckCircle2 className="size-4" /> It's over
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Are you nearby? (within {((settings?.emergency_respond_radius_m ?? 2000) / 1000).toFixed(0)} km)</p>
            {a.my_response && (
              <p className="text-xs text-muted">
                You answered: {a.my_response === 'confirm' ? `I see ${a.my_seen ? emergencyLabel(a.my_seen).toLowerCase() : 'it'}`
                  : a.my_response === 'deny' ? 'nothing here' : 'it is over'}.
              </p>
            )}
            <LiveCamera media={witnessMedia} onChange={setWitnessMedia} max={2}
              label="Add a live photo first (optional)" />
            {/* Witnesses name what they see; a one-tap "me too" proves nothing. */}
            <p className="text-sm font-semibold">What do you see right now?</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {EMERGENCY_KINDS.map((k) => (
                <button key={k.kind} type="button" disabled={busy} onClick={() => respond('confirm', k.kind)}
                  className={clsx('flex items-center gap-2 rounded-lg border p-2 text-left text-sm',
                    a.my_seen === k.kind ? 'border-danger bg-danger-soft font-semibold text-danger' : 'border-line hover:bg-card-hover')}>
                  {k.icon} {k.kind === 'other' ? 'Something else dangerous' : k.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-soft" disabled={busy} onClick={() => respond('deny')}><ThumbsDown className="size-4" /> Nothing here</button>
              <button className="btn-soft" disabled={busy} onClick={() => respond('over')}><CheckCircle2 className="size-4" /> It's over</button>
            </div>
          </div>
        ))}
        {a.followup_issue_id ? (
          <p className="rounded-lg bg-brand-soft p-3 text-sm">
            Damage logged for repair:{' '}
            <Link to={`/issue/${a.followup_issue_id}`} className="font-semibold text-brand hover:underline">{a.followup_issue_title}</Link>
          </p>
        ) : !active && a.status !== 'hidden' && role === 'citizen' && (
          <Link to={`/new?lat=${a.lat}&lng=${a.lng}&address=${encodeURIComponent(a.address)}`} className="btn-soft w-full">
            <Wrench className="size-4" /> Report the damage it left
          </Link>
        )}
        <p className="text-xs text-muted">
          Afterwards, report any damage (debris, burnt poles, broken drains) as a normal issue. Dangerous damage goes straight to the City Corporation.
        </p>
      </div>
    </div>
  )
}
