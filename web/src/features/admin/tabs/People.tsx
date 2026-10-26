import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, Check, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { UserRole } from '@/models'
import { displayName, timeAgo } from '@/shared/lib/format'
import { PageSpinner } from '@/shared/ui'
import { PersonSearch } from '@/features/admin/components/PersonSearch'
import { useRunner } from '@/features/admin/hooks/useRunner'
import { roleService } from '@/features/admin/services/role.service'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { cleanUsername } from '@/features/auth/lib/auth'
import { areaLabel } from '@/features/city-corp/lib/areaLabel'
import { authorityService } from '@/features/city-corp/services/authority.service'

export function People() {
  const { user, isAdmin, cityAdminOf } = useAuth()
  const qc = useQueryClient()
  const requests = useQuery({ queryKey: ['role_requests'], queryFn: () => roleService.getRoleRequests('pending') })
  const roles = useQuery({ queryKey: ['roles', 'all'], queryFn: roleService.getRoles })
  const cities = (useQuery({ queryKey: ['authorities'], queryFn: authorityService.getAuthorities }).data ?? [])
    .filter((a) => a.kind === 'city_corporation' && a.is_active)
  const { busy, run } = useRunner()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [newCityAdmin, setNewCityAdmin] = useState('')
  const [newCity, setNewCity] = useState('')
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['role_requests'] })
    qc.invalidateQueries({ queryKey: ['roles'] })
  }
  const reasonFor = (k: string) => reasons[k] ?? ''
  const setReason = (k: string, v: string) => setReasons((r) => ({ ...r, [k]: v }))
  const all = roles.data ?? []
  // A city admin sees and manages only their own City Corporation's people.
  const inMyCity = (r: UserRole) => isAdmin || r.authority_id === cityAdminOf?.id
  const officials = all.filter((r) => r.role === 'official' && inMyCity(r))
  const cityAdmins = all.filter((r) => r.role === 'city_admin' && inMyCity(r))
  const superAdmins = all.filter((r) => r.role === 'admin')
  const city = isAdmin ? null : cityAdminOf?.area

  const roleRow = (r: UserRole, canRemove: boolean) => {
    const key = `${r.user_id}:${r.role}`
    return (
      <div key={key} className="flex flex-wrap items-center gap-2 p-3 text-sm">
        <Link to={`/u/${r.username}`} className="min-w-0 flex-1 font-semibold hover:underline">{displayName(r.full_name, r.username)}</Link>
        <span className={clsx('chip', r.role === 'official' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand')}>
          {r.role === 'admin' ? 'Super admin' : r.role === 'city_admin' ? `${r.authority_area} admin` : `${r.authority_short_name} official`}
        </span>
        {canRemove && r.user_id !== user?.id && (
          <button className="btn-ghost px-2 py-1 text-xs text-danger" disabled={busy}
            onClick={() => {
              if (!confirm(`Remove @${r.username}? Their login is closed and their name is removed. Their reports and fixes stay, without their name.`)) return
              run(() => roleService.adminDeleteAccount(r.username, r.role), 'Removed. Their login is closed.', refresh)
            }}>
            <Trash2 className="size-3.5" /> Remove
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Super admins don't verify officials (0064): they only see sign-ups stuck in areas without an admin. */}
      {isAdmin ? (requests.data?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 font-bold">Officials waiting for an area admin ({requests.data?.length})</h2>
          <p className="px-1 text-xs text-muted">
            Only an area's own admin verifies its officials. These areas have no admin yet: appoint one below and they'll decide.
          </p>
          <div className="card divide-y divide-line">
            {requests.data?.map((r) => (
              <p key={r.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="font-semibold">{displayName(r.full_name, r.username)}</span>
                <span className="chip bg-warn-soft text-warn">{r.authority_short_name} official</span>
                <span className="text-muted">{r.designation} · signed up {timeAgo(r.created_at)}</span>
              </p>
            ))}
          </div>
        </section>
      ) : (
      <section className="space-y-2">
        <h2 className="px-1 font-bold">Requests to be {city ? `a ${city}` : 'an'} official ({requests.data?.length ?? 0})</h2>
        {requests.isLoading && <PageSpinner />}
        {!requests.isLoading && !requests.data?.length && <p className="card p-4 text-sm text-muted">No pending requests.</p>}
        {requests.data?.map((r) => (
          <article key={r.id} className="card space-y-2 p-4">
            <p className="text-sm">
              <Link to={`/u/${r.username}`} className="font-semibold hover:underline">{displayName(r.full_name, r.username)}</Link>{' '}
              wants to be a <strong>{r.authority_short_name}</strong> official · account {timeAgo(r.account_created_at).replace(' ago', '')} old
            </p>
            <dl className="grid gap-1 text-sm sm:grid-cols-[120px_1fr]">
              <dt className="text-muted">Email</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {r.email}
                {r.official_email
                  ? <span className="chip bg-brand-soft text-brand">Official email ✓ confirmed</span>
                  : <span className="chip bg-warn-soft text-warn">Not an official email</span>}
              </dd>
              <dt className="text-muted">Designation</dt><dd>{r.designation}</dd>
              {r.office && <><dt className="text-muted">Office</dt><dd>{r.office}</dd></>}
              {r.message && <><dt className="text-muted">Message</dt><dd className="whitespace-pre-line">{r.message}</dd></>}
            </dl>
            {r.user_id === user?.id ? (
              <p className="rounded-lg bg-bg p-3 text-sm text-muted">This is your own request. Another admin has to decide it.</p>
            ) : (
              <>
                <p className="text-xs text-muted">
                  {r.official_email
                    ? 'They confirmed this official email. If unsure, check their designation with the City Corporation before approving.'
                    : 'This request is from before official sign-ups. Check their identity with the City Corporation (staff ID or a phone call) before approving.'}
                </p>
                <input className="input" maxLength={500} value={reasonFor(`r${r.id}`)} onChange={(e) => setReason(`r${r.id}`, e.target.value)}
                  placeholder="How you verified them / why you reject" aria-label="Reason" />
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-primary" disabled={busy || reasonFor(`r${r.id}`).trim().length < 5}
                    onClick={() => run(() => roleService.adminDecideRoleRequest(r.id, true, reasonFor(`r${r.id}`)), 'Approved.', refresh)}>
                    <Check className="size-4" /> Approve
                  </button>
                  <button className="btn-soft" disabled={busy || reasonFor(`r${r.id}`).trim().length < 5}
                    onClick={() => run(() => roleService.adminDecideRoleRequest(r.id, false, reasonFor(`r${r.id}`)), 'Rejected.', refresh)}>
                    <X className="size-4" /> Reject
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </section>
      )}

      <section className="space-y-2">
        <h2 className="px-1 font-bold">{city ? `${city} officials` : 'Officials'} ({officials.length})</h2>
        {isAdmin && <p className="px-1 text-xs text-muted">Officials of every City Corporation. Area admins verify new ones; you can remove any official at any time.</p>}
        <div className="card divide-y divide-line">
          {officials.map((r) => roleRow(r, true))}
          {!officials.length && (
            <p className="p-4 text-sm text-muted">
              No verified officials yet. They sign up with their official email on the City Corporation sign-up page
              {isAdmin ? ', and their area admin approves them.' : ' and their requests appear above.'}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 font-bold">Area admins</h2>
        {isAdmin ? (
          <>
            <p className="px-1 text-xs text-muted">
              Appoint one admin for each area. The Dhaka North admin sees only Dhaka North, the Dhaka South admin only
              Dhaka South. Admins are independent, not City Corporation staff, and can't also be officials. Until an area has
              its own admin, you look after its cases. New officials are verified by their own area admin; you can remove any official.
            </p>
            <div className="card divide-y divide-line">
              {cities.map((c) => {
                const here = cityAdmins.filter((r) => r.authority_id === c.id)
                return (
                  <div key={c.id} className="p-3">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <Building2 className="size-4 text-warn" /> {areaLabel(c.name)}
                      {!here.length && <span className="chip bg-warn-soft text-warn">No admin appointed yet</span>}
                    </p>
                    {here.length > 0 && <div className="mt-1 divide-y divide-line rounded-lg bg-bg">{here.map((r) => roleRow(r, true))}</div>}
                  </div>
                )
              })}
              {!cities.length && <p className="p-4 text-sm text-muted">Add a City Corporation first (City Corporations tab).</p>}
            </div>
            <div className="card space-y-2 p-4">
              <h3 className="font-semibold">Appoint an area admin</h3>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
                <PersonSearch value={newCityAdmin} onChange={setNewCityAdmin} />
                <select className="input" value={newCity} onChange={(e) => setNewCity(e.target.value)} aria-label="Area">
                  <option value="">Area…</option>
                  {/* One admin per area: only areas without one can be chosen. */}
                  {cities.filter((c) => !cityAdmins.some((r) => r.authority_id === c.id))
                    .map((c) => <option key={c.id} value={c.id}>{areaLabel(c.name)}</option>)}
                </select>
                <input className="input" maxLength={500} value={reasonFor('city_admin')} onChange={(e) => setReason('city_admin', e.target.value)}
                  placeholder="Reason" aria-label="Reason" />
                <button className="btn-primary" disabled={busy || newCityAdmin.trim().length < 3 || !newCity || reasonFor('city_admin').trim().length < 5}
                  onClick={() => run(() => roleService.adminGrantCityAdmin(cleanUsername(newCityAdmin), newCity, reasonFor('city_admin')), 'Area admin appointed.', () => {
                    setNewCityAdmin('')
                    setNewCity('')
                    setReason('city_admin', '')
                    refresh()
                  })}>
                  <Plus className="size-4" /> Add
                </button>
              </div>
              <p className="text-xs text-muted">Each area has one admin, so only areas without one are listed. To replace an admin, remove them first. Already the admin of
                another area? This moves them.</p>
            </div>
          </>
        ) : (
          <>
            <div className="card divide-y divide-line">{cityAdmins.map((r) => roleRow(r, false))}</div>
            <p className="px-1 text-xs text-muted">Only super admins appoint or remove area admins. Ask one if your area needs more help.</p>
          </>
        )}
      </section>

      {isAdmin && (
        <section className="space-y-2">
          <h2 className="px-1 font-bold">Super admins</h2>
          <div className="card divide-y divide-line">{superAdmins.map((r) => roleRow(r, true))}</div>
        </section>
      )}
    </div>
  )
}
