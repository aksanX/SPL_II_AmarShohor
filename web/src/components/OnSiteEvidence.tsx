import { useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../hooks/useData'
import { discardPaths, discardUploads, uploadMedia } from '../lib/media'
import type { UploadedMedia } from '../lib/types'
import { LiveCamera } from './LiveCamera'
import { MediaPicker } from './MediaPicker'

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
    if (unsent.current.length) discardPaths(unsent.current.map((m) => m.path))
  }, [])

  return {
    live,
    /** At least one photo, as the server requires. */
    ready: live ? shots.some((m) => m.type === 'image') : files.length > 0,
    upload: (userId: string) => (live ? Promise.resolve(shots) : uploadMedia(userId, files)),
    /** The server refused or the form was cancelled: the uploads won't be used. */
    discard: async () => {
      if (live) {
        setShots([])
        await discardPaths(shots.map((m) => m.path))
      } else {
        await discardUploads(files)
      }
    },
    /** Sent: forget the photos at once, so leaving the page right after doesn't try to delete them. */
    reset: () => { unsent.current = []; setFiles([]); setShots([]) },
    picker: live
      ? <LiveCamera media={shots} onChange={setShots} label="Take a photo now" />
      : <MediaPicker files={files} onChange={setFiles} required imagesOnly />,
  }
}
