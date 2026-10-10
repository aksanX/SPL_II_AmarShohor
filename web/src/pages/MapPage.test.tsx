// @vitest-environment jsdom
// The map page with a real (empty) Leaflet map: the time filter, the share button and the empty-map message.
// The database calls and the data hooks are replaced; nothing leaves the test.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getHeatmapHex, getHeatmapPoints, getMapIssues } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { MapPage } from './MapPage'

vi.mock('../lib/api', () => ({
  getHeatmapHex: vi.fn(), getHeatmapPoints: vi.fn(), getMapIssues: vi.fn(), getFeed: vi.fn(),
  getAreaSummary: vi.fn(), getHexIssues: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({ mediaUrl: (path: string) => `/media/${path}` }))
vi.mock('../lib/geo', async (real) => ({
  ...(await real<typeof import('../lib/geo')>()),
  getCurrentPosition: vi.fn(async () => ({ lat: 23.8701, lng: 90.3987, accuracy: 10 })),
  reverseGeocode: vi.fn(async () => 'Road 12, Sector 7, Uttara'),
}))
vi.mock('../hooks/useData', () => ({
  useCategories: () => ({ data: [] }), useCategoryGroups: () => ({ data: [] }), useAppSettings: () => ({ data: undefined }),
}))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))

const hex = vi.mocked(getHeatmapHex)
const heat = vi.mocked(getHeatmapPoints)
const pins = vi.mocked(getMapIssues)

// Records the page address after each change, so tests can check what the link holds.
let search = ''
function Url() {
  const { search: now } = useLocation()
  useEffect(() => { search = now }, [now])
  return null
}

function renderMap(url = '/map') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path='/map' element={<><MapPage /><Url /></>} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hex.mockResolvedValue([])
  heat.mockResolvedValue([])
  pins.mockResolvedValue([])
})

describe('time filter', () => {
  it('shows all time by default and asks without a time limit', async () => {
    renderMap()
    expect(screen.getByRole('radio', { name: 'All time' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(hex).toHaveBeenCalled())
    expect(hex.mock.calls.at(-1)![3]).toBeNull()
  })

  it('asks for the last 7 days and saves the choice in the link', async () => {
    renderMap()
    await userEvent.click(screen.getByRole('radio', { name: 'Last 7 days' }))
    await waitFor(() => expect(hex.mock.calls.at(-1)![3]).toBe(7))
    expect(screen.getByRole('radio', { name: 'Last 7 days' })).toHaveAttribute('aria-checked', 'true')
    expect(search).toContain('days=7')
  })

  it('reads the time from a shared link, in every mode', async () => {
    renderMap('/map?mode=heat&days=30')
    await waitFor(() => expect(heat).toHaveBeenCalled())
    expect(heat.mock.calls.at(-1)![2]).toBe(30)
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute('aria-checked', 'true')
  })

  it('passes it to the pins too', async () => {
    renderMap('/map?mode=pins&days=7')
    await waitFor(() => expect(pins).toHaveBeenCalled())
    expect(pins.mock.calls.at(-1)![3]).toBe(7)
  })

  it('treats an unknown value in the link as all time', async () => {
    renderMap('/map?days=9999')
    expect(screen.getByRole('radio', { name: 'All time' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(hex).toHaveBeenCalled())
    expect(hex.mock.calls.at(-1)![3]).toBeNull()
  })

  it('removes the time from the link when going back to all time', async () => {
    renderMap('/map?days=7')
    await userEvent.click(screen.getByRole('radio', { name: 'All time' }))
    await waitFor(() => expect(search).not.toContain('days='))
  })

  it('says the time in the empty-map message', async () => {
    renderMap('/map?days=7')
    expect(await screen.findByText('No validated issues reported in the last 7 days here. Try zooming out or a longer time.'))
      .toBeInTheDocument()
  })
})

describe('share button', () => {
  it('copies the address of this exact view', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderMap('/map?mode=pins&days=7')
    await userEvent.click(screen.getByRole('button', { name: 'Copy a link to this map view' }))
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(toast.success).toHaveBeenCalledWith('Map link copied. Anyone who opens it sees this view.')
  })

  it('says so when copying is not allowed', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    renderMap()
    await userEvent.click(screen.getByRole('button', { name: 'Copy a link to this map view' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })
})

describe('map fixes', () => {
  it('has no pin, and no pin panel, for an empty ?lat=&lng= in the link', async () => {
    renderMap('/map?lat=&lng=')
    await waitFor(() => expect(hex).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Remove pin' })).not.toBeInTheDocument()
  })

  it('does not save "My location" in the link; the pin shows its address instead', async () => {
    renderMap()
    await userEvent.click(screen.getByRole('button', { name: 'Go to my location' }))
    await waitFor(() => expect(search).toContain('lat=23.8701'))
    expect(search).not.toContain('place=')
    expect(await screen.findAllByText('Road 12, Sector 7, Uttara')).not.toHaveLength(0)
  })

  it('has + and − zoom buttons', () => {
    const { container } = renderMap()
    expect(container.querySelector('.leaflet-control-zoom-in')).toBeInTheDocument()
    expect(container.querySelector('.leaflet-control-zoom-out')).toBeInTheDocument()
  })
})
