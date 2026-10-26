// Interface state (Tech Design §2): what the person typed is kept as text and parsed in derive.ts,
// so a bad value is reported where it was typed and never silently becomes 0 (PRD I-07).
// Hand-offs between modules are snapshots with version numbers (PRD R-X-07).
import { MAX_PRICE_MICROS, plainMoney, trimAscii, type Currency } from './lib/money'
import type { FeeBasis, FeeKind, FeePayer } from './lib/allocation'
import {
  commitmentFingerprint,
  decisionsAfterImport,
  lineFingerprint,
  pruneDecisions,
  type BankLine,
  type Commitment,
  type Decision,
  type Decisions,
  type Handoff,
} from './lib/reconcile'
import { generateId } from './lib/csv'
import { commitmentOf, lineOf } from './derive'
import { defaultDeal, type DealSettings } from './lib/deal'
import { SAMPLE_BANK, SAMPLE_CAP, SAMPLE_COMMITMENTS, SAMPLE_EXIT, SAMPLE_FEES, SAMPLE_PRICE_MICROS, SAMPLE_SETTINGS } from './lib/sample'
import type { Holding } from './lib/waterfall'
import { plainPrice } from './lib/exports'
import type { AllocationInvestor } from './lib/allocation'

export const STORAGE_KEY = 'deal-ops-toolkit:v1'
export const SCHEMA = 1

export interface DealText {
  name: string
  currency: Currency
  asOf: string
  feeBasis: FeeBasis
  minimum: string
  agedThresholdDays: string
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
}

/** An over-payment to refund. `needsCheck`: the investor's row was changed by hand after hand-off, so a person must keep or remove it. */
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
}

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
})

export const commitmentRow = (c: Commitment): CommitmentRow => ({ ...c, cashDue: plainMoney(c.cashDue) })
export const bankRow = (l: BankLine): BankRow => ({ ...l, amount: plainMoney(l.amount) })
export const investorRow = (v: AllocationInvestor): InvestorRow => ({ ...v, received: plainMoney(v.received) })

const emptyAllocation = (): AllocationState => ({ price: '', cap: '', fees: [], investors: [], excess: [], handoffVersion: null })
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
  }
}

