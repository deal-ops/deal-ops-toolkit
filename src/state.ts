// Interface state (Tech Design §2): what the person typed is kept as text and parsed in derive.ts,
// so a bad value is reported where it was typed and never silently becomes 0 (PRD I-07).
// Hand-offs between modules are snapshots with version numbers (PRD R-X-07).
import { isIsoDate, MAX_MONEY, MAX_PRICE_MICROS, parseDate, parseMoney, parsePercent, plainMoney, sumExact, trimAscii, type Currency } from './lib/money'
import type { FeeBasis, FeeKind, FeePayer } from './lib/allocation'
import {
  commitmentFingerprint,
  decisionsAfterImport,
  lineFingerprint,
  pruneDecisions,
  reconcile,
  type BankLine,
  type Commitment,
  type Decision,
  type Decisions,
  type Handoff,
  type LineStatus,
  normRef,
} from './lib/reconcile'
import { generateId } from './lib/csv'
import { MAX_INVESTORS } from './lib/validate'
import {
  appendEvents,
  emptyLog,
  LINE_STATUS_WORDS,
  LOG_CAP,
  LOG_EVENTS,
  localIsoTime,
  dropOldest,
  markExported,
  parseInitials,
  type ActivityLog,
  type LogEntry,
  type NewEvent,
  type Truncated,
  logAmount,
} from './lib/activity'
import { commitmentOf, deriveFeePayerInput, deriveReconcile, lineOf } from './derive'
import { activeChange, type AdjustmentLine, type FeePayerChange, type Withdrawal } from './lib/adjust'
import { buildChange, needsConsent, previewFeePayerChange } from './lib/feePayer'
import { defaultDeal, type DealSettings } from './lib/deal'
import { SAMPLE_BANK, SAMPLE_CAP, SAMPLE_COMMITMENTS, SAMPLE_EXIT, SAMPLE_FEES, SAMPLE_PRICE_MICROS, SAMPLE_SETTINGS } from './lib/sample'
import type { Holding } from './lib/waterfall'
import { plainPrice } from './lib/exports'
import type { AllocationInvestor } from './lib/allocation'

export const STORAGE_KEY = 'deal-ops-toolkit:v1'
export const SCHEMA = 2

export interface DealText {
  name: string
  currency: Currency
  asOf: string
  feeBasis: FeeBasis
  minimum: string
  agedThresholdDays: string
  /** Your initials (R-X-08.3), kept as typed and checked when an entry is written */
  initials: string
}

export interface CommitmentRow {
  id: string
  name: string
  email: string
  reference: string
  cashDue: string
  scheme: string
}

export interface BankRow {
  id: string
  txnId: string | null
  date: string
  amount: string
  payer: string
  reference: string
}

export interface InvestorRow {
  id: string
  name: string
  received: string
  scheme: string
}

export interface FeeRow {
  id: string
  label: string
  payer: FeePayer
  kind: FeeKind
  value: string
}

export interface AllocationState {
  price: string
  cap: string
  fees: FeeRow[]
  investors: InvestorRow[]
  /** over-payments listed for refund at hand-off (R-REC-08) */
  excess: Refund[]
  /** reconciliation version the investors were handed off from; null when entered or imported here */
  handoffVersion: number | null
  /** the investor table was edited here after the hand-off (R-ALL-12.1) */
  editedSinceHandoff: boolean
}

/**
 * A refund outside the allocation: an over-payment, or all a withdrawn investor paid (C-REC-7). `needsCheck`: the
 * investor's row was changed by hand after hand-off, so a person must keep or remove it.
 */
export type Refund = Handoff['excess'][number] & { needsCheck: boolean }

export interface HoldingRow {
  id: string
  name: string
  /** amount invested, excluding fees (R-DIS-01) */
  capital: string
}

export interface TierRow {
  id: string
  /** gross multiple where the tier ends; blank on the last tier */
  upTo: string
  rate: string
}

export interface ExitState {
  holdings: HoldingRow[]
  /** saved with the snapshot or the import; only used to display shares (C-DIS-7) */
  sharePriceMicros: number | null
  /** allocation version the holdings were handed off from; null when entered or imported here */
  handoffVersion: number | null
  proceeds: string
  exitCosts: string
  years: string
  mode: 'fixed' | 'tiered'
  carry: string
  hurdle: string
  catchUp: string
  tiers: TierRow[]
}

export interface AppState {
  schema: typeof SCHEMA
  disclaimerAccepted: boolean
  deal: DealText
  commitments: CommitmentRow[]
  bank: BankRow[]
  decisions: Decisions
  /** bumped on every change that can alter the hand-off (R-X-07) */
  recVersion: number
  allocation: AllocationState
  /** bumped on every change that can alter the allocation, and so the holdings handed off from it (R-X-07) */
  allocVersion: number
  exit: ExitState
  /**
   * Bumped whenever a whole list is replaced (import, hand-off, sample). Table rows are keyed by it, so a draft typed
   * into a row can never carry over to the investor who replaces that row (Codex M2 round 3 #7).
   */
  tables: Tables
  /** C-REC-7, keyed by investor ID (a prototype-free record, so IDs like "__proto__" stay data); used from M6 */
  withdrawals: Record<string, Withdrawal>
  /** C-ALL-11, every change in the order applied; at most one active; used from M6 */
  feePayerChanges: FeePayerChange[]
  /** C-X-1 */
  log: ActivityLog
}

// the shapes live with the rules that use them (src/lib/adjust.ts)
export type { AdjustmentLine, FeePayerChange, Withdrawal }

export interface Tables {
  commitments: number
  bank: number
  investors: number
  fees: number
  holdings: number
  tiers: number
}

const dealText = (d: DealSettings): DealText => ({
  name: d.name,
  currency: d.currency,
  asOf: d.asOf,
  feeBasis: d.feeBasis,
  minimum: d.minimum ? plainMoney(d.minimum) : '',
  agedThresholdDays: String(d.agedThresholdDays),
  initials: '',
})

export const commitmentRow = (c: Commitment): CommitmentRow => ({ ...c, cashDue: plainMoney(c.cashDue) })
export const bankRow = (l: BankLine): BankRow => ({ ...l, amount: plainMoney(l.amount) })
export const investorRow = (v: AllocationInvestor): InvestorRow => ({ ...v, received: plainMoney(v.received) })

const emptyAllocation = (): AllocationState => ({
  price: '',
  cap: '',
  fees: [],
  investors: [],
  excess: [],
  handoffVersion: null,
  editedSinceHandoff: false,
})
export const emptyExit = (): ExitState => ({
  holdings: [],
  sharePriceMicros: null,
  handoffVersion: null,
  proceeds: '',
  exitCosts: '',
  years: '',
  mode: 'fixed',
  carry: '',
  hurdle: '',
  catchUp: '',
  tiers: [],
})
export const holdingRow = (h: Holding): HoldingRow => ({ ...h, capital: plainMoney(h.capital) })
const NO_TABLES: Tables = { commitments: 0, bank: 0, investors: 0, fees: 0, holdings: 0, tiers: 0 }

export function initialState(now = new Date()): AppState {
  return {
    schema: SCHEMA,
    disclaimerAccepted: false,
    deal: dealText(defaultDeal(now)),
    commitments: [],
    bank: [],
    decisions: {},
    recVersion: 1,
    allocation: emptyAllocation(),
    allocVersion: 1,
    exit: emptyExit(),
    tables: NO_TABLES,
    withdrawals: Object.create(null),
    feePayerChanges: [],
    log: emptyLog(),
  }
}

/**
 * Test Plan §3: the fictional sample, before any review, with nothing handed off yet. The log starts empty (loading
 * the sample through the reducer writes its first entry); the initials identify the person, not the deal, so they stay.
 */
