// Payment reconciliation (PRD §4.1, C-REC-1..6).
import { sum, MAX_MONEY } from './money'
import { Errors, LIMITS, MAX_BANK_LINES, MAX_INVESTORS } from './validate'
import { finish, type Check, type InputError, type Outcome } from './outcome'
import type { TaxScheme } from './allocation'

export interface Commitment {
  id: string
  name: string
  email: string
  reference: string
  /** Cash the investor should wire, including any fees charged to them. */
  cashDue: number
  scheme: TaxScheme
}

export interface BankLine {
  /** Stable key: the transaction ID when the bank gives one, otherwise generated at import. */
  id: string
  txnId: string | null
  date: string
  amount: number
  payer: string
  reference: string
}

/** A person's decision, pinned to the data it was made on (R-REC-04.4). */
export type Decision =
  | { kind: 'assign'; commitmentId: string; lineFp: string; commitmentFp: string }
  | { kind: 'reject'; lineFp: string }
export type Decisions = Record<string, Decision>

export type LineStatus = 'auto' | 'confirmed' | 'suggested' | 'unmatched' | 'rejected' | 'skipped' | 'future'

export interface Candidate {
  commitmentId: string
  score: number
  reasons: string[]
}

export interface LineResult {
  line: BankLine
  status: LineStatus
  assignedTo: string | null
  suspectedDuplicate: boolean
  candidates: Candidate[]
  ageDays: number
  aged: boolean
  /** a stored decision exists but no longer matches the data */
  staleDecision: boolean
}

export type CommitmentStatus = 'paid' | 'partial' | 'overpaid' | 'outstanding'

export interface CommitmentResult {
  commitment: Commitment
  received: number
  difference: number
  status: CommitmentStatus
  lineIds: string[]
}

export interface ReconcileResult {
  lines: LineResult[]
  commitments: CommitmentResult[]
  totals: { bank: number; booked: number; unbooked: number; cashDue: number }
  pendingSuggestions: number
}

export interface ReconcileInput {
  commitments: Commitment[]
  lines: BankLine[]
  decisions: Decisions
  asOf: string
  thresholdDays: number
}

// ---------- C-REC-1/2: references ----------

// Only a–z are upper-cased; other letters (É, ß) stay as they are and still count as letters (C-REC-1, self-test #10).
const upperAscii = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase())
// Separators are ASCII characters other than A–Z, a–z, 0–9; every non-ASCII character belongs to a token.
// No Unicode tables are consulted, so every runtime and browser gives the same answer (self-test R3 #3).
// oxlint-disable-next-line no-control-regex -- ASCII control characters are separators by rule (C-REC-1)
const SEP = /[\x00-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F]+/
export const normRef = (s: string) => upperAscii(s).split(SEP).join('')
const tokens = (s: string) => upperAscii(s).split(SEP).filter(Boolean)

/** All concatenations of 1–3 adjacent tokens. */
export function tokenRuns(s: string): string[] {
  const t = tokens(s)
  const out: string[] = []
  for (let i = 0; i < t.length; i++) for (let n = 1; n <= 3 && i + n <= t.length; n++) out.push(t.slice(i, i + n).join(''))
  return out
}

/** Field table: a reference is 1–3 alphanumeric segments, 3–20 characters once normalised. */
export function referenceProblem(ref: string): string | null {
  if (ref.trim() === '') return 'required'
  // 1–3 segments of English letters and digits, one separator between segments, nothing before or after (self-test R3 #4)
  if (!/^[A-Za-z0-9]+(?:[ \-/_.][A-Za-z0-9]+){0,2}$/.test(ref))
    return 'use 1–3 parts of English letters and digits separated by one of space - / _ . (e.g. NW-001 or NW 001 A)'
  const n = normRef(ref).length
  if (n < 3 || n > 20) return 'must be 3–20 letters and digits'
  return null
}

