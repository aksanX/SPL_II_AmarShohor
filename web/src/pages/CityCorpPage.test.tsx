// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { getAuthorityRecords } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { CityCorpPage } from './CityCorpPage'

vi.mock('../lib/api', () => ({ getAuthorityRecords: vi.fn(), getAuthorityTasks: vi.fn() }))
vi.mock('../lib/supabase', () => ({ mediaUrl: (p: string) => `/media/${p}` }))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
const records = vi.mocked(getAuthorityRecords)

const DNCC = {
  id: 'a1', name: 'Dhaka North City Corporation', is_active: true, hotline: '16106',
  escalated: 40, resolved: 25, open: 12, overdue: 3, avg_days_to_resolve: 6.5,
}
const renderPage = () => renderWithQuery(<MemoryRouter><CityCorpPage /></MemoryRouter>)

beforeEach(() => {
  records.mockReset()
  vi.mocked(useAuth).mockReturnValue({ role: 'citizen', loading: false } as unknown as ReturnType<typeof useAuth>)
})

describe('City Corporation record', () => {
  it('shows each City Corporation with its hotline and numbers', async () => {
    records.mockResolvedValue([DNCC] as never)
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Dhaka North City Corporation' })).toBeInTheDocument()
    expect(screen.getByText('16106')).toBeInTheDocument()
    expect(screen.getByText('Overdue').previousSibling).toHaveTextContent('3')
  })

  it('says when none are set up yet', async () => {
    records.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No City Corporations set up yet')).toBeInTheDocument()
  })

  it('shows a load error with Try again, not "none set up yet"', async () => {
    records.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue([DNCC] as never)
    renderPage()
    expect(await screen.findByText('Could not load the City Corporation record: Network down')).toBeInTheDocument()
    expect(screen.queryByText('No City Corporations set up yet')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('16106')).toBeInTheDocument()
  })
})