export function sampleState(prev: AppState): AppState {
  return {
    ...prev,
    deal: { ...dealText(SAMPLE_SETTINGS), initials: prev.deal.initials },
    withdrawals: Object.create(null),
    feePayerChanges: [],
    log: emptyLog(),
    commitments: SAMPLE_COMMITMENTS.map(commitmentRow),
    bank: SAMPLE_BANK.map(bankRow),
    decisions: {},
    recVersion: prev.recVersion + 1,
    tables: renewAll(prev.tables),
    allocation: {
      ...emptyAllocation(),
      price: plainPrice(SAMPLE_PRICE_MICROS),
      cap: plainMoney(SAMPLE_CAP),
      fees: SAMPLE_FEES.map((f) => ({
        id: f.id,
        label: f.label,
        payer: f.payer,
        kind: f.kind,
        value: f.kind === 'percent' ? String(f.value / 100) : plainMoney(f.value),
      })),
    },
    allocVersion: prev.allocVersion + 1,
    // Test Plan §3 exit terms; the holdings arrive by hand-off
    exit: {
      ...emptyExit(),
      proceeds: plainMoney(SAMPLE_EXIT.proceeds),
      exitCosts: plainMoney(SAMPLE_EXIT.exitCosts),
      years: String(SAMPLE_EXIT.years100 / 100),
      carry: String(SAMPLE_EXIT.carry.k / 100),
      hurdle: String(SAMPLE_EXIT.carry.h / 100),
      catchUp: String(SAMPLE_EXIT.carry.c / 100),
    },
  }
}

const renewAll = (t: Tables): Tables => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v + 1])) as unknown as Tables
const renew = (s: AppState, list: keyof Tables): Tables => ({ ...s.tables, [list]: s.tables[list] + 1 })

export type Action =
  | { type: 'acceptDisclaimer' }
  /** the guided tour replays the sample to a given step (docs/en/05_GUIDED_TOUR.md §4) */
  | { type: 'restore'; state: AppState }
  | { type: 'loadSample' }
  | { type: 'clearAll' }
  | { type: 'setDeal'; patch: Partial<DealText> }
  | { type: 'replaceCommitments'; rows: CommitmentRow[] }
  | { type: 'editCommitment'; index: number; rowId?: string; field: keyof CommitmentRow; value: string }
  | { type: 'addCommitment' }
  | { type: 'deleteCommitment'; index: number }
  | { type: 'importBank'; mode: 'replace' | 'append'; rows: BankRow[] }
  | { type: 'editBank'; index: number; rowId?: string; field: 'date' | 'amount' | 'payer' | 'reference'; value: string }
  | { type: 'addBank' }
  | { type: 'deleteBank'; index: number }
  /**
   * `via`: a suggested candidate (confirm) or the "Assign to…" list (assign); `prevStatus`: the line's status as shown
   * when the person decided, for the log; `tour`: done by the guided tour's "Do this for me" (C-X-1)
   */
  | { type: 'decide'; lineId: string; decision: Decision; via?: 'candidate' | 'any'; prevStatus?: LineStatus; tour?: boolean }
  | { type: 'undoDecision'; lineId: string; prevStatus?: LineStatus; tour?: boolean }
  | { type: 'handoff'; handoff: Handoff; tour?: boolean }
  | { type: 'setAllocation'; patch: Partial<Pick<AllocationState, 'price' | 'cap'>> }
  | { type: 'addFee' }
  | { type: 'editFee'; index: number; rowId?: string; patch: Partial<Omit<FeeRow, 'id'>> }
  | { type: 'deleteFee'; index: number }
  | { type: 'replaceInvestors'; rows: InvestorRow[] }
  | { type: 'editInvestor'; index: number; rowId?: string; field: keyof InvestorRow; value: string }
  | { type: 'addInvestor' }
  | { type: 'deleteInvestor'; index: number }
  | { type: 'keepRefund'; id: string }
  | { type: 'removeRefund'; id: string }
  | { type: 'handoffToExit'; holdings: Holding[]; sharePriceMicros: number; tour?: boolean }
  | { type: 'replaceHoldings'; rows: HoldingRow[]; sharePriceMicros: number | null }
  | { type: 'editHolding'; index: number; rowId?: string; field: 'name' | 'capital'; value: string }
  | { type: 'addHolding' }
  | { type: 'deleteHolding'; index: number }
  | { type: 'setExit'; patch: Partial<Pick<ExitState, 'proceeds' | 'exitCosts' | 'years' | 'carry' | 'hurdle' | 'catchUp'>> }
  | { type: 'setCarryMode'; mode: ExitState['mode'] }
  | { type: 'addTier' }
  | { type: 'editTier'; index: number; rowId?: string; field: 'upTo' | 'rate'; value: string }
  | { type: 'deleteTier'; index: number }
  /** C-REC-7: `on` as typed; nothing happens without ticked consent and a real date (R-REC-11.1) */
  /** `name` / `reference`: the investor the consent was ticked for; if the row now shows someone else, nothing is marked (Codex M6 r4 #1) */
  | { type: 'markWithdrawn'; investorId: string; on: string; consent: boolean; name?: string; reference?: string }
  | { type: 'undoWithdrawal'; investorId: string }
  /** R-ALL-12.3: the reducer previews again and applies only what the panel would allow */
  | { type: 'applyFeePayerChange'; feeId: string; to: FeePayer; consent: boolean }
  | { type: 'reverseFeePayerChange'; changeId: string }
  /** a message was copied (or selected for copying by hand); the text itself is never logged (C-X-1) */
  | { type: 'messageCopied'; template: 'A' | 'B'; investorId: string; investorName: string; transactionId?: string; manual?: boolean }
  | { type: 'logExported' }
  /** the save dropped the oldest entries to fit the browser's storage: keep memory equal to what was saved (R-X-08.5) */
  /** the save dropped the oldest entries through `last` to fit; memory drops the same ones (R-X-08.5) */
  | { type: 'logTrimmed'; last: LogEntry }

const replaceAt = <T>(xs: T[], i: number, x: T) => xs.map((v, j) => (j === i ? x : v))
const removeAt = <T>(xs: T[], i: number) => xs.filter((_, j) => j !== i)

/** Upstream reconciliation data changed: the allocation hand-off may now be out of date (R-X-07). */
const bump = (s: AppState, patch: Partial<AppState>): AppState => ({ ...s, ...patch, recVersion: s.recVersion + 1 })
/** An allocation change: the holdings handed off from it may now be out of date (R-X-07). */
const alloc = (s: AppState, patch: Partial<AllocationState>): AppState => ({
  ...s,
  allocation: { ...s.allocation, ...patch },
  allocVersion: s.allocVersion + 1,
})
/** Refund flags do not change the allocation itself. */
const refunds = (s: AppState, excess: Refund[]): AppState => ({ ...s, allocation: { ...s.allocation, excess } })
const exit = (s: AppState, patch: Partial<ExitState>): AppState => ({ ...s, exit: { ...s.exit, ...patch } })

/**
 * A hand-edited investor and their over-payment refund (Codex M2 #2): a new name is carried over; a change to the
 * amount or ID, or a deletion, leaves the refund in place but flagged, so a person keeps or removes it explicitly
 * instead of it being silently dropped or refunded twice.
 */
function refundsAfterEdit(s: AppState, index: number, field: keyof InvestorRow | 'delete', value = ''): Refund[] {
  const id = s.allocation.investors[index]?.id
  return s.allocation.excess.map((x) => {
    // a row given the ID of someone with a refund (an over-payment, or a withdrawal) now claims that investor too: the
    // refund is flagged, so the same money is never both allocated and refunded unseen (Codex M6 r5 #1)
    if (field === 'id' && x.id === value && x.id !== id) return { ...x, needsCheck: true }
    if (x.id !== id || field === 'scheme') return x
    if (field === 'name') return { ...x, name: value }
    return { ...x, needsCheck: true }
  })
}

/** Decision marker that can never match a fingerprint again (R-REC-04.4). */
export const VOID = 'void'

/**
 * R-REC-04.4: once the line or the investor behind a decision changes or goes, the decision is void for good —
 * changing the data back does not revive it (Codex M2 #1). Each decision is checked against exactly what the
 * engine will see; anything that no longer matches is marked void and stays in review until a person decides again.
 */
export type VoidReason = 'line changed' | 'line deleted' | 'investor changed' | 'investor deleted'
export interface Voided {
  lineId: string
  reason: VoidReason
  /** the decision as it was, for the log */
  decision: Decision
}

