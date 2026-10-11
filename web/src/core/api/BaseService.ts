import { AppError, type PgError } from './AppError'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/core/supabase'
import type { UploadedMedia } from '@/models'

/**
 * Base class of every backend service (IssueService, MapService, …). It owns the Supabase client and turns its
 * errors into AppError, so each service only says *which* database call to make.
 *
 * Services write their calls as arrow-function fields, not methods: they keep `this` when passed around on their
 * own, e.g. `useQuery({ queryFn: categoryService.getCategories })`.
 */
export abstract class BaseService {
  private readonly injected: SupabaseClient | undefined

  /** `client` is for tests, which pass a fake one; the app uses the shared client. */
  constructor(client?: SupabaseClient) {
    this.injected = client
  }

  /** Looked up on each call (not stored at start-up), so a test's mocked `@/core/supabase` is always the one used. */
  protected get db(): SupabaseClient {
    return this.injected ?? supabase
  }

  /** Calls a database function (supabase.rpc) and returns its result, or throws an AppError. */
  protected async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args)
    if (error) throw AppError.from(error)
    return data as T
  }

  /** Runs a table or view query built with `this.db.from(…)` and returns its rows, or throws an AppError. */
  protected async select<T>(query: PromiseLike<{ data: unknown; error: PgError | null }>): Promise<T> {
    const { data, error } = await query
    if (error) throw AppError.from(error)
    return data as T
  }

  /** The first row of a function that returns a list, or null when it returned none. */
  protected async rpcFirst<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
    const rows = await this.rpc<T[]>(fn, args)
    return rows[0] ?? null
  }

  /** Uploaded photos/videos as the database functions expect them (the live-capture token only when there is one). */
  protected mediaJson(media: UploadedMedia[]) {
    return media.map((m) => (m.token ? { path: m.path, type: m.type, token: m.token } : { path: m.path, type: m.type }))
  }
}
