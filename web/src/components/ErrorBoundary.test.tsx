// @vitest-environment jsdom
// A page that crashes shows a way out instead of a blank screen.
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'
import { ErrorBoundary, isStaleBundle } from './ErrorBoundary'

function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('ErrorBoundary', () => {
  it('shows the page when nothing goes wrong', () => {
    renderWithQuery(<ErrorBoundary><p>feed</p></ErrorBoundary>)
    expect(screen.getByText('feed')).toBeInTheDocument()
  })

  it('shows "Something went wrong" with Reload and a way back when a page crashes', () => {
    renderWithQuery(<ErrorBoundary><Boom message="Cannot read properties of undefined" /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('button', { name: /Reload/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the feed' })).toHaveAttribute('href', '/')
  })

  it('asks for a reload when the app was updated under an open tab', () => {
    renderWithQuery(<ErrorBoundary><Boom message="Failed to fetch dynamically imported module: /assets/MapPage-abc.js" /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('AmarShohor was updated')
  })

  it('clears the error when the person moves to another page', () => {
    const { rerender } = renderWithQuery(<ErrorBoundary resetKey="/map"><Boom message="bad" /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(<ErrorBoundary resetKey="/feed"><p>feed</p></ErrorBoundary>)
    expect(screen.getByText('feed')).toBeInTheDocument()
  })
})

describe('isStaleBundle', () => {
  it('recognises missing page files in Chrome, Safari and Firefox', () => {
    expect(isStaleBundle(new TypeError('Failed to fetch dynamically imported module: x'))).toBe(true)
    expect(isStaleBundle(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleBundle(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isStaleBundle(new Error('x is undefined'))).toBe(false)
  })
})