/** `idEdited`: an investor ID was changed by hand, so a decision that lost its investor names a change, not a deletion. */
function voidChangedDecisions(s: AppState, idEdited = false): { state: AppState; voided: Voided[] } {
  const cur = s.deal.currency
  const lines = new Map(s.bank.map((r) => [r.id, r]))
  const people = new Map(s.commitments.map((r) => [r.id, r]))
  const voided: Voided[] = []
  const decisions: Decisions = Object.create(null)
  for (const [lineId, d] of Object.entries(s.decisions)) {
    let ok = d.lineFp !== VOID
    let reason: VoidReason = 'line changed'
    if (ok) {
      const row = lines.get(lineId)
      const line = row && lineOf(row, cur)
      ok = Boolean(line?.ok && lineFingerprint(line.value) === d.lineFp)
      if (!row) reason = 'line deleted'
    }
    if (ok && d.kind === 'assign') {
      const row = people.get(d.commitmentId)
      const c = row && commitmentOf(row, cur)
      ok = Boolean(c?.ok && commitmentFingerprint(c.value) === d.commitmentFp)
      reason = row || idEdited ? 'investor changed' : 'investor deleted'
    }
    decisions[lineId] = ok ? d : { ...d, lineFp: VOID }
    if (!ok && d.lineFp !== VOID) voided.push({ lineId, reason, decision: d })
  }
  return voided.length ? { state: { ...s, decisions }, voided } : { state: s, voided }
}

export interface MarkVoided {
  kind: 'withdrawal' | 'adjustment'
  investorId: string
  reason: 'investor deleted' | 'ID changed' | 'ID duplicated' | 'reference changed' | 'cash due changed'
  /** withdrawal date, for the log */
  on?: string
}

/**
 * C-REC-7 / C-ALL-11: a withdrawal mark goes when its investor is deleted or their ID or (normalised) reference changes;
 * an adjustment line is voided for good on the same changes or when the cash due submitted differs from the one it was
 * applied on. Name, email and scheme do not count; neither does `NW-012` → `NW 012` (compared after C-REC-1).
 */
function voidChangedMarks(prev: AppState, s: AppState, idEdited: boolean): { state: AppState; voided: MarkVoided[] } {
  const people = new Map(s.commitments.map((r) => [r.id, r]))
  const voided: MarkVoided[] = []
  // an ID on two rows names nobody for sure: one row could stand in for the other and hide a delete or an edit, so a
  // mark or a line on it is voided (Codex M6 r6 #1); the investor list itself already shows the duplicate as an input error
  const count = new Map<string, number>()
  for (const r of s.commitments) count.set(r.id, (count.get(r.id) ?? 0) + 1)
  const gone = (id: string): MarkVoided['reason'] | null => {
    const row = people.get(id)
    if (!row) return idEdited && prev.commitments.some((r) => r.id === id) ? 'ID changed' : 'investor deleted'
    if ((count.get(id) ?? 0) > 1) return 'ID duplicated'
    return null
  }
  const withdrawals: Record<string, Withdrawal> = Object.create(null)
  for (const [id, w] of Object.entries(s.withdrawals)) {
    const reason = gone(id) ?? (normRef(people.get(id)!.reference) !== w.reference ? 'reference changed' : null)
    if (reason) voided.push({ kind: 'withdrawal', investorId: id, reason, on: w.on })
    else withdrawals[id] = w
  }
  const change = activeChange(s.feePayerChanges)
  let changes = s.feePayerChanges
  if (change) {
    let touched = false
    const lines = change.lines.map((l) => {
      if (l.voided) return l
      const row = people.get(l.investorId)
      const cash = row ? parseMoney(row.cashDue, s.deal.currency) : null
      const reason =
        gone(l.investorId) ??
        (normRef(row!.reference) !== l.reference ? 'reference changed' : !cash?.ok || cash.value !== l.baseCashDue ? 'cash due changed' : null)
      if (!reason) return l
      touched = true
      voided.push({ kind: 'adjustment', investorId: l.investorId, reason })
      return { ...l, voided: true, voidReason: reason }
    })
    if (touched) changes = s.feePayerChanges.map((c) => (c === change ? { ...c, lines } : c))
  }
  return voided.length ? { state: { ...s, withdrawals, feePayerChanges: changes }, voided } : { state: s, voided }
}

/**
 * C-ALL-11: the whole change is void for good once its fee's payer, type or rate, or the fee basis, is not what it was
 * applied with (by value: submitting the same value is no change), or the fee is deleted. Its effect on the cash due goes,
 * so reconciliation data changed too (R-X-07).
 */
function voidChangedFeeChange(s: AppState): { state: AppState; voided: { change: FeePayerChange; reason: string } | null } {
  const c = activeChange(s.feePayerChanges)
  if (!c) return { state: s, voided: null }
  // exactly one fee with the ID: a second row with the same ID could hide the deletion of the one applied (Codex M6 r6 #2)
  const same = s.allocation.fees.filter((x) => x.id === c.feeId)
  const f = same.length === 1 ? same[0] : undefined
  const rate = f ? parsePercent(f.value) : null
  const reason = !f
    ? same.length > 1
      ? 'fee duplicated'
      : 'fee deleted'
    : needsConsent(c.to) && c.consent !== true
      ? 'no consent recorded'
      : f.payer !== c.to
        ? 'payer changed'
        : f.kind !== 'percent'
          ? 'type changed'
          : !rate?.ok || rate.value !== c.feeAtApply.rateBps
            ? 'rate changed'
            : s.deal.feeBasis !== c.feeAtApply.basis
              ? 'fee basis changed'
              : null
  if (!reason) return { state: s, voided: null }
  const voided = { ...c, status: 'voided' as const, voidReason: reason }
  return { state: bump(s, { feePayerChanges: s.feePayerChanges.map((x) => (x === c ? voided : x)) }), voided: { change: voided, reason } }
}

/** R-DEAL-01 (v0.8.1, decision 12): a recorded adjustment ties the amounts to the currency it was worked out in. */
export const currencyLocked = (s: Pick<AppState, 'feePayerChanges'>) => activeChange(s.feePayerChanges) !== undefined
export const CURRENCY_LOCKED_TEXT = 'Reverse the fee payer change before changing the currency'

/** Actions that can change the fee a fee payer change was applied to, or the fee basis (C-ALL-11). */
const FEE_DATA = new Set<Action['type']>(['editFee', 'deleteFee', 'setDeal'])

/**
 * R-ALL-12.1 / 12.5: why the fee payer change panel is not available, or null. The reducer asks again before applying.
 */
export function feePayerChangeBlock(s: AppState): string | null {
  if (activeChange(s.feePayerChanges)) return 'A fee payer change is already active. Reverse it before making another.'
  if (s.allocation.handoffVersion === null) return 'Hand off from reconciliation first: the investors here were not carried in from it.'
  if (allocationStale(s)) return 'The allocation is out of date. Hand off from reconciliation again first.'
  if (s.allocation.editedSinceHandoff) return 'The investor table was edited after the hand-off. Hand off from reconciliation again first.'
  return null
}

/** R-ALL-12.5: an active change can be reversed at any time — stale or not, without consent again (Codex v0.8 #1). */
export const canReverse = (s: AppState, changeId: string) => s.feePayerChanges.some((c) => c.id === changeId && c.status === 'active')

/** The last tier has no ceiling (C-DIS-6); its hidden field is cleared whenever a tier becomes last (review M3 #3). */
const openEnded = (tiers: TierRow[]): TierRow[] => tiers.map((t, i) => (i === tiers.length - 1 && t.upTo !== '' ? { ...t, upTo: '' } : t))

/** Actions that change data a decision was made on. */
const UPSTREAM_DATA = new Set<Action['type']>(['setDeal', 'replaceCommitments', 'editCommitment', 'deleteCommitment', 'importBank', 'editBank', 'deleteBank'])

/** A blank ID is filled in, as on import (R-REC-01.1). */
const idOrNew = (v: string, prefix: string) => (v.trim() === '' ? generateId(prefix) : v)

/**
 * An edit names the row it was typed into; if a different row now sits at that index (the list was replaced
 * or reordered in the meantime), the edit is dropped instead of landing on someone else (Codex M2 #7).
 */
function targetMoved(s: AppState, a: Action): boolean {
  if (!('rowId' in a) || a.rowId === undefined) return false
  const rows: { id: string }[] =
    a.type === 'editCommitment'
      ? s.commitments
      : a.type === 'editBank'
        ? s.bank
        : a.type === 'editFee'
          ? s.allocation.fees
          : a.type === 'editInvestor'
            ? s.allocation.investors
            : a.type === 'editHolding'
              ? s.exit.holdings
              : a.type === 'editTier'
                ? s.exit.tiers
                : []
  return rows[a.index]?.id !== a.rowId
}

/**
 * The save dropped the oldest entries through `last`. The same entries are dropped from the log as it is now, so anything
 * written since stays, the cap still holds, and both removal counts merge in `truncated`. If `last` is no longer in the log
 * (the cap removed it already, or the log was replaced by the sample or a clear) there is nothing to drop (Codex M5 r2 #4, r4 #1).
 */
