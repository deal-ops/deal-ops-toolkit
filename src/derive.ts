// Text typed in the interface → engine input, with every problem located (Tech Design §2, PRD I-07).
// No calculation happens here: values are only parsed, then the engines in src/lib validate and compute.
import { parseDate, parseMoney, parseMultiple, parsePercent, parsePrice, parseYears, trimAscii, type Currency } from './lib/money'
import { validateReconcile, type BankLine, type Commitment, type ReconcileInput } from './lib/reconcile'
import { validateAllocation, type AllocationInput, type Fee, type TaxScheme } from './lib/allocation'
import { validateHoldings, validateWaterfall, type Holding } from './lib/waterfall'
import type { InputError } from './lib/outcome'
import type { CarryTerms, WaterfallInput } from './lib/waterfall'
import type { AppState, BankRow, CommitmentRow, DealText } from './state'

export interface Derived<T> {
  /** null whenever any input is wrong: the engine is not run and no figures are shown */
  input: T | null
  errors: InputError[]
}

export function parseScheme(raw: string): TaxScheme | null {
  const s = trimAscii(raw).toUpperCase()
  if (s === '' || s === 'NONE') return 'none'
  if (s === 'SEIS' || s === 'EIS') return s
  return null
}

class Collector {
  errors: InputError[] = []
  /** parse, record the reason under `where`, and return a harmless placeholder so other checks can still run */
  take<T>(r: { ok: true; value: T } | { ok: false; reason: string }, where: string, placeholder: T): T {
    if (r.ok) return r.value
    this.errors.push({ where, message: r.reason })
    return placeholder
  }
}

function minimumOf(d: DealText, c: Collector): number {
  return trimAscii(d.minimum) === '' ? 0 : c.take(parseMoney(d.minimum, d.currency), 'Deal settings, minimum commitment', 0)
}

export function deriveReconcile(s: Pick<AppState, 'deal' | 'commitments' | 'bank' | 'decisions'>): Derived<ReconcileInput> {
  const c = new Collector()
  const cur: Currency = s.deal.currency
  const asOf = c.take(parseDate(s.deal.asOf), 'Deal settings, as-of date', '2000-01-01')
  const t = trimAscii(s.deal.agedThresholdDays)
  let thresholdDays = 10
  if (t !== '') {
    if (/^\d{1,3}$/.test(t) && Number(t) >= 1 && Number(t) <= 365) thresholdDays = Number(t)
    else c.errors.push({ where: 'Deal settings, flag unmatched receipts after', message: 'must be a whole number of days from 1 to 365' })
  }
  const commitments = s.commitments.map((r, i) => commitmentOf(r, cur, c, `Investors row ${i + 1}`).value)
  const lines = bankLines(s, c, asOf)
  const input: ReconcileInput = { commitments, lines, decisions: s.decisions, asOf, thresholdDays }
  const errors = [...c.errors, ...validateReconcile(input).map(friendly)]
  return { input: errors.length ? null : input, errors }
}

function bankLines(s: Pick<AppState, 'deal' | 'bank'>, c: Collector, dateFallback: string): BankLine[] {
  return s.bank.map((r, i) => lineOf(r, s.deal.currency, c, `Bank row ${i + 1}`, dateFallback).value)
}

/**
 * One investor row → engine value. `ok` is false when any field does not parse (the value then holds placeholders).
 * The decision fingerprints in state.ts use the same function, so a decision is judged on exactly what the engine sees.
 */
export function commitmentOf(r: CommitmentRow, cur: Currency, c = new Collector(), at = 'Investor'): { value: Commitment; ok: boolean } {
  const before = c.errors.length
  const scheme = parseScheme(r.scheme)
  if (!scheme) c.errors.push({ where: `${at}, scheme`, message: 'must be none, SEIS or EIS' })
  const value: Commitment = {
    id: r.id,
    name: r.name,
    email: trimAscii(r.email),
    reference: trimAscii(r.reference),
    cashDue: c.take(parseMoney(r.cashDue, cur), `${at}, cash due`, 1),
    scheme: scheme ?? 'none',
  }
  return { value, ok: c.errors.length === before }
}

