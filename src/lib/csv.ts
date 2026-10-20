// CSV import / export (PRD §5.0 I-07..I-09, §5.5).
import Papa from 'papaparse'
import { parseDate, parseMoney, parsePrice, plainMoney, trimAscii, type Currency } from './money'
import type { InputError } from './outcome'
import type { BankLine, Commitment } from './reconcile'
import type { AllocationInvestor, TaxScheme } from './allocation'
import type { Holding } from './waterfall'

import { Errors, LIMITS, MAX_BANK_LINES, MAX_HOLDINGS, MAX_INVESTORS } from './validate'
import { validateCommitments } from './reconcile'

type FieldSpec = { key: string; required: boolean; aliases: string[] }

const SCHEMAS: Record<'commitments' | 'bank' | 'investors' | 'holdings', FieldSpec[]> = {
  commitments: [
    { key: 'investor_id', required: false, aliases: ['id', 'investor id'] },
    { key: 'name', required: true, aliases: ['investor name', 'investor', 'full name'] },
    { key: 'email', required: false, aliases: [] },
    { key: 'reference', required: true, aliases: ['payment reference', 'ref'] },
    { key: 'cash_due', required: true, aliases: ['cash due', 'amount due', 'expected', 'expected amount'] },
    { key: 'scheme', required: false, aliases: ['tax scheme', 'seis/eis'] },
  ],
  bank: [
    { key: 'transaction_id', required: false, aliases: ['id', 'transaction id', 'txn id'] },
    { key: 'date', required: true, aliases: ['value date', 'booking date'] },
    { key: 'amount', required: true, aliases: ['credit', 'paid in'] },
    { key: 'payer', required: false, aliases: ['payer name', 'counterparty', 'from', 'name'] },
    { key: 'reference', required: false, aliases: ['description', 'payment reference', 'narrative'] },
  ],
  investors: [
    { key: 'investor_id', required: false, aliases: ['id', 'investor id'] },
    { key: 'name', required: true, aliases: ['investor name', 'investor', 'full name'] },
    { key: 'received', required: true, aliases: ['cash received', 'amount received'] },
    { key: 'scheme', required: false, aliases: ['tax scheme', 'seis/eis'] },
  ],
  holdings: [
    { key: 'investor_id', required: false, aliases: ['id', 'investor id'] },
    { key: 'name', required: true, aliases: ['investor name', 'investor', 'full name'] },
    { key: 'capital', required: true, aliases: ['invested', 'amount invested'] },
    { key: 'share_price', required: false, aliases: ['price per share', 'price'] },
  ],
}

/** Header names refused as stand-ins for a required column, because they could include or exclude fees.
 *  Only reported when that required column is missing; otherwise they are ignored like any extra column (review M1 #15). */
const MISLEADING: Record<string, { field: string; hint: string }> = {
  committed: { field: 'cash_due', hint: 'Use a "cash_due" column: the full cash the investor should wire, including any fees charged to them.' },
  commitment: { field: 'cash_due', hint: 'Use a "cash_due" column: the full cash the investor should wire, including any fees charged to them.' },
  cost: { field: 'capital', hint: 'Use a "capital" column: the amount invested, excluding fees.' },
  paid: { field: 'capital', hint: 'Use a "capital" column: the amount invested, excluding fees.' },
  wired: { field: 'capital', hint: 'Use a "capital" column: the amount invested, excluding fees.' },
}

const CCY_MARKS: Record<Currency, string[]> = { GBP: ['£', 'gbp'], EUR: ['€', 'eur'], USD: ['$', 'usd'] }

/** Fields treated as identifiers or parsed values: trimmed of ASCII whitespace on import (PRD I-09, CSV text review). */
const IDENTIFIER_FIELDS: Record<keyof typeof SCHEMAS, string[]> = {
  commitments: ['investor_id', 'reference', 'email', 'cash_due', 'scheme'],
  bank: ['transaction_id', 'date', 'amount'],
  investors: ['investor_id', 'received', 'scheme'],
  holdings: ['investor_id', 'capital', 'share_price'],
}

