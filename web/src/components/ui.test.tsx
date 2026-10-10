// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../test/utils'
import { LoadError } from './ui'

describe('LoadError', () => {
  it('says what could not load and why', () => {
    render(<LoadError what="the leaderboard" error={new Error('Network down')} onRetry={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the leaderboard: Network down')
  })

  it('retries when asked', async () => {
    const onRetry = vi.fn()
    render(<LoadError what="tasks" error={new Error('x')} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('still reads well when the error has no message', () => {
    render(<LoadError what="tasks" error={null} onRetry={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load tasks: unknown error')
  })
})
