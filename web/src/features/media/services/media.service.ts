import { BaseService } from '@/core/api/BaseService'

/** Photos and videos: live capture codes for the in-app camera. */
export class MediaService extends BaseService {
  /** Opens a live capture: a one-time code to stamp on a photo taken right now, here. */
  startLiveCapture = async (lat: number, lng: number, accuracy: number) => {
    const rows = await this.rpc<{ token: string; code: string; expires_at: string }[]>(
      'start_live_capture', { p_lat: lat, p_lng: lng, p_accuracy: accuracy })
    return rows[0]
  }
}

export const mediaService = new MediaService()
