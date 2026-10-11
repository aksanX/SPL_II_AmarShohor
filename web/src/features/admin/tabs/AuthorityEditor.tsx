import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { AreaDrawer } from '@/features/map/components/area-drawer/AreaDrawer'
import { type LatLng, polygonFromRing, ringFromGeoJSON } from '@/features/map/lib/outline'
import { Spinner } from '@/shared/ui'
import { roleService } from '@/features/admin/services/role.service'
import { authorityService } from '@/features/city-corp/services/authority.service'
import { SEVERITY_META } from '@/features/issues/lib/issueLabels'
import type { Authority, EmergencyContact } from '@/models'
import { useRunner } from '@/features/admin/hooks/useRunner'

export function AuthorityEditor({ authority, all, onDone }: { authority: Authority | null; all: Authority[]; onDone: () => void }) {
  const qc = useQueryClient()
  const { busy, run } = useRunner()
  const areaAdmins = (useQuery({ queryKey: ['roles', 'all'], queryFn: roleService.getRoles }).data ?? [])
    .filter((r) => r.role === 'city_admin' && r.authority_id === authority?.id)
  const [name, setName] = useState(authority?.name ?? '')
  const [shortName, setShortName] = useState(authority?.short_name ?? '')
  const [hotline, setHotline] = useState(authority?.hotline ?? '')
  const [complaintUrl, setComplaintUrl] = useState(authority?.complaint_url ?? '')
  const [emailDomain, setEmailDomain] = useState(authority?.email_domain ?? '')
  const [contacts, setContacts] = useState<EmergencyContact[]>(authority?.emergency_contacts ?? [])
  const [due, setDue] = useState({
    critical: authority?.due_days_critical ?? 3, high: authority?.due_days_high ?? 7,
    medium: authority?.due_days_medium ?? 14, low: authority?.due_days_low ?? 30,
  })
  const [active, setActive] = useState(authority?.is_active ?? true)
  const [kind, setKind] = useState<Authority['kind']>(authority?.kind ?? 'city_corporation')
  const [points, setPoints] = useState<LatLng[]>(ringFromGeoJSON(authority?.area))
  const others = all.filter((a) => a.id !== authority?.id).map((a) => ({ name: a.short_name, ring: ringFromGeoJSON(a.area) }))

  function save() {
    run(() => authorityService.adminSaveAuthority({
      id: authority?.id ?? null, name, shortName, area: polygonFromRing(points), hotline, complaintUrl,
      emergencyContacts: contacts.filter((c) => c.label.trim() && c.phone.trim()),
      dueCritical: due.critical, dueHigh: due.high, dueMedium: due.medium, dueLow: due.low, isActive: active, kind, emailDomain,
    }), 'Saved.', () => {
      qc.invalidateQueries({ queryKey: ['authorities'] })
      qc.invalidateQueries({ queryKey: ['authority_records'] })
      onDone()
    })
  }

  return (
    <div className="card space-y-4 p-4">
      <h2 className="text-lg font-bold">{authority ? `Edit ${authority.short_name}` : 'New City Corporation'}</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div><label className="label" htmlFor="a-name">Name</label>
          <input id="a-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dhaka North City Corporation" /></div>
        <div><label className="label" htmlFor="a-short">Short name</label>
          <input id="a-short" className="input" value={shortName} maxLength={16} onChange={(e) => setShortName(e.target.value)} placeholder="DNCC" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="a-kind">Type</label>
          <select id="a-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as Authority['kind'])}>
            <option value="city_corporation">City Corporation (receives escalated issues in its area)</option>
            <option value="agency">Other agency, e.g. DESCO, WASA (only receives issues an admin refers to it)</option>
          </select></div>
        <div><label className="label" htmlFor="a-hotline">Hotline</label>
          <input id="a-hotline" className="input" value={hotline} onChange={(e) => setHotline(e.target.value)} placeholder="16106" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="a-domain">Official email domain</label>
          <input id="a-domain" className="input" value={emailDomain} onChange={(e) => setEmailDomain(e.target.value.trim().toLowerCase())}
            placeholder="dncc.gov.bd" />
          <p className="mt-1 text-xs text-muted">
            Officials sign up with an email at this domain (or a subdomain of it). Leave empty to take no official sign-ups.
          </p></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="a-url">Official complaint page (optional)</label>
          <input id="a-url" className="input" value={complaintUrl} onChange={(e) => setComplaintUrl(e.target.value)} placeholder="https://…" /></div>
      </div>

      <div>
        <span className="label">Service area</span>
        <AreaDrawer points={points} onChange={setPoints} others={others} name={name} />
      </div>

      <div>
        <span className="label">Target time to deal with an escalated issue (days)</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['critical', 'high', 'medium', 'low'] as const).map((k) => (
            <label key={k} className="text-sm">
              <span className="text-muted">{SEVERITY_META[k].label}</span>
              <input type="number" min={1} className="input" value={due[k]}
                onChange={(e) => setDue({ ...due, [k]: Math.max(1, Number(e.target.value)) })} />
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="label">Local emergency numbers (shown next to 999 for emergencies in this area)</span>
        {contacts.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input className="input" value={c.label} placeholder="e.g. Mirpur Fire Station" aria-label="Label"
              onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="input w-40" value={c.phone} placeholder="Phone" aria-label="Phone"
              onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
            <button className="btn-ghost" aria-label="Remove" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}><X className="size-4" /></button>
          </div>
        ))}
        <button className="btn-ghost text-xs" onClick={() => setContacts([...contacts, { label: '', phone: '' }])}><Plus className="size-3.5" /> Add number</button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (receives escalated issues)
      </label>
      {!active && authority?.is_active && areaAdmins.length > 0 && (
        <p className="rounded-lg bg-warn-soft p-3 text-sm text-warn">
          Switching this off leaves its area admin{areaAdmins.length > 1 && 's'} ({areaAdmins.map((r) => `@${r.username}`).join(', ')})
          with nothing to act on: its cases go to you until it is switched on again. They will be told.
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || name.trim().length < 2 || shortName.trim().length < 2 || points.length < 3} onClick={save}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Save
        </button>
        <button className="btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}