/** Test Plan §3: the fictional sample, before any review, with nothing handed off yet. */
export function sampleState(prev: AppState): AppState {
  return {
    ...prev,
    deal: dealText(SAMPLE_SETTINGS),
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
  | { type: 'decide'; lineId: string; decision: Decision }
  | { type: 'undoDecision'; lineId: string }
  | { type: 'handoff'; handoff: Handoff }
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
  | { type: 'handoffToExit'; holdings: Holding[]; sharePriceMicros: number }
  | { type: 'replaceHoldings'; rows: HoldingRow[]; sharePriceMicros: number | null }
  | { type: 'editHolding'; index: number; rowId?: string; field: 'name' | 'capital'; value: string }
  | { type: 'addHolding' }
  | { type: 'deleteHolding'; index: number }
  | { type: 'setExit'; patch: Partial<Pick<ExitState, 'proceeds' | 'exitCosts' | 'years' | 'carry' | 'hurdle' | 'catchUp'>> }
  | { type: 'setCarryMode'; mode: ExitState['mode'] }
  | { type: 'addTier' }
  | { type: 'editTier'; index: number; rowId?: string; field: 'upTo' | 'rate'; value: string }
  | { type: 'deleteTier'; index: number }

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
function voidChangedDecisions(s: AppState): AppState {
  const cur = s.deal.currency
  const lines = new Map(s.bank.map((r) => [r.id, r]))
  const people = new Map(s.commitments.map((r) => [r.id, r]))
  let changed = false
  const decisions: Decisions = Object.create(null)
  for (const [lineId, d] of Object.entries(s.decisions)) {
    let ok = d.lineFp !== VOID
    if (ok) {
      const row = lines.get(lineId)
      const line = row && lineOf(row, cur)
      ok = Boolean(line?.ok && lineFingerprint(line.value) === d.lineFp)
    }
    if (ok && d.kind === 'assign') {
      const row = people.get(d.commitmentId)
      const c = row && commitmentOf(row, cur)
      ok = Boolean(c?.ok && commitmentFingerprint(c.value) === d.commitmentFp)
    }
    decisions[lineId] = ok ? d : { ...d, lineFp: VOID }
    if (!ok && d.lineFp !== VOID) changed = true
  }
  return changed ? { ...s, decisions } : s
}

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

export function reducer(s: AppState, a: Action): AppState {
  if (targetMoved(s, a)) return s
  const next = apply(s, a)
  return UPSTREAM_DATA.has(a.type) ? voidChangedDecisions(next) : next
}

function apply(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'acceptDisclaimer':
      return { ...s, disclaimerAccepted: true }
    case 'restore':
      return a.state
    case 'loadSample':
      return sampleState(s)
    case 'clearAll':
      return { ...initialState(), recVersion: s.recVersion + 1 }
    case 'setDeal': {
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
      return alloc({ ...s, tables: renew(s, 'investors') }, { investors: a.rows, excess: [], handoffVersion: null })
    case 'editInvestor': {
      const value = a.field === 'id' ? idOrNew(a.value, 'inv') : a.value
      return alloc(s, {
        investors: replaceAt(s.allocation.investors, a.index, { ...s.allocation.investors[a.index], [a.field]: value }),
        excess: refundsAfterEdit(s, a.index, a.field, value),
      })
    }
    case 'addInvestor':
      return alloc(s, { investors: [...s.allocation.investors, { id: generateId('inv'), name: '', received: '', scheme: 'none' }] })
    case 'deleteInvestor':
      return alloc(s, { investors: removeAt(s.allocation.investors, a.index), excess: refundsAfterEdit(s, a.index, 'delete') })
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
  }
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

/** Shape check for saved data; anything unexpected is ignored rather than trusted. */
export function parseSaved(raw: string | null): AppState | null {
  if (!raw) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(v) || v.schema !== SCHEMA || typeof v.disclaimerAccepted !== 'boolean' || !Number.isSafeInteger(v.recVersion)) return null
  const d = v.deal
  if (
    !strFields(d, ['name', 'asOf', 'minimum', 'agedThresholdDays']) ||
    !['GBP', 'EUR', 'USD'].includes(String((d as Record<string, unknown>).currency)) ||
    !['deducted', 'onTop'].includes(String((d as Record<string, unknown>).feeBasis))
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
        ['investors', 'company', 'lead'].includes(String((x as Record<string, unknown>).payer)) &&
        ['percent', 'perInvestor', 'fixed'].includes(String((x as Record<string, unknown>).kind)),
    )
  )
    return null
  if (!arrOf(a.investors, (x) => strFields(x, ['id', 'name', 'received', 'scheme']))) return null
  // refunds feed the closing confirmation directly, so they are checked as money, not just as shapes (Codex M2 #5)
  const refundOk = (x: unknown) =>
    strFields(x, ['id', 'name']) &&
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
    if (
      !strFields(x, ['proceeds', 'exitCosts', 'years', 'carry', 'hurdle', 'catchUp']) ||
      !['fixed', 'tiered'].includes(String((x as Record<string, unknown>).mode))
    )
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
  return { ...(v as unknown as AppState), decisions, tables, exit: exitState, allocVersion }
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

/** Saves the whole state; on failure says why, so the page names the right cause (PRD R-X-02, v0.7.6). */
export function saveState(storage: Pick<Storage, 'setItem'> | undefined, s: AppState): SaveResult {
  // no storage at all: the browser refused it before any write (cookies or site data blocked), so nothing is saved
  if (!storage) return 'blocked'
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(s))
    return 'saved'
  } catch (e) {
    return isQuotaError(e) ? 'full' : 'blocked'
  }
}

export function clearSaved(storage: Pick<Storage, 'removeItem'> | undefined) {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // nothing saved, nothing to clear
  }
}
