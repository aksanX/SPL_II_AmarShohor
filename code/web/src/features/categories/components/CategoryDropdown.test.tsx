// @vitest-environment jsdom
import { category, group } from '@/test/utils'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoryDropdown } from '@/features/categories/components/CategoryDropdown'
import { useCategoryFilter } from '@/features/categories/hooks/useCategoryFilter'
import { buildCategoryTree } from '@/features/categories/lib/categoryTree'

vi.mock('@/features/categories/hooks/useCategoryFilter', () => ({ useCategoryFilter: vi.fn() }))

const TREE = buildCategoryTree(
  [
    group('roads', 'Roads'),
    group('surface', 'Road surface', 'roads'),
    group('waste', 'Waste'),
    group('street-waste', 'Street waste', 'waste'),
  ],
  [category('pothole', 'Pothole', 'surface'), category('litter', 'Litter', 'street-waste')]
)
const setPicked = vi.fn()

function filter(groups: string[], subs: string[] = [], onIssues = true) {
  vi.mocked(useCategoryFilter).mockReturnValue({ tree: TREE, groups, subs, setPicked, onIssues } as never)
}

beforeEach(() => {
  setPicked.mockReset()
})

describe('CategoryDropdown', () => {
  it('renders "All Categories" on trigger when nothing is selected', () => {
    filter([])
    render(<CategoryDropdown />)
    expect(screen.getByRole('button', { name: /all categories/i })).toBeInTheDocument()
  })

  it('renders selected group name on trigger when 1 group is selected', () => {
    filter(['roads'])
    render(<CategoryDropdown />)
    expect(screen.getByRole('button', { name: /roads/i })).toBeInTheDocument()
  })

  it('opens dropdown menu on click and toggles category', async () => {
    filter([])
    render(<CategoryDropdown />)
    const trigger = screen.getByRole('button', { name: /all categories/i })
    await userEvent.click(trigger)

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    const roadsCheckbox = screen.getByRole('checkbox', { name: /roads/i })
    expect(roadsCheckbox).not.toBeChecked()

    await userEvent.click(roadsCheckbox)
    expect(setPicked).toHaveBeenCalledWith(['roads'], [])
  })

  it('clears selection when "View all categories" is clicked', async () => {
    filter(['roads'])
    render(<CategoryDropdown />)
    const trigger = screen.getByRole('button', { name: /roads/i })
    await userEvent.click(trigger)

    const viewAllOption = screen.getByRole('option', { name: /view all categories/i })
    await userEvent.click(viewAllOption)
    expect(setPicked).toHaveBeenCalledWith([], [])
  })

  it('unticking a group also forgets its subcategories, but keeps other groups\' ones', async () => {
    filter(['roads', 'waste'], ['surface', 'street-waste'])
    render(<CategoryDropdown />)
    await userEvent.click(screen.getByRole('button', { name: /2 categories selected/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /roads/i }))
    expect(setPicked).toHaveBeenCalledWith(['waste'], ['street-waste'])
  })
})