function trimmedLog(now: ActivityLog, last: LogEntry): ActivityLog {
  const at = now.entries.indexOf(last)
  return at === -1 ? now : dropOldest(now, at + 1)
}

/** What App tells the reducer after a save that had to trim: the last entry the save dropped, or null. */
export function trimAction(saved: ActivityLog, trimmed: ActivityLog | null): Action | null {
  if (!trimmed) return null
  const dropped = saved.entries.length - trimmed.entries.length
  return dropped > 0 ? { type: 'logTrimmed', last: saved.entries[dropped - 1] } : null
}

/** Where entries get their time: the system clock in the app, a fixed one in tests (Tech Design §9.3). */
export type Clock = () => { epochMs: number; offsetMinutes: number }
export const systemClock: Clock = () => {
  const d = new Date()
  return { epochMs: d.getTime(), offsetMinutes: -d.getTimezoneOffset() }
}

export function makeReducer(clock: Clock) {
  return (s: AppState, a: Action): AppState => {
    if (targetMoved(s, a)) return s
    const now = () => {
      const { epochMs, offsetMinutes } = clock()
      return localIsoTime(epochMs, offsetMinutes)
    }
    const applied = apply(s, a, now)
    const idEdited = a.type === 'editCommitment' && a.field === 'id'
    const { state: decided, voided } = UPSTREAM_DATA.has(a.type)
      ? voidChangedDecisions(applied, a.type === 'editCommitment' && a.field === 'id')
      : { state: applied, voided: [] }
    // withdrawal marks and adjustment lines follow the investor list; the whole change follows its fee (C-REC-7, C-ALL-11)
    const marked = UPSTREAM_DATA.has(a.type) ? voidChangedMarks(s, decided, idEdited) : { state: decided, voided: [] }
    const fee = FEE_DATA.has(a.type) ? voidChangedFeeChange(marked.state) : { state: marked.state, voided: null }
    const next = fee.state
    // a failure to log never stops the action (C-X-1, OWASP): the change stands, only this entry is lost
    try {
      const events = [...eventsFor(s, next, a, voided), ...markEvents(s, marked.voided), ...feeVoidEvents(fee.voided)]
      if (events.length === 0) return next
      const { epochMs, offsetMinutes } = clock()
      const meta = { time: localIsoTime(epochMs, offsetMinutes), initials: parseInitials(next.deal.initials) ?? '', currency: next.deal.currency }
      return { ...next, log: a.type === 'logExported' ? markExported(next.log, meta) : appendEvents(next.log, events, meta) }
    } catch {
      return next
    }
  }
}

export const reducer = makeReducer(systemClock)

// ---------- C-X-1: what each action writes to the activity log ----------

const tourNote = (a: { tour?: boolean }) => (a.tour ? ' · guided tour' : '')

/** The bank line behind a decision, as the log names it: its transaction ID (or the generated line ID) and amount. */
function lineFacts(s: AppState, lineId: string): Pick<NewEvent, 'transactionId' | 'amount'> {
  const row = s.bank.find((r) => r.id === lineId)
  const amount = row ? parseMoney(row.amount, s.deal.currency, true) : null
  return { transactionId: row?.txnId ?? lineId, amount: amount?.ok ? amount.value : null }
}

function investorFacts(s: AppState, id: string): Pick<NewEvent, 'investorId' | 'investorName'> {
  return { investorId: id, investorName: s.commitments.find((c) => c.id === id)?.name ?? '' }
}

/** Lines booked automatically (C-REC-2), or null while the inputs have errors and nothing is calculated. */
function autoBooked(s: AppState): Set<string> | null {
  const d = deriveReconcile(s)
  const o = d.input ? reconcile(d.input) : null
  return o?.ok ? new Set(o.result.lines.filter((l) => l.status === 'auto').map((l) => l.line.id)) : null
}

