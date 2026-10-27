// @vitest-environment jsdom
// A case in the review queue: what can be decided.
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

  it('offers only volunteers where no City Corporation covers the place', () => {
    renderCard(item({ kind: 'no_authority', city_id: null }))
    expect(screen.getByRole('button', { name: /Send to volunteers/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Send to City Corporation/ })).not.toBeInTheDocument()
  })

  it('shows no case-type or "For you" chips, for the super admin or the area admin', () => {
    asRole(true)
    renderCard(item({ super_reason: 'no_city_corporation', needs_super_admin: true, city_id: null }))
    expect(screen.queryByText('Stuck')).not.toBeInTheDocument()
    expect(screen.queryByText(/For you/)).not.toBeInTheDocument()
    asRole(false)
    renderCard(item({ missed_count: 2 }))
    expect(screen.queryByText(/h left to decide/)).not.toBeInTheDocument()
  })
})
