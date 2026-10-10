import { describe, expect, it, vi } from 'vitest'
import {
  EXPORT_COLUMNS, REPORTS_PAGE, averageRating, csvCell, exportFileName, fetchAllPages, nextReportsOffset, raterText,
  reportsCsv, roleLabel,
} from './profile'
import type { Issue } from './types'

describe('averageRating', () => {
  it('is empty before the first rating', () => {
    expect(averageRating(0, 0)).toBeNull()
  })

  it('shows one decimal', () => {
    expect(averageRating(9, 2)).toBe('4.5')
    expect(averageRating(5, 1)).toBe('5.0')
    expect(averageRating(13, 3)).toBe('4.3')
  })
})

describe('nextReportsOffset', () => {
  const page = (n: number) => Array.from({ length: n }, (_, i) => i)

  it('asks for the next 20 after a full page', () => {
    expect(nextReportsOffset(page(REPORTS_PAGE), [page(REPORTS_PAGE)])).toBe(20)
    expect(nextReportsOffset(page(REPORTS_PAGE), [page(REPORTS_PAGE), page(REPORTS_PAGE)])).toBe(40)
  })

  it('stops after a page that is not full', () => {
    expect(nextReportsOffset(page(7), [page(REPORTS_PAGE), page(7)])).toBeUndefined()
    expect(nextReportsOffset([], [[]])).toBeUndefined()
  })
})

describe('roleLabel', () => {
  it('names admins', () => {
    expect(roleLabel({ role: 'admin', authority_short_name: null })).toBe('Admin')
  })

  it('names verified officials with their City Corporation', () => {
    expect(roleLabel({ role: 'official', authority_short_name: 'DNCC' })).toBe('DNCC Official ✓')
  })

  it('never shows "null" when the City Corporation has no short name', () => {
    expect(roleLabel({ role: 'official', authority_short_name: null })).toBe('City Corporation Official ✓')
  })
})

describe('raterText', () => {
  it('shows who rated', () => {
    expect(raterText('rahim_mirpur')).toBe('@rahim_mirpur')
  })

  it('keeps anonymous reporters anonymous', () => {
    expect(raterText(null)).toBe('an anonymous reporter')
  })
})

describe('csvCell', () => {
  it('quotes every value', () => {
    expect(csvCell('Road 12')).toBe('"Road 12"')
    expect(csvCell(23.8)).toBe('"23.8"')
  })

  it('keeps commas and new lines inside the cell', () => {
    expect(csvCell('Sector 7, Uttara')).toBe('"Sector 7, Uttara"')
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
  })

  it('doubles quotes inside the value', () => {
    expect(csvCell('the "big" pothole')).toBe('"the ""big"" pothole"')
  })

  it('leaves missing values empty', () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })
})

describe('reportsCsv', () => {
  const issue = {
    id: 'abc', title: 'Broken drain, near "school"', category_name: 'Drainage', severity: 'high', status: 'closed',
    address: 'Road 12, Sector 7', lat: 23.8701, lng: 90.3987, upvote_count: 4, confirmation_count: 2, comment_count: 1,
    is_anonymous: true, created_at: '2026-10-01T08:00:00Z', validated_at: '2026-10-02T08:00:00Z', closed_at: null,
    volunteer_username: null,
  } as unknown as Issue
  const csv = reportsCsv([issue], 'https://amarshohor.app')
  const lines = csv.split('\n')

  it('starts with a byte order mark so Excel reads Bangla correctly', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('has a header row with every column', () => {
    expect(lines[0].slice(1)).toBe(EXPORT_COLUMNS.map(csvCell).join(','))
    expect(EXPORT_COLUMNS).toHaveLength(16)
  })

  it('writes one row per report, in column order', () => {
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe([
      '"Broken drain, near ""school"""', '"Drainage"', '"high"', '"Resolved"', '"Road 12, Sector 7"', '"23.8701"',
      '"90.3987"', '"4"', '"2"', '"1"', '"yes"', '"2026-10-01T08:00:00Z"', '"2026-10-02T08:00:00Z"', '""', '""',
      '"https://amarshohor.app/issue/abc"',
    ].join(','))
  })

  it('is only the header when there are no reports', () => {
    expect(reportsCsv([], 'https://x').split('\n')).toHaveLength(1)
  })
})

describe('fetchAllPages', () => {
  it('keeps loading until a page comes back short', async () => {
    const getPage = vi.fn(async (offset: number) => (offset < 100 ? Array(50).fill(offset) : [offset]))
    const all = await fetchAllPages(getPage, 50)
    expect(getPage.mock.calls.map(([o]) => o)).toEqual([0, 50, 100])
    expect(all).toHaveLength(101)
  })

  it('asks once when the first page is short', async () => {
    const getPage = vi.fn(async () => [1, 2, 3])
    expect(await fetchAllPages(getPage, 50)).toEqual([1, 2, 3])
    expect(getPage).toHaveBeenCalledTimes(1)
  })

  it('asks one more time after an exactly full last page', async () => {
    const getPage = vi.fn(async (offset: number) => (offset === 0 ? Array(50).fill(0) : []))
    expect(await fetchAllPages(getPage, 50)).toHaveLength(50)
    expect(getPage).toHaveBeenCalledTimes(2)
  })
})

describe('exportFileName', () => {
  it('names the file after the day of the download', () => {
    expect(exportFileName(new Date('2026-10-10T15:30:00Z'))).toBe('amarshohor-my-reports-2026-10-10.csv')
  })
})