function lineStatus(s: AppState, lineId: string): LineStatus | null {
  const d = deriveReconcile(s)
  const o = d.input ? reconcile(d.input) : null
  return o?.ok ? (o.result.lines.find((l) => l.line.id === lineId)?.status ?? null) : null
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function importDetail(prev: AppState, next: AppState, a: Extract<Action, { type: 'replaceCommitments' | 'importBank' }>): string {
  const after = autoBooked(next)
  let auto: string
  if (a.type === 'importBank') {
    // the lines this import accepted: all of a replace, only the new ones of an append (ignored duplicates are not added)
    const known = new Set(a.mode === 'append' ? prev.bank.map((r) => r.id) : [])
    const accepted = next.bank.filter((r) => !known.has(r.id))
    auto = after ? `${accepted.filter((r) => after.has(r.id)).length} auto-booked` : 'auto-booked not calculated (input errors)'
    return `bank statement · ${a.mode} · ${plural(accepted.length, 'row')} added · ${auto}`
  }
  // an investor list import books whatever now matches exactly and did not before
  const before = autoBooked(prev)
  auto = after && before ? `${[...after].filter((id) => !before.has(id)).length} auto-booked` : 'auto-booked not calculated (input errors)'
  return `investor list · replace · ${plural(a.rows.length, 'row')} added · ${auto}`
}

function voidedEvents(prev: AppState, a: Action, voided: Voided[]): NewEvent[] {
  if (voided.length === 0) return []
  // one operation voiding many (a replacing import, a change of settings) is one entry; edits and deletes, one each
  if (a.type === 'importBank' || a.type === 'replaceCommitments' || a.type === 'setDeal') {
    const reasons = [...new Set(voided.map((v) => v.reason))].join(', ')
    const what = a.type === 'importBank' ? 'statement imported' : a.type === 'replaceCommitments' ? 'investor list imported' : 'deal settings changed'
    return [{ event: 'decision_voided', detail: `${plural(voided.length, 'decision')} voided (${what}: ${reasons})` }]
  }
  return voided.map((v) => ({
    event: 'decision_voided',
    ...lineFacts(prev, v.lineId),
    ...(v.decision.kind === 'assign' ? investorFacts(prev, v.decision.commitmentId) : {}),
    detail: v.reason,
  }))
}

function markEvents(prev: AppState, voided: MarkVoided[]): NewEvent[] {
  return voided.map((v) => ({
    event: v.kind === 'withdrawal' ? 'withdrawal_voided' : 'adjustment_voided',
    ...investorFacts(prev, v.investorId),
    detail: v.kind === 'withdrawal' ? `withdrawal on ${v.on} voided (${v.reason})` : `this investor · ${v.reason}`,
  }))
}

function feeVoidEvents(v: { change: FeePayerChange; reason: string } | null): NewEvent[] {
  return v ? [{ event: 'fee_payer_change_voided', detail: `whole change · ${v.change.feeLabel} · ${v.reason}` }] : []
}

function eventsFor(prev: AppState, next: AppState, a: Action, voided: Voided[]): NewEvent[] {
  switch (a.type) {
    case 'loadSample':
      return [{ event: 'sample_loaded', detail: 'fictional sample deal' }]
    case 'replaceCommitments':
    case 'importBank': {
      // a replacing statement clears every decision itself, before the void check sees them (R-REC-02.2)
      const cleared: Voided[] =
        a.type === 'importBank' && a.mode === 'replace'
          ? Object.entries(prev.decisions)
              .filter(([, d]) => d.lineFp !== VOID)
              .map(([lineId, d]) => ({ lineId, reason: 'line deleted', decision: d }))
          : []
      return [{ event: 'import', detail: importDetail(prev, next, a) }, ...voidedEvents(prev, a, [...cleared, ...voided])]
    }
    case 'deleteBank': {
      const gone = prev.bank[a.index]
      // own keys only: a line id like "__proto__" must not read an inherited value as a decision (Codex M5 r5 #1)
      const d = gone && Object.hasOwn(prev.decisions, gone.id) ? prev.decisions[gone.id] : undefined
      const removed: Voided[] = gone && d && d.lineFp !== VOID ? [{ lineId: gone.id, reason: 'line deleted', decision: d }] : []
      return voidedEvents(prev, a, [...removed, ...voided])
    }
    case 'decide': {
      const d = a.decision
      const was = a.prevStatus ? LINE_STATUS_WORDS[a.prevStatus] : 'Undecided'
      if (d.kind === 'reject') return [{ event: 'not_in_deal', ...lineFacts(prev, a.lineId), detail: `${was} → ${LINE_STATUS_WORDS.rejected}${tourNote(a)}` }]
      const who = investorFacts(prev, d.commitmentId)
      const assign = a.via === 'any'
      return [
        {
          event: assign ? 'assign' : 'confirm',
          ...lineFacts(prev, a.lineId),
          ...who,
          detail: `${was} → ${LINE_STATUS_WORDS.confirmed}${assign ? ` · assigned to ${who.investorName}` : ''}${tourNote(a)}`,
        },
      ]
    }
    case 'undoDecision': {
      const d = Object.hasOwn(prev.decisions, a.lineId) ? prev.decisions[a.lineId] : undefined
      if (!d) return []
      // the line's status now, worked out from the new state: back in review, unmatched, or booked automatically
      const now = lineStatus(next, a.lineId)
      const after = now ? LINE_STATUS_WORDS[now] : 'not calculated (input errors)'
      // a decision voided earlier was already logged as decision_voided; clearing it undoes nothing
      const void_ = d.lineFp === VOID
      const was = void_
        ? 'Earlier decision, no longer valid'
        : a.prevStatus
          ? LINE_STATUS_WORDS[a.prevStatus]
          : d.kind === 'reject'
            ? LINE_STATUS_WORDS.rejected
            : LINE_STATUS_WORDS.confirmed
      return [
        {
          event: 'undo',
          ...lineFacts(prev, a.lineId),
          ...(d.kind === 'assign' ? investorFacts(prev, d.commitmentId) : {}),
          detail: `${void_ ? 'old decision cleared · ' : ''}${was} → ${after}${tourNote(a)}`,
        },
      ]
    }
    case 'handoff': {
      const n = a.handoff.investors.length
      return [
        {
          event: 'handoff_allocation',
          amount: sumExact(a.handoff.investors.map((v) => v.received)),
          detail: `snapshot v${prev.recVersion} · ${plural(n, 'investor')}${tourNote(a)}`,
        },
      ]
    }
    case 'handoffToExit':
      return [
        {
          event: 'handoff_exit',
          amount: sumExact(a.holdings.map((h) => h.capital)),
          detail: `snapshot v${prev.allocVersion} · ${plural(a.holdings.length, 'holding')}${tourNote(a)}`,
        },
      ]
    case 'messageCopied':
      return [
        {
          event: 'message_copied',
          investorId: a.investorId,
          investorName: a.investorName,
          transactionId: a.transactionId ?? '',
          detail: `template ${a.template}${a.manual ? ' · selected for manual copy' : ''}`,
        },
      ]
    case 'logExported':
      return [{ event: 'log_exported' }] // written by markExported, which first records how far the export went
    case 'markWithdrawn': {
      const w = Object.hasOwn(next.withdrawals, a.investorId) && !Object.hasOwn(prev.withdrawals, a.investorId) ? next.withdrawals[a.investorId] : null
      return w ? [{ event: 'withdrawn', ...investorFacts(prev, a.investorId), detail: `withdrawn on ${w.on} · written consent received` }] : []
    }
    case 'undoWithdrawal': {
      const w = Object.hasOwn(prev.withdrawals, a.investorId) ? prev.withdrawals[a.investorId] : null
      return w ? [{ event: 'withdrawal_undone', ...investorFacts(prev, a.investorId), detail: `was withdrawn on ${w.on}` }] : []
    }
    case 'applyFeePayerChange': {
      const c = next.feePayerChanges.length > prev.feePayerChanges.length ? next.feePayerChanges[next.feePayerChanges.length - 1] : null
      if (!c) return []
      const summary: NewEvent = {
        event: 'fee_payer_changed',
        detail: `${c.feeLabel}: ${c.from} → ${c.to} · ${needsConsent(c.to) ? (c.consent ? 'consent evidence received' : 'no consent evidence') : 'inform only'}`,
      }
      // one entry per investor whose cash due changes; amount = the difference, + top-up, − refund (C-X-1)
      const each: NewEvent[] = c.lines
        .filter((l) => l.newCashDue !== l.baseCashDue)
        .map((l) => ({
          event: 'fee_payer_changed',
          ...investorFacts(prev, l.investorId),
          amount: l.newCashDue - l.baseCashDue,
          detail: `cash due ${logAmount(l.baseCashDue)} → ${logAmount(l.newCashDue)}`,
        }))
      return [summary, ...each]
    }
    case 'reverseFeePayerChange': {
      const c = prev.feePayerChanges.find((x) => x.id === a.changeId && x.status === 'active')
      return c && !canReverse(next, a.changeId) ? [{ event: 'fee_payer_change_reversed', detail: `whole change · ${c.feeLabel} back to ${c.from}` }] : []
    }
    default:
      return voidedEvents(prev, a, voided)
  }
}

function apply(s: AppState, a: Action, now: () => string): AppState {
  switch (a.type) {
    case 'acceptDisclaimer':
      return { ...s, disclaimerAccepted: true }
    case 'restore':
      return a.state
    case 'loadSample':
      return sampleState(s)
    case 'messageCopied':
    case 'logExported':
      return s
    case 'logTrimmed':
      return { ...s, log: trimmedLog(s.log, a.last) }
    case 'clearAll':
      return { ...initialState(), recVersion: s.recVersion + 1 }
    case 'setDeal': {
      // R-DEAL-01 (v0.8.1, decision 12): the currency is locked while a fee payer change is active — reverse it first
      if (a.patch.currency !== undefined && a.patch.currency !== s.deal.currency && currencyLocked(s)) return s
      let next: AppState = { ...s, deal: { ...s.deal, ...a.patch } }
      // fee basis, minimum and currency change the allocation, so the holdings handed off from it (R-X-07)
      if ('feeBasis' in a.patch || 'minimum' in a.patch || 'currency' in a.patch) next = { ...next, allocVersion: next.allocVersion + 1 }
      // the as-of date decides which receipts count; the currency decides how amounts parse
      return 'asOf' in a.patch || 'currency' in a.patch ? bump(next, {}) : next
    }
    case 'replaceCommitments':
      return bump(s, { commitments: a.rows, tables: renew(s, 'commitments') })
    case 'editCommitment': {
      const value = a.field === 'id' ? idOrNew(a.value, 'inv') : a.value
      return bump(s, { commitments: replaceAt(s.commitments, a.index, { ...s.commitments[a.index], [a.field]: value }) })
    }
    case 'addCommitment':
      return bump(s, { commitments: [...s.commitments, { id: generateId('inv'), name: '', email: '', reference: '', cashDue: '', scheme: 'none' }] })
    case 'deleteCommitment':
      return bump(s, { commitments: removeAt(s.commitments, a.index) })
    case 'importBank':
      // replace clears every decision; append keeps decisions whose line is still there (R-REC-02.2, R-REC-04.4)
      return bump(s, {
        bank: a.rows,
        decisions: decisionsAfterImport(a.mode, s.decisions, a.rows),
        // append keeps the existing rows as they are (and any edit in progress); only replace starts the table afresh
        tables: a.mode === 'replace' ? renew(s, 'bank') : s.tables,
      })
    case 'editBank':
      return bump(s, { bank: replaceAt(s.bank, a.index, { ...s.bank[a.index], [a.field]: a.value }) })
    case 'addBank':
      return bump(s, { bank: [...s.bank, { id: generateId('line'), txnId: null, date: s.deal.asOf, amount: '', payer: '', reference: '' }] })
    case 'deleteBank': {
      // a decision about a deleted line goes with it (R-REC-04.4)
      const bank = removeAt(s.bank, a.index)
      return bump(s, { bank, decisions: pruneDecisions(s.decisions, bank) })
    }
    case 'decide':
      return bump(s, { decisions: { ...s.decisions, [a.lineId]: a.decision } })
    case 'undoDecision': {
      const decisions = { ...s.decisions }
      delete decisions[a.lineId]
      return bump(s, { decisions })
    }
    case 'handoff':
      // the whole investor list is replaced, never merged (E2E-02a)
      return alloc(
        { ...s, tables: renew(s, 'investors') },
        {
          investors: a.handoff.investors.map(investorRow),
          excess: a.handoff.excess.map((x) => ({ ...x, needsCheck: false })),
          handoffVersion: s.recVersion,
          editedSinceHandoff: false,
        },
      )
    case 'setAllocation':
      return alloc(s, a.patch)
    case 'addFee':
      return alloc(s, { fees: [...s.allocation.fees, { id: generateId('fee'), label: '', payer: 'investors', kind: 'percent', value: '' }] })
    case 'editFee': {
      const f = { ...s.allocation.fees[a.index], ...a.patch }
      // keep the kind valid for the payer: investors pay a % or a per-investor amount, others a % or a total (R-ALL-02)
      if (f.payer === 'investors' && f.kind === 'fixed') f.kind = 'perInvestor'
      if (f.payer !== 'investors' && f.kind === 'perInvestor') f.kind = 'fixed'
      return alloc(s, { fees: replaceAt(s.allocation.fees, a.index, f) })
    }
    case 'deleteFee':
      return alloc(s, { fees: removeAt(s.allocation.fees, a.index) })
    case 'replaceInvestors':
      return alloc({ ...s, tables: renew(s, 'investors') }, { investors: a.rows, excess: [], handoffVersion: null, editedSinceHandoff: false })
    case 'editInvestor': {
      const value = a.field === 'id' ? idOrNew(a.value, 'inv') : a.value
      return alloc(s, {
        investors: replaceAt(s.allocation.investors, a.index, { ...s.allocation.investors[a.index], [a.field]: value }),
        excess: refundsAfterEdit(s, a.index, a.field, value),
        editedSinceHandoff: true,
      })
    }
    case 'addInvestor':
      return alloc(s, {
        investors: [...s.allocation.investors, { id: generateId('inv'), name: '', received: '', scheme: 'none' }],
        editedSinceHandoff: true,
      })
    case 'deleteInvestor':
      return alloc(s, { investors: removeAt(s.allocation.investors, a.index), excess: refundsAfterEdit(s, a.index, 'delete'), editedSinceHandoff: true })
    case 'keepRefund':
      return refunds(
        s,
        s.allocation.excess.map((x) => (x.id === a.id ? { ...x, needsCheck: false } : x)),
      )
    case 'removeRefund':
      return refunds(
        s,
        s.allocation.excess.filter((x) => x.id !== a.id),
      )
    case 'handoffToExit':
      // R-ALL-11: the holdings are replaced whole, with the share price saved alongside (R-X-07, C-DIS-7)
      return exit(
        { ...s, tables: renew(s, 'holdings') },
        { holdings: a.holdings.map(holdingRow), sharePriceMicros: a.sharePriceMicros, handoffVersion: s.allocVersion },
      )
    case 'replaceHoldings':
      return exit({ ...s, tables: renew(s, 'holdings') }, { holdings: a.rows, sharePriceMicros: a.sharePriceMicros, handoffVersion: null })
    case 'editHolding': {
      const value = a.value
      return exit(s, { holdings: replaceAt(s.exit.holdings, a.index, { ...s.exit.holdings[a.index], [a.field]: value }) })
    }
    case 'addHolding':
      return exit(s, { holdings: [...s.exit.holdings, { id: generateId('inv'), name: '', capital: '' }] })
    case 'deleteHolding':
      return exit(s, { holdings: removeAt(s.exit.holdings, a.index) })
    case 'setExit':
      return exit(s, a.patch)
    case 'setCarryMode':
      // C-DIS: switching clears what does not apply to the new mode
      if (a.mode === s.exit.mode) return s
      return exit(
        { ...s, tables: renew(s, 'tiers') },
        a.mode === 'tiered'
          ? { mode: 'tiered', carry: '', hurdle: '', catchUp: '', tiers: [{ id: generateId('tier'), upTo: '', rate: '' }] }
          : { mode: 'fixed', tiers: [] },
      )
    case 'addTier': {
      // a new band goes before the open-ended last one
      const t = s.exit.tiers
      const fresh = { id: generateId('tier'), upTo: '', rate: '' }
      return exit(s, { tiers: openEnded(t.length ? [...t.slice(0, -1), fresh, t[t.length - 1]] : [fresh]) })
    }
    case 'editTier':
      return exit(s, { tiers: replaceAt(s.exit.tiers, a.index, { ...s.exit.tiers[a.index], [a.field]: a.value }) })
    case 'deleteTier':
      return exit(s, { tiers: openEnded(removeAt(s.exit.tiers, a.index)) })
    case 'markWithdrawn': {
      // R-REC-11.1: written consent and a real date, on an investor who is on the list and not already withdrawn
      const row = s.commitments.find((r) => r.id === a.investorId)
      const on = parseDate(a.on)
      if (a.consent !== true || !on.ok || !row || Object.hasOwn(s.withdrawals, a.investorId)) return s
      // the consent was given for one person: a list replaced or edited since the tick puts someone else under this ID
      if ((a.name !== undefined && a.name !== row.name) || (a.reference !== undefined && normRef(a.reference) !== normRef(row.reference))) return s
      const withdrawals: Record<string, Withdrawal> = Object.assign(Object.create(null), s.withdrawals)
      withdrawals[a.investorId] = { on: on.value, consent: true, reference: normRef(row.reference) }
      return bump(s, { withdrawals })
    }
    case 'undoWithdrawal': {
      if (!Object.hasOwn(s.withdrawals, a.investorId)) return s
      const withdrawals: Record<string, Withdrawal> = Object.assign(Object.create(null), s.withdrawals)
      delete withdrawals[a.investorId]
      return bump(s, { withdrawals })
    }
    case 'applyFeePayerChange':
      return applyFeePayerChange(s, a, now)
    case 'reverseFeePayerChange': {
      if (!canReverse(s, a.changeId)) return s
      // the active record with that ID, never a historical one (Codex M6 r5 #2)
      const c = s.feePayerChanges.find((x) => x.id === a.changeId && x.status === 'active')!
      // the fee goes back to its original payer; the record stays, marked reversed (R-ALL-12.5)
      const fees = s.allocation.fees.map((f) => (f.id === c.feeId ? { ...f, payer: c.from } : f))
      return alloc(bump(s, { feePayerChanges: s.feePayerChanges.map((x) => (x === c ? { ...x, status: 'reversed' as const } : x)) }), { fees })
    }
  }
}

/**
 * R-ALL-12.3: apply only what the panel allows — available (R-ALL-12.1), consent ticked where it is needed, and a preview
 * with no blocker — checked again here, not just by the disabled button. The investor list is not rewritten (C-ALL-11).
 */
function applyFeePayerChange(s: AppState, a: Extract<Action, { type: 'applyFeePayerChange' }>, now: () => string): AppState {
  if (feePayerChangeBlock(s) !== null || (needsConsent(a.to) && a.consent !== true)) return s
  const input = deriveFeePayerInput(s, a.feeId, a.to)
  if (!input.input) return s
  const o = previewFeePayerChange(input.input)
  if (!o.ok || !o.result.canApply) return s
  const change = buildChange(o.result, input.input, { id: generateId('fpc'), consent: needsConsent(a.to) ? true : a.consent, appliedAt: now() })
  const fees = s.allocation.fees.map((f) => (f.id === a.feeId ? { ...f, payer: a.to } : f))
  return alloc(bump(s, { feePayerChanges: [...s.feePayerChanges, change] }), { fees })
}

/** R-X-07: the allocation was handed off from reconciliation data that has changed since. */
export const allocationStale = (s: AppState) => s.allocation.handoffVersion !== null && s.allocation.handoffVersion !== s.recVersion
/** R-X-07: the holdings were handed off from an allocation that has changed since. */
export const exitStale = (s: AppState) => s.exit.handoffVersion !== null && s.exit.handoffVersion !== s.allocVersion

/** R-DEAL-01 (v0.7.5): how many amounts a change of currency would relabel; nothing is converted. Counting only, no money maths. */
export function amountsEntered(s: AppState): number {
  const filled = (v: string) => trimAscii(v) !== ''
  const a = s.allocation
  return (
    [
      s.deal.minimum,
      ...s.commitments.map((c) => c.cashDue),
      ...s.bank.map((l) => l.amount),
      a.price,
      a.cap,
      ...a.fees.filter((f) => f.kind !== 'percent').map((f) => f.value),
      ...a.investors.map((v) => v.received),
      ...s.exit.holdings.map((h) => h.capital),
      s.exit.proceeds,
      s.exit.exitCosts,
    ].filter(filled).length +
    a.excess.length + // over-payments listed for refund at hand-off (UI polish self-test #5)
    (s.exit.sharePriceMicros === null ? 0 : 1)
  )
}

// ---------- local persistence (Tech Design §1: localStorage, try/catch, schema version) ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const strFields = (v: unknown, keys: string[]) => isObj(v) && keys.every((k) => isStr(v[k]))
const arrOf = (v: unknown, ok: (x: unknown) => boolean) => Array.isArray(v) && v.every(ok)
/** an actual string from the list: no coercion, so `["active"]` or an object with a hostile toString is refused (Codex M5 r2 #2 #3) */
const oneOf = (v: unknown, list: readonly string[]) => typeof v === 'string' && list.includes(v)

/** Shape check for saved data; anything unexpected is ignored rather than trusted. */
export function parseSaved(raw: string | null): AppState | null {
  if (!raw) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  // schema 1 is v1.1.x; schema 2 adds withdrawals, fee payer changes, the activity log and initials (Tech Design §9.1)
  if (!isObj(v) || (v.schema !== 1 && v.schema !== SCHEMA) || typeof v.disclaimerAccepted !== 'boolean' || !Number.isSafeInteger(v.recVersion)) return null
  const old = v.schema === 1
  const d = v.deal
  if (
    !strFields(d, ['name', 'asOf', 'minimum', 'agedThresholdDays']) ||
    !(old || (d as Record<string, unknown>).initials === undefined || isStr((d as Record<string, unknown>).initials)) ||
    !oneOf((d as Record<string, unknown>).currency, ['GBP', 'EUR', 'USD']) ||
    !oneOf((d as Record<string, unknown>).feeBasis, ['deducted', 'onTop'])
  )
    return null
  if (!arrOf(v.commitments, (x) => strFields(x, ['id', 'name', 'email', 'reference', 'cashDue', 'scheme']))) return null
  if (
    !arrOf(
      v.bank,
      (x) =>
        strFields(x, ['id', 'date', 'amount', 'payer', 'reference']) &&
        ((x as Record<string, unknown>).txnId === null || isStr((x as Record<string, unknown>).txnId)),
    )
  )
    return null
  if (
    !isObj(v.decisions) ||
    !Object.values(v.decisions).every(
      (x) => isObj(x) && (x.kind === 'assign' ? strFields(x, ['commitmentId', 'lineFp', 'commitmentFp']) : x.kind === 'reject' && isStr(x.lineFp)),
    )
  )
    return null
  const a = v.allocation
  if (!isObj(a) || !isStr(a.price) || !isStr(a.cap) || !(a.handoffVersion === null || Number.isSafeInteger(a.handoffVersion))) return null
  if (
    !arrOf(
      a.fees,
      (x) =>
        strFields(x, ['id', 'label', 'value']) &&
        oneOf((x as Record<string, unknown>).payer, ['investors', 'company', 'lead']) &&
        oneOf((x as Record<string, unknown>).kind, ['percent', 'perInvestor', 'fixed']),
    )
  )
    return null
  if (!arrOf(a.investors, (x) => strFields(x, ['id', 'name', 'received', 'scheme']))) return null
  // refunds feed the closing confirmation directly, so they are checked as money, not just as shapes (Codex M2 #5)
  const refundOk = (x: unknown) =>
    strFields(x, ['id', 'name']) &&
    ((x as Record<string, unknown>).reason === undefined || oneOf((x as Record<string, unknown>).reason, ['Withdrawn', 'Over-paid'])) &&
    Number.isSafeInteger((x as Record<string, unknown>).amount) &&
    ((x as Record<string, unknown>).amount as number) > 0 &&
    typeof (x as Record<string, unknown>).needsCheck === 'boolean'
  if (!arrOf(a.excess, refundOk) || new Set((a.excess as { id: string }[]).map((x) => x.id)).size !== (a.excess as unknown[]).length) return null
  // decisions are a plain record keyed by line id; rebuild it without a prototype so ids like "__proto__" stay data
  const decisions: Decisions = Object.create(null)
  for (const [k, x] of Object.entries(v.decisions)) decisions[k] = x as Decision
  // saved before table generations existed (or before fees had their own): start the missing ones at 0
  const t = isObj(v.tables) ? v.tables : {}
  const gen = (k: keyof Tables) => (Number.isSafeInteger(t[k]) ? (t[k] as number) : 0)
  const tables: Tables = Object.fromEntries((Object.keys(NO_TABLES) as (keyof Tables)[]).map((k) => [k, gen(k)])) as unknown as Tables
  // saved before the exit module existed: start it empty
  let exitState = emptyExit()
  if (v.exit !== undefined) {
    const x = v.exit
    if (!strFields(x, ['proceeds', 'exitCosts', 'years', 'carry', 'hurdle', 'catchUp']) || !oneOf((x as Record<string, unknown>).mode, ['fixed', 'tiered']))
      return null
    const e = x as Record<string, unknown>
    const price = e.sharePriceMicros
    if (!(price === null || (Number.isSafeInteger(price) && (price as number) > 0 && (price as number) <= MAX_PRICE_MICROS))) return null
    if (!(e.handoffVersion === null || Number.isSafeInteger(e.handoffVersion))) return null
    if (!arrOf(e.holdings, (h) => strFields(h, ['id', 'name', 'capital']))) return null
    if (!arrOf(e.tiers, (r) => strFields(r, ['id', 'upTo', 'rate']))) return null
    exitState = x as unknown as ExitState
  }
  if (v.allocVersion !== undefined && !Number.isSafeInteger(v.allocVersion)) return null
  const allocVersion = (v.allocVersion as number | undefined) ?? 1
  if (!old && typeof a.editedSinceHandoff !== 'boolean') return null
  // what affects money must be there and well formed, or nothing is read: no money is ever worked out without it (Codex v0.8 #4)
  const withdrawals = old ? Object.create(null) : parseWithdrawals(v.withdrawals)
  const feePayerChanges = old ? [] : parseFeePayerChanges(v.feePayerChanges)
  if (withdrawals === null || feePayerChanges === null) return null
  const loaded: AppState = {
    ...(v as unknown as AppState),
    schema: SCHEMA,
    deal: { ...(d as unknown as DealText), initials: old ? '' : (((d as Record<string, unknown>).initials as string | undefined) ?? '') },
    // not known whether the table was edited after the hand-off: assume it was, so a fee payer change waits for a new hand-off
    allocation: {
      ...(a as unknown as AllocationState),
      // refunds saved before withdrawals existed are all over-payments
      excess: (a.excess as Refund[]).map((x) => ({ ...x, reason: x.reason ?? 'Over-paid' })),
      editedSinceHandoff: old ? true : (a.editedSinceHandoff as boolean),
    },
    decisions,
    tables,
    exit: exitState,
    allocVersion,
    withdrawals,
    feePayerChanges,
    // a damaged log loses only the log, never the deal (R-X-08.5)
    log: old || v.log === undefined ? emptyLog() : parseLog(v.log),
  }
  // the same void checks as after an edit: a mark, a line or a change that no longer fits the data read with it is voided
  // before anything is calculated, never trusted (Codex M6 r6 #2 #3). Nothing is logged here: there is no action and no clock
  // a void found here changes reconciliation, so an allocation handed off before it is out of date (R-X-07; Codex M6 r7 #1)
  const marks = voidChangedMarks(loaded, loaded, false)
  return voidChangedFeeChange(marks.voided.length ? bump(marks.state, {}) : marks.state).state
}

const isMoney = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 1 && (x as number) <= MAX_MONEY
const PAYERS = ['investors', 'company', 'lead']
const BASES = ['deducted', 'onTop']
const isRate = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= 10_000
/** a fee as the engine takes it (Fee): a rate in basis points or an amount in minor units */
const feeOk = (f: unknown) =>
  strFields(f, ['id', 'label']) &&
  oneOf((f as Record<string, unknown>).payer, PAYERS) &&
  (((f as Record<string, unknown>).kind === 'percent' && isRate((f as Record<string, unknown>).value)) ||
    (oneOf((f as Record<string, unknown>).kind, ['perInvestor', 'fixed']) && isMoney((f as Record<string, unknown>).value)))

function parseWithdrawals(x: unknown): Record<string, Withdrawal> | null {
  if (!isObj(x)) return null
  const out: Record<string, Withdrawal> = Object.create(null)
  for (const [id, w] of Object.entries(x)) {
    if (!isObj(w) || !isStr(w.on) || !isIsoDate(w.on) || w.consent !== true || !isStr(w.reference)) return null
    out[id] = { on: w.on, consent: true, reference: w.reference }
  }
  return out
}

function parseFeePayerChanges(x: unknown): FeePayerChange[] | null {
  if (!Array.isArray(x)) return null
  const lineOk = (l: unknown) =>
    isObj(l) &&
    isStr(l.investorId) &&
    isStr(l.reference) &&
    isMoney(l.baseCashDue) &&
    isMoney(l.newCashDue) &&
    typeof l.voided === 'boolean' &&
    (l.voidReason === null || isStr(l.voidReason))
  const ok = (c: unknown) => {
    if (!isObj(c) || !strFields(c, ['id', 'feeId', 'feeLabel', 'appliedAt'])) return false
    if (!oneOf(c.from, PAYERS) || !oneOf(c.to, PAYERS) || typeof c.consent !== 'boolean') return false
    if (!oneOf(c.status, ['active', 'reversed', 'voided']) || !(c.voidReason === null || isStr(c.voidReason))) return false
    const f = c.feeAtApply
    if (!isObj(f) || !isRate(f.rateBps) || !oneOf(f.basis, BASES)) return false
    const st = c.settingsAtApply
    if (!isObj(st) || !(st.minimum === 0 || isMoney(st.minimum)) || !(st.cap === null || isMoney(st.cap))) return false
    if (!Number.isSafeInteger(st.priceMicros) || (st.priceMicros as number) < 1 || (st.priceMicros as number) > MAX_PRICE_MICROS) return false
    if (!oneOf(st.basis, BASES) || !arrOf(st.fees, feeOk)) return false
    if (!isObj(c.targets) || !Object.values(c.targets).every(isMoney)) return false
    if (!arrOf(c.lines, lineOk) || (c.lines as unknown[]).length > MAX_INVESTORS) return false
    const ids = (c.lines as AdjustmentLine[]).map((l) => l.investorId)
    return new Set(ids).size === ids.length
  }
  if (!x.every(ok) || x.filter((c) => (c as FeePayerChange).status === 'active').length > 1) return null
  // each change has its own ID: Reverse names one (Codex M6 r5 #2)
  if (new Set(x.map((c) => (c as FeePayerChange).id)).size !== x.length) return null
  // targets are keyed by investor ID: rebuilt without a prototype, so IDs like "toString" stay data
  return (x as FeePayerChange[]).map((c) => ({ ...c, targets: Object.assign(Object.create(null), c.targets) as Record<string, number> }))
}

function parseLog(x: unknown): ActivityLog {
  try {
    return readLog(x)
  } catch {
    // whatever is wrong with the log, the deal is still read (R-X-08.5)
    return emptyLog()
  }
}

/** a whole, exactly representable number ≥ 0, or null (appendEvents never numbers past the exact range, Codex M5 r3 #5, r4 #4) */
const count0 = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null)

