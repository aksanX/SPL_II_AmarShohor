// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getHexIssues } from '../../lib/api'
import { areaName } from '../../lib/geo'
import type { HexIssue } from '../../lib/types'
import { category, hexCell, mapIssue, renderWithQuery } from '../../test/utils'
import { HexPanel } from './HexPanel'

vi.mock('../../lib/api', () => ({ getHexIssues: vi.fn() }))
vi.mock('../../lib/geo', async (real) => ({ ...(await real<typeof import('../../lib/geo')>()), areaName: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ mediaUrl: (path: string) => `/media/${path}` }))
const hexIssues = vi.mocked(getHexIssues)
const name = vi.mocked(areaName)

const CATEGORIES = [category('pothole', 'Pothole', null), category('drain', 'Blocked drain', null)]
const hexIssue = (over: Partial<HexIssue>): HexIssue => ({ ...mapIssue(), total: 2, ...over })
const ISSUES = [
  hexIssue({ id: 'a', title: 'Deep pothole', category: 'pothole', severity: 'critical', upvote_count: 5, confirmation_count: 2 }),
  hexIssue({ id: 'b', title: 'Blocked drain', category: 'drain', severity: 'low', thumb_path: 'u/1.jpg', thumb_type: 'image' }),
]

function renderPanel(over: Partial<Parameters<typeof HexPanel>[0]> = {}) {
  const props = {
    cell: hexCell(), cellM: 1200, mostly: 'Roads', category: null, categories: CATEGORIES,
    onOpenIssue: vi.fn(), onShowPins: vi.fn(), onClose: vi.fn(), ...over,
  }
  renderWithQuery(<HexPanel {...props} />)
  return props
}

beforeEach(() => {
  hexIssues.mockReset()
  hexIssues.mockResolvedValue(ISSUES)
  name.mockReset()
  name.mockResolvedValue('Sector 7, Uttara')
})

describe('HexPanel header', () => {
  it('names the area the hexagon covers', async () => {
    renderPanel()
    expect(screen.getByText('Finding the area…')).toBeInTheDocument()
    expect(await screen.findByText('Around Sector 7, Uttara')).toBeInTheDocument()
  })

  it('looks the name up at the hexagon middle, with neighbourhood detail for a small hexagon', async () => {
    renderPanel()
    await screen.findByText('Around Sector 7, Uttara')
    const [lat, lng, detail] = name.mock.calls[0]
    expect(lat).toBeCloseTo(23.8, 6)
    expect(lng).toBeCloseTo(90.4, 6)
    expect(detail).toBe('neighbourhood')
  })

  it('says "This area" when OpenStreetMap has no name there', async () => {
    name.mockResolvedValue('')
    renderPanel()
    expect(await screen.findByText('This area')).toBeInTheDocument()
  })

  it('shows the count, heat score and main group', () => {
    renderPanel()
    expect(screen.getByText('4 active issues · heat score 12.3 · mostly Roads')).toBeInTheDocument()
  })

  it('says "issue", not "issues", for one', () => {
    renderPanel({ cell: hexCell({ issue_count: 1 }) })
    expect(screen.getByText(/^1 active issue ·/)).toBeInTheDocument()
  })
})

describe('HexPanel issue list', () => {
  it('asks the server for the 20 most serious issues in this hexagon', async () => {
    const props = renderPanel({ category: 'roads' })
    await screen.findByText('Deep pothole')
    expect(hexIssues).toHaveBeenCalledWith(props.cell.hex, 1200, 'roads', 20)
  })

  it('lists each issue with its category and severity, in the order the server sent', async () => {
    renderPanel()
    const titles = (await screen.findAllByText(/Deep pothole|Blocked drain/, { selector: 'span.font-semibold' })).map((e) => e.textContent)
    expect(titles).toEqual(['Deep pothole', 'Blocked drain'])
    expect(screen.getByText(/Pothole · Critical/)).toBeInTheDocument()
  })

  it('shows the photo when an issue has one', async () => {
    const { container } = renderWithQuery(<HexPanel cell={hexCell()} cellM={1200} mostly='Roads' category={null} categories={CATEGORIES}
      onOpenIssue={vi.fn()} onShowPins={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText('Deep pothole')
    expect(container.querySelector('img')).toHaveAttribute('src', '/media/u/1.jpg')
  })

  it('opens an issue when it is clicked', async () => {
    const props = renderPanel()
    await userEvent.click(await screen.findByText('Deep pothole'))
    expect(props.onOpenIssue).toHaveBeenCalledWith('a')
  })

  it('says how many more there are when the hexagon holds more than it lists', async () => {
    hexIssues.mockResolvedValue(ISSUES.map((i) => ({ ...i, total: 45 })))
    renderPanel()
    expect(await screen.findByText('43 more')).toBeInTheDocument()
  })

  it('does not mention more when the list is complete', async () => {
    renderPanel()
    await screen.findByText('Deep pothole')
    expect(screen.queryByText(/more\b/)).not.toBeInTheDocument()
  })

  it('explains an empty list', async () => {
    hexIssues.mockResolvedValue([])
    renderPanel({ cell: hexCell({ issue_count: 0 }) })
    expect(await screen.findByText('These issues were just updated. Move the map to refresh.')).toBeInTheDocument()
  })

  it('shows the error when the list cannot load', async () => {
    hexIssues.mockRejectedValue(new Error('Database is busy'))
    renderPanel()
    expect(await screen.findByText('Database is busy')).toBeInTheDocument()
  })
})

describe('HexPanel buttons', () => {
  it('switches to pins and closes', async () => {
    const props = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /Show them as pins/ }))
    expect(props.onShowPins).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(props.onClose).toHaveBeenCalled()
  })
})
