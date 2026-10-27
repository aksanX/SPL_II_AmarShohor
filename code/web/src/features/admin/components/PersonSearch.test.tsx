// @vitest-environment jsdom
import { renderWithQuery } from '@/test/utils'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonSearch } from '@/features/admin/components/PersonSearch'
import { roleService } from '@/features/admin/services/role.service'

vi.mock('@/features/admin/services/role.service', () => ({ roleService: { findPeople: vi.fn() } }))
const findPeople = vi.mocked(roleService.findPeople)

const RAHIMA = { username: 'rahima', full_name: 'Rahima Begum', avatar_url: null, area_name: 'Mirpur', roles: null, pending_official: false }
const KARIM = { username: 'karim_dncc', full_name: 'Karim Ahmed', avatar_url: null, area_name: '', roles: 'official', pending_official: false }

/** The box as People uses it: it shows whatever username was typed or picked. */
function Harness({ onPick = () => {} }: { onPick?: (u: string) => void }) {
  const [value, setValue] = useState('')
  return <><PersonSearch value={value} onChange={(u) => { setValue(u); onPick(u) }} /><p>picked: {value}</p></>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PersonSearch', () => {
  it('lists matching people with their username and area', async () => {
    findPeople.mockResolvedValue([RAHIMA])
    renderWithQuery(<Harness />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Username' }), 'rah')
    expect(await screen.findByText('Rahima Begum')).toBeInTheDocument()
    expect(screen.getByText('@rahima · Mirpur')).toBeInTheDocument()
    expect(findPeople).toHaveBeenLastCalledWith('rah')
  })

  it('fills in the username of the person picked', async () => {
    findPeople.mockResolvedValue([RAHIMA])
    renderWithQuery(<Harness />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Username' }), 'begum')
    fireEvent.mouseDown(await screen.findByText('Rahima Begum'))
    expect(screen.getByText('picked: rahima')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marks someone who already has a role', async () => {
    findPeople.mockResolvedValue([KARIM])
    renderWithQuery(<Harness />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Username' }), 'karim')
    expect(await screen.findByText('Official')).toBeInTheDocument()
  })

  it('says when nobody matches', async () => {
    findPeople.mockResolvedValue([])
    renderWithQuery(<Harness />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Username' }), 'zzz')
    expect(await screen.findByText('Nobody found')).toBeInTheDocument()
  })

  it("doesn't search for a single letter", async () => {
    renderWithQuery(<Harness />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Username' }), 'r')
    await new Promise((r) => setTimeout(r, 400))
    expect(findPeople).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