function editDistanceAtMostOne(x: string, y: string): boolean {
  if (x === y) return true
  // by code point, not UTF-16 unit (self-test R3 #2)
  const a = Array.from(x)
  const b = Array.from(y)
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

const digitsValue = (s: string): bigint | null => {
  const d = s.replace(/[^0-9]/g, '') // ASCII digits only
  return d ? BigInt(d) : null
}

// ---------- C-REC-3: names ----------

const STOP = new Set(['MR', 'MRS', 'MS', 'DR', 'LTD', 'LIMITED', 'LLP', 'PLC', 'AND', 'THE'])
const nameTokens = (s: string) =>
  s
    .replace(/[a-z]/g, (c) => c.toUpperCase())
    // oxlint-disable-next-line no-control-regex -- ASCII control characters separate words by rule (C-REC-3)
    .replace(/[\x00-\x40\x5B-\x60\x7B-\x7F]+/g, ' ') // C-REC-3: ASCII non-letters separate words; non-ASCII counts as a letter (self-test #11, R3 #3)
    .split(' ')
    .filter((t) => t && !STOP.has(t))

// compare by code point, not UTF-16 unit, so letters outside the basic plane work (review R2-2)
const cp = (s: string) => Array.from(s)
const pairs = (a: string, b: string) => {
  const A = cp(a)
  const B = cp(b)
  return a === b || (A.length === 1 && B[0] === A[0]) || (B.length === 1 && A[0] === B[0])
}

/** Maximum one-to-one matching ÷ the longer token list. */
export function nameSimilarity(x: string, y: string): number {
  const { matched, of } = tokenMatch(nameTokens(x), nameTokens(y))
  return of === 0 ? 0 : matched / of
}

/** Maximum one-to-one matching as an exact ratio matched / of (review M1 #17). */
function tokenMatch(A: string[], B: string[]): { matched: number; of: number } {
  if (!A.length || !B.length) return { matched: 0, of: 0 }
  const matchOfB: number[] = B.map(() => -1)
  const tryAssign = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < B.length; j++) {
      if (seen[j] || !pairs(A[i], B[j])) continue
      seen[j] = true
      if (matchOfB[j] === -1 || tryAssign(matchOfB[j], seen)) {
        matchOfB[j] = i
        return true
      }
    }
    return false
  }
  let matched = 0
  for (let i = 0; i < A.length; i++) if (tryAssign(i, B.map(() => false))) matched++
  return { matched, of: Math.max(A.length, B.length) }
}

// ---------- fingerprints for decision invalidation ----------

export const lineFingerprint = (l: BankLine) => JSON.stringify([l.id, l.txnId, l.date, l.amount, l.payer, l.reference])
export const commitmentFingerprint = (c: Commitment) => JSON.stringify([c.id, c.name, c.email, c.reference, c.cashDue, c.scheme])

const dupKey = (l: BankLine) => JSON.stringify([l.date, l.amount, l.payer, l.reference])

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000)
}

/** Commitment rows (shared with CSV import so both apply the same field-table rules). */
export function validateCommitments(list: Commitment[], e: Errors, rowLabel = (i: number) => `commitments row ${i + 1}`, allowBlankIds = false) {
  e.count(list.length, MAX_INVESTORS, 'investors')
  const seenId = new Map<string, number>()
  const seenRef = new Map<string, number>()
  list.forEach((c, i) => {
    const where = rowLabel(i)
    e.text(c.id, `${where}, investor_id`, LIMITS.investorId, !allowBlankIds)
    if (c.id && seenId.has(c.id)) e.add(`${where}, investor_id`, `duplicate investor id "${c.id}" (also ${rowLabel(seenId.get(c.id)!)})`)
    else seenId.set(c.id, i)
    e.text(c.name, `${where}, name`, LIMITS.name, true)
    e.text(c.email, `${where}, email`, LIMITS.freeText, false)
    e.email(c.email, `${where}, email`)
    const rp = referenceProblem(c.reference)
    if (rp) e.add(`${where}, reference`, rp)
    const n = normRef(c.reference)
    if (n && seenRef.has(n)) e.add(`${where}, reference`, `same reference as ${rowLabel(seenRef.get(n)!)}`)
    else if (n) seenRef.set(n, i)
    e.money(c.cashDue, `${where}, cash_due`, 1)
    if (!['none', 'SEIS', 'EIS'].includes(c.scheme)) e.add(`${where}, scheme`, 'must be none, SEIS or EIS')
  })
}

