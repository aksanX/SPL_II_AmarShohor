import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { LocateFixed, Siren } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { LocationPicker } from '@/features/map/components/LocationPicker'
import { MiniMap } from '@/features/map/components/MiniMap'
import { LiveCamera } from '@/features/media/components/LiveCamera'
import { Spinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useTitle } from '@/shared/hooks/useTitle'
import { useToast } from '@/shared/hooks/useToast'
import { emergencyService } from '@/features/emergency/services/emergency.service'
import { issueService } from '@/features/issues/services/issue.service'
import { placeSearchService } from '@/shared/geo/placeSearch.service'
import { locationService } from '@/shared/geo/location.service'
import type { EmergencyKind, UploadedMedia } from '@/models'
import { EMERGENCY_KINDS } from '@/features/emergency/components/emergencyKinds'
import { CallFirst } from '@/features/emergency/components/CallFirst'

export function EmergencyPage() {
  useTitle('Emergency alert')
  const { user, role } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  // ?kind=live_wire from the report form; ?issue=<id> when an existing issue got dangerous.
  const [params] = useSearchParams()
  const issueId = params.get('issue')
  const issue = useQuery({ queryKey: ['issue', issueId], queryFn: () => issueService.getIssue(issueId!), enabled: Boolean(issueId) }).data
  const [kind, setKind] = useState<EmergencyKind | null>(
    EMERGENCY_KINDS.find((k) => k.kind === params.get('kind'))?.kind ?? null,
  )
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(locationService.getLastKnownPosition())
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [media, setMedia] = useState<UploadedMedia[]>([])
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const local = useQuery({
    queryKey: ['emergency_contacts', point?.lat.toFixed(3), point?.lng.toFixed(3)],
    queryFn: () => emergencyService.getEmergencyContactsAt(point!.lat, point!.lng),
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
      const p = await locationService.getCurrentPosition()
      setPoint({ lat: p.lat, lng: p.lng })
      setAddress((await placeSearchService.reverseGeocode(p.lat, p.lng)) || address)
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
      const id = await emergencyService.createEmergencyAlert(kind, note, point.lat, point.lng, address, media, issue?.id ?? null)
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
        ) : role !== 'citizen' ? (
          <p className="rounded-lg bg-bg p-3 text-sm">
            Alerts are raised by residents on site. As {role === 'official' ? 'a City Corporation official' : 'an admin'} you
            check verified alerts from your {role === 'official' ? 'dashboard' : 'review queue'}. Call 999 first if someone is in danger.
          </p>
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
                const a = await placeSearchService.reverseGeocode(lat, lng)
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

