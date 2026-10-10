// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCategoryFilter } from '../hooks/useCategoryFilter'
import { buildCategoryTree } from '../lib/categories'
import { category, group } from '../test/utils'
import { GroupPicker } from './CategoryBrowser'

vi.mock('../hooks/useCategoryFilter', () => ({ useCategoryFilter: vi.fn() }))

const TREE = buildCategoryTree(
  [group('roads', 'Roads'), group('surface', 'Road surface', 'roads'), group('lights', 'Street lights', 'roads'),
    group('waste', 'Waste'), group('street-waste', 'Street waste', 'waste')],
  [category('pothole', 'Pothole', 'surface'), category('lamp', 'Broken lamp', 'lights'), category('litter', 'Litter', 'street-waste')],
)
const setPicked = vi.fn()

function filter(groups: string[], subs: string[] = [], onIssues = true) {
  vi.mocked(useCategoryFilter).mockReturnValue({ tree: TREE, groups, subs, setPicked, onIssues } as never)
}

beforeEach(() => {
  setPicked.mockReset()
})

describe('GroupPicker', () => {
  it('marks "View all" when no group is picked', () => {
    filter([])
    render(<GroupPicker />)
    expect(screen.getByRole('button', { name: 'View all' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('checkbox', { name: /Roads/ })).not.toBeChecked()
  })

  it('adds a group when it is ticked', async () => {
    filter(['waste'])
    render(<GroupPicker />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Roads/ }))
    expect(setPicked).toHaveBeenCalledWith(['waste', 'roads'], [])
  })

  it('unticking a group also forgets its subcategories, but keeps other groups\' ones', async () => {
    filter(['roads', 'waste'], ['lights', 'street-waste'])
    render(<GroupPicker />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Roads/ }))
    expect(setPicked).toHaveBeenCalledWith(['waste'], ['street-waste'])
  })

  it('"View all" clears every choice', async () => {
    filter(['roads'], ['lights'])
    render(<GroupPicker />)
    await userEvent.click(screen.getByRole('button', { name: 'View all' }))
    expect(setPicked).toHaveBeenCalledWith([], [])
  })
})
