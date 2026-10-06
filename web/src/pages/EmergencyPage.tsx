import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Biohazard, Building, CircleAlert, Clock, Flame, LocateFixed, Phone, Siren, ThumbsDown, ThumbsUp, Waves, Wind, Zap, CheckCircle2,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { LocationPicker, MiniMap } from '../components/map/LocationPicker'
import { MediaGallery } from '../components/MediaGallery'
import { LiveCamera } from '../components/LiveCamera'
import { Empty, PageSpinner, Spinner } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { createEmergencyAlert, getAlert, getEmergencyContactsAt, getIssue, respondEmergency, reviewEmergency } from '../lib/api'
import { timeAgo, timeLeft } from '../lib/format'
import { getCurrentPosition, getLastKnownPosition, reverseGeocode } from '../lib/geo'
import type { EmergencyContact, EmergencyKind, UploadedMedia } from '../lib/types'

const EMERGENCY_KINDS: { kind: EmergencyKind; label: string; icon: ReactNode }[] = [
  { kind: 'fire', label: 'Fire', icon: <Flame className="size-5" /> },
  { kind: 'gas_leak', label: 'Gas leak', icon: <Wind className="size-5" /> },
  { kind: 'building_collapse', label: 'Building collapse', icon: <Building className="size-5" /> },
  { kind: 'live_wire', label: 'Live electric wire', icon: <Zap className="size-5" /> },
  { kind: 'flood_rescue', label: 'People trapped by flooding', icon: <Waves className="size-5" /> },
  { kind: 'toxic_release', label: 'Chemical spill or toxic smoke', icon: <Biohazard className="size-5" /> },
  { kind: 'other', label: 'Other emergency', icon: <CircleAlert className="size-5" /> },
]
const emergencyLabel = (k: EmergencyKind) => EMERGENCY_KINDS.find((x) => x.kind === k)?.label ?? 'Emergency'

/** 999 first, always. Shown as text because phone links don't work everywhere. */
function CallFirst({ contacts, area }: { contacts?: EmergencyContact[]; area?: string | null }) {
  return (
    <div className="space-y-3 rounded-xl bg-danger p-4 text-white">
      <p className="flex items-center gap-2 text-lg font-bold"><Siren className="size-6" /> Call first</p>
      <a href="tel:999" className="flex items-center justify-between rounded-lg bg-white/15 p-3 hover:bg-white/25">
        <span>National emergency (police, fire, ambulance)</span>
        <span className="flex items-center gap-2 text-2xl font-extrabold tabular-nums"><Phone className="size-5" /> 999</span>
      </a>
      {contacts && contacts.length > 0 && (
        <div className="space-y-1">
          {area && <p className="text-xs opacity-80">Local numbers for {area}</p>}
          {contacts.map((c) => (
            <a key={c.label + c.phone} href={`tel:${c.phone}`} className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
              <span>{c.label}</span><span className="select-all font-bold tabular-nums">{c.phone}</span>
            </a>
          ))}
        </div>
      )}
      <p className="text-sm opacity-90">
        AmarShohor is not an emergency service and does not contact the fire service or police. It only warns people nearby.
      </p>
    </div>
  )
}

