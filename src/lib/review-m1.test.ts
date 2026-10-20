// Regression tests for the M1 code review (docs/en/REVIEW_SUMMARY.md, M1).
// Each test reproduces Codex's failing input and asserts the corrected result.
import { describe, expect, it } from 'vitest'
import { allocate, type AllocationInput } from './allocation'
import { distribute } from './waterfall'
import { decide, decisionsAfterImport, reconcile, type BankLine, type Commitment } from './reconcile'
import { importBank, importCommitments, importHoldings } from './csv'
import { hurdleAmount, parseMultiple } from './money'

const A: AllocationInput = { feeBasis: 'deducted', minimum: 0, cap: null, priceMicros: 1_000_000, fees: [], investors: [] }
const C = (id: string, reference: string, cashDue: number, extra: Partial<Commitment> = {}): Commitment => ({ id, name: `Investor ${id}`, email: '', reference, cashDue, scheme: 'none', ...extra })
const rec = (commitments: Commitment[], lines: BankLine[], decisions = {}, asOf = '2026-10-16') => reconcile({ commitments, lines, decisions, asOf, thresholdDays: 10 })

describe('M1 review regressions', () => {
  it('TC-DIS-27 a hurdle of exactly half a penny rounds up (#1)', () => {
    expect(hurdleAmount(5_000, 1, 100)).toBe(1n)
    const o = distribute({ holdings: [{ id: 'a', name: 'a', capital: 5_000 }], proceeds: 5_001, exitCosts: 0, years100: 100, carry: { mode: 'fixed', k: 10_000, h: 1, c: 0 } })
    expect(o.ok && o.result).toMatchObject({ hurdlePaid: 1, carry: 0, investorsTotal: 5_001 })
    // fractional year landing on exactly half a penny: 5p × (1.21^0.5 − 1) = 0.5p → 1p
    expect(hurdleAmount(5, 2_100, 50)).toBe(1n)
  })

  it('TC-ALL-26 a fee id of "__proto__" is an ordinary fee (#2)', () => {
    const o = allocate({ ...A, fees: [{ id: '__proto__', label: 'p', kind: 'percent', value: 300, payer: 'investors' }], investors: [{ id: 'i', name: 'i', received: 10_000, scheme: 'none' }] })
    expect(o.ok && o.result.rows[0]).toMatchObject({ invested: 9_700, feesTotal: 300, refund: 0 })
    expect(o.ok && o.result.feeTotals[0].amount).toBe(300)
  })

  it('TC-ALL-27 after scale-back, people whose rounded target did not move are still checked (#3)', () => {
    const o = allocate({
      ...A,
      minimum: 100,
      cap: 297,
      fees: [{ id: 'p', label: 'p', kind: 'percent', value: 1, payer: 'investors' }],
      investors: [
        { id: 'A', name: 'A', received: 100, scheme: 'none' },
        { id: 'B', name: 'B', received: 200, scheme: 'none' },
      ],
    })
    expect(o.ok && o.result.blockers).toEqual([{ code: 'scale-back-below-minimum', names: ['A'] }])
  })

  it('TC-REC-30 a voided decision goes back to review even when an exact match exists; email and scheme edits void it (#4)', () => {
    const c = C('x', 'NW001', 10_000)
    const line: BankLine = { id: 't', txnId: 't', date: '2026-10-10', amount: 10_000, payer: 'P', reference: 'NW001' }
    const d = { t: decide(line, c) }
    const edited = rec([c], [{ ...line, amount: 9_000 }], d)
    expect(edited.ok && edited.result.lines[0]).toMatchObject({ status: 'suggested', assignedTo: null, staleDecision: true })
    expect(edited.ok && edited.checks.find((k) => k.id === 'reviewed')?.pass).toBe(false)
    for (const change of [{ email: 'new@example.com' }, { scheme: 'EIS' as const }]) {
      const r = rec([{ ...c, ...change }], [line], d)
      expect(r.ok && r.result.lines[0].staleDecision).toBe(true)
    }
  })

  it('TC-REC-31 a replace import clears every decision, even for repeated transaction IDs (#5)', () => {
    // imported lines are keyed 't:<transaction id>' (review R2-7)
    const line: BankLine = { id: 't:T1', txnId: 'T1', date: '2026-10-10', amount: 10_000, payer: 'P', reference: 'NW001' }
    const decisions = { 't:T1': decide(line, null) }
    const res = importBank('transaction_id,date,amount,payer,reference\nT1,2026-10-10,100,P,NW001\n', 'GBP', 'replace', [line])
    if (!res.ok) throw new Error('import')
    expect(decisionsAfterImport('replace', decisions, res.value.lines)).toEqual({})
    expect(decisionsAfterImport('append', decisions, res.value.lines)).toEqual(decisions)
  })

  it('TC-IO-21 a row with the wrong number of cells rejects the whole file (#6)', () => {
    const r = importBank('date,amount,payer\n2026-10-01,1,234.56,ALICE\n', 'GBP', 'replace', [])
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors[0]).toMatchObject({ where: 'row 2' })
  })

  it('TC-IO-22 commitment import applies every field rule (#7)', () => {
    const bad = [
      'name,reference,cash_due\nA,UK-NW-A-001,10\n',
      'name,reference,cash_due\nB,NW-001,10\nC,nw001,10\n',
      'name,reference,cash_due\nD,,10\n',
      `name,reference,cash_due\n${'x'.repeat(121)},NW-001,10\n`,
      'name,email,reference,cash_due\nE,bad,NW-001,10\n',
    ]
    for (const csv of bad) expect(importCommitments(csv, 'GBP').ok, csv).toBe(false)
  })

  it('TC-IO-23 engines reject invalid input at their own entry (#8)', () => {
    const line: BankLine = { id: 'l', txnId: 'l', date: '2026-10-10', amount: 10_000, payer: '', reference: '' }
    expect(rec([], [line], {}, '').ok).toBe(false)
    expect(rec([], [{ ...line, date: '2026-02-31' }]).ok).toBe(false)
    expect(rec([], [{ ...line, amount: 100_000_000_001 }]).ok).toBe(false)
    expect(allocate({ ...A, priceMicros: 1_000_000_000_001 }).ok).toBe(false)
    expect(allocate({ ...A, investors: [{ id: 'i', name: '', received: 1, scheme: 'none' }] }).ok).toBe(false)
    expect(allocate({ ...A, investors: Array.from({ length: 501 }, (_, i) => ({ id: `i${i}`, name: 'n', received: 1, scheme: 'none' as const })) }).ok).toBe(false)
    expect(distribute({ holdings: Array.from({ length: 501 }, (_, i) => ({ id: `h${i}`, name: 'n', capital: 1 })), proceeds: 1, exitCosts: 0, years100: 0, carry: { mode: 'fixed', k: 0, h: 0, c: 0 } }).ok).toBe(false)
  })

  it('TC-DIS-28 a very large tier ceiling is fine, and multiples parse without precision loss (#9)', () => {
    const o = distribute({
      holdings: [{ id: 'a', name: 'a', capital: 10_000_000_000 }],
      proceeds: 20_000_000_000,
      exitCosts: 0,
      years100: 0,
      carry: { mode: 'tiered', tiers: [{ upTo100: 1_000_000_000n, rate: 2000 }, { upTo100: null, rate: 3000 }] },
    })
    expect(o.ok && o.result).toMatchObject({ carry: 2_000_000_000, investorsTotal: 18_000_000_000 })
    const m = parseMultiple('90071992547409.93')
    expect(m.ok && m.value).toBe(9_007_199_254_740_993n)
  })

  it('TC-ALL-28 at most 20 fees; 20 extreme fees still give exact totals (#10, R2-5/R2-6)', () => {
    const investors = Array.from({ length: 500 }, (_, i) => ({ id: `i${i}`, name: 'n', received: 100_000_000_000, scheme: 'none' as const }))
    const lead = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, label: `lead fee ${i}`, kind: 'percent' as const, value: 10_000, payer: 'lead' as const }))
    const tooMany = allocate({ ...A, fees: lead(21), investors })
    expect(!tooMany.ok && tooMany.errors.map((e) => e.message)).toEqual(['at most 20 fees'])
    const max = allocate({ ...A, fees: lead(20), investors })
    expect(max.ok && max.result.totals.leadInvoice).toBe(1_000_000_000_000_000)
  })

  it('TC-REC-32 a number in one token run counts as a near reference (#11)', () => {
    const r = rec([C('c', 'NW-011', 10_000)], [{ id: 'l', txnId: 'l', date: '2026-10-10', amount: 10_000, payer: 'UNKNOWN', reference: 'XX 11 INV 4471' }])
    expect(r.ok && r.result.lines[0].status).toBe('suggested')
    expect(r.ok && r.result.lines[0].candidates[0].score).toBe(0.5)
  })

  it('TC-IO-24 append de-duplicates within the file and checks capacity after de-duplication (#14)', () => {
    const twice = importBank('transaction_id,date,amount\nT1,2026-10-06,10\nT1,2026-10-06,10\n', 'GBP', 'replace', [])
    expect(twice.ok && twice.value.lines.length).toBe(1)
    const existing: BankLine[] = Array.from({ length: 2_000 }, (_, i) => ({ id: `T${i}`, txnId: `T${i}`, date: '2026-10-06', amount: 10, payer: '', reference: '' }))
    expect(importBank('transaction_id,date,amount\nT1,2026-10-06,0.10\n', 'GBP', 'append', existing).ok).toBe(true)
  })

  it('TC-IO-25 misleading column names only matter when the required column is missing (#15)', () => {
    expect(importHoldings('name,capital,cost\nA,1,10\n', 'GBP').ok).toBe(true)
    expect(importBank('date,amount,cost\n2026-10-01,1,foo\n', 'GBP', 'replace', []).ok).toBe(true)
    const r = importHoldings('name,cost\nA,10\n', 'GBP')
    expect(!r.ok && r.errors[0].message).toMatch(/capital.*excluding fees/)
  })

  it('TC-DIS-29 hurdle or catch-up present in tiered mode is an error even when 0 (#16)', () => {
    const base = { holdings: [{ id: 'a', name: 'a', capital: 100 }], proceeds: 300, exitCosts: 0, years100: 0 }
    const tiers = [{ upTo100: null, rate: 2000 }]
    expect(distribute({ ...base, carry: { mode: 'tiered', tiers, h: 0 } }).ok).toBe(false)
    expect(distribute({ ...base, carry: { mode: 'tiered', tiers, c: 0 } }).ok).toBe(false)
    expect(distribute({ ...base, carry: { mode: 'tiered', tiers } }).ok).toBe(true)
  })

  it('TC-REC-33 candidate scores are exact fractions (#17)', () => {
    const r = rec(
      [{ ...C('a', 'NW001', 5), name: 'A B C D E F G' }, { ...C('b', 'NW002', 5), name: 'A B C D E F G' }],
      [{ id: 'l', txnId: 'l', date: '2026-10-10', amount: 5, payer: 'A X Y Z U V W', reference: '' }],
    )
    // 0.3 × 1/7 + 0.25 = 19/70 ≈ 0.271 is below the 0.3 cut-off: no candidates (the float sum would also be below)
    expect(r.ok && r.result.lines[0].candidates.map((c) => [c.commitmentId, c.score])).toEqual([])
    const r2 = rec(
      [{ ...C('a', 'NW001', 5), name: 'A B C D E F G' }, { ...C('b', 'NW002', 5), name: 'A B C D E F G' }],
      [{ id: 'l', txnId: 'l', date: '2026-10-10', amount: 5, payer: 'A B C D U V W', reference: '' }],
    )
    // 0.3 × 4/7 + 0.25 = 59/140 ≈ 0.4214 for both; tie → list order
    expect(r2.ok && r2.result.lines[0].candidates.map((c) => [c.commitmentId, c.score])).toEqual([
      ['a', 59 / 140],
      ['b', 59 / 140],
    ])
  })

  it('TC-IO-26 error rows are file lines even with blank lines (#19)', () => {
    const r = importBank('date,amount\n\n2026-10-01,abc', 'GBP', 'replace', [])
    expect(!r.ok && r.errors.map((e) => e.where)).toEqual(['row 3, amount'])
  })
})
