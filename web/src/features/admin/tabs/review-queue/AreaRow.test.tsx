// @vitest-environment jsdom
// One area in the super admin's overview: missed deadlines and when to consider replacing the admin (0078).
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import type { AreaOverviewRow } from '@/models'
import { AreaRow } from '@/features/admin/tabs/review-queue/AreaRow'

vi.mock('@/shared/settings/useAppSettings', () => ({ useAppSettings: () => ({ data: { city_admin_miss_alert: 5 } }) }))

const row = (over: Partial<AreaOverviewRow> = {}): AreaOverviewRow => ({
  area_id: 'dncc', area: 'Dhaka North', short_name: 'DNCC', admins: [{ username: 'dncc_ca', full_name: 'Karim' }],
  open_cases: 2, overdue_cases: 0, pending_emergencies: 0, decided_30d: 4, avg_hours_to_decide: 6,
  last_action_at: new Date().toISOString(), missed_30d: 0, ...over,
})
const renderRow = (r: AreaOverviewRow) => render(<AreaRow row={r} open={false} onToggle={vi.fn()} />)

describe('AreaRow', () => {
  it('is on track with no missed deadlines', () => {
    renderRow(row())
    expect(screen.getByText('On track')).toBeInTheDocument()
    expect(screen.queryByText(/missed deadline/)).not.toBeInTheDocument()
  })

  it('shows late cases and missed deadlines', () => {
    renderRow(row({ overdue_cases: 1, missed_30d: 2 }))
    expect(screen.getByText('1 late')).toBeInTheDocument()
    expect(screen.getByText('2 missed deadlines in 30 days')).toBeInTheDocument()
    expect(screen.getByText('Falling behind')).toBeInTheDocument()
  })

  it('says to consider replacing the admin from the alert level', () => {
    renderRow(row({ overdue_cases: 3, missed_30d: 5 }))
    expect(screen.getByText('Consider replacing')).toBeInTheDocument()
  })
})
