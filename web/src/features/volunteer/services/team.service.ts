import { BaseService } from '@/core/api/BaseService'
import type { Issue, TeamMember } from '@/models'

/** Volunteer teams on one task: joining, checking in at the site and handing over the lead. */
export class TeamService extends BaseService {
  getTeam = (id: string) => this.rpc<TeamMember[]>('get_team', { p_issue: id })

  joinTeam = (id: string) => this.rpc<void>('join_team', { p_issue: id })

  leaveTeam = (id: string) => this.rpc<void>('leave_team', { p_issue: id })

  checkIn = (id: string, lat: number, lng: number, accuracyM: number | null) =>
    this.rpc<void>('check_in', { p_issue: id, p_lat: lat, p_lng: lng, p_accuracy_m: accuracyM })

  offerLead = (id: string, memberId: string) => this.rpc<void>('offer_lead', { p_issue: id, p_member: memberId })

  acceptLead = (id: string) => this.rpc<void>('accept_lead', { p_issue: id })

  getOpenTeams = (lat: number | null, lng: number | null, radiusM: number) =>
    this.rpc<Issue[]>('get_open_teams', { p_lat: lat, p_lng: lng, p_radius_m: radiusM })
}

export const teamService = new TeamService()
