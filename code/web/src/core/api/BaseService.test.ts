// The shared part of every backend service: error handling and the helpers, with a fake Supabase client.
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from './AppError'
import { BaseService } from './BaseService'

vi.mock('@/core/supabase', () => ({ supabase: {} }))

class TestService extends BaseService {
  call = (fn: string) => this.rpc<number[]>(fn, { p_x: 1 })
  first = (fn: string) => this.rpcFirst<number>(fn)
  rows = () => this.select<number[]>(this.db.from('t').select('*'))
  media = this.mediaJson.bind(this)
}

function fakeClient(result: { data: unknown; error: unknown }) {
  const query = Promise.resolve(result)
  return {
    rpc: vi.fn(async () => result),
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
  } as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> }
}

describe('BaseService', () => {
  it('calls the database function with its arguments and returns the data', async () => {
    const client = fakeClient({ data: [1, 2], error: null })
    await expect(new TestService(client).call('get_things')).resolves.toEqual([1, 2])
    expect(client.rpc).toHaveBeenCalledWith('get_things', { p_x: 1 })
  })

  it("throws an AppError carrying the SQL hint as its code", async () => {
    const client = fakeClient({ data: null, error: { message: 'Too far away', hint: 'TOO_FAR' } })
    const err = await new TestService(client).call('confirm').catch((e) => e)
    expect(err).toBeInstanceOf(AppError)
    expect(err).toMatchObject({ message: 'Too far away', code: 'TOO_FAR' })
  })

  it('turns a dropped connection into a friendly network error', async () => {
    const client = fakeClient({ data: null, error: { message: 'TypeError: Failed to fetch' } })
    const err: AppError = await new TestService(client).call('x').catch((e) => e)
    expect(err.isNetwork).toBe(true)
    expect(err.message).toMatch(/Network problem/)
  })

  it('returns the first row, or null when there is none', async () => {
    await expect(new TestService(fakeClient({ data: [7, 8], error: null })).first('f')).resolves.toBe(7)
    await expect(new TestService(fakeClient({ data: [], error: null })).first('f')).resolves.toBeNull()
  })

  it('runs table queries the same way', async () => {
    await expect(new TestService(fakeClient({ data: [3], error: null })).rows()).resolves.toEqual([3])
    const failing = new TestService(fakeClient({ data: null, error: { message: 'denied' } }))
    await expect(failing.rows()).rejects.toThrow('denied')
  })

  it('sends the live-capture token only with media that has one', () => {
    const s = new TestService(fakeClient({ data: null, error: null }))
    expect(s.media([{ path: 'a.jpg', type: 'image' }, { path: 'b.jpg', type: 'image', token: 't1', live: true }])).toEqual([
      { path: 'a.jpg', type: 'image' }, { path: 'b.jpg', type: 'image', token: 't1' },
    ])
  })
})