/** One bank row → engine value; see commitmentOf. */
export function lineOf(r: BankRow, cur: Currency, c = new Collector(), at = 'Bank line', dateFallback = '2000-01-01'): { value: BankLine; ok: boolean } {
  const before = c.errors.length
  const value: BankLine = {
    id: r.id,
    txnId: r.txnId,
    date: c.take(parseDate(r.date), `${at}, date`, dateFallback),
    amount: c.take(parseMoney(r.amount, cur, true), `${at}, amount`, 0),
    payer: r.payer,
    reference: r.reference,
  }
  return { value, ok: c.errors.length === before }
}

/** The bank table on its own, for an append import that de-duplicates against it (R-REC-02.2). */
export function deriveBankLines(s: Pick<AppState, 'deal' | 'bank'>): Derived<BankLine[]> {
  const c = new Collector()
  const lines = bankLines(s, c, '2000-01-01')
  return { input: c.errors.length ? null : lines, errors: c.errors }
}

export function deriveAllocation(s: Pick<AppState, 'deal' | 'allocation'>): Derived<AllocationInput> {
  const c = new Collector()
  const cur = s.deal.currency
  const a = s.allocation
  const minimum = minimumOf(s.deal, c)
  const priceMicros = c.take(parsePrice(a.price, cur), 'Allocation, share price', 1_000_000)
  const cap = trimAscii(a.cap) === '' ? null : c.take(parseMoney(a.cap, cur), 'Allocation, round cap', 1)
  const fees: Fee[] = a.fees.map((f, i) => {
    const at = `Fee ${i + 1}${f.label ? ` (${f.label})` : ''}`
    if (f.label.trim() === '') c.errors.push({ where: `${at}, name`, message: 'required' })
    const value = f.kind === 'percent' ? c.take(parsePercent(f.value), `${at}, rate`, 0) : c.take(parseMoney(f.value, cur), `${at}, amount`, 1)
    return { id: f.id, label: f.label, payer: f.payer, kind: f.kind, value }
  })
  const investors = a.investors.map((v, i) => {
    const at = `Allocation investors row ${i + 1}`
    const scheme = parseScheme(v.scheme)
    if (!scheme) c.errors.push({ where: `${at}, scheme`, message: 'must be none, SEIS or EIS' })
    return { id: v.id, name: v.name, received: c.take(parseMoney(v.received, cur), `${at}, received`, 0), scheme: scheme ?? 'none' }
  })
  const input: AllocationInput = { feeBasis: s.deal.feeBasis, minimum, cap, priceMicros, fees, investors }
  const errors = [...c.errors, ...validateAllocation(input).map(friendly)]
  return { input: errors.length ? null : input, errors }
}

export function deriveDistribution(s: Pick<AppState, 'deal' | 'exit'>): Derived<WaterfallInput> {
  const c = new Collector()
  const cur = s.deal.currency
  const x = s.exit
  const holdings = x.holdings.map((h, i) => ({
    id: h.id,
    name: h.name,
    capital: c.take(parseMoney(h.capital, cur), `Holdings row ${i + 1}, amount invested`, 1),
  }))
  const proceeds = c.take(parseMoney(x.proceeds, cur), 'Exit, proceeds', 0)
  const exitCosts = trimAscii(x.exitCosts) === '' ? 0 : c.take(parseMoney(x.exitCosts, cur), 'Exit, exit costs', 0)
  const years100 = c.take(parseYears(x.years), 'Exit, years held', 0)
  const pct = (raw: string, where: string, blankIsZero: boolean) => (blankIsZero && trimAscii(raw) === '' ? 0 : c.take(parsePercent(raw), where, 0))
  let carry: CarryTerms
  if (x.mode === 'fixed') {
    carry = { mode: 'fixed', k: pct(x.carry, 'Exit, carry', false), h: pct(x.hurdle, 'Exit, hurdle', true), c: pct(x.catchUp, 'Exit, catch-up', true) }
  } else {
    carry = {
      mode: 'tiered',
      tiers: x.tiers.map((t, i) => ({
        // the last tier has no ceiling and no field for one; a blank ceiling anywhere else is caught by the engine
        upTo100: i === x.tiers.length - 1 || trimAscii(t.upTo) === '' ? null : c.take(parseMultiple(t.upTo), `Tier ${i + 1}, up to multiple`, 200n),
        rate: c.take(parsePercent(t.rate), `Tier ${i + 1}, carry`, 0),
      })),
    }
  }
  const input: WaterfallInput = { holdings, proceeds, exitCosts, years100, carry }
  const errors = [...c.errors, ...validateWaterfall(input).map(friendly)]
  return { input: errors.length ? null : input, errors }
}

