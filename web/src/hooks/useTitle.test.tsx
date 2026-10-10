// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '../test/utils'
import { useTitle } from './useTitle'

function Page({ title }: { title?: string | null }) {
  useTitle(title)
  return null
}

describe('useTitle', () => {
  it('names the tab after the page', () => {
    render(<Page title="Map" />)
    expect(document.title).toBe('Map · AmarShohor')
  })

  it('shows just the app name while the page title is loading', () => {
    render(<Page title={null} />)
    expect(document.title).toBe('AmarShohor')
  })

  it('updates when the title changes and resets when the page closes', () => {
    const { rerender, unmount } = render(<Page title="Feed" />)
    rerender(<Page title="Notifications (3)" />)
    expect(document.title).toBe('Notifications (3) · AmarShohor')
    unmount()
    expect(document.title).toBe('AmarShohor')
  })
})
