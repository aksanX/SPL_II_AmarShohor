// @vitest-environment jsdom
// The admin's area drawer: the search box above the map. The map itself is a real (empty) Leaflet map.
import { renderWithQuery } from '@/test/utils'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { placeSearchService } from '@/shared/geo/placeSearch.service'
import { authorityService } from '@/features/city-corp/services/authority.service'
import { AreaDrawer } from '@/features/map/components/area-drawer/AreaDrawer'
import { type Ward, loadWards } from '@/features/map/components/area-drawer/wards'
import { type Thana, loadThanas } from '@/features/map/components/area-drawer/thanas'

vi.mock('@/features/city-corp/services/authority.service', () => ({ authorityService: { mergeAreas: vi.fn() } }))
vi.mock('@/shared/geo/placeSearch.service', async (real) => {
  const m = await real<typeof import('@/shared/geo/placeSearch.service')>()
  return { ...m, placeSearchService: { ...m.placeSearchService, searchBoundaries: vi.fn() } }
})
vi.mock('@/features/map/components/area-drawer/wards', async (real) => {
  const m = await real<typeof import('@/features/map/components/area-drawer/wards')>()
  return { ...m, loadWards: vi.fn() }
})
vi.mock('@/features/map/components/area-drawer/thanas', async (real) => {
  const m = await real<typeof import('@/features/map/components/area-drawer/thanas')>()
  return { ...m, loadThanas: vi.fn() }
})
const thanas = vi.mocked(loadThanas)
const boundaries = vi.mocked(placeSearchService.searchBoundaries)
const wards = vi.mocked(loadWards)
const merge = vi.mocked(authorityService.mergeAreas)

const square = (x: number): Ward['geometry'] => ({ type: 'Polygon', coordinates: [[[x, 23], [x + 1, 23], [x + 1, 24], [x, 23]]] })
const WARDS: Ward[] = [
  { name: 'Ward 1', area: 'Dhaka North', geometry: square(90) },
  { name: 'Ward 2 (part)', area: 'Dhaka North', geometry: square(91) },
  { name: 'Ward 2 (part)', area: 'Dhaka North', geometry: square(92) },
  { name: 'Ward 37', area: 'Dhaka South', geometry: square(93) },
]

// Gulshan lies inside Dhaka North's ward 1; Turag is outside every ward (like the areas Dhaka added in 2016).
const THANAS: Thana[] = [
  { name: 'Gulshan', area: 'Dhaka North', geometry: square(90) },
  { name: 'Turag', area: 'Dhaka North', geometry: square(95) },
]

const renderDrawer = (onChange = vi.fn(), name = '') => renderWithQuery(<AreaDrawer points={[]} onChange={onChange} name={name} />)
const searchFor = (text: string) => userEvent.type(screen.getByRole('textbox', { name: 'Search for an area' }), `${text}{Enter}`)

beforeEach(() => {
  boundaries.mockReset()
  wards.mockReset().mockResolvedValue(WARDS)
  merge.mockReset()
  thanas.mockReset().mockResolvedValue(THANAS)
})

describe('AreaDrawer search', () => {
  it('searches once, however often Enter is pressed while the search is running', async () => {
    boundaries.mockImplementation(() => new Promise(() => {}))
    renderDrawer()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search for an area' }), 'Chittagong{Enter}{Enter}{Enter}')
    expect(boundaries).toHaveBeenCalledTimes(1)
  })

  it('says so when nothing is found', async () => {
    boundaries.mockResolvedValue([])
    renderDrawer()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search for an area' }), 'Nowhere{Enter}')
    expect(await screen.findByText(/Nothing found for "Nowhere"/)).toBeInTheDocument()
  })

  it('puts the best OpenStreetMap outline on the map straight away, with no list to choose from', async () => {
    const ring: [number, number][] = [[24.8, 89.3], [24.8, 89.4], [24.9, 89.4]]
    boundaries.mockResolvedValue([
      { name: 'Bogura', detail: 'Bogura, Rajshahi Division', ring, center: [24.85, 89.37] },
      { name: 'Bogura Sadar', detail: 'Bogura Sadar Upazila', ring: [[24, 89], [24, 90], [25, 90]], center: [24.5, 89.5] },
    ])
    const onChange = vi.fn()
    renderDrawer(onChange)
    await searchFor('Bogura City Corporation')
    expect(onChange).toHaveBeenCalledWith(ring)
    expect(await screen.findByText('Outline of Bogura from OpenStreetMap. Check that it covers the City Corporation before saving.')).toBeInTheDocument()
    expect(screen.queryByText('Bogura Sadar')).not.toBeInTheDocument()
  })

  it('takes an outline over a place OpenStreetMap only has a point for', async () => {
    const ring: [number, number][] = [[24.8, 89.3], [24.8, 89.4], [24.9, 89.4]]
    boundaries.mockResolvedValue([
      { name: 'Bogura office', detail: 'Office', ring: null, center: [24.85, 89.37] },
      { name: 'Bogura', detail: 'Bogura, Rajshahi Division', ring, center: [24.85, 89.37] },
    ])
    const onChange = vi.fn()
    renderDrawer(onChange)
    await searchFor('Bogura')
    expect(onChange).toHaveBeenCalledWith(ring)
  })

  it('takes at most 200 characters', () => {
    renderDrawer()
    expect(screen.getByRole('textbox', { name: 'Search for an area' })).toHaveAttribute('maxLength', '200')
  })
})

