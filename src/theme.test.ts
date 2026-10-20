// @vitest-environment jsdom
// TC-X-03 (R-X-04, PRD v0.7.4 decision 9): hostile storage for the theme choice.
import { describe, expect, it } from 'vitest'
import { THEME_KEY, applyTheme, loadTheme, saveTheme } from './theme'

const store = (v: string | null) => ({ getItem: () => v }) as unknown as Storage
const throwing = new Proxy({} as Storage, {
  get: () => () => {
    throw new Error('blocked')
  },
})

describe('theme storage', () => {
  it('TC-X-03 anything stored other than light or dark reads as System', () => {
    for (const v of [null, '', 'Dark', ' dark', 'system', '__proto__', 'constructor', '{"theme":"dark"}', 'x'.repeat(100_000)]) expect(loadTheme(store(v))).toBe('system')
    expect(loadTheme(store('light'))).toBe('light')
    expect(loadTheme(store('dark'))).toBe('dark')
    expect(loadTheme(undefined)).toBe('system')
  })

  it('TC-X-03 blocked storage: reading gives System and saving does not throw', () => {
    expect(loadTheme(throwing)).toBe('system')
    expect(() => saveTheme(throwing, 'dark')).not.toThrow()
    expect(() => saveTheme(throwing, 'system')).not.toThrow()
  })

  it('TC-X-03 System stores nothing; Light and Dark store their name; applying System removes the mark', () => {
    const m = new Map<string, string>()
    const s = { setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) } as unknown as Storage
    saveTheme(s, 'dark')
    expect(m.get(THEME_KEY)).toBe('dark')
    saveTheme(s, 'light')
    expect(m.get(THEME_KEY)).toBe('light')
    saveTheme(s, 'system')
    expect(m.has(THEME_KEY)).toBe(false)
    const root = document.createElement('html')
    applyTheme('dark', root)
    expect(root.getAttribute('data-theme')).toBe('dark')
    applyTheme('system', root)
    expect(root.hasAttribute('data-theme')).toBe(false)
  })
})
