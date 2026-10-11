// @vitest-environment jsdom
// The admin's area drawer: the search box above the map. The map itself is a real (empty) Leaflet map.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchBoundaries } from '@/lib/geo'
import { renderWithQuery } from '@/test/utils'
import { AreaDrawer } from '@/components/map/AreaDrawer'

vi.mock('@/lib/api', () => ({ mergeAreas: vi.fn() }))
vi.mock('@/lib/geo', async (real) => ({ ...(await real<typeof import('@/lib/geo')>()), searchBoundaries: vi.fn() }))
const boundaries = vi.mocked(searchBoundaries)

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
