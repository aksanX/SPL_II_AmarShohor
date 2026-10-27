// Platform-wide settings the admins can change (app_settings).

export interface AppSettings {
  threshold_critical: number
  threshold_high: number
  threshold_medium: number
  threshold_low: number
  min_supporters: number
  confirm_radius_m: number
  duplicate_radius_m: number
  max_gps_accuracy_m: number
  lock_hours: number
  resolution_radius_m: number
  resolution_quorum: number
  reviewer_radius_m: number
  auto_close_days: number
  hide_min_flags: number
  review_expiry_days: number
  volunteer_min_account_hours: number
  max_active_tasks: number
  heat_half_life_days: number
  rep_task_completed: number
  rep_task_expired: number
  rep_task_reopened: number
  rep_per_star: number
  team_lock_hours: number
  team_lead_min_tasks: number
  /** Most people in a team, leader included (0066). */
  team_max_size: number
  escalation_retake_days: number
  escalation_abuse_rejections: number
  escalation_abuse_window_days: number
  rep_escalation_abuse: number
  rep_wrong_issue_lie: number
  stuck_release_count: number
  stuck_days: number
  request_help_radius_m: number
  emergency_radius_m: number
  emergency_new_account_radius_m: number
  emergency_hours: number
  emergency_max_per_day: number
  emergency_hide_denials: number
  emergency_end_votes: number
  emergency_respond_radius_m: number
  rep_false_emergency: number
  emergency_verify_confirms: number
  emergency_verify_radius_m: number
  live_capture_seconds: number
  live_issue_evidence: boolean
  max_reports_per_day: number
  max_flags_per_day: number
  rep_false_confirm: number
  /** Hours an area admin has to decide a case; each time it passes, the case counts as a missed deadline (0078). */
  city_admin_hours: number
  /** How many hours before that the area admins get a reminder (0049). */
  city_admin_reminder_hours: number
  /** Missed deadlines in 30 days from which the area admin is warned they may be replaced (0078). */
  city_admin_miss_warning: number
  /** Missed deadlines in 30 days at which the super admins are told to consider replacing the area admin (0078). */
  city_admin_miss_alert: number
  recategorize_confirms: number
  recategorize_votes: number
  min_lat: number
  max_lat: number
  min_lng: number
  max_lng: number
}
