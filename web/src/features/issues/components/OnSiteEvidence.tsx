import { useEffect, useRef, useState } from 'react'
import type { UploadedMedia } from '@/models'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { LiveCamera } from '@/features/media/components/LiveCamera'
import { MediaPicker } from '@/features/media/components/MediaPicker'
import { mediaService } from '@/features/media/services/media.service'

/**
 * Photos for a fix or an "I see this too". The server wants live photos from the in-app camera (a
 * gallery photo could be old or from somewhere else), unless the admin turned that off. Live photos
 * are uploaded as they are taken; gallery photos when the form is sent.
 */
export function useOnSiteEvidence() {
  const live = useAppSettings().data?.live_issue_evidence !== false
  const [files, setFiles] = useState<File[]>([])
  const [shots, setShots] = useState<UploadedMedia[]>([])

  // Live photos are uploaded as they are taken and their codes expire within minutes, so photos never
  // sent are useless: delete them when the form goes away (page left, dialog closed).
  const unsent = useRef<UploadedMedia[]>([])
  useEffect(() => { unsent.current = shots }, [shots])
  useEffect(() => () => {
    if (unsent.current.length) mediaService.discardPaths(unsent.current.map((m) => m.path))
  }, [])

  return {
    live,
    /** At least one photo, as the server requires. */
    ready: live ? shots.some((m) => m.type === 'image') : files.length > 0,
    upload: (userId: string) => (live ? Promise.resolve(shots) : mediaService.uploadMedia(userId, files)),
    /** The server refused or the form was cancelled: the uploads won't be used. */
    discard: async () => {
      if (live) {
        setShots([])
        await mediaService.discardPaths(shots.map((m) => m.path))
      } else {
        await mediaService.discardUploads(files)
      }
    },
    /** Sent: forget the photos at once, so leaving the page right after doesn't try to delete them. */
    reset: () => { unsent.current = []; setFiles([]); setShots([]) },
    picker: live
      ? <LiveCamera media={shots} onChange={setShots} label="Take a photo now" />
      : <MediaPicker files={files} onChange={setFiles} required imagesOnly />,
  }
}
