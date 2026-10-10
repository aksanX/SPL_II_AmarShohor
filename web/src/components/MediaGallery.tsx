import clsx from 'clsx'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { mediaUrl } from '../lib/supabase'
import type { MediaItem } from '../lib/types'

const KIND_LABEL: Record<MediaItem['kind'], string> = {
  report: '',
  confirmation: 'On-site confirmation',
  progress: 'Progress',
  resolution: 'After fix',
}

function Thumb({ item, className, onClick }: { item: MediaItem; className?: string; onClick: () => void }) {
  const url = mediaUrl(item.path)
  // The picture inside is decorative, so the button itself must say what it opens.
  const name = `Open ${item.media_type === 'video' ? 'video' : 'photo'}${KIND_LABEL[item.kind] ? ` (${KIND_LABEL[item.kind]})` : ''}`
  return (
    <button type="button" onClick={onClick} aria-label={name} className={clsx('relative block overflow-hidden bg-black/5', className)}>
      {item.media_type === 'video' ? (
        <video src={url} className="size-full object-cover" muted playsInline preload="metadata" />
      ) : (
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      )}
      {item.media_type === 'video' && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-black/60 text-white">▶</span>
        </span>
      )}
      {KIND_LABEL[item.kind] && (
        <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
          {KIND_LABEL[item.kind]}
        </span>
      )}
    </button>
  )
}

/** Facebook-style grid: 1 big, 2 side by side, 3+ as 1 big + small tiles. */
export function MediaGallery({ items }: { items: MediaItem[] }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!items.length) return null
  const shown = items.slice(0, 4)
  const extra = items.length - shown.length

  return (
    <>
      <div
        className={clsx(
          'grid gap-0.5 overflow-hidden',
          shown.length === 1 && 'grid-cols-1',
          shown.length === 2 && 'grid-cols-2',
          shown.length >= 3 && 'grid-cols-2 grid-rows-2',
        )}
      >
        {shown.map((m, i) => (
          <div
            key={m.id}
            className={clsx(
              'relative',
              shown.length === 1 && 'aspect-[4/3] max-h-[480px]',
              shown.length === 2 && 'aspect-square',
              shown.length >= 3 && i === 0 && 'row-span-2 aspect-auto',
              shown.length >= 3 && i > 0 && 'aspect-[4/3]',
              shown.length === 3 && i === 2 && 'col-start-2',
            )}
          >
            <Thumb item={m} className="absolute inset-0 size-full" onClick={() => setOpen(i)} />
            {i === shown.length - 1 && extra > 0 && (
              <button
                onClick={() => setOpen(i)}
                className="absolute inset-0 grid place-items-center bg-black/50 text-2xl font-bold text-white"
              >
                +{extra}
              </button>
            )}
          </div>
        ))}
      </div>
      {open !== null && <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  )
}

function Lightbox({ items, index, onIndex, onClose }: {
  items: MediaItem[]; index: number; onIndex: (i: number) => void; onClose: () => void
}) {
  const item = items[index]
  const url = mediaUrl(item.path)
  const label = `${KIND_LABEL[item.kind] || 'Reported evidence'} · ${index + 1} / ${items.length}`

  // Keyboard: Escape closes, the arrow keys go back and forth, like any photo viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && items.length > 1) onIndex((index - 1 + items.length) % items.length)
      else if (e.key === 'ArrowRight' && items.length > 1) onIndex((index + 1) % items.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onIndex, onClose])

  return (
    <div className="fixed inset-0 z-[1800] flex items-center justify-center bg-black/90" onClick={onClose}>
      <button aria-label="Close" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" onClick={onClose}>
        <X />
      </button>
      {items.length > 1 && (
        <>
          <button
            aria-label="Previous"
            className="absolute left-3 rounded-full bg-white/10 p-2 text-white"
            onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + items.length) % items.length) }}
          >
            <ChevronLeft />
          </button>
          <button
            aria-label="Next"
            className="absolute right-3 rounded-full bg-white/10 p-2 text-white"
            onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % items.length) }}
          >
            <ChevronRight />
          </button>
        </>
      )}
      <div className="max-h-[90vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        {item.media_type === 'video' ? (
          <video src={url} controls autoPlay playsInline className="max-h-[85vh] max-w-[92vw]" />
        ) : (
          <img src={url} alt={label} className="max-h-[85vh] max-w-[92vw] object-contain" />
        )}
        <p className="mt-2 text-center text-sm text-white/80">
          {label}
        </p>
      </div>
    </div>
  )
}
