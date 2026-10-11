import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { PageSpinner } from '@/shared/ui'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { appSettingsService } from '@/shared/settings/appSettings.service'
import type { AppSettings } from '@/models'
import { useRunner } from '@/features/admin/hooks/useRunner'

const SETTING_GROUPS: { title: string; fields: { key: keyof AppSettings; label: string; step?: number }[] }[] = [
  {
    title: 'Volunteers', fields: [
      { key: 'lock_hours', label: 'Solo task lock (hours)' },
      { key: 'team_lock_hours', label: 'Team task lock (hours)' },
      { key: 'team_max_size', label: 'Most people in a team (leader included)' },
      { key: 'max_active_tasks', label: 'Max tasks one person can lead' },
      { key: 'escalation_retake_days', label: 'Days before a volunteer can retake an issue they escalated' },
    ],
  },
  {
    title: 'Reputation', fields: [
      { key: 'rep_task_completed', label: 'Confirmed fix' },
      { key: 'rep_task_expired', label: 'Lock expired / removed' },
      { key: 'rep_task_reopened', label: 'Fake or bad fix' },
      { key: 'rep_per_star', label: 'Per star above/below 3' },
      { key: 'rep_escalation_abuse', label: 'Repeated rejected City Corporation requests' },
      { key: 'escalation_abuse_rejections', label: '…after this many rejections' },
      { key: 'rep_wrong_issue_lie', label: 'False "report is wrong" claim' },
      { key: 'rep_false_emergency', label: 'False emergency alert' },
    ],
  },
  {
    title: 'Stuck issues', fields: [
      { key: 'stuck_release_count', label: 'Releases before an issue counts as stuck' },
      { key: 'stuck_days', label: 'Days with no volunteer before it counts as stuck' },
    ],
  },
  {
    title: 'Emergencies', fields: [
      { key: 'emergency_radius_m', label: 'Alert radius (m)' },
      { key: 'emergency_new_account_radius_m', label: 'Alert radius for new accounts (m)' },
      { key: 'emergency_hours', label: 'Alert ends after (hours)' },
      { key: 'emergency_max_per_day', label: 'Max alerts per person per day' },
      { key: 'emergency_hide_denials', label: '"Not true" answers that hide an alert' },
      { key: 'emergency_verify_confirms', label: 'On-site confirmations that verify an alert' },
      { key: 'emergency_verify_radius_m', label: 'On-site distance for verifying (m)' },
      { key: 'live_capture_seconds', label: 'Seconds to take and send a live photo' },
      { key: 'rep_false_confirm', label: 'Reputation change for confirming a rejected emergency' },
    ],
  },
  {
    title: 'Daily limits', fields: [
      { key: 'max_reports_per_day', label: 'Reports one person can post a day' },
      { key: 'max_flags_per_day', label: 'Reports and comments one person can flag a day' },
    ],
  },
  {
    title: 'Area admins', fields: [
      { key: 'city_admin_hours', label: 'Hours an area admin has before a case goes to the super admins' },
      { key: 'city_admin_reminder_hours', label: 'Remind the area admin this many hours before that' },
    ],
  },
  {
    title: 'Wrong categories', fields: [
      { key: 'recategorize_confirms', label: 'On-site confirmers naming the same category to change it' },
      { key: 'recategorize_votes', label: 'People in total naming the same category to change it' },
    ],
  },
  {
    title: 'Validation', fields: [
      { key: 'threshold_critical', label: 'Score needed: critical' },
      { key: 'threshold_high', label: 'Score needed: high' },
      { key: 'threshold_medium', label: 'Score needed: medium' },
      { key: 'threshold_low', label: 'Score needed: low' },
      { key: 'resolution_quorum', label: 'Neighbours needed to confirm a fix' },
    ],
  },
]

export function SettingsTab() {
  const qc = useQueryClient()
  const settings = useAppSettings().data
  const { busy, run } = useRunner()
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    if (settings) setValues(Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v)])))
  }, [settings])
  if (!settings) return <PageSpinner />

  const changed = Object.fromEntries(
    Object.entries(values)
      .filter(([k, v]) => String((settings as unknown as Record<string, unknown>)[k]) !== v && v.trim() !== '' && !Number.isNaN(Number(v)))
      .map(([k, v]) => [k, Number(v)]),
  )

  return (
    <div className="space-y-4">
      {SETTING_GROUPS.map((g) => (
        <section key={g.title} className="card space-y-2 p-4">
          <h2 className="font-bold">{g.title}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.fields.map((f) => (
              <label key={f.key} className="text-sm">
                <span className="text-muted">{f.label}</span>
                <input type="number" step={f.step ?? 1} className="input" value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              </label>
            ))}
          </div>
        </section>
      ))}
      <button className="btn-primary w-full" disabled={busy || Object.keys(changed).length === 0}
        onClick={() => run(() => appSettingsService.adminUpdateSettings(changed), 'Settings saved.', () => qc.invalidateQueries({ queryKey: ['app_settings'] }))}>
        Save {Object.keys(changed).length || ''} change{Object.keys(changed).length === 1 ? '' : 's'}
      </button>
    </div>
  )
}
