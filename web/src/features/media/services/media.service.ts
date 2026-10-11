import imageCompression from 'browser-image-compression'
import { BaseService } from '@/core/api/BaseService'
import { MEDIA_BUCKET } from '@/core/supabase'
import type { UploadedMedia } from '@/models'
import { isVideo } from '@/features/media/lib/mediaRules'

/**
 * Photos and videos: uploading them to Storage (compressed, with untraceable names), removing ones a post won't
 * use, and live capture codes for the in-app camera. It remembers what it uploaded per File, so retrying after a
 * network failure doesn't upload the same photo twice.
 */
export class MediaService extends BaseService {
  private readonly uploaded = new WeakMap<File, UploadedMedia>()

  /** Uploads the files one by one; `onProgress` gets how many are done. */
  uploadMedia = async (userId: string, files: File[], onProgress?: (done: number) => void) => {
    const out: UploadedMedia[] = []
    for (const f of files) {
      out.push(await this.uploadOne(userId, f))
      onProgress?.(out.length)
    }
    return out
  }

  deleteFiles = async (paths: string[]) => {
    if (paths.length) await this.db.storage.from(MEDIA_BUCKET).remove(paths)
  }

  /**
   * Deletes uploads that won't be used, e.g. the server refused the post they were for. Otherwise they
   * stay in Storage forever and count against the plan's space. Never fails: at worst a file is left for
   * the admin's "unused uploads" cleanup. Storage only allows it while nothing uses the file.
   */
  discardPaths = async (paths: string[]) => {
    await this.deleteFiles(paths).catch(() => undefined)
  }

  /** discardPaths for files uploaded with uploadMedia; a retry will upload them again. */
  discardUploads = async (files: File[]) => {
    const paths: string[] = []
    for (const f of files) {
      const m = this.uploaded.get(f)
      if (m) {
        paths.push(m.path)
        this.uploaded.delete(f)
      }
    }
    await this.discardPaths(paths)
  }

  /** Opens a live capture: a one-time code to stamp on a photo taken right now, here. */
  startLiveCapture = async (lat: number, lng: number, accuracy: number) => {
    const rows = await this.rpc<{ token: string; code: string; expires_at: string }[]>(
      'start_live_capture', { p_lat: lat, p_lng: lng, p_accuracy: accuracy })
    return rows[0]
  }

  private async uploadOne(userId: string, file: File): Promise<UploadedMedia> {
    const cached = this.uploaded.get(file)
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
    await this.withRetry(async () => {
      const { error } = await this.db.storage.from(MEDIA_BUCKET).upload(path, body, { contentType, upsert: false })
      if (error) throw error
    })
    const result: UploadedMedia = { path, type }
    this.uploaded.set(file, result)
    return result
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
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
}

export const mediaService = new MediaService()
