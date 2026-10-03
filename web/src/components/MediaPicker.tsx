import { Camera, Video, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../hooks/useToast'
import { MAX_FILES, MAX_VIDEO_SECONDS, isVideo, validateSelection } from '../lib/media'

/** Pick photos (camera on phones) and at most one short video. */
export function MediaPicker({ files, onChange, required = false, imagesOnly = false }: {
  files: File[]; onChange: (f: File[]) => void; required?: boolean; imagesOnly?: boolean
}) {
  const photoInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files])
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews])

  async function add(list: FileList | null) {
    if (!list?.length) return
    setBusy(true)
    const next = [...files, ...Array.from(list)]
    const problem = await validateSelection(next)
    setBusy(false)
    if (problem) toast.error(new Error(problem))
    else onChange(next)
  }

  const hasVideo = files.some(isVideo)

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {previews.map((p, i) => (
          <div key={p.url} className="relative size-24 overflow-hidden rounded-lg border border-line bg-black/5">
            {isVideo(p.file) ? (
              <video src={p.url} className="size-full object-cover" muted playsInline />
            ) : (
              <img src={p.url} alt="" className="size-full object-cover" />
            )}
            <button
              type="button"
              aria-label="Remove"
              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
              onClick={() => onChange(files.filter((_, j) => j !== i))}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        {files.length < MAX_FILES && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => photoInput.current?.click()}
              className="grid size-24 place-items-center rounded-lg border-2 border-dashed border-line text-muted hover:border-brand hover:text-brand"
            >
              <span className="flex flex-col items-center gap-1 text-xs font-semibold">
                <Camera className="size-6" /> Photo
              </span>
            </button>
            {!imagesOnly && !hasVideo && (
              <button
                type="button"
                disabled={busy}
                onClick={() => videoInput.current?.click()}
                className="grid size-24 place-items-center rounded-lg border-2 border-dashed border-line text-muted hover:border-brand hover:text-brand"
              >
                <span className="flex flex-col items-center gap-1 text-xs font-semibold">
                  <Video className="size-6" /> Video
                </span>
              </button>
            )}
          </>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {required ? 'Required. ' : ''}Up to {MAX_FILES} files{imagesOnly ? '' : `, one video of max ${MAX_VIDEO_SECONDS}s`}.
        Photos taken on the spot are the strongest evidence.
      </p>
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { add(e.target.files); e.target.value = '' }}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => { add(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
