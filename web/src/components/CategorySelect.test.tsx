// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { category, group } from '../test/utils'
import { CategorySelect } from './CategorySelect'

vi.mock('../hooks/useData', async () => {
  const { category: c, group: g } = await import('../test/utils')
  return {
    useCategories: () => ({
      data: [c('pothole', 'Pothole', 'surface'), c('crack', 'Crack', 'surface'), { ...c('old', 'Old category', 'surface'), is_active: false }, c('other', 'Other', null)],
    }),
    useCategoryGroups: () => ({ data: [g('roads', 'Roads'), { ...g('surface', 'Road surface', 'roads'), code: '1.1' }] }),
  }
})

describe('CategorySelect', () => {
  it('groups active categories under their subgroup, with ungrouped ones after', () => {
    render(<CategorySelect value="" onChange={vi.fn()} />)
    const box = screen.getByRole('combobox', { name: 'Category' })
    const optgroup = box.querySelector('optgroup') as HTMLElement
    expect(optgroup).toHaveAttribute('label', '1.1 Road surface')
    expect(within(optgroup).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pothole', 'Crack'])
    expect(screen.getByRole('option', { name: 'Other' })).toBeInTheDocument()
  })

  it('leaves out retired categories and the one being corrected', () => {
    render(<CategorySelect value="" onChange={vi.fn()} exclude="pothole" />)
    expect(screen.queryByRole('option', { name: 'Old category' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Pothole' })).not.toBeInTheDocument()
  })

  // keep the helpers referenced so the shared fixtures stay in use
  it('uses the shared fixtures', () => {
    expect(category('x', 'X', null).slug).toBe('x')
    expect(group('y', 'Y').slug).toBe('y')
  })
})
