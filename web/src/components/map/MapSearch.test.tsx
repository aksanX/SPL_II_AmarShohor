// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFeed } from '../../lib/api'
import { searchPlaces, type Place } from '../../lib/geo'
import type { Issue } from '../../lib/types'
import { renderWithQuery } from '../../test/utils'
import { MapSearch } from './MapSearch'

vi.mock('../../lib/api', () => ({ getFeed: vi.fn() }))
vi.mock('../../lib/geo', async (real) => ({ ...(await real<typeof import('../../lib/geo')>()), searchPlaces: vi.fn() }))
const places = vi.mocked(searchPlaces)
const feed = vi.mocked(getFeed)

const UTTARA: Place = { name: 'Uttara', detail: 'Dhaka', lat: 23.8759, lng: 90.3995, bbox: [23.85, 90.36, 23.9, 90.42], isArea: true }
const UTTARA_PARK: Place = { name: 'Uttara Lake Park', detail: 'Sector 7, Dhaka', lat: 23.87, lng: 90.39, bbox: null, isArea: false }
const ISSUE = { id: 'i9', title: 'Uttara road flooded', category_name: 'Waterlogging', address: 'Sector 4', category_color: '#00f' } as Issue
const NEAR = { minLat: 23.7, maxLat: 23.9, minLng: 90.3, maxLng: 90.5 }

function renderSearch(over: Partial<Parameters<typeof MapSearch>[0]> = {}) {
  const props = { near: NEAR, onPick: vi.fn(), ...over }
  renderWithQuery(<MapSearch {...props} />)
  return { ...props, input: screen.getByRole('combobox', { name: 'Search the map' }) }
}

beforeEach(() => {
  places.mockReset()
  places.mockResolvedValue([UTTARA, UTTARA_PARK])
  feed.mockReset()
  feed.mockResolvedValue([ISSUE])
})

describe('MapSearch results', () => {
  it('lists places and reported issues under their own headings', async () => {
    const { input } = renderSearch()
    await userEvent.type(input, 'uttara')
    expect(await screen.findByText('Uttara Lake Park')).toBeInTheDocument()
    expect(screen.getByText('Places')).toBeInTheDocument()
    expect(await screen.findByText('Reported issues')).toBeInTheDocument()
    expect(screen.getByText('Uttara road flooded')).toBeInTheDocument()
    expect(screen.getByText('Area')).toBeInTheDocument() // Uttara is a whole area
  })

  it('searches places near the map and issues by text', async () => {
    const { input } = renderSearch()
    await userEvent.type(input, 'uttara')
    await screen.findByText('Uttara Lake Park')
    expect(places).toHaveBeenCalledWith('uttara', NEAR, expect.anything())
    expect(feed).toHaveBeenCalledWith({ sort: 'hot', scope: 'all', search: 'uttara', limit: 5 })
  })

  it('waits for 2 characters before searching', async () => {
    const { input } = renderSearch()
    await userEvent.type(input, 'u')
    await new Promise((r) => setTimeout(r, 400))
    expect(places).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('leaves issues out when the box only searches places (the report form)', async () => {
    const { input } = renderSearch({ includeIssues: false })
    await userEvent.type(input, 'uttara')
    await screen.findByText('Uttara Lake Park')
    expect(feed).not.toHaveBeenCalled()
    expect(screen.queryByText('Reported issues')).not.toBeInTheDocument()
  })

  it('offers pasted coordinates without searching', async () => {
    const { input, onPick } = renderSearch()
    await userEvent.type(input, '23.81, 90.41')
    expect(await screen.findByText('Go to 23.81, 90.41')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith({ kind: 'coords', lat: 23.81, lng: 90.41 })
    expect(places).not.toHaveBeenCalled()
  })

  it('suggests pressing Enter when there is no quick match', async () => {
    places.mockResolvedValue([])
    feed.mockResolvedValue([])
    const { input } = renderSearch()
    await userEvent.type(input, 'zzqx')
    expect(await screen.findByText(/No quick match for “zzqx”/)).toBeInTheDocument()
  })
})

describe('MapSearch picking', () => {
  it('picks a clicked result, shows its name and closes the list', async () => {
    const { input, onPick } = renderSearch()
    await userEvent.type(input, 'uttara')
    await userEvent.click(await screen.findByText('Uttara Lake Park'))
    expect(onPick).toHaveBeenCalledWith({ kind: 'place', place: UTTARA_PARK })
    expect(input).toHaveValue('Uttara Lake Park')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('picks the highlighted result with Enter', async () => {
    const { input, onPick } = renderSearch()
    await userEvent.type(input, 'uttara')
    await screen.findByText('Uttara Lake Park')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledWith({ kind: 'place', place: UTTARA_PARK })
  })

  it('still picks the first result when ↓ was pressed before results arrived', async () => {
    const { input, onPick } = renderSearch()
    await userEvent.type(input, 'uttara{ArrowDown}')
    await screen.findByText('Uttara Lake Park')
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith({ kind: 'place', place: UTTARA })
  })

  it('runs a full search on Enter when nothing matches yet, and says so if nothing is found', async () => {
    places.mockResolvedValue([])
    feed.mockResolvedValue([])
    const { input, onPick } = renderSearch()
    await userEvent.type(input, 'zzqx')
    await screen.findByText(/No quick match/)
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText(/Nothing found for “zzqx”/)).toBeInTheDocument()
    expect(places).toHaveBeenCalledWith('zzqx', NEAR, undefined, true)
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('MapSearch keyboard and screen readers', () => {
  it('tells screen readers which result is highlighted', async () => {
    const { input } = renderSearch()
    await userEvent.type(input, 'uttara')
    await screen.findByText('Uttara Lake Park')
    await userEvent.keyboard('{ArrowDown}')
    const second = screen.getAllByRole('option')[1]
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', second.id)
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
  })

  it('does not go past the last result', async () => {
    const { input } = renderSearch()
    await userEvent.type(input, 'uttara')
    await screen.findByText('Uttara road flooded')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    const options = screen.getAllByRole('option')
    expect(options.at(-1)).toHaveAttribute('aria-selected', 'true')
  })

  it('closes the list with Escape', async () => {
    const { input } = renderSearch()
    await userEvent.type(input, 'uttara')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('clears the text with the clear button', async () => {
    const { input } = renderSearch()
    await userEvent.type(input, 'uttara')
    await screen.findByText('Uttara Lake Park')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(input).toHaveValue('')
  })

  it('gives two search boxes on one page different list ids', () => {
    renderWithQuery(<><MapSearch near={null} onPick={vi.fn()} /><MapSearch near={null} onPick={vi.fn()} /></>)
    const [a, b] = screen.getAllByRole('combobox')
    expect(a.getAttribute('aria-controls')).not.toBe(b.getAttribute('aria-controls'))
  })
})