/** Strip a currency annotation after checking it matches the deal currency. */
function normaliseHeader(raw: string, currency: Currency): { name: string } | { error: string } {
  let h = raw.trim().toLowerCase()
  const bracket = /\s*\(([^)]*)\)\s*$/.exec(h)
  let mark: string | null = null
  if (bracket) {
    mark = bracket[1].trim()
    h = h.slice(0, bracket.index).trim()
  } else {
    const code = /\s+(gbp|eur|usd)$/.exec(h)
    if (code) {
      mark = code[1]
      h = h.slice(0, code.index).trim()
    }
  }
  if (mark !== null) {
    const known = Object.entries(CCY_MARKS).find(([, marks]) => marks.includes(mark!))
    if (known && known[0] !== currency) return { error: `column "${raw.trim()}" is in ${known[0]} but this deal is in ${currency}` }
    if (!known) h = raw.trim().toLowerCase() // a bracket that is not a currency: keep the header as written
  }
  return { name: h }
}

interface Table {
  rows: Record<string, string>[]
  /** spreadsheet row number of each data row (header is row 1) */
  rowNumbers: number[]
}

/**
 * Mixed line endings (PRD I-09): outside quoted fields, CRLF and lone CR become LF, whichever comes first
 * in the file (Codex M1 R4-1). Line breaks inside quotes are content and are kept as written.
 * Each line ending becomes exactly one LF, so reported row numbers do not move.
 */
export function normaliseNewlines(src: string): string {
  let out = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"') quoted = !quoted
    if (!quoted && ch === '\r') {
      out += '\n'
      if (src[i + 1] === '\n') i++
      continue
    }
    out += ch
  }
  return out
}

function readTable(text: string, kind: keyof typeof SCHEMAS, currency: Currency): { table: Table; errors: InputError[]; ignored: string[] } {
  const errors: InputError[] = []
  const src = normaliseNewlines(text.replace(/^\uFEFF/, ''))
  // Step mode keeps each record's start offset, so error rows are true file lines even with
  // blank lines or quoted line breaks (review M1 #19).
  const records: { cells: string[]; line: number }[] = []
  const lineAt = (offset: number) => src.slice(0, offset).split(/\r\n|\r|\n/).length // any line ending (self-test #5)
  let prevCursor = 0
  Papa.parse<string[]>(src, {
    delimiter: ',',
    newline: '\n',
    skipEmptyLines: false,
    step: (res) => {
      const start = prevCursor
      prevCursor = res.meta.cursor
      for (const err of res.errors) errors.push({ where: `row ${lineAt(start)}`, message: err.message })
      const cells = [...res.data]
      const lead = src.slice(start, res.meta.cursor).match(/^[\r\n]*/)?.[0].length ?? 0
      if (cells.every((c) => c.trim() === '')) return // blank line, including spreadsheet rows of empty cells (self-test #4)
      records.push({ cells, line: lineAt(start + lead) })
    },
  })
  const [headerRec, ...body] = records
  const header = headerRec?.cells ?? []
  const spec = SCHEMAS[kind]
  const colOf: Record<string, number> = {}
  const ignored: string[] = []
  const misleading: { raw: string; field: string; hint: string }[] = []
  header.forEach((raw, idx) => {
    const n = normaliseHeader(raw, currency)
    if ('error' in n) return errors.push({ where: 'header', message: n.error })
    const field = spec.find((f) => f.key === n.name || f.aliases.includes(n.name))
    if (field) {
      if (field.key in colOf) errors.push({ where: 'header', message: `two columns map to "${field.key}"` })
      else colOf[field.key] = idx
      return
    }
    const m = MISLEADING[n.name]
    if (m) misleading.push({ raw: raw.trim(), ...m })
    ignored.push(raw.trim())
  })
  for (const f of spec) {
    if (!f.required || f.key in colOf) continue
    const m = misleading.find((x) => x.field === f.key)
    errors.push({ where: 'header', message: m ? `column "${m.raw}" is not accepted. ${m.hint}` : `missing required column "${f.key}"` })
  }
  // Every row must have exactly as many cells as the header (review M1 #6).
  for (const r of body)
    if (r.cells.length !== header.length) errors.push({ where: `row ${r.line}`, message: `has ${r.cells.length} cells but the header has ${header.length} — check for unquoted commas` })
  // undo our own export escaping so exported files import unchanged (self-test #9)
  // remove our escape apostrophe before trimming, so a value that starts with a tab or CR is restored exactly (self-test R3 #5)
  const unescape = (v: string) => (/^'[=+\-@\t\r']/.test(v) ? v.slice(1) : v)
  // Text cells are kept exactly as written: no trimming, because characters such as a trailing
  // non-breaking space are significant for reference matching and for lossless round-trips (Codex M1 R3-1).
  // Amount, date and scheme parsers trim for themselves.
  // Identifier and parsed fields lose leading/trailing ASCII whitespace; whitespace-only means blank.
  // Free text (names, payers, bank references) stays exact (PRD I-09).
  const ids = new Set(IDENTIFIER_FIELDS[kind])
  const rows = body.map((r) =>
    Object.fromEntries(Object.entries(colOf).map(([k, i]) => {
      const v = unescape(r.cells[i] ?? '')
      return [k, ids.has(k) ? trimAscii(v) : v]
    })),
  )
  return { table: { rows, rowNumbers: body.map((r) => r.line) }, errors, ignored }
}

