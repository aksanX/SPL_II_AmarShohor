import { BaseService } from '@/core/api/BaseService'
import type { AppRole, MyRoleRequest, RoleRequest, UserRole } from '@/models'

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

  /** Deletes the person's whole account (no reason needed). City admins: officials of their own city only. */
  adminDeleteAccount = (username: string, role: AppRole) =>
    this.rpc<void>('admin_delete_account', { p_username: username, p_role: role })

  /** Super admins only. Giving someone another City Corporation moves them there. */
  adminGrantCityAdmin = (username: string, authorityId: string, reason: string) =>
    this.rpc<void>('admin_grant_city_admin', { p_username: username, p_authority: authorityId, p_reason: reason })
}

export const roleService = new RoleService()
