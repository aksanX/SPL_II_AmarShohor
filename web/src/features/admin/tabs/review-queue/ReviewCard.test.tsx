// @vitest-environment jsdom
// A case in the review queue: who has it, how late it is (0078), and what can be decided.
import { renderWithQuery, issueFixture } from '@/test/utils'
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewItem } from '@/models'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { ReviewCard } from '@/features/admin/tabs/review-queue/ReviewCard'

vi.mock('@/core/supabase', () => ({ mediaUrl: (p: string) => `/media/${p}` }))
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
vi.mock('@/features/auth/hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/features/categories/services/category.service', () => ({ categoryService: { getAllCategories: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/shared/settings/useAppSettings', () => ({ useAppSettings: () => ({ data: { city_admin_hours: 24 } }) }))

const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: 1, kind: 'stuck', note: null, data: {}, created_at: new Date().toISOString(), requester_username: null, requester_full_name: null,
  issue: issueFixture(), evidence: [], city_id: 'dncc', city_short_name: 'DNCC', passed_up_at: null, needs_super_admin: false,
  city_area: 'Dhaka North', super_reason: null, clock_from: new Date().toISOString(), missed_count: 0, ...over,
})

const asRole = (isAdmin: boolean) =>
  vi.mocked(useAuth).mockReturnValue({ isAdmin, profile: { username: 'someone' } } as unknown as ReturnType<typeof useAuth>)
const renderCard = (i: ReviewItem) => renderWithQuery(<MemoryRouter><ReviewCard item={i} /></MemoryRouter>)

beforeEach(() => asRole(false))

describe('ReviewCard', () => {
  it('offers only volunteers or the City Corporation for a stuck case, not "Leave as is"', () => {
    renderCard(item())
    expect(screen.getByRole('button', { name: /Send to volunteers/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send to City Corporation/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Leave as is/ })).not.toBeInTheDocument()
  })

  it('tells the area admin how long they have, and that the case never goes to the super admins', () => {
    renderCard(item())
    expect(screen.getByText('24 h left to decide')).toBeInTheDocument()
    expect(screen.queryByText(/super admins/)).not.toBeInTheDocument()
  })

  it('tells the area admin how often they missed the deadline', () => {
    renderCard(item({ missed_count: 2 }))
    expect(screen.getByText('24 h left to decide (missed the deadline twice)')).toBeInTheDocument()
  })

  it('shows the super admin that a late case is still with the area admin', () => {
    asRole(true)
    renderCard(item({ missed_count: 1 }))
    expect(screen.getByText('With the Dhaka North admin: missed the deadline once')).toBeInTheDocument()
    expect(screen.queryByText(/For you/)).not.toBeInTheDocument()
  })

  it('does not say "no admin" for a case the area admin left too long (database without 0078)', () => {
    asRole(true)
    renderCard(item({ super_reason: 'waited', needs_super_admin: true, passed_up_at: new Date().toISOString() }))
    expect(screen.getByText("For you: Dhaka North admin didn't decide within 24 h")).toBeInTheDocument()
    expect(screen.queryByText(/has no admin/)).not.toBeInTheDocument()
  })

  it('still gives the super admin cases no area admin may decide', () => {
    asRole(true)
    renderCard(item({ super_reason: 'no_admin', needs_super_admin: true, passed_up_at: new Date().toISOString() }))
    expect(screen.getByText('For you: Dhaka North has no admin yet')).toBeInTheDocument()
  })
})