export type ImportResult<T> = { ok: true; rows: T[]; ignoredColumns: string[] } | { ok: false; errors: InputError[] }

function parseScheme(raw: string): TaxScheme | null {
  const s = trimAscii(raw).toUpperCase()
  if (s === '' || s === 'NONE') return 'none'
  if (s === 'SEIS' || s === 'EIS') return s
  return null
}

let idCounter = 0
export const generateId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

function fillIds<T extends { id: string }>(rows: T[], prefix: string, existing: Set<string>) {
  for (const r of rows) {
    if (r.id) continue
    let id: string
    do id = generateId(prefix)
    while (existing.has(id))
    r.id = id
    existing.add(id)
  }
}

export function importCommitments(text: string, currency: Currency): ImportResult<Commitment> {
  const { table, errors, ignored } = readTable(text, 'commitments', currency)
  const rows: Commitment[] = []
  const e = new Errors()
  table.rows.forEach((r, i) => {
    const at = `row ${table.rowNumbers[i]}`
    const cash = parseMoney(r.cash_due ?? '', currency)
    if (!cash.ok) e.add(`${at}, cash_due`, cash.reason)
    const scheme = parseScheme(r.scheme ?? '')
    if (!scheme) e.add(`${at}, scheme`, 'must be none, SEIS or EIS')
    rows.push({ id: r.investor_id ?? '', name: r.name ?? '', email: r.email ?? '', reference: r.reference ?? '', cashDue: cash.ok ? cash.value : 1, scheme: scheme ?? 'none' })
  })
  // Same field-table rules as the engine: references, uniqueness, text limits, email (review M1 #7).
  // blank ids are allowed here and filled in below (self-test #3)
  validateCommitments(rows, e, (i) => `row ${table.rowNumbers[i]}`, true)
  const all = [...errors, ...e.list]
  if (all.length) return { ok: false, errors: all }
  fillIds(rows, 'inv', new Set(rows.map((r) => r.id).filter(Boolean)))
  return { ok: true, rows, ignoredColumns: ignored }
}

export interface BankImport {
  lines: BankLine[]
  /** rows skipped as ≤ 0 are kept in `lines` (the engine lists them); this is just a count for the UI */
  nonPositive: number
}

