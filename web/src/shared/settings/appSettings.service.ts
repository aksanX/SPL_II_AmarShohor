import { BaseService } from '@/core/api/BaseService'
import type { AppSettings } from '@/models'

/** Platform-wide settings (app_settings) and the public totals shown on the landing page. */
export class AppSettingsService extends BaseService {
  getAppSettings = () =>
    this.select<AppSettings>(this.db.from('app_settings').select('*').single())

  adminUpdateSettings = (changes: Record<string, number>) =>
    this.rpc<void>('admin_update_settings', { p_changes: changes })

  getPlatformStats = () =>
    this.rpc<{ reported: number; validated: number; in_progress: number; resolved: number; volunteers: number }>('platform_stats')
}

export const appSettingsService = new AppSettingsService()
