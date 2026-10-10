// pathFromMediaUrl: from a public image link back to the file in Storage (used to delete old avatars).
import { describe, expect, it } from 'vitest'
import { pathFromMediaUrl } from './supabase'

const BASE = 'https://abc.supabase.co/storage/v1/object/public/media/'

describe('pathFromMediaUrl', () => {
  it('finds the path of a new-style upload', () => {
    expect(pathFromMediaUrl(BASE + 'u/0b9c1f4e-1d2a-4c55-9a3e-0e6f1c2d3b4a.jpg')).toBe('u/0b9c1f4e-1d2a-4c55-9a3e-0e6f1c2d3b4a.jpg')
  })

  it('finds the path of an old-style upload and ignores query strings', () => {
    expect(pathFromMediaUrl(BASE + '00000000-0000-0000-0000-000000000001/a.jpg?t=123')).toBe('00000000-0000-0000-0000-000000000001/a.jpg')
  })

  it('returns null for links that are not our Storage, or no link', () => {
    expect(pathFromMediaUrl('https://example.com/me.png')).toBeNull()
    expect(pathFromMediaUrl(null)).toBeNull()
    expect(pathFromMediaUrl(undefined)).toBeNull()
  })
})
