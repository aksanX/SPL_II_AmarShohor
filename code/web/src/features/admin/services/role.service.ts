import { BaseService } from '@/core/api/BaseService'
import type { AppRole, MyRoleRequest, PersonMatch, RoleRequest, UserRole } from '@/models'

/** Roles (admin, city admin, official): who has which, official sign-up requests, granting and removing them. */
export class RoleService extends BaseService {
  getRoles = () => this.select<UserRole[]>(this.db.from('roles_v').select('*').order('granted_at'))

  getRolesOf = (userId: string) => this.select<UserRole[]>(this.db.from('roles_v').select('*').eq('user_id', userId))

  getMyRoleRequest = () =>
    this.rpcFirst<MyRoleRequest>('get_my_role_request')

  getRoleRequests = (status: 'pending' | 'approved' | 'rejected' = 'pending') =>
    this.rpc<RoleRequest[]>('get_role_requests', { p_status: status })

  adminDecideRoleRequest = (id: number, approve: boolean, reason: string) =>
    this.rpc<void>('admin_decide_role_request', { p_request: id, p_approve: approve, p_reason: reason })

  adminGrantAdmin = (username: string, reason: string) =>
    this.rpc<void>('admin_grant_admin', { p_username: username, p_reason: reason })

  adminRevokeRole = (username: string, role: AppRole, reason: string) =>
    this.rpc<void>('admin_revoke_role', { p_username: username, p_role: role, p_reason: reason })

  /**
   * Closes the person's account (no reason needed): login, name and roles go, their reports and fixes stay (0076).
   * City admins: officials of their own city only.
   */
  adminDeleteAccount = (username: string, role: AppRole) =>
    this.rpc<void>('admin_delete_account', { p_username: username, p_role: role })

  /** Super admins only: people whose username starts with, or name contains, `query` (at most 8). */
  findPeople = (query: string) => this.rpc<PersonMatch[]>('admin_find_people', { p_query: query })

  /** Super admins only. Giving someone another City Corporation moves them there. */
  adminGrantCityAdmin = (username: string, authorityId: string, reason: string) =>
    this.rpc<void>('admin_grant_city_admin', { p_username: username, p_authority: authorityId, p_reason: reason })
}

export const roleService = new RoleService()
