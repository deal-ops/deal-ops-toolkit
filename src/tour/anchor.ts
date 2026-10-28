// Finding a guided-tour target on the page (R-X-01). Kept out of Tour.tsx so that file exports only components.

/**
 * The element with this tour anchor. Compared as a plain value, never put into a CSS selector: anchors can hold
 * transaction IDs from a bank file, and a `"` in one would make the selector throw and take the page down (Codex M5 r3 #1).
 */
export function byTour(anchor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-tour]')) if (el.dataset.tour === anchor) return el
  return null
}
