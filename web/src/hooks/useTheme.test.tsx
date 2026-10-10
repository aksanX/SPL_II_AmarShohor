// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../test/utils'
import { useTheme } from './useTheme'

let deviceDark = false
let onDeviceChange: (() => void) | null = null

beforeEach(() => {
  localStorage.clear()
  deviceDark = false
  onDeviceChange = null
  document.documentElement.dataset.theme = 'light'
  window.matchMedia = vi.fn(() => ({
    get matches() { return deviceDark },
    addEventListener: (_: string, fn: () => void) => { onDeviceChange = fn },
    removeEventListener: vi.fn(),
  })) as never
})

describe('useTheme', () => {
  it('starts from the theme the page already has (set before the first paint)', () => {
    document.documentElement.dataset.theme = 'dark'
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
  })

  it('switches and remembers the choice', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggle())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('follows the device until the person picks a theme', () => {
    const { result } = renderHook(() => useTheme())
    deviceDark = true
    act(() => onDeviceChange?.())
    expect(result.current.theme).toBe('dark')
  })

  it('ignores the device once the person has picked', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggle()) // dark, saved
    act(() => result.current.toggle()) // light, saved
    deviceDark = true
    act(() => onDeviceChange?.())
    expect(result.current.theme).toBe('light')
  })
})
