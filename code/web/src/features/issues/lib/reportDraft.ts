// A report being written is kept in the browser, so a reload or a lost connection doesn't lose it.

export const DRAFT_KEY = 'amarshohor:draft'

export type Size = 'small' | 'medium' | 'large'

export interface Draft {
  title: string
  description: string
  size: Size | null
  address: string
  point: { lat: number; lng: number } | null
  accuracy: number | null
  source: 'gps' | 'manual'
}

export function loadDraft(): Partial<Draft> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') as Partial<Draft>
  } catch {
    return {}
  }
}