/** R-REC-02.2: replace, or append with transaction-ID de-duplication and conflict detection. */
export function importBank(
  text: string,
  currency: Currency,
  mode: 'replace' | 'append',
  existing: BankLine[],
): { ok: true; value: BankImport; added: number; ignoredDuplicates: number; ignoredColumns: string[] } | { ok: false; errors: InputError[] } {
  const { table, errors, ignored } = readTable(text, 'bank', currency)
  const e = new Errors()
  const parsed: { line: BankLine; row: number }[] = []
  table.rows.forEach((r, i) => {
    const at = `row ${table.rowNumbers[i]}`
    const date = parseDate(r.date ?? '')
    if (!date.ok) e.add(`${at}, date`, date.reason)
    const amt = parseMoney(r.amount ?? '', currency, true)
    if (!amt.ok) e.add(`${at}, amount`, amt.reason)
    const txnId = r.transaction_id ? r.transaction_id : null
    if (txnId) e.text(txnId, `${at}, transaction_id`, LIMITS.txnId, true)
    e.text(r.payer ?? '', `${at}, payer`, LIMITS.freeText, false)
    e.text(r.reference ?? '', `${at}, reference`, LIMITS.freeText, false)
    parsed.push({ row: table.rowNumbers[i], line: { id: txnId ? `t:${txnId}` : '', txnId, date: date.ok ? date.value : '', amount: amt.ok ? amt.value : 0, payer: r.payer ?? '', reference: r.reference ?? '' } })
  })
  const same = (a: BankLine, b: BankLine) => a.date === b.date && a.amount === b.amount && a.payer === b.payer && a.reference === b.reference
  // De-duplicate against the existing ledger (append) and within this file, the same way (review M1 #14).
  const known = new Map<string, BankLine>(mode === 'append' ? existing.filter((l) => l.txnId).map((l) => [l.txnId!, l]) : [])
  let ignoredDuplicates = 0
  const fresh: BankLine[] = []
  for (const { line, row } of parsed) {
    const prior = line.txnId ? known.get(line.txnId) : undefined
    if (!prior) {
      if (line.txnId) known.set(line.txnId, line)
      fresh.push(line)
    } else if (same(prior, line)) ignoredDuplicates++
    else e.add(`row ${row}, transaction_id`, `"${line.txnId}" already exists with different details — import conflict, nothing was imported`)
  }
  const base = mode === 'append' ? existing : []
  if (base.length + fresh.length > MAX_BANK_LINES) e.add('file', `at most ${MAX_BANK_LINES} bank lines per deal`)
  const all = [...errors, ...e.list]
  if (all.length) return { ok: false, errors: all }
  fillIds(fresh, 'line', new Set(base.map((l) => l.id)))
  const lines = [...base, ...fresh]
  return { ok: true, value: { lines, nonPositive: lines.filter((l) => l.amount <= 0).length }, added: fresh.length, ignoredDuplicates, ignoredColumns: ignored }
}

export function importInvestors(text: string, currency: Currency): ImportResult<AllocationInvestor> {
  const { table, errors, ignored } = readTable(text, 'investors', currency)
  if (table.rows.length > MAX_INVESTORS) errors.push({ where: 'file', message: `at most ${MAX_INVESTORS} investors per deal` })
  const rows: AllocationInvestor[] = []
  const ids = new Set<string>()
  table.rows.forEach((r, i) => {
    const at = `row ${table.rowNumbers[i]}`
    const rec = parseMoney(r.received ?? '', currency)
    if (!rec.ok) errors.push({ where: `${at}, received`, message: rec.reason })
    if (!(r.name ?? '').trim()) errors.push({ where: `${at}, name`, message: 'required' })
    const scheme = parseScheme(r.scheme ?? '')
    if (!scheme) errors.push({ where: `${at}, scheme`, message: 'must be none, SEIS or EIS' })
    const id = r.investor_id ?? ''
    if (id) {
      if (ids.has(id)) errors.push({ where: `${at}, investor_id`, message: `duplicate investor id "${id}"` })
      ids.add(id)
    }
    if (id.length > LIMITS.investorId) errors.push({ where: `${at}, investor_id`, message: `at most ${LIMITS.investorId} characters` })
    if ((r.name ?? '').length > LIMITS.name) errors.push({ where: `${at}, name`, message: `at most ${LIMITS.name} characters` })
    rows.push({ id, name: r.name ?? '', received: rec.ok ? rec.value : 0, scheme: scheme ?? 'none' })
  })
  if (errors.length) return { ok: false, errors }
  fillIds(rows, 'inv', ids)
  return { ok: true, rows, ignoredColumns: ignored }
}

