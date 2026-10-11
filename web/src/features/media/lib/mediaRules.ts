// What may be attached to a post: how many files, which kinds, how long a video. No network, so it is unit tested.
import { AppError } from '@/core/api/AppError'

export const MAX_FILES = 5

export const MAX_VIDEO_SECONDS = 30

export const MAX_VIDEO_MB = 25

export function isVideo(file: File) {
  return file.type.startsWith('video/')
}

function videoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video')
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(el.src)
      resolve(el.duration)
    }
    el.onerror = () => reject(new Error('Could not read this video'))
    el.src = URL.createObjectURL(file)
  })
}

/** Returns an error message, or null when the selection is acceptable. */
export async function validateSelection(files: File[]): Promise<string | null> {
  if (files.length > MAX_FILES) return `You can attach up to ${MAX_FILES} files.`
  const videos = files.filter(isVideo)
  if (videos.length > 1) return 'You can attach only one video.'
  for (const f of files) {
    if (!f.type.startsWith('image/') && !isVideo(f)) return `${f.name} is not a photo or video.`
  }
  for (const v of videos) {
    if (v.size > MAX_VIDEO_MB * 1024 * 1024) return `Videos must be under ${MAX_VIDEO_MB} MB.`
    const seconds = await videoDuration(v)
    if (seconds > MAX_VIDEO_SECONDS + 0.5) return `Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`
  }
  return null
}

/** A lost connection: keep the uploads, the same files are reused when the person tries again. */
export function isNetworkError(e: unknown) {
  return e instanceof AppError && e.isNetwork
}
