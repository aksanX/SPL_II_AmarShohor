// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import '../test/utils'
import { NotFoundPage } from './NotFoundPage'

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><NotFoundPage /></MemoryRouter>)

describe('NotFoundPage', () => {
  it('says the page does not exist and shows the address that was tried', () => {
    renderAt('/isue/123')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByText('/isue/123')).toBeInTheDocument()
  })

  it('offers a way home and to the map', () => {
    renderAt('/old-link')
    expect(screen.getByRole('link', { name: /Go home/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /Open the map/ })).toHaveAttribute('href', '/map')
  })

  it('names the browser tab', async () => {
    renderAt('/nowhere')
    await waitFor(() => expect(document.title).toBe('Page not found · AmarShohor'))
  })
})
