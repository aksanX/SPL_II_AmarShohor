// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { renderWithQuery } from '../test/utils'
import { PrivacyPage, TermsPage } from './LegalPages'

describe('legal pages', () => {
  it('Terms point to 999 for emergencies and link to the Privacy Policy', () => {
    renderWithQuery(<MemoryRouter><TermsPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Use' })).toBeInTheDocument()
    expect(screen.getByText('999')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    expect(document.title).toBe('Terms of Use · AmarShohor')
  })

  it('Privacy explains how to delete the account', () => {
    renderWithQuery(<MemoryRouter><PrivacyPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Deleting your account' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })
})
