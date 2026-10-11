/** Error shape returned by Supabase / PostgREST. */
export type PgError = { message: string; hint?: string | null; code?: string }

/** Error raised by the database. `code` is the HINT set in the SQL (e.g. DUPLICATE_FOUND). */
export class AppError extends Error {
  code: string | null
  constructor(message: string, code: string | null) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }

  /** True when the browser could not reach the server at all. */
  get isNetwork() {
    return this.code === 'NETWORK'
  }

  /** Turns a Supabase error into an AppError, with a friendly message for a dropped connection. */
  static from(error: PgError): AppError {
    if (error.message?.includes('Failed to fetch')) {
      return new AppError('Network problem — check your connection and try again.', 'NETWORK')
    }
    return new AppError(error.message, error.hint ?? null)
  }
}
