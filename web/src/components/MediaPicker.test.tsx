// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import '../test/utils'
import { MediaPicker } from './MediaPicker'

vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
vi.mock('../lib/media', async (real) => ({ ...(await real<typeof import('../lib/media')>()), validateSelection: vi.fn(async () => null) }))

beforeAll(() => {
  // jsdom has no object URLs; previews only need a unique address each.
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`)
  URL.revokeObjectURL = vi.fn()
})

function Picker({ start }: { start: File[] }) {
  const [files, setFiles] = useState(start)
  return <MediaPicker files={files} onChange={setFiles} />
}

const jpg = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

describe('MediaPicker', () => {
  it('describes each preview and names each remove button by its place', () => {
    render(<Picker start={[jpg('a.jpg'), jpg('b.jpg')]} />)
    expect(screen.getByAltText('Photo 1')).toBeInTheDocument()
    expect(screen.getByAltText('Photo 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove photo 2' })).toBeInTheDocument()
  })

  it('removes exactly the photo whose button was pressed', async () => {
    render(<Picker start={[jpg('a.jpg'), jpg('b.jpg')]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(screen.queryByAltText('Photo 2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeInTheDocument()
  })
})
