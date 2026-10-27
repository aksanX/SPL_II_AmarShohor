// Comments under an issue.

export interface Comment {
  id: string
  issue_id: string
  parent_id: string | null
  author_id: string
  author_username: string
  author_full_name: string
  author_avatar_url: string | null
  body: string | null
  is_deleted: boolean
  is_hidden: boolean
  is_update: boolean
  edited_at: string | null
  created_at: string
  is_volunteer: boolean
  is_reporter: boolean
  my_flagged: boolean
  author_official_of: string | null
  author_is_admin: boolean
  author_city_admin_of: string | null
}
