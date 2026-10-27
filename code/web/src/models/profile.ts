// People: public profiles, personal settings, ratings and the leaderboard.

export interface Profile {
  id: string
  username: string
  full_name: string
  avatar_url: string | null
  bio: string
  area_name: string
  is_volunteer: boolean
  volunteer_since: string | null
  reputation: number
  tasks_completed: number
  tasks_expired: number
  tasks_reopened: number
  rating_sum: number
  rating_count: number
  reports_count: number
  created_at: string
}

export interface MySettings {
  user_id: string
  home_lat: number | null
  home_lng: number | null
  default_anonymous: boolean
  show_on_leaderboard: boolean
}

export interface LeaderboardRow {
  id: string
  username: string
  full_name: string
  avatar_url: string | null
  area_name: string
  reputation: number
  tasks_completed: number
  tasks_expired: number
  tasks_reopened: number
  rating_count: number
  avg_rating: number | null
  rank: number
}

export interface Rating {
  id: number
  issue_id: string
  issue_title: string
  volunteer_id: string
  stars: number
  review: string
  created_at: string
  rater_id: string | null
  rater_username: string | null
}
