// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '../lib/types'
import '../test/utils'
import { MediaGallery } from './MediaGallery'

vi.mock('../lib/supabase', () => ({ mediaUrl: (path: string) => `/media/${path}` }))

const photo = (id: number, kind: MediaItem['kind'] = 'report'): MediaItem => ({ id: String(id), kind, media_type: 'image', path: `u/${id}.jpg` })
const video: MediaItem = { id: '9', kind: 'report', media_type: 'video', path: 'u/9.mp4' }

describe('MediaGallery thumbnails', () => {
  it('names each thumbnail button, since the picture inside is decorative', () => {
    render(<MediaGallery items={[photo(1), video]} />)
    expect(screen.getAllByRole('button', { name: /^Open photo/ })).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: /^Open video/ })).toBeInTheDocument()
  })
})

describe('photo viewer', () => {
  const open = async (items: MediaItem[]) => {
    render(<MediaGallery items={items} />)
    await userEvent.click(screen.getAllByRole('button', { name: /^Open/ })[0])
  }

  it('opens the photo with a description and its position', async () => {
    await open([photo(1), photo(2), photo(3)])
    expect(screen.getByAltText(/· 1 \/ 3$/)).toHaveAttribute('src', '/media/u/1.jpg')
  })

  it('goes back and forth with the arrow keys, wrapping around', async () => {
    await open([photo(1), photo(2), photo(3)])
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByAltText(/· 2 \/ 3$/)).toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByAltText(/· 3 \/ 3$/)).toBeInTheDocument()
  })

  it('closes with Escape', async () => {
    await open([photo(1), photo(2)])
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('closes with the close button', async () => {
    await open([photo(1)])
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })
})
