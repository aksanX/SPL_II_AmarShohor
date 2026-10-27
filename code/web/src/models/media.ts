// Photos and videos attached to issues, alerts and comments.

export type MediaKind = 'report' | 'confirmation' | 'progress' | 'resolution'

export type MediaType = 'image' | 'video'

export interface MediaItem {
  id: string
  kind: MediaKind
  media_type: MediaType
  path: string
}

export interface UploadedMedia {
  path: string
  type: MediaType
  /** Live capture code from the in-app camera (sent to the server, which checks and uses it up). */
  token?: string
  /** Set by the server on checked live evidence. */
  live?: boolean
  code?: string
  taken_at?: string
}

/** An upload nobody uses any more (admin_unused_uploads). */
export interface UnusedUpload {
  path: string
  size_bytes: number
  uploaded_at: string
}