export function EmergencyPage() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  // ?kind=live_wire from the report form; ?issue=<id> when an existing issue got dangerous.
  const [params] = useSearchParams()
  const issueId = params.get('issue')
  const issue = useQuery({ queryKey: ['issue', issueId], queryFn: () => getIssue(issueId!), enabled: Boolean(issueId) }).data
  const [kind, setKind] = useState<EmergencyKind | null>(
    EMERGENCY_KINDS.find((k) => k.kind === params.get('kind'))?.kind ?? null,
  )
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(getLastKnownPosition())
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [media, setMedia] = useState<UploadedMedia[]>([])
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const local = useQuery({
    queryKey: ['emergency_contacts', point?.lat.toFixed(3), point?.lng.toFixed(3)],
    queryFn: () => getEmergencyContactsAt(point!.lat, point!.lng),
    enabled: Boolean(point),
  }).data

  // The emergency is at the issue: take its spot and address.
  useEffect(() => {
    if (!issue) return
    setPoint({ lat: issue.lat, lng: issue.lng })
    setAddress((a) => a || issue.address)
  }, [issue])

  async function useGps() {
    setLocating(true)
    try {
      const p = await getCurrentPosition()
      setPoint({ lat: p.lat, lng: p.lng })
      setAddress((await reverseGeocode(p.lat, p.lng)) || address)
    } catch (e) {
      toast.error(e)
    } finally {
      setLocating(false)
    }
  }

  async function submit() {
    if (!user || !kind || !point) return
    setBusy(true)
    try {
      const id = await createEmergencyAlert(kind, note, point.lat, point.lng, address, media, issue?.id ?? null)
      toast.success('Alert published. People nearby are being warned.')
      navigate(`/alert/${id}`, { replace: true })
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-2 py-4 sm:px-4">
      <CallFirst contacts={local?.emergency_contacts} area={local?.authority_short_name} />

      <div className="card space-y-4 p-4">
        <div>
          <h1 className="text-xl font-bold">Warn people nearby</h1>
          <p className="text-sm text-muted">After calling, post an alert so neighbours stay away and keep the road clear. It shows immediately as "unverified" until people nearby confirm it.</p>
        </div>
        {issue && (
          <p className="rounded-lg bg-bg p-3 text-sm">
            This issue has become an emergency: <Link to={`/issue/${issue.id}`} className="font-semibold text-brand hover:underline">{issue.title}</Link>.
            The alert is placed at the issue's location and its followers are warned too.
          </p>
        )}
        {!user ? (
          <p className="text-sm"><Link to="/login" className="font-semibold text-brand">Log in</Link> to post an alert.</p>
        ) : (
          <>
            <div>
              <span className="label">What is happening?</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {EMERGENCY_KINDS.map((k) => (
                  <button key={k.kind} type="button" onClick={() => setKind(k.kind)}
                    className={clsx('flex items-center gap-2 rounded-lg border p-2 text-left text-sm',
                      kind === k.kind ? 'border-danger bg-danger-soft font-semibold text-danger' : 'border-line hover:bg-card-hover')}>
                    {k.icon} {k.label}
                  </button>
                ))}
              </div>
            </div>
            {issue ? (
              <div className="space-y-2">
                <span className="label mb-0">Where?</span>
                <MiniMap lat={issue.lat} lng={issue.lng} color="#dc2626" />
                <input className="input" value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)}
                  placeholder="Landmark, e.g. Mirpur 10 market, 3rd floor" aria-label="Landmark" />
              </div>
            ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="label mb-0">Where?</span>
                <button type="button" className="btn-soft" onClick={useGps} disabled={locating}>
                  {locating ? <Spinner className="size-4" /> : <LocateFixed className="size-4" />} Use my GPS
                </button>
              </div>
              <LocationPicker value={point} onPick={async (lat, lng) => {
                setPoint({ lat, lng })
                const a = await reverseGeocode(lat, lng)
                if (a) setAddress(a)
              }} height={220} />
              <input className="input" value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)}
                placeholder="Landmark, e.g. Mirpur 10 market, 3rd floor" aria-label="Landmark" />
            </div>
            )}
            <textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Anything people nearby should know? (optional)" aria-label="Details" />
            <div>
              <span className="label">Live photo or video (optional, only if it's safe)</span>
              <p className="mb-2 text-xs text-muted">An alert with live evidence can be verified by people on site{issue ? ', which makes the issue critical' : ''}.</p>
              <LiveCamera media={media} onChange={setMedia} />
            </div>
            <button className="btn-danger w-full py-3 text-base" disabled={busy || !kind || !point} onClick={submit}>
              {busy ? <Spinner className="size-5" /> : <Siren className="size-5" />} Publish alert
            </button>
            <p className="text-xs text-muted">False alerts are hidden by people nearby and cost reputation.</p>
          </>
        )}
      </div>
    </div>
  )
}

/** Admins and the area's officials: look at the live evidence of a verified alert, keep or reject it. */
function ReviewBox({ alertId, onDone }: { alertId: string; onDone: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function decide(keep: boolean) {
    setBusy(true)
    try {
      await reviewEmergency(alertId, keep, reason)
      toast.success(keep ? 'Kept. The emergency stands.' : 'Rejected. The alert is hidden and the issue goes back to normal.')
      qc.invalidateQueries({ queryKey: ['emergency_reviews'] })
      onDone()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-warn bg-warn-soft p-3">
      <p className="text-sm font-semibold">Check the evidence</p>
      <p className="text-xs text-muted">
        People on site verified this. Look at the live photos below: do they show this emergency at this place?
        Rejecting hides it, removes the issue's critical severity and costs the reporter and confirmers reputation.
      </p>
      <textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (needed to reject), e.g. photos show a normal street" aria-label="Review note" />
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => decide(true)}><ThumbsUp className="size-4" /> Keep</button>
        <button className="btn-danger" disabled={busy || reason.trim().length < 5} onClick={() => decide(false)}>
          <ThumbsDown className="size-4" /> Reject
        </button>
      </div>
    </div>
  )
}

export function AlertPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const alert = useQuery({ queryKey: ['alert', id], queryFn: () => getAlert(id), refetchInterval: 30_000 })
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
        ? getLastKnownPosition() ?? (a!.is_mine ? null : await getCurrentPosition().catch(() => null))
        : await getCurrentPosition()
      const status = await respondEmergency(id, r, pos, r === 'confirm' ? witnessMedia : [], seen)
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
          <span className={clsx('chip', active ? 'bg-danger text-white' : 'bg-card-hover text-muted')}>
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

        {active && user && (a.is_mine ? (
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
        <p className="text-xs text-muted">
          Afterwards, report any damage (debris, burnt poles, broken drains) as a normal issue. Dangerous damage goes straight to the City Corporation.
        </p>
      </div>
    </div>
  )
}
