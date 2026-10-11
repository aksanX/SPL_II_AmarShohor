// Volunteer teams and handing a task back.

export interface TeamMember {
  user_id: string
  username: string
  full_name: string
  avatar_url: string | null
  is_leader: boolean
  joined_at: string
  checked_in_at: string | null
}

export type ReleaseKind = 'busy' | 'needs_authority' | 'wrong_issue' | 'send_back'

export type WrongType = 'already_fixed' | 'fake' | 'wrong_location'
