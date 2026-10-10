// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAreaSummary } from '../../lib/api'
import type { AreaSummary } from '../../lib/types'
import { category, group, renderWithQuery } from '../../test/utils'
import { AreaPanel } from './AreaPanel'

vi.mock('../../lib/api', () => ({ getAreaSummary: vi.fn() }))
const summary = vi.mocked(getAreaSummary)

const GROUPS = [group('roads', 'Roads'), group('surface', 'Road surface', 'roads'), group('waste', 'Waste'), group('street-waste', 'Street waste', 'waste')]
const CATEGORIES = [category('pothole', 'Pothole', 'surface', '#ff0000'), category('litter', 'Litter', 'street-waste', '#00aa00')]

const SUMMARY: AreaSummary = {
  radius_m: 1000, active: 3, unverified: 1, resolved: 2, heat: 7.5, heat_per_km2: 2.39,
  categories: [{ category: 'litter', count: 1, heat: 1.5 }, { category: 'pothole', count: 2, heat: 6 }],
  hottest: [
    { id: 'h1', title: 'Deep pothole on Road 12', category: 'pothole', status: 'validated', heat: 4.2, distance_m: 350 },
    { id: 'h2', title: 'Rubbish pile near school', category: 'litter', status: 'assigned', heat: 1.5, distance_m: 820 },
  ],
}

function renderPanel(over: Partial<Parameters<typeof AreaPanel>[0]> = {}) {
  const props = {
    lat: 23.87012, lng: 90.39874, label: 'Sector 7, Uttara', radiusM: 1000, category: null,
    categories: CATEGORIES, groups: GROUPS, issueId: null,
    onRadius: vi.fn(), onOpenIssue: vi.fn(), onClose: vi.fn(), ...over,
  }
  renderWithQuery(<AreaPanel {...props} />)
  return props
}

beforeEach(() => {
  summary.mockReset()
  summary.mockResolvedValue(SUMMARY)
})

describe('AreaPanel', () => {
  it('asks the database about the circle around the pin', async () => {
    renderPanel({ radiusM: 2000, category: 'roads' })
    await screen.findByText('Moderate')
    expect(summary).toHaveBeenCalledWith(23.87012, 90.39874, 2000, 'roads', null)
  })

  it("uses the map's time filter", async () => {
    renderPanel({ days: 30 })
    await screen.findByText('Moderate')
    expect(summary).toHaveBeenCalledWith(23.87012, 90.39874, 1000, null, 30)
  })

  it('shows the place name and the pin position', async () => {
    renderPanel()
    expect(screen.getByText('Sector 7, Uttara')).toBeInTheDocument()
    expect(screen.getByText(/23\.87012, 90\.39874/)).toBeInTheDocument()
  })

  it('calls an unnamed pin "Dropped pin"', () => {
    renderPanel({ label: null })
    expect(screen.getByText('Dropped pin')).toBeInTheDocument()
  })

  it('shows the heat level and the counts', async () => {
    renderPanel()
    expect(await screen.findByText('Moderate')).toBeInTheDocument()
    expect(screen.getByText('heat 7.5 · 2.4/km²')).toBeInTheDocument()
    expect(screen.getByText('active').previousSibling).toHaveTextContent('3')
    expect(screen.getByText('need validation').previousSibling).toHaveTextContent('1')
    expect(screen.getByText('resolved').previousSibling).toHaveTextContent('2')
  })

  it('says "No active issues" when nothing active is in the circle', async () => {
    summary.mockResolvedValue({ ...SUMMARY, active: 0, heat: 0, heat_per_km2: 0, categories: [], hottest: [] })
    renderPanel()
    expect(await screen.findByText('No active issues')).toBeInTheDocument()
    expect(screen.queryByText('What makes it hot')).not.toBeInTheDocument()
  })

  it('adds up heat per main group, hottest group first, with its share', async () => {
    renderPanel()
    await screen.findByText('What makes it hot')
    const roads = screen.getByText('Roads')
    const waste = screen.getByText('Waste')
    expect(roads.compareDocumentPosition(waste) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('80%')).toBeInTheDocument() // 6 of 7.5
    expect(screen.getByText('20%')).toBeInTheDocument()
  })

  it('lists the hottest issues and opens one when clicked', async () => {
    const props = renderPanel()
    await userEvent.click(await screen.findByText('Deep pothole on Road 12'))
    expect(props.onOpenIssue).toHaveBeenCalledWith('h1')
    expect(screen.getByText(/350 m away/)).toBeInTheDocument()
  })

  it('marks the chosen radius and reports a new one', async () => {
    const props = renderPanel()
    expect(screen.getByRole('radio', { name: '1.0 km' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '500 m' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('radio', { name: '2.0 km' }))
    expect(props.onRadius).toHaveBeenCalledWith(2000)
  })

  it('offers to open the issue the pin came from', async () => {
    const props = renderPanel({ issueId: 'abc' })
    await userEvent.click(screen.getByRole('button', { name: /Open this issue/ }))
    expect(props.onOpenIssue).toHaveBeenCalledWith('abc')
  })

  it('removes the pin with the close button', async () => {
    const props = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Remove pin' }))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows the error when the summary cannot load', async () => {
    summary.mockRejectedValue(new Error('Network down'))
    renderPanel()
    expect(await screen.findByText('Network down')).toBeInTheDocument()
  })
})
