// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLiveAlerts } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { LiveEmergencies } from './LiveEmergencies'

vi.mock('../lib/api', () => ({ getLiveAlerts: vi.fn() }))
const alerts = vi.mocked(getLiveAlerts)

// An ended alert: listed, but no live map (Leaflet maps are tested elsewhere).
const ENDED = {
  id: 'al1', kind: 'gas_leak', address: 'Mirpur 10', status: 'ended', ended_at: new Date().toISOString(),
  created_at: new Date().toISOString(), confirm_count: 3, deny_count: 0, authority_short_name: 'DNCC',
  followup_issue_id: 'iss-9', last_update: 'Titas has shut the line', lat: 23.8, lng: 90.36,
}
const renderBox = () => renderWithQuery(<MemoryRouter><LiveEmergencies title="Live emergencies" /></MemoryRouter>)

beforeEach(() => {
  alerts.mockReset()
})

describe('LiveEmergencies', () => {
  it('lists alerts with their proper names, area and latest update', async () => {
    alerts.mockResolvedValue([ENDED] as never)
    renderBox()
    expect(await screen.findByText('Gas leak')).toBeInTheDocument()
    expect(screen.getByText(/DNCC · damage logged/)).toBeInTheDocument()
    expect(screen.getByText('Latest update: Titas has shut the line')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Gas leak/ })).toHaveAttribute('href', '/alert/al1')
  })

  it('stays hidden when there are no alerts', async () => {
    alerts.mockResolvedValue([])
    const { container } = renderBox()
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('never hides a loading failure from the people who act on alerts', async () => {
    alerts.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue([ENDED] as never)
    renderBox()
    expect(await screen.findByText('Could not load live emergency alerts: Network down')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Gas leak')).toBeInTheDocument()
  })
})
