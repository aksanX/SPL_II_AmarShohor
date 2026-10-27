import { BaseService } from '@/core/api/BaseService'
import type { Notification } from '@/models'

/** In-app notifications. */
export class NotificationService extends BaseService {
  getNotifications = () =>
    this.select<Notification[]>(this.db.from('notifications_v').select('*').order('created_at', { ascending: false }).limit(50))

  markNotificationsRead = (ids: number[] | null = null) =>
    this.rpc<void>('mark_notifications_read', { p_ids: ids })
}

export const notificationService = new NotificationService()