function readLog(x: unknown): ActivityLog {
  const entryOk = (e: unknown, i: number, all: unknown[]) =>
    isObj(e) &&
    (count0(e.seq) ?? 0) >= 1 &&
    (i === 0 || (e.seq as number) > ((all[i - 1] as LogEntry).seq as number)) &&
    strFields(e, ['time', 'initials', 'investorId', 'investorName', 'transactionId', 'detail']) &&
    LOG_EVENTS.includes(e.event as LogEntry['event']) &&
    oneOf(e.currency, ['GBP', 'EUR', 'USD']) &&
    (e.amount === null || Number.isSafeInteger(e.amount))
  const t = isObj(x) ? x.truncated : undefined
  // each field read on its own, so one damaged field does not lose the others (Codex M5 r3 #3)
  const tf = isObj(t) ? count0(t.fromSeq) : null
  const tt = isObj(t) ? count0(t.toSeq) : null
  const tc = isObj(t) ? count0(t.count) : null
  const tu = isObj(t) ? count0(t.unexported) : null
  const trunc: Truncated | null =
    tf !== null && tt !== null && tc !== null && tu !== null && tc >= 1 && tf >= 1 && tf <= tt && tu <= tc
      ? { count: tc, fromSeq: tf, toSeq: tt, unexported: tu }
      : null
  const truncOk = t === null || trunc !== null
  const entries: unknown[] = isObj(x) && Array.isArray(x.entries) ? x.entries : []
  const allOk = entries.every(entryOk) // checked before any entry is read: a null entry must not throw (Codex M5 #1)
  const lastSeq = allOk && entries.length ? (entries[entries.length - 1] as LogEntry).seq : 0
  const next = isObj(x) ? count0(x.nextSeq) : null
  const exported = isObj(x) ? count0(x.lastExportedSeq) : null
  if (
    isObj(x) &&
    Array.isArray(x.entries) &&
    entries.length <= LOG_CAP &&
    allOk &&
    next !== null &&
    next > lastSeq &&
    // the export mark cannot be ahead of the log, or later removals would count as exported (Codex M5 r3 #4)
    exported !== null &&
    exported < next &&
    truncOk &&
    // removed entries come before every kept one, and numbering carries on after them (C-X-1: seq is never reused)
    (trunc === null || ((entries.length === 0 || trunc.toSeq < (entries[0] as LogEntry).seq) && next > trunc.toSeq))
  )
    return { entries: entries as LogEntry[], nextSeq: next, lastExportedSeq: exported, truncated: trunc }
  // unreadable: start a new log after the highest number seen anywhere, and count what was lost with what was removed
  // before; nothing counts as exported. Plain loops, not Math.max(...xs): a crafted save can hold far more entries than a
  // spread can take (Codex M5 r2 #2)
  let maxSeq = 0
  let minSeq = Infinity
  for (const e of entries) {
    const n = isObj(e) ? (count0(e.seq) ?? 0) : 0
    if (n > maxSeq) maxSeq = n
    if (n > 0 && n < minSeq) minSeq = n
  }
  const count = entries.length + (tc ?? 0)
  // seq starts at 1 and has no gaps, so `count` lost entries reached at least seq `count` even when none of their numbers
  // can be read; the result is a log this same check accepts after a save and reload (Codex M5 #2)
  // a readable fromSeq is a number already used too, even when toSeq is damaged (Codex M5 r5 #2)
  const top = Math.max(0, next === null ? 0 : next - 1, tt ?? 0, tf ?? 0, count, maxSeq)
  return {
    ...emptyLog(),
    // never below a number already read; at the very end of the exact range appendEvents stops numbering instead
    nextSeq: Math.min(top + 1, Number.MAX_SAFE_INTEGER),
    truncated: count
      ? {
          count,
          fromSeq: Math.min(tf || 1, minSeq, 1),
          toSeq: top,
          // a damaged count of unexported removals is taken as all of them, so the warning errs towards showing
          unexported: Math.min(count, entries.length + (tu !== null && tc !== null && tu <= tc ? tu : (tc ?? 0))),
        }
      : null,
  }
}