export function validateReconcile(input: ReconcileInput): InputError[] {
  const e = new Errors()
  validateCommitments(input.commitments, e)
  e.count(input.lines.length, MAX_BANK_LINES, 'bank lines')
  const lineIds = new Set<string>()
  input.lines.forEach((l, i) => {
    const where = `bank row ${i + 1}`
    if (lineIds.has(l.id)) e.add(where, `duplicate line id "${l.id}"`)
    lineIds.add(l.id)
    e.text(l.id, `${where}, id`, LIMITS.txnId + 2, true) // internal key is `t:` + transaction id (self-test R3 #1)
    if (l.txnId !== null) e.text(l.txnId, `${where}, transaction_id`, LIMITS.txnId, true)
    e.date(l.date, `${where}, date`)
    e.money(l.amount, `${where}, amount`, -MAX_MONEY)
    e.text(l.payer, `${where}, payer`, LIMITS.freeText, false)
    e.text(l.reference, `${where}, reference`, LIMITS.freeText, false)
  })
  e.date(input.asOf, 'asOf')
  if (!Number.isInteger(input.thresholdDays) || input.thresholdDays < 1 || input.thresholdDays > 365) e.add('thresholdDays', 'must be 1–365')
  return e.list
}

export function reconcile(input: ReconcileInput): Outcome<ReconcileResult> {
  const errors = validateReconcile(input)
  if (errors.length) return { ok: false, errors }
  const { commitments, lines, decisions, asOf, thresholdDays } = input
  const byRef = new Map(commitments.map((c) => [normRef(c.reference), c]))
  const byId = new Map(commitments.map((c) => [c.id, c]))

  const noIdCount = new Map<string, number>()
  for (const l of lines) if (!l.txnId) noIdCount.set(dupKey(l), (noIdCount.get(dupKey(l)) ?? 0) + 1)

  // Pass 1: scope, decisions, exact matches.
  type Draft = Omit<LineResult, 'candidates'> & { exact: Commitment[] }
  const drafts: Draft[] = lines.map((line) => {
    const ageDays = daysBetween(line.date, asOf)
    // R-REC-02.2 flags identical no-ID rows wherever they are, including skipped and future ones.
    const suspectedDuplicate = !line.txnId && (noIdCount.get(dupKey(line)) ?? 0) > 1
    const base = { line, assignedTo: null, ageDays, aged: false, staleDecision: false, suspectedDuplicate, exact: [] as Commitment[] }
    if (line.amount <= 0) return { ...base, status: 'skipped' }
    if (line.date > asOf) return { ...base, status: 'future' }
    const runs = new Set(tokenRuns(line.reference))
    const exact = [...runs].map((r) => byRef.get(r)).filter((c): c is Commitment => Boolean(c))
    const uniqExact = [...new Map(exact.map((c) => [c.id, c])).values()]
    const d = Object.hasOwn(decisions, line.id) ? decisions[line.id] : undefined // ids like "constructor" are data (self-test #2)
    let staleDecision = false
    if (d) {
      const lineOk = d.lineFp === lineFingerprint(line)
      if (d.kind === 'reject' && lineOk) return { ...base, suspectedDuplicate, exact: uniqExact, status: 'rejected' }
      if (d.kind === 'assign') {
        const c = byId.get(d.commitmentId)
        if (lineOk && c && d.commitmentFp === commitmentFingerprint(c))
          return { ...base, suspectedDuplicate, exact: uniqExact, status: 'confirmed', assignedTo: c.id }
      }
      staleDecision = true
    }
    // An invalidated decision always goes back to a person, even if an exact match exists (review M1 #4).
    if (uniqExact.length === 1 && !suspectedDuplicate && !staleDecision)
      return { ...base, suspectedDuplicate, staleDecision, exact: uniqExact, status: 'auto', assignedTo: uniqExact[0].id }
    return { ...base, suspectedDuplicate, staleDecision, exact: uniqExact, status: 'unmatched' }
  })

  const bookedSoFar = new Map<string, number>()
  for (const d of drafts) if (d.assignedTo) bookedSoFar.set(d.assignedTo, (bookedSoFar.get(d.assignedTo) ?? 0) + d.line.amount)

  // Pass 2: candidates for everything still open. Commitment-side features are computed once.
  const feats = commitments.map((c) => ({ cref: normRef(c.reference), digits: digitsValue(c.reference), name: nameTokens(c.name) }))
  const results: LineResult[] = drafts.map((d) => {
    const { exact, ...rest } = d
    if (d.status !== 'unmatched') return { ...rest, candidates: [], aged: d.status === 'rejected' && d.ageDays > thresholdDays }
    const runs = tokenRuns(d.line.reference)
    const runDigits = runs.map(digitsValue).filter((v): v is bigint => v !== null)
    const payer = nameTokens(d.line.payer)
    const exactIds = new Set(exact.map((x) => x.id))
    // Score as an exact fraction num/den (review M1 #17): 0.6 = 12/20, 0.25 = 5/20, 0.3 × m/k = 6m/(20k).
    const scored = commitments.map((c, order) => {
      const reasons: string[] = []
      const { cref, digits: cDigits, name } = feats[order]
      let twentieths = 0
      if (exactIds.has(c.id)) {
        twentieths += 12
        reasons.push('reference matches')
      } else {
        const near = runs.some((r) => editDistanceAtMostOne(r, cref))
        // numeric equality is per 1–3-token run, not the whole reference (review M1 #11)
        const sameNumber = cDigits !== null && runDigits.some((v) => v === cDigits)
        if (near || sameNumber) {
          twentieths += 5
          reasons.push('reference nearly matches')
        }
      }
      const { matched, of } = tokenMatch(payer, name)
      if (matched > 0) reasons.push(matched === of ? 'payer name matches' : 'payer name partly matches')
      const outstanding = c.cashDue - (bookedSoFar.get(c.id) ?? 0)
      if (d.line.amount === c.cashDue || (outstanding > 0 && d.line.amount === outstanding)) {
        twentieths += 5
        reasons.push('amount matches')
      }
      const k = of || 1
      let num = twentieths * k + 6 * matched
      const den = 20 * k
      if (num > den) num = den // capped at 1
      return { commitmentId: c.id, num, den, reasons, order }
    })
    const candidates = scored
      .filter((x) => x.num * 20 >= 6 * x.den) // ≥ 0.3
      .sort((a, b) => b.num * a.den - a.num * b.den || a.order - b.order)
      .slice(0, 3)
      .map(({ commitmentId, num, den, reasons }) => ({ commitmentId, score: num / den, reasons }))
    const status: LineStatus = candidates.length || d.staleDecision ? 'suggested' : 'unmatched'
    return { ...rest, status, candidates, aged: d.ageDays > thresholdDays }
  })

  const inScope = results.filter((r) => r.status !== 'skipped' && r.status !== 'future')
  const byCommitment = new Map<string, LineResult[]>()
  for (const r of inScope) if (r.assignedTo) byCommitment.set(r.assignedTo, [...(byCommitment.get(r.assignedTo) ?? []), r])
  const commitmentResults: CommitmentResult[] = commitments.map((c) => {
    const mine = byCommitment.get(c.id) ?? []
    const received = sum(mine.map((r) => r.line.amount))
    const difference = received - c.cashDue
    const status: CommitmentStatus = received === 0 ? 'outstanding' : difference === 0 ? 'paid' : difference < 0 ? 'partial' : 'overpaid'
    return { commitment: c, received, difference, status, lineIds: mine.map((r) => r.line.id) }
  })
  const bank = sum(inScope.map((r) => r.line.amount))
  const booked = sum(inScope.filter((r) => r.assignedTo).map((r) => r.line.amount))
  const pendingSuggestions = results.filter((r) => r.status === 'suggested').length
  const result: ReconcileResult = {
    lines: results,
    commitments: commitmentResults,
    totals: { bank, booked, unbooked: bank - booked, cashDue: sum(commitments.map((c) => c.cashDue)) },
    pendingSuggestions,
  }
  const checks: Check[] = [
    {
      id: 'ledger-ties',
      kind: 'invariant',
      label: 'Booked to investors + not yet booked = bank total',
      pass: sum(commitmentResults.map((c) => c.received)) + result.totals.unbooked === bank,
    },
    {
      id: 'reviewed',
      kind: 'review',
      label: 'Every suggested match has been confirmed or rejected by a person',
      pass: pendingSuggestions === 0,
      detail: `${pendingSuggestions} waiting for review`,
    },
    ...results
      .filter((r) => r.aged)
      .map(
        (r): Check => ({
          id: `aged-${r.line.id}`,
          kind: 'warning',
          pass: false,
          label: `${r.line.payer || 'Unknown payer'}: not matched for ${r.ageDays} days`,
          detail: AGED_NOTE,
        }),
      ),
  ]
  return finish(result, checks)
}

