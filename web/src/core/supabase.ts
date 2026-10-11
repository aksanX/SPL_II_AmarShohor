import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const MEDIA_BUCKET = 'media'

export function mediaUrl(path: string): string {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
}

/** The Storage path inside a mediaUrl() link, or null for any other link. */
export function pathFromMediaUrl(url: string | null | undefined): string | null {
  const marker = `/object/public/${MEDIA_BUCKET}/`
  const i = url ? url.indexOf(marker) : -1
  return i === -1 ? null : decodeURIComponent(url!.slice(i + marker.length).split('?')[0])
}
