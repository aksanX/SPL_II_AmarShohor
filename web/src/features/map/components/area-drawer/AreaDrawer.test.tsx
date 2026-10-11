// @vitest-environment jsdom
// The admin's area drawer: the search box above the map. The map itself is a real (empty) Leaflet map.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { placeSearchService } from '@/shared/geo/placeSearch.service'
import { renderWithQuery } from '@/test/utils'
import { AreaDrawer } from '@/features/map/components/area-drawer/AreaDrawer'

vi.mock('@/features/city-corp/services/authority.service', () => ({ authorityService: { mergeAreas: vi.fn() } }))
vi.mock('@/shared/geo/placeSearch.service', async (real) => {
  const m = await real<typeof import('@/shared/geo/placeSearch.service')>()
  return { ...m, placeSearchService: { ...m.placeSearchService, searchBoundaries: vi.fn() } }
})
const boundaries = vi.mocked(placeSearchService.searchBoundaries)

const renderDrawer = () => renderWithQuery(<AreaDrawer points={[]} onChange={vi.fn()} />)

beforeEach(() => {
  boundaries.mockReset()
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

  it('takes at most 200 characters', () => {
    renderDrawer()
    expect(screen.getByRole('textbox', { name: 'Search for an area' })).toHaveAttribute('maxLength', '200')
  })
})