export const AGED_NOTE = 'Operational reminder, not a regulatory deadline and not an instruction to move money. Review this receipt.'

// ---------- R-REC-08 / C-REC-6: hand-off to allocation ----------

export interface Handoff {
  investors: { id: string; name: string; received: number; scheme: 'none' | 'SEIS' | 'EIS' }[]
  excess: { id: string; name: string; amount: number }[]
}

export function handoffToAllocation(r: ReconcileResult): { ok: true; value: Handoff } | { ok: false; reason: string } {
  if (r.pendingSuggestions > 0) return { ok: false, reason: `Review the ${r.pendingSuggestions} suggested match(es) first.` }
  return {
    ok: true,
    value: {
      investors: r.commitments.map((c) => ({ id: c.commitment.id, name: c.commitment.name, received: Math.min(c.received, c.commitment.cashDue), scheme: c.commitment.scheme })),
      excess: r.commitments
        .filter((c) => c.received > c.commitment.cashDue)
        .map((c) => ({ id: c.commitment.id, name: c.commitment.name, amount: c.received - c.commitment.cashDue })),
    },
  }
}

/** Decisions to keep after an import: a replace clears all of them (review M1 #5); append keeps those whose line still exists. */
export function decisionsAfterImport(mode: 'replace' | 'append', decisions: Decisions, lines: { id: string }[]): Decisions {
  return mode === 'replace' ? {} : pruneDecisions(decisions, lines)
}

/** Drop decisions about lines that no longer exist (e.g. a line deleted by hand). */
export function pruneDecisions(decisions: Decisions, lines: { id: string }[]): Decisions {
  const ids = new Set(lines.map((l) => l.id))
  return Object.fromEntries(Object.entries(decisions).filter(([id]) => ids.has(id)))
}

/** Build a decision pinned to the current data. */
export function decide(line: BankLine, target: Commitment | null): Decision {
  return target
    ? { kind: 'assign', commitmentId: target.id, lineFp: lineFingerprint(line), commitmentFp: commitmentFingerprint(target) }
    : { kind: 'reject', lineFp: lineFingerprint(line) }
}
