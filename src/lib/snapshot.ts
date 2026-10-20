// Snapshot hand-offs between modules (PRD R-X-07, C-DIS-7).
import type { AllocationResult } from './allocation'
import type { Holding } from './waterfall'

export interface Snapshot<T> {
  /** version of the upstream data the snapshot was taken from */
  sourceVersion: number
  data: T
}

export interface HoldingsTable {
  rows: Holding[]
  /** saved with the snapshot so later upstream price edits do not change the display */
  sharePriceMicros: number | null
}

export function holdingsFromAllocation(r: AllocationResult, priceMicros: number, sourceVersion: number): Snapshot<HoldingsTable> {
  return {
    sourceVersion,
    data: {
      rows: r.rows.filter((x) => x.participating).map((x) => ({ id: x.id, name: x.name, capital: x.invested })),
      sharePriceMicros: priceMicros,
    },
  }
}

export const isStale = <T,>(s: Snapshot<T> | null, currentSourceVersion: number) => s !== null && s.sourceVersion !== currentSourceVersion