export function importHoldings(
  text: string,
  currency: Currency,
): { ok: true; rows: Holding[]; sharePriceMicros: number | null; ignoredColumns: string[] } | { ok: false; errors: InputError[] } {
  const { table, errors, ignored } = readTable(text, 'holdings', currency)
  if (table.rows.length > MAX_HOLDINGS) errors.push({ where: 'file', message: `at most ${MAX_HOLDINGS} holdings` })
  const rows: Holding[] = []
  const ids = new Set<string>()
  let price: number | null | undefined
  table.rows.forEach((r, i) => {
    const at = `row ${table.rowNumbers[i]}`
    const cap = parseMoney(r.capital ?? '', currency)
    if (!cap.ok) errors.push({ where: `${at}, capital`, message: cap.reason })
    else if (cap.value <= 0) errors.push({ where: `${at}, capital`, message: 'must be greater than 0' })
    if (!(r.name ?? '').trim()) errors.push({ where: `${at}, name`, message: 'required' })
    const rawPrice = r.share_price ?? ''
    let thisPrice: number | null = null
    if (rawPrice) {
      const p = parsePrice(rawPrice, currency)
      if (!p.ok) errors.push({ where: `${at}, share_price`, message: p.reason })
      else thisPrice = p.value
    }
    if (price === undefined) price = thisPrice
    else if (price !== thisPrice) errors.push({ where: `${at}, share_price`, message: 'must be the same on every row' })
    const id = r.investor_id ?? ''
    if (id) {
      if (ids.has(id)) errors.push({ where: `${at}, investor_id`, message: `duplicate investor id "${id}"` })
      ids.add(id)
    }
    if (id.length > LIMITS.investorId) errors.push({ where: `${at}, investor_id`, message: `at most ${LIMITS.investorId} characters` })
    if ((r.name ?? '').length > LIMITS.name) errors.push({ where: `${at}, name`, message: `at most ${LIMITS.name} characters` })
    rows.push({ id, name: r.name ?? '', capital: cap.ok ? cap.value : 0 })
  })
  if (errors.length) return { ok: false, errors }
  fillIds(rows, 'inv', ids)
  return { ok: true, rows, sharePriceMicros: price ?? null, ignoredColumns: ignored }
}

// ---------- export ----------

/** I-09: neutralise spreadsheet formulas in text cells, including tab / CR prefixes (review M1 #12). */
export function safeText(v: string): string {
  // a leading apostrophe is doubled too, so import can undo exactly one (reversible, review R2-3)
  return /^[=+\-@\t\r']/.test(v) ? `'${v}` : v
}

/**
 * Columns listed in `numeric` hold amounts or counts we produced ourselves and are written as-is;
 * every other column is treated as text and escaped, even if it looks like a number.
 */
export function toCsv(header: string[], rows: (string | number)[][], numeric: string[] = []): string {
  const num = new Set(numeric.map((n) => header.indexOf(n)))
  return Papa.unparse({ fields: header, data: rows.map((r) => r.map((v, i) => (num.has(i) || typeof v === 'number' ? v : safeText(v)))) })
}

export { plainMoney }
