// R-X-04 (PRD v0.7.4, decision 9): System / Light / Dark. Only an explicit choice is stored; System stores nothing.
export type Theme = 'system' | 'light' | 'dark'
export const THEME_KEY = 'deal-ops-toolkit:theme'

export function loadTheme(storage: Storage | undefined): Theme {
  try {
    const v = storage?.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(storage: Storage | undefined, theme: Theme): void {
  try {
    if (theme === 'system') storage?.removeItem(THEME_KEY)
    else storage?.setItem(THEME_KEY, theme)
  } catch {
    // blocked storage: the choice lasts until the page is closed
  }
}

/** An attribute on <html>, not an inline style (CSP style-src 'self'); index.css reads it. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}
