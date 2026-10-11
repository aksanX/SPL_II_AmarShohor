/**
 * A list or panel that could not load. Says so with the reason and a retry, instead of an empty
 * "Nothing here yet" that hides the problem.
 */
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="card flex flex-wrap items-center gap-2 p-4 text-sm">
      <span className="mr-auto text-danger">Could not load {what}: {(error as Error)?.message ?? 'unknown error'}</span>
      <button type="button" className="btn-soft py-1.5 text-xs" onClick={onRetry}>Try again</button>
    </div>
  )
}