/** The holdings table alone, validated as the engine and the importer do; the exit terms play no part (review M3 R1 #6). */
export function deriveHoldings(s: Pick<AppState, 'deal' | 'exit'>): Derived<Holding[]> {
  const c = new Collector()
  const holdings = s.exit.holdings.map((h, i) => ({
    id: h.id,
    name: h.name,
    capital: c.take(parseMoney(h.capital, s.deal.currency), `Holdings row ${i + 1}, amount invested`, 1),
  }))
  const errors = [...c.errors, ...validateHoldings(holdings).map(friendly)]
  return { input: errors.length ? null : holdings, errors }
}

/** Each holding's amount invested, or null where the text does not parse (shares are shown per row, C-DIS-7). */
export function holdingCapitals(s: Pick<AppState, 'deal' | 'exit'>): (number | null)[] {
  return s.exit.holdings.map((h) => {
    const r = parseMoney(h.capital, s.deal.currency)
    return r.ok && r.value > 0 ? r.value : null
  })
}

/** Engine error positions in the words the interface uses. */
const WHERE: [RegExp, string][] = [
  [/^commitments row (\d+)/, 'Investors row $1'],
  [/^bank row (\d+)/, 'Bank row $1'],
  [/^investors\[(\d+)\] (\w+)/, 'Allocation investors row $1, $2'],
  [/^investors row (\d+)/, 'Allocation investors row $1'],
  [/^fees\[(\d+)\]/, 'Fee $1'],
  [/^fee labels row (\d+)/, 'Fee $1, name'],
  [/^fees row (\d+)/, 'Fee $1'],
  [/^fees$/, 'Fees'],
  [/^sharePrice$/, 'Allocation, share price'],
  [/^cap$/, 'Allocation, round cap'],
  [/^minimum$/, 'Deal settings, minimum commitment'],
  [/^asOf$/, 'Deal settings, as-of date'],
  [/^thresholdDays$/, 'Deal settings, flag unmatched receipts after'],
  [/^holdings\[(\d+)\] (\w+)/, 'Holdings row $1, $2'],
  [/^holdings row (\d+)/, 'Holdings row $1'],
  [/^holdings$/, 'Holdings'],
  [/^tiers\[(\d+)\]( rate)?/, 'Tier $1'],
  [/^tiers$/, 'Tiers'],
  [/^proceeds$/, 'Exit, proceeds'],
  [/^exitCosts$/, 'Exit, exit costs'],
  [/^years$/, 'Exit, years held'],
  [/^carry$/, 'Exit, carry'],
  [/^hurdle$/, 'Exit, hurdle'],
  [/^catchUp$/, 'Exit, catch-up'],
]
export function friendly(e: InputError): InputError {
  const message = e.message.replace(/\bcommitments row (\d+)/g, 'Investors row $1')
  for (const [re, to] of WHERE) if (re.test(e.where)) return { where: e.where.replace(re, to), message }
  return { ...e, message }
}
