import { BaseService } from '@/core/api/BaseService'
import type { LeaderboardRow } from '@/models'

/** The volunteer leaderboard. */
export class LeaderboardService extends BaseService {
  getLeaderboard = () =>
    this.select<LeaderboardRow[]>(this.db.from('leaderboard_v').select('*').order('rank').limit(100))
}

export const leaderboardService = new LeaderboardService()