describe('AreaDrawer search from wards', () => {
  const OUTLINE = { type: 'Polygon' as const, coordinates: [[[90, 23], [93, 23], [93, 24], [90, 23]]] }

  it('joins the wards of the City Corporation searched for into the outline, without asking OpenStreetMap', async () => {
    merge.mockResolvedValue(OUTLINE)
    const onChange = vi.fn()
    renderDrawer(onChange)
    await searchFor('Dhaka North City Corporation')
    expect(merge).toHaveBeenCalledWith([square(90), square(91), square(92)])
    expect(onChange).toHaveBeenCalledWith([[23, 90], [23, 93], [24, 93]])
    expect(await screen.findByText(/Made from Dhaka North's wards as they were in 2011/)).toBeInTheDocument()
    expect(boundaries).not.toHaveBeenCalled()
  })

  it('knows a City Corporation by its short name', async () => {
    merge.mockResolvedValue(OUTLINE)
    renderDrawer()
    await searchFor('DSCC')
    expect(merge).toHaveBeenCalledWith([square(93)])
  })

  it('asks which one only when the name fits more than one City Corporation', async () => {
    merge.mockResolvedValue(OUTLINE)
    renderDrawer()
    await searchFor('Dhaka')
    expect(merge).not.toHaveBeenCalled()
    expect(screen.getByRole('list', { name: 'Which City Corporation?' })).toBeInTheDocument()
    await userEvent.click(screen.getByText('Dhaka South City Corporation'))
    expect(merge).toHaveBeenCalledWith([square(93)])
    expect(screen.queryByRole('list', { name: 'Which City Corporation?' })).not.toBeInTheDocument()
  })
})

describe('AreaDrawer thana picker', () => {
  const openThanas = () => userEvent.click(screen.getByRole('radio', { name: 'Pick thanas' }))

  it('says the suggested thanas are filled in when the City Corporation has some', async () => {
    wards.mockResolvedValue([])
    renderDrawer(vi.fn(), 'Dhaka North City Corporation')
    await openThanas()
    expect(await screen.findByText('2 thanas picked')).toBeInTheDocument()
    expect(screen.getByText(/The suggested thanas are filled in/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('starts from the 2011 wards and picks only the thanas they miss', async () => {
    renderDrawer(vi.fn(), 'Dhaka North City Corporation')
    await openThanas()
    expect(await screen.findByText('2 wards + 1 thana picked')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Start from Dhaka North's 2 wards \(2011\)/ })).toBeChecked()
    expect(screen.getByText(/Dhaka North's 2011 wards are filled in \(blue\), with the thanas they miss/)).toBeInTheDocument()
  })

  it('joins the wards and the picked thanas into one outline', async () => {
    merge.mockResolvedValue({ type: 'Polygon', coordinates: [[[90, 23], [96, 23], [96, 24], [90, 23]]] })
    const onChange = vi.fn()
    renderDrawer(onChange, 'Dhaka North City Corporation')
    await openThanas()
    await userEvent.click(await screen.findByRole('button', { name: 'Make outline' }))
    expect(merge).toHaveBeenCalledWith([square(90), square(91), square(92), square(95)])
    expect(onChange).toHaveBeenCalledWith([[23, 90], [23, 96], [24, 96]])
    expect(await screen.findByText(/Made from Dhaka North's wards as they were in 2011, and 1 thana for the parts they miss/)).toBeInTheDocument()
  })

  it('goes back to thanas only when the wards are unticked', async () => {
    merge.mockResolvedValue({ type: 'Polygon', coordinates: [[[90, 23], [96, 23], [96, 24], [90, 23]]] })
    renderDrawer(vi.fn(), 'Dhaka North City Corporation')
    await openThanas()
    await userEvent.click(await screen.findByRole('checkbox'))
    expect(screen.getByText('2 thanas picked')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Make outline' }))
    expect(merge).toHaveBeenCalledWith([square(90), square(95)])
    expect(screen.queryByText(/Made from/)).not.toBeInTheDocument()
  })

  it('starts from the City Corporation whose wards were picked in the search', async () => {
    boundaries.mockResolvedValue([])
    merge.mockResolvedValue({ type: 'Polygon', coordinates: [[[90, 23], [93, 23], [93, 24], [90, 23]]] })
    renderDrawer()
    await searchFor('DNCC')
    await screen.findByText(/Made from Dhaka North's wards/)
    await openThanas()
    expect(await screen.findByText('2 wards + 1 thana picked')).toBeInTheDocument()
  })

  it('says so when the City Corporation has no thanas here', async () => {
    renderDrawer(vi.fn(), 'Bogura City Corporation')
    await openThanas()
    expect(await screen.findByText('There are no thanas for Bogura here. Search for it above, or use Draw.')).toBeInTheDocument()
    expect(screen.getByText('0 thanas picked')).toBeInTheDocument()
  })

  it('just says how to pick when no name is typed yet', async () => {
    renderDrawer()
    await openThanas()
    expect(await screen.findByText('Click a thana to add or remove it, then make the outline.')).toBeInTheDocument()
  })
})
