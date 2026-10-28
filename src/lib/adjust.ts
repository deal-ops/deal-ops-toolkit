// Withdrawals before closing (PRD C-REC-7) and fee payer change adjustments (C-ALL-11): the investor list is never
// rewritten; a mark or an adjustment is recorded beside it and decides the effective cash due (Tech Design §9.2.1).
import { formatMoney, parseDate, type Currency } from './money'
import { normRef } from './reconcile'
import type { Fee, FeeBasis, FeePayer } from './allocation'

/** C-REC-7: a mark on the investor, not a decision on a bank line. */
export interface Withdrawal {
  /** ISO date; shown and logged only, never used in a calculation */
  on: string
  consent: true
  /** the payment reference when marked, normalised as C-REC-1, to tell whether it was changed since */
  reference: string
}

/** C-ALL-11: the original stays, the adjustment is recorded beside it and can be reversed. */
export interface FeePayerChange {
  id: string
  feeId: string
  feeLabel: string
  from: FeePayer
  to: FeePayer
  consent: boolean
  appliedAt: string
  status: 'active' | 'reversed' | 'voided'
  voidReason: string | null
  /** the fee's rate and the fee basis when applied: a change to either voids the whole change (compared by value) */
  feeAtApply: { rateBps: number; basis: FeeBasis }
  /** the allocation settings right after applying (the fee table with the new payer), for the reminder and the re-check */
  settingsAtApply: { minimum: number; cap: number | null; priceMicros: number; basis: FeeBasis; fees: Fee[] }
  /** T_i of every participant of the commitment allocation */
  targets: Record<string, number>
  /** one line for every investor in scope, including those whose amount did not change and those not participating */
  lines: AdjustmentLine[]
}

export interface AdjustmentLine {
  investorId: string
  /** the payment reference when applied, normalised as C-REC-1 */
  reference: string
  /** the cash due on the investor list when applied */
  baseCashDue: number
  /** N_i (equal to baseCashDue when unchanged) */
  newCashDue: number
  voided: boolean
  voidReason: string | null
}

/** R-REC-12 */
export const ADJUSTMENT_VOID_NOTE = 'This fee payer change no longer applies — redo it'
/** C-REC-7 */
export const NOT_COVERED_NOTE = 'Not covered by the active fee payer change — reverse and redo'
/** C-ALL-11 */
export const SETTINGS_CHANGED_NOTE = 'Allocation settings changed since this fee payer change — check the preview'

export const activeChange = (changes: FeePayerChange[]): FeePayerChange | undefined => changes.find((c) => c.status === 'active')

const lineFor = (change: FeePayerChange | undefined, investorId: string) => change?.lines.find((l) => l.investorId === investorId)

/**
 * C-ALL-11 effective cash due: N_i while the change is active and the investor's line stands, otherwise the list value.
 * The list amount and the normalised reference are compared too, as a second guard should a void check ever be missed.
 */
export function effectiveDue(
  change: FeePayerChange | undefined,
  investorId: string,
  listCashDue: number,
  listReference: string,
): { due: number; original: number; line: AdjustmentLine | null } {
  const line = change?.status === 'active' ? lineFor(change, investorId) : undefined
  if (line && !line.voided && line.baseCashDue === listCashDue && line.reference === normRef(listReference))
    return { due: line.newCashDue, original: listCashDue, line }
  return { due: listCashDue, original: listCashDue, line: null }
}

/**
 * C-REC-7: investors on the list, not withdrawn, that the active change does not cover — no line, a voided one, or one
 * that no longer fits the list (the same test as `effectiveDue`, so coverage and the amount used always agree; Codex M6 r6 #3).
 */
export function notCovered(
  change: FeePayerChange | undefined,
  investors: { id: string; cashDue: number; reference: string }[],
  withdrawals: Record<string, Withdrawal>,
): string[] {
  if (change?.status !== 'active') return []
  // covered = a standing line that fits the list, which is exactly when effectiveDue uses it (no line, voided, or changed: not)
  return investors
    .filter((v) => !Object.hasOwn(withdrawals, v.id) && effectiveDue(change, v.id, v.cashDue, v.reference).line === null)
    .map((v) => v.id)
}

/** C-REC-7: a withdrawal counts only while the investor's reference is the one it was marked with (a second guard, as for adjustments). */
export const withdrawalStands = (w: Withdrawal, listReference: string) => w.reference === normRef(listReference)

const PAYER_WORD: Record<FeePayer, string> = { investors: 'investors', company: 'company', lead: 'lead' }

/** R-REC-12: "was £1,000.00 · +£30.93 fee payer change (Platform fee: company → investors)". */
export function adjustmentNote(original: number, due: number, change: Pick<FeePayerChange, 'feeLabel' | 'from' | 'to'>, currency: Currency): string {
  const d = due - original
  const signed = `${d > 0 ? '+' : d < 0 ? '−' : ''}${formatMoney(Math.abs(d), currency)}`
  return `was ${formatMoney(original, currency)} · ${signed} fee payer change (${change.feeLabel}: ${PAYER_WORD[change.from]} → ${PAYER_WORD[change.to]})`
}

/** R-REC-12 banner, without the Reverse button that follows it. */
export function changeBanner(change: Pick<FeePayerChange, 'feeLabel' | 'to' | 'consent'>): string {
  return `Fee payer change active: ${change.feeLabel} → ${PAYER_WORD[change.to]} · ${change.consent ? 'consent recorded' : 'no consent needed'}`
}

/** C-ALL-11: the allocation settings, compared by value with those saved at apply (fee labels do not count). */
export function settingsChanged(change: FeePayerChange, now: FeePayerChange['settingsAtApply']): boolean {
  const key = (s: FeePayerChange['settingsAtApply']) =>
    JSON.stringify([s.minimum, s.cap, s.priceMicros, s.basis, s.fees.map((f) => [f.id, f.kind, f.value, f.payer])])
  return key(change.settingsAtApply) !== key(now)
}

/** R-REC-11.1: why a withdrawal cannot be marked yet, or null. */
export function withdrawalProblem(consent: boolean, on: string): string | null {
  if (consent !== true) return 'Tick “Written consent from the investor received” first.'
  const d = parseDate(on)
  return d.ok ? null : `Withdrawal date: ${d.reason}`
}

/** C-REC-7: "Withdrawn: 1 investor, £3,000.00 to refund". */
export function withdrawnSummary(count: number, toRefund: number, currency: Currency): string {
  return `Withdrawn: ${count} ${count === 1 ? 'investor' : 'investors'}, ${formatMoney(toRefund, currency)} to refund`
}
