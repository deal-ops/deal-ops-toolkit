// Where the guided tour was left, saved as an interface preference — never with the deal data (docs/en/05_GUIDED_TOUR.md §4).
// `demoFrom` records that the step-10 cap on screen was set by the tour, and the cap it replaced, so the right value is
// still put back after a reload (review M3 #2, Codex M3 R1 #2).
export const TOUR_KEY = 'deal-ops-toolkit:tour'

export interface TourProgress {
  step: number
  /** the cap before the step-10 demo; null when no demo is in progress */
  demoFrom: string | null
}

export function loadTourProgress(storage: Pick<Storage, 'getItem'> | undefined, steps: number): TourProgress | null {
  try {
    const v = JSON.parse(storage?.getItem(TOUR_KEY) ?? 'null') as unknown
    if (typeof v !== 'object' || v === null) return null
    const { step, demoFrom } = v as { step?: unknown; demoFrom?: unknown }
    return Number.isInteger(step) && (step as number) >= 0 && (step as number) < steps
      ? { step: step as number, demoFrom: typeof demoFrom === 'string' ? demoFrom : null }
      : null
  } catch {
    return null
  }
}

export function saveTourProgress(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, p: TourProgress | null) {
  try {
    if (p === null) storage?.removeItem(TOUR_KEY)
    else storage?.setItem(TOUR_KEY, JSON.stringify(p))
  } catch {
    // storage blocked: the tour still works, it just cannot be resumed after a reload
  }
}
