// What may be attached: how many files, which kinds, how long a video.
import { describe, expect, it } from 'vitest'
import { MAX_FILES, isVideo, validateSelection } from '@/features/media/lib/mediaRules'

describe('choosing photos and videos', () => {
  const file = (name: string, type: string) => new File(['x'], name, { type })

  it('tells videos from photos by their type', () => {
    expect(isVideo(file('a.mp4', 'video/mp4'))).toBe(true)
    expect(isVideo(file('a.jpg', 'image/jpeg'))).toBe(false)
  })

  it('accepts a few photos', async () => {
    expect(await validateSelection([file('a.jpg', 'image/jpeg'), file('b.png', 'image/png')])).toBeNull()
  })

  it('refuses more files than allowed', async () => {
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => file(`${i}.jpg`, 'image/jpeg'))
    expect(await validateSelection(many)).toBe(`You can attach up to ${MAX_FILES} files.`)
  })

  it('allows only one video', async () => {
    expect(await validateSelection([file('a.mp4', 'video/mp4'), file('b.mp4', 'video/mp4')])).toBe('You can attach only one video.')
  })

  it('refuses files that are not photos or videos, by name', async () => {
    expect(await validateSelection([file('notes.pdf', 'application/pdf')])).toBe('notes.pdf is not a photo or video.')
  })
})
