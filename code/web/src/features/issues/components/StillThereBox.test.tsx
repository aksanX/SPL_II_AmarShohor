// @vitest-environment jsdom
import { issueFixture, renderWithQuery } from '@/test/utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StillThereState } from '@/models'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { StillThereBox } from '@/features/issues/components/StillThereBox'
import { issueService } from '@/features/issues/services/issue.service'

vi.mock('@/features/issues/services/issue.service', () => ({ issueService: { getStillThere: vi.fn(), answerStillThere: vi.fn() } }))
vi.mock('@/features/auth/hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
vi.mock('@/features/issues/hooks/useInvalidateIssue', () => ({ useInvalidateIssue: () => vi.fn() }))
const state = vi.mocked(issueService.getStillThere)

const check = (over: Partial<StillThereState>): StillThereState => ({
  checkable: true, asked_at: '2026-10-09T00:00:00Z', quiet_days: 14, gone: 0, still: 0, quorum: 2, my_answer: null, ...over,
})

function signedIn(role = 'citizen') {
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'me' }, role } as unknown as ReturnType<typeof useAuth>)
}

beforeEach(() => {
  signedIn()
  state.mockReset()
})

describe('StillThereBox', () => {
  it('asks residents whether a quiet issue is still there', async () => {
    state.mockResolvedValue(check({}))
    renderWithQuery(<StillThereBox issue={issueFixture()} />)
    expect(await screen.findByText(/Nothing has happened here for 14 days/)).toBeInTheDocument()
    expect(screen.getByText(/It closes when 2 people say it’s gone/)).toBeInTheDocument()
  })

  it('reads correctly for one day and one person', async () => {
    state.mockResolvedValue(check({ quiet_days: 1, quorum: 1 }))
    renderWithQuery(<StillThereBox issue={issueFixture()} />)
    expect(await screen.findByText(/for 1 day\./)).toBeInTheDocument()
    expect(screen.getByText(/It closes when one person says it’s gone/)).toBeInTheDocument()
  })

  it('is not shown to admins or to the volunteer fixing it', async () => {
    state.mockResolvedValue(check({}))
    signedIn('admin')
    const { unmount } = renderWithQuery(<StillThereBox issue={issueFixture()} />)
    expect(screen.queryByText(/Is this still there/)).not.toBeInTheDocument()
    unmount()
    signedIn()
    renderWithQuery(<StillThereBox issue={issueFixture({ volunteer_id: 'me' })} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Is this still there/)).not.toBeInTheDocument()
  })
})
