// @vitest-environment jsdom
// "I see this too": closing without sending deletes the live photos already taken.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issueFixture, renderWithQuery } from '../test/utils'
import { ConfirmOnSiteDialog } from './IssueDialogs'

const evidence = { live: true, ready: false, upload: vi.fn(), discard: vi.fn(), reset: vi.fn(), picker: <p>camera</p> }
vi.mock('./OnSiteEvidence', () => ({ useOnSiteEvidence: () => evidence }))
vi.mock('../lib/api', () => ({}))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../hooks/useData', () => ({ useAppSettings: () => ({ data: { confirm_radius_m: 200 } }), useCategories: () => ({ data: [] }) }))
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

beforeEach(() => vi.clearAllMocks())

describe('ConfirmOnSiteDialog', () => {
  it('deletes the live photos when closed without sending', async () => {
    const onClose = vi.fn()
    renderWithQuery(<MemoryRouter><ConfirmOnSiteDialog issue={issueFixture()} open onClose={onClose} /></MemoryRouter>)
    expect(screen.getByText('camera')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(evidence.discard).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('can\'t be sent before a photo is taken', () => {
    renderWithQuery(<MemoryRouter><ConfirmOnSiteDialog issue={issueFixture()} open onClose={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /Confirm on-site/ })).toBeDisabled()
  })
})
