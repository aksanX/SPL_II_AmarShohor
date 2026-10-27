import { BaseService } from '@/core/api/BaseService'
import type { MySettings } from '@/models'

/** Your own account: personal settings and closing the account. */
export class AccountService extends BaseService {
  getMySettings = async (): Promise<MySettings | null> => {
    const rows = await this.select<MySettings[]>(this.db.from('my_settings_v').select('*').limit(1))
    return rows[0] ?? null
  }

  updateMySettings = (homeLat: number | null, homeLng: number | null, defaultAnonymous: boolean, showOnLeaderboard: boolean) =>
    this.rpc<void>('update_my_settings', {
      p_home_lat: homeLat, p_home_lng: homeLng,
      p_default_anonymous: defaultAnonymous, p_show_on_leaderboard: showOnLeaderboard,
    })

  /** Empties and closes the account; reports stay, anonymous. p_confirm is the username, typed by the person. */
  deleteMyAccount = (confirmUsername: string) => this.rpc<void>('delete_my_account', { p_confirm: confirmUsername })
}

export const accountService = new AccountService()
