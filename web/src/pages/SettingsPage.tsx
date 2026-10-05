import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Camera, LocateFixed, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { LocationPicker } from '../components/map/LocationPicker'
import { Avatar, PageSpinner, Spinner } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useMySettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getAuthorities, getMyRoleRequest, requestOfficialRole, updateMyProfile, updateMySettings } from '../lib/api'
import { displayName } from '../lib/format'
import { getCurrentPosition } from '../lib/geo'
import { uploadMedia } from '../lib/media'
import { mediaUrl } from '../lib/supabase'

export function SettingsPage() {
  const { user, profile, loading, refreshProfile } = useAuth()
  const mySettings = useMySettings()
  const toast = useToast()
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [bio, setBio] = useState('')
  const [area, setArea] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [home, setHome] = useState<{ lat: number; lng: number } | null>(null)
  const [anonymous, setAnonymous] = useState(false)
  const [onBoard, setOnBoard] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!profile) return
    setUsername(profile.username)
    setFullName(profile.full_name)
    setBio(profile.bio)
    setArea(profile.area_name)
    setAvatar(profile.avatar_url)
  }, [profile])

  useEffect(() => {
    const s = mySettings.data
    if (!s) return
    setHome(s.home_lat != null && s.home_lng != null ? { lat: s.home_lat, lng: s.home_lng } : null)
    setAnonymous(s.default_anonymous)
    setOnBoard(s.show_on_leaderboard)
  }, [mySettings.data])

  if (!loading && !user) return <Navigate to="/login" replace />
  if (!profile || mySettings.isLoading) return <PageSpinner />

  async function pickAvatar(f: File | undefined) {
    if (!f || !user) return
    try {
      const [m] = await uploadMedia(user.id, [f])
      setAvatar(mediaUrl(m.path))
    } catch (e) {
      toast.error(e)
    }
  }

  async function save() {
    setBusy(true)
    try {
      await updateMyProfile(username.trim().toLowerCase(), fullName, bio, area, avatar)
      await updateMySettings(home?.lat ?? null, home?.lng ?? null, anonymous, onBoard)
      await refreshProfile()
      qc.invalidateQueries({ queryKey: ['my_settings'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      toast.success('Saved')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-2 py-4 sm:px-4">
      <section className="card space-y-4 p-4">
        <h1 className="text-xl font-bold">Profile</h1>
        <div className="flex items-center gap-4">
          <Avatar url={avatar} name={displayName(fullName, username)} size={72} />
          <button className="btn-soft" onClick={() => fileInput.current?.click()}><Camera className="size-4" /> Change photo</button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="s-name">Full name</label>
            <input id="s-name" className="input" value={fullName} maxLength={80} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="s-user">Username</label>
            <input id="s-user" className="input" value={username} maxLength={24}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="s-area">Area</label>
          <input id="s-area" className="input" value={area} maxLength={80} placeholder="e.g. Mirpur, Dhaka" onChange={(e) => setArea(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="s-bio">Bio</label>
          <textarea id="s-bio" className="input" rows={3} value={bio} maxLength={280} onChange={(e) => setBio(e.target.value)} />
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-lg font-bold">Home area <span className="text-sm font-normal text-muted">(private)</span></h2>
        <p className="text-sm text-muted">
          Only you can see this. It's used to show nearby issues, and your votes count 1.5× for issues near home —
          locals know their area best. It also lets you confirm fixes near home.
        </p>
        <LocationPicker value={home} onPick={(lat, lng) => setHome({ lat, lng })} height={240} />
        <div className="flex gap-2">
          <button className="btn-soft" onClick={async () => {
            try { const p = await getCurrentPosition(); setHome({ lat: p.lat, lng: p.lng }) } catch (e) { toast.error(e) }
          }}><LocateFixed className="size-4" /> Use current location</button>
          {home && <button className="btn-ghost" onClick={() => setHome(null)}>Clear</button>}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-lg font-bold">Privacy</h2>
        <Toggle checked={anonymous} onChange={setAnonymous} title="Post anonymously by default"
          help="Your name is hidden on new reports. You can still change it per post." />
        <Toggle checked={onBoard} onChange={setOnBoard} title="Show me on the volunteer leaderboard"
          help="Turn off to volunteer without appearing in public rankings." />
      </section>

      <button className="btn-primary w-full py-3" disabled={busy} onClick={save}>
        {busy ? <Spinner className="size-4 text-brand-ink" /> : <Save className="size-4" />} Save settings
      </button>

      <OfficialApplication />
    </div>
  )
}

/** City Corporation staff ask to be verified. An admin checks and approves. */
function OfficialApplication() {
  const { officialOf } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const authorities = (useQuery({ queryKey: ['authorities'], queryFn: getAuthorities }).data ?? []).filter((a) => a.is_active)
  const request = useQuery({ queryKey: ['my_role_request'], queryFn: getMyRoleRequest })
  const [authority, setAuthority] = useState('')
  const [designation, setDesignation] = useState('')
  const [office, setOffice] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  if (officialOf) {
    return (
      <section className="card flex items-center gap-3 p-4 text-sm">
        <Building2 className="size-5 text-warn" /> You are a verified {officialOf.shortName} official.
      </section>
    )
  }
  if (!authorities.length) return null
  const pending = request.data?.status === 'pending'

  async function submit() {
    setBusy(true)
    try {
      await requestOfficialRole(authority, designation, office, message)
      toast.success('Request sent. An admin will verify you.')
      qc.invalidateQueries({ queryKey: ['my_role_request'] })
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Building2 className="size-5 text-warn" /> Work for a City Corporation?</h2>
      <p className="text-sm text-muted">
        Verified officials get a dashboard of escalated issues in their area and a badge on their updates.
        An admin checks your identity before approving.
      </p>
      {request.data && (
        <p className="rounded-lg bg-bg p-3 text-sm">
          Your request to be a {request.data.authority_short_name} official is <strong>{request.data.status}</strong>
          {request.data.decision_note && `: ${request.data.decision_note}`}
        </p>
      )}
      {!pending && (
        <>
          <select className="input" value={authority} onChange={(e) => setAuthority(e.target.value)} aria-label="City Corporation">
            <option value="">Choose your City Corporation</option>
            {authorities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input className="input" value={designation} maxLength={120} onChange={(e) => setDesignation(e.target.value)}
            placeholder="Your designation, e.g. Conservancy Inspector" aria-label="Designation" />
          <input className="input" value={office} maxLength={200} onChange={(e) => setOffice(e.target.value)}
            placeholder="Office / zone, e.g. Zone 2, Mirpur" aria-label="Office" />
          <textarea className="input" rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="How can the admin verify you? e.g. official email, staff ID, office phone" aria-label="Message" />
          <button className="btn-soft w-full" disabled={busy || !authority || designation.trim().length < 2} onClick={submit}>
            {busy && <Spinner className="size-4" />} Ask to be verified
          </button>
        </>
      )}
    </section>
  )
}

function Toggle({ checked, onChange, title, help }: { checked: boolean; onChange: (v: boolean) => void; title: string; help: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{help}</span>
      </span>
      <input type="checkbox" className="mt-1 size-5 accent-[var(--brand)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
