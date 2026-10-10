// Uploads: untraceable names, and deleting files a post won't use. Storage is replaced, so nothing is
// really uploaded. Photos are not compressed here (browser-image-compression needs a real browser).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from './api'
import { discardPaths, discardUploads, isNetworkError, uploadMedia } from './media'

const upload = vi.fn()
const remove = vi.fn()
vi.mock('./supabase', () => ({ MEDIA_BUCKET: 'media', supabase: { storage: { from: () => ({ upload, remove }) } } }))
vi.mock('browser-image-compression', () => ({ default: async (f: File) => f }))

const USER = '00000000-0000-0000-0000-000000000001'
const photo = (name = 'IMG_2041.HEIC') => new File(['x'], name, { type: 'image/heic' })

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null })
  remove.mockReset().mockResolvedValue({ error: null })
})

describe('upload names', () => {
  it('never contain the uploader\'s account id', async () => {
    const [m] = await uploadMedia(USER, [photo()])
    expect(m.path).not.toContain(USER)
    expect(m.path).toMatch(/^u\/[0-9a-f-]{36}\.jpg$/)
    expect(upload).toHaveBeenCalledWith(m.path, expect.anything(), expect.objectContaining({ upsert: false }))
  })

  it('are different for every file', async () => {
    const [a, b] = await uploadMedia(USER, [photo('a.jpg'), photo('b.jpg')])
    expect(a.path).not.toBe(b.path)
  })

  it('keep a safe extension for videos', async () => {
    const [m] = await uploadMedia(USER, [new File(['x'], 'clip.Final.MOV', { type: 'video/quicktime' })])
    expect(m).toMatchObject({ type: 'video' })
    expect(m.path).toMatch(/^u\/[0-9a-f-]{36}\.mov$/)
  })

  it('need a logged-in user', async () => {
    await expect(uploadMedia('', [photo()])).rejects.toThrow('log in')
    expect(upload).not.toHaveBeenCalled()
  })

  it('are reused when the same file is sent again (a retry after a lost connection)', async () => {
    const f = photo()
    const [first] = await uploadMedia(USER, [f])
    const [again] = await uploadMedia(USER, [f])
    expect(again.path).toBe(first.path)
    expect(upload).toHaveBeenCalledTimes(1)
  })
})

describe('deleting uploads a post won\'t use', () => {
  it('deletes the uploaded files and uploads them again next time', async () => {
    const f = photo()
    const [first] = await uploadMedia(USER, [f])
    await discardUploads([f])
    expect(remove).toHaveBeenCalledWith([first.path])
    const [second] = await uploadMedia(USER, [f])
    expect(second.path).not.toBe(first.path)
  })

  it('does nothing for files that were never uploaded', async () => {
    await discardUploads([photo()])
    expect(remove).not.toHaveBeenCalled()
  })

  it('never fails, even if Storage refuses (e.g. the file is in use)', async () => {
    remove.mockRejectedValueOnce(new Error('in use'))
    await expect(discardPaths(['u/x.jpg'])).resolves.toBeUndefined()
  })

  it('keeps uploads after a lost connection, deletes them after a refusal', () => {
    expect(isNetworkError(new AppError('Network problem', 'NETWORK'))).toBe(true)
    expect(isNetworkError(new AppError('Too far away', 'TOO_FAR'))).toBe(false)
    expect(isNetworkError(new Error('anything else'))).toBe(false)
  })
})
