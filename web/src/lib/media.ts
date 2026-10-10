import imageCompression from 'browser-image-compression'
import { MEDIA_BUCKET, supabase } from './supabase'
import type { UploadedMedia } from './types'

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

// Remember uploads per File so retrying after a network failure doesn't upload twice.
const uploaded = new WeakMap<File, UploadedMedia>()

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw last
}

async function uploadOne(userId: string, file: File): Promise<UploadedMedia> {
  const cached = uploaded.get(file)
  if (cached) return cached

  let body: Blob = file
  let ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  let contentType = file.type
  const type = isVideo(file) ? 'video' : 'image'

  if (type === 'image') {
    // Phone photos are 3–8 MB; 1600px JPEG is plenty for evidence and loads fast on 3G.
    body = await imageCompression(file, {
      maxWidthOrHeight: 1600, maxSizeMB: 0.8, fileType: 'image/jpeg', initialQuality: 0.8, useWebWorker: true,
    })
    ext = 'jpg'
    contentType = 'image/jpeg'
  }

  if (!userId) throw new Error('Please log in first')
  // An untraceable name: the path is public (it is in every image link), so it must not reveal who
  // uploaded it. Storage records the uploader itself, and the server checks ownership with that.
  const path = `u/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'}`
  await withRetry(async () => {
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, { contentType, upsert: false })
    if (error) throw error
  })
  const result: UploadedMedia = { path, type }
  uploaded.set(file, result)
  return result
}

export async function uploadMedia(userId: string, files: File[], onProgress?: (done: number) => void) {
  const out: UploadedMedia[] = []
  for (const f of files) {
    out.push(await uploadOne(userId, f))
    onProgress?.(out.length)
  }
  return out
}

export async function deleteFiles(paths: string[]) {
  if (paths.length) await supabase.storage.from(MEDIA_BUCKET).remove(paths)
}
