// Deal settings (PRD §4.0 R-DEAL-01..04).
import type { Currency } from './money'
import type { FeeBasis } from './allocation'

export interface DealSettings {
  name: string
  currency: Currency
  /** ISO date */
  asOf: string
  feeBasis: FeeBasis
  /** minor units */
  minimum: number
  /** days; unmatched receipts older than this are flagged (R-REC-06) */
  agedThresholdDays: number
}

/** R-DEAL-02: fixed, shown in the UI, no alternative offered. */
export const HOLDING_STRUCTURE =
  'Holding structure: nominee (bare trust) — investors hold beneficial interests; fractional shares allowed'

export const todayIso = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

export function defaultDeal(now = new Date()): DealSettings {
  return { name: 'New deal', currency: 'GBP', asOf: todayIso(now), feeBasis: 'deducted', minimum: 0, agedThresholdDays: 10 }
}
