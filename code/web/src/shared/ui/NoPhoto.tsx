import { ImageOff } from 'lucide-react'

/** Thumbnail stand-in for an issue without a photo. */
export function NoPhoto() {
  return (
    <div className="grid size-20 shrink-0 place-items-center rounded-lg bg-bg text-muted" aria-label="No photo">
      <ImageOff className="size-6" />
    </div>
  )
}
