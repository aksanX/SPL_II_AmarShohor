// Shared helpers for component tests (files marked `// @vitest-environment jsdom`).
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach } from 'vitest'
import type { Category, CategoryGroup, HexCell, Issue, MapIssue } from '../lib/types'

afterEach(() => cleanup())

/** Renders a component the way the app does: inside React Query, with no retries so errors show at once. */
export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (el: ReactElement) => <QueryClientProvider client={client}>{el}</QueryClientProvider>
  const result = render(wrap(ui))
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) }
}

export function mapIssue(over: Partial<MapIssue> = {}): MapIssue {
  return {
    id: 'i1', title: 'Broken drain', category: 'drain', category_color: '#0a7d55', category_icon: 'circle',
    severity: 'medium', status: 'validated', lat: 23.8, lng: 90.4, upvote_count: 0, confirmation_count: 0,
    validation_score: 0, validation_threshold: 3, created_at: new Date().toISOString(), thumb_path: null, thumb_type: null,
    ...over,
  }
}

export function category(slug: string, name: string, groupSlug: string | null, color = '#123456'): Category {
  return {
    slug, name, name_bn: '', icon: 'circle', color, resolver: 'community', default_severity: 'medium',
    sort_order: 0, is_active: true, volunteer_allowed: true, duplicate_group: null, group_slug: groupSlug,
  }
}

export function group(slug: string, name: string, parent: string | null = null, color = '#654321'): CategoryGroup {
  return { slug, parent_slug: parent, code: slug, name, name_bn: '', description: '', icon: 'circle', color, sort_order: 0 }
}

// A hexagon about 1 km from its middle (23.8, 90.4) to each corner, as GeoJSON [lng, lat] with the first corner repeated.
export const HEX_RING: GeoJSON.Position[] = [
  [90.41, 23.8], [90.405, 23.809], [90.395, 23.809], [90.39, 23.8], [90.395, 23.791], [90.405, 23.791], [90.41, 23.8],
]

export function hexCell(over: Partial<HexCell> = {}): HexCell {
  return { hex: { type: 'Polygon', coordinates: [HEX_RING] }, weight: 12.34, issue_count: 4, top_category: 'roads', ...over }
}

/** A full issue for component tests; only the fields a test cares about need passing. */
export function issueFixture(over: Partial<Issue> = {}): Issue {
  return {
    id: 'iss-1', title: 'Blocked drain on Road 3', description: '', category: 'drain', category_name: 'Drainage',
    category_color: '#0a7d55', category_icon: 'circle', severity: 'medium', status: 'validated', route: 'community',
    lat: 23.8, lng: 90.4, address: 'Road 3', media: [], team_size: 1, team_count: 0, volunteer_id: null,
    volunteer_username: null, volunteer_full_name: null, lock_expires_at: null, validated_at: '2026-10-01T00:00:00Z',
    assigned_at: null, is_mine: false, assignee_role: null, ...over,
  } as unknown as Issue
}
