// Pages loaded on demand: the feed loads first, other pages (and the map library) only when opened — it matters on slow mobile data.
import { lazy } from 'react'

// The feed loads first; other pages (and the map library) load on demand — matters on slow mobile data.
export const LandingPage = lazy(() => import('@/features/landing/pages/LandingPage').then((m) => ({ default: m.LandingPage })))

export const NotFoundPage = lazy(() => import('@/app/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })))

export const ResetPasswordPage = lazy(() => import('@/features/auth/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })))

export const IssuePage = lazy(() => import('@/features/issues/pages/IssuePage').then((m) => ({ default: m.IssuePage })))

export const LeaderboardPage = lazy(() => import('@/features/leaderboard/pages/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })))

export const MapPage = lazy(() => import('@/features/map/pages/MapPage').then((m) => ({ default: m.MapPage })))

export const NewIssuePage = lazy(() => import('@/features/issues/pages/NewIssuePage').then((m) => ({ default: m.NewIssuePage })))

export const NotificationsPage = lazy(() => import('@/features/notifications/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))

export const ProfilePage = lazy(() => import('@/features/profile/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })))

export const SettingsPage = lazy(() => import('@/features/settings/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))

export const VolunteerPage = lazy(() => import('@/features/volunteer/pages/VolunteerPage').then((m) => ({ default: m.VolunteerPage })))

export const AdminPage = lazy(() => import('@/features/admin/pages/AdminPage').then((m) => ({ default: m.AdminPage })))

export const CityCorpPage = lazy(() => import('@/features/city-corp/pages/CityCorpPage').then((m) => ({ default: m.CityCorpPage })))

export const CityCorpDashboardPage = lazy(() => import('@/features/city-corp/pages/CityCorpDashboardPage').then((m) => ({ default: m.CityCorpDashboardPage })))

export const OfficialSignupPage = lazy(() => import('@/features/city-corp/pages/OfficialSignupPage').then((m) => ({ default: m.OfficialSignupPage })))

export const OfficialWaitingPage = lazy(() => import('@/features/city-corp/pages/OfficialWaitingPage').then((m) => ({ default: m.OfficialWaitingPage })))

export const EmergencyPage = lazy(() => import('@/features/emergency/pages/EmergencyPage').then((m) => ({ default: m.EmergencyPage })))

export const TermsPage = lazy(() => import('@/features/legal/pages/TermsPage').then((m) => ({ default: m.TermsPage })))

export const PrivacyPage = lazy(() => import('@/features/legal/pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })))

export const AlertPage = lazy(() => import('@/features/emergency/pages/AlertPage').then((m) => ({ default: m.AlertPage })))
