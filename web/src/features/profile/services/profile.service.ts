import { AppError } from '@/core/api/AppError'
import { BaseService } from '@/core/api/BaseService'
import type { Profile } from '@/models'

/** Public profiles: looking people up and editing your own. */
export class ProfileService extends BaseService {
  /** Is this username already someone's? Profiles are public, so this works before signing up. */
  isUsernameTaken = async (username: string): Promise<boolean> => {
    const { count, error } = await this.db.from('profiles').select('id', { count: 'exact', head: true }).eq('username', username)
    if (error) throw AppError.from(error)
    return (count ?? 0) > 0
  }

  getProfileByUsername = async (username: string): Promise<Profile | null> => {
    const rows = await this.select<Profile[]>(this.db.from('profiles').select('*').eq('username', username).limit(1))
    return rows[0] ?? null
  }

  getProfileById = async (id: string): Promise<Profile | null> => {
    const rows = await this.select<Profile[]>(this.db.from('profiles').select('*').eq('id', id).limit(1))
    return rows[0] ?? null
  }

  updateMyProfile = (username: string, fullName: string, bio: string, areaName: string, avatarUrl: string | null) =>
    this.rpc<void>('update_my_profile', {
      p_username: username, p_full_name: fullName, p_bio: bio, p_area_name: areaName, p_avatar_url: avatarUrl,
    })
}

export const profileService = new ProfileService()