export function loadState(storage: Pick<Storage, 'getItem'> | undefined): AppState | null {
  try {
    return parseSaved(storage?.getItem(STORAGE_KEY) ?? null)
  } catch {
    return null // storage blocked (private mode): run without saving
  }
}

export type SaveResult = 'saved' | 'full' | 'blocked'

// a full store throws QuotaExceededError (Firefox: NS_ERROR_DOM_QUOTA_REACHED; older browsers only set code 22 or 1014)
function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const { name, code } = e as { name?: unknown; code?: unknown }
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014
}

/** Entries dropped per retry when the browser's storage is full (Tech Design §9.3). */
export const TRIM_STEP = 500

/**
 * Saves the whole state; on failure says why, so the page names the right cause (PRD R-X-02, v0.7.6). When the store is
 * full, the oldest log entries go first and the save is tried again: the deal data comes first (R-X-08.5). `log` is the
 * trimmed log when a save succeeded only after trimming; if nothing fits, the log in memory is left whole for export.
 */
export function saveState(storage: Pick<Storage, 'setItem'> | undefined, s: AppState): { result: SaveResult; log: ActivityLog | null } {
  // no storage at all: the browser refused it before any write (cookies or site data blocked), so nothing is saved
  if (!storage) return { result: 'blocked', log: null }
  let log = s.log
  for (;;) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(log === s.log ? s : { ...s, log }))
      return { result: 'saved', log: log === s.log ? null : log }
    } catch (e) {
      if (!isQuotaError(e)) return { result: 'blocked', log: null }
      if (log.entries.length === 0) return { result: 'full', log: null }
      log = dropOldest(log, TRIM_STEP)
    }
  }
}

export function clearSaved(storage: Pick<Storage, 'removeItem'> | undefined) {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // nothing saved, nothing to clear
  }
}
