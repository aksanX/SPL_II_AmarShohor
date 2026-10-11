// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { pinIcon } from './leaflet'

describe('pinIcon', () => {
  it('reuses one icon per colour and kind instead of making one per pin', () => {
    expect(pinIcon('#ff0000')).toBe(pinIcon('#ff0000'))
    expect(pinIcon('#ff0000', 'resolved')).toBe(pinIcon('#ff0000', 'resolved'))
  })

  it('makes different icons for different colours or kinds', () => {
    expect(pinIcon('#ff0000')).not.toBe(pinIcon('#00ff00'))
    expect(pinIcon('#ff0000')).not.toBe(pinIcon('#ff0000', 'unverified'))
  })

  it('draws the pin in its category colour, dashed when unverified', () => {
    expect(String(pinIcon('#123456', 'unverified').options.html)).toContain('class="issue-pin unverified" style="background:#123456"')
  })

  it('draws a grey pin for a colour that is not a plain hex colour, so it cannot add HTML', () => {
    const html = String(pinIcon('red"><img src=x onerror=alert(1)>').options.html)
    expect(html).toContain('style="background:#6b7280"')
    expect(html).not.toContain('<img')
  })
})
