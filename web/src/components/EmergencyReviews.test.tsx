// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmergencyReviews } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { EmergencyReviews } from './EmergencyReviews'

vi.mock('../lib/api', () => ({ getEmergencyReviews: vi.fn() }))
const reviews = vi.mocked(getEmergencyReviews)
const renderBox = () => renderWithQuery(<MemoryRouter><EmergencyReviews /></MemoryRouter>)

beforeEach(() => {
  reviews.mockReset()
})

describe('EmergencyReviews', () => {
  it('lists verified emergencies with their proper names', async () => {
    reviews.mockResolvedValue([{
      id: 'a1', kind: 'live_wire', address: 'Mirpur 10', lat: 23.8, lng: 90.36, verified_at: new Date().toISOString(),
      status: 'active', on_site_confirms: 2, live_items: 1, issue_id: null, issue_title: null,
    }] as never)
    renderBox()
    expect(await screen.findByRole('heading', { name: /Verified emergencies to check \(1\)/ })).toBeInTheDocument()
    expect(screen.getByText('Live electric wire')).toBeInTheDocument()
    expect(screen.getByText(/2 on site · 1 live photo$/)).toBeInTheDocument()
  })

  it('stays hidden when there is nothing to check', async () => {
    reviews.mockResolvedValue([])
    const { container } = renderBox()
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('never hides a loading failure: an admin must know the list is missing', async () => {
    reviews.mockRejectedValue(new Error('Network down'))
    renderBox()
    expect(await screen.findByText('Could not load verified emergencies to check: Network down')).toBeInTheDocument()
  })
})
