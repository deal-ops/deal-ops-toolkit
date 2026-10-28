import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import {
  AGED_NOTE,
  decide,
  handoffToAllocation,
  nameSimilarity,
  pruneDecisions,
  reconcile,
  type BankLine,
  type Commitment,
  type Decisions,
  type ReconcileResult,
} from './reconcile'
import { importBank } from './csv'
import { allocate } from './allocation'
import { chaseListCsv, ledgerCsv } from './exports'
import { SAMPLE_BANK, SAMPLE_COMMITMENTS } from './sample'

const C = (id: string, name: string, reference: string, cashDue: number): Commitment => ({ id, name, email: '', reference, cashDue, scheme: 'none' })
const base: Commitment[] = [
  C('john', 'John Smith', 'NW-001', 500_000),
  C('priya', 'Priya Shah', 'NW-002', 1_000_000),
  C('tom', 'Tom Okafor', 'NW-003', 250_000),
  C('ana', 'Ana Lima', 'NW-010', 100_000),
]
let n = 0
const L = (amount: number, payer: string, reference: string, date = '2026-10-10', txnId: string | null = `x${n++}`): BankLine => ({
  id: txnId ?? `gen${n++}`,
  txnId,
  date,
  amount,
  payer,
  reference,
})

function run(lines: BankLine[], decisions: Decisions = {}, commitments = base, asOf = '2026-10-12', thresholdDays = 10): ReconcileResult {
  const o = reconcile({ commitments, lines, decisions, asOf, thresholdDays })
  if (!o.ok) throw new Error(JSON.stringify(o.errors))
  return o.result
}
const line = (r: ReconcileResult, i = 0) => r.lines[i]
const status = (r: ReconcileResult, id: string) => r.commitments.find((c) => c.commitment.id === id)!

describe('reconciliation', () => {
  it('TC-REC-01 reference variants all auto-book', () => {
    for (const ref of ['NW-001', 'nw 001', 'NW001 SPV']) expect(line(run([L(500_000, 'J SMITH', ref)]))).toMatchObject({ status: 'auto', assignedTo: 'john' })
  })

  it('TC-REC-02 a reference inside a longer number is not a match', () => {
    expect(line(run([L(500_000, 'SOMEONE', 'NW-0019')])).status).not.toBe('auto')
  })

  it('TC-REC-03 NW-010 books to Ana, not John', () => {
    expect(line(run([L(100_000, 'A LIMA', 'NW-010')])).assignedTo).toBe('ana')
  })

  it('TC-REC-04 two references in one line: suggest, do not book', () => {
    const l = line(run([L(500_000, 'X', 'NW-001 NW-002')]))
    expect(l.status).toBe('suggested')
    expect(l.assignedTo).toBeNull()
  })

  it('TC-REC-05 no reference: suggestion only, nothing booked', () => {
    const r = run([L(1_000_000, 'PRIYA SHAH', '')])
    expect(line(r).status).toBe('suggested')
    expect(line(r).candidates[0]).toMatchObject({ commitmentId: 'priya', score: 0.55 })
    expect(status(r, 'priya').status).toBe('outstanding')
  })

  it('TC-REC-06 confirming the suggestion books it', () => {
    const l = L(1_000_000, 'PRIYA SHAH', '')
    const r = run([l], { [l.id]: decide(l, base[1]) })
    expect(line(r).status).toBe('confirmed')
    expect(status(r, 'priya').status).toBe('paid')
  })

  it('TC-REC-07 a person can assign to anyone, not just a candidate', () => {
    const l = L(1_000_000, 'PRIYA SHAH', '')
    const r = run([l], { [l.id]: decide(l, base[2]) })
    expect(status(r, 'tom')).toMatchObject({ status: 'overpaid', difference: 750_000 })
  })

  it('TC-REC-08 reject, then undo', () => {
    const l = L(1_000_000, 'PRIYA SHAH', '')
    expect(line(run([l], { [l.id]: decide(l, null) })).status).toBe('rejected')
    expect(line(run([l], {})).status).toBe('suggested')
  })

  it('TC-REC-09 editing the line voids the decision', () => {
    const l = L(1_000_000, 'PRIYA SHAH', '')
    const d = { [l.id]: decide(l, base[1]) }
    const r = run([{ ...l, amount: 900_000 }], d)
    expect(line(r).status).toBe('suggested')
    expect(line(r).staleDecision).toBe(true)
  })

  it('TC-REC-10 deleting the investor voids the decision', () => {
    const l = L(1_000_000, 'PRIYA SHAH', '')
    const r = run([l], { [l.id]: decide(l, base[1]) }, base.filter((c) => c.id !== 'priya'))
    expect(line(r).staleDecision).toBe(true)
    expect(line(r).assignedTo).toBeNull()
  })

  it('TC-REC-11 amount alone is not enough to suggest', () => {
    const l = line(run([L(100_000, 'UNKNOWN', '')]))
    expect(l.status).toBe('unmatched')
    expect(l.candidates).toEqual([])
  })

  it('TC-REC-12 name similarity', () => {
    expect(nameSimilarity('J SMITH', 'John Smith')).toBe(1)
    expect(nameSimilarity('MR JOHN SMITH', 'John Smith')).toBe(1)
    expect(nameSimilarity('Okafor Holdings Ltd', 'Tom Okafor')).toBe(0.5)
  })

  it('TC-REC-13 partial reference by number + name + amount', () => {
    const l = line(run([L(250_000, 'T OKAFOR', 'NW 3')]))
    expect(l.status).toBe('suggested')
    expect(l.candidates[0]).toMatchObject({ commitmentId: 'tom', score: 0.8 })
  })

  it('TC-REC-14 short payment and a genuine double payment', () => {
    const r = run([L(200_000, 'T OKAFOR', 'NW-003'), L(500_000, 'J SMITH', 'NW001', '2026-10-09', 'a'), L(500_000, 'J SMITH', 'NW001', '2026-10-10', 'b')])
    expect(status(r, 'tom')).toMatchObject({ status: 'partial', difference: -50_000 })
    expect(status(r, 'john')).toMatchObject({ status: 'overpaid', difference: 500_000 })
  })

  it('TC-REC-15 appending the same statement does not double count', () => {
    const csv = 'transaction_id,date,amount,payer,reference\nT1,2026-10-06,5000,J SMITH,NW-001\n'
    const first = importBank(csv, 'GBP', 'replace', [])
    if (!first.ok) throw new Error('import failed')
    const again = importBank(csv, 'GBP', 'append', first.value.lines)
    expect(again.ok && again.value.lines.length).toBe(1)
    expect(again.ok && again.ignoredDuplicates).toBe(1)
  })

  it('TC-REC-16 identical rows without IDs are flagged, not booked, not deleted', () => {
    const r = run([L(500_000, 'J SMITH', 'NW-001', '2026-10-10', null), L(500_000, 'J SMITH', 'NW-001', '2026-10-10', null)])
    expect(r.lines).toHaveLength(2)
    for (const l of r.lines) {
      expect(l.suspectedDuplicate).toBe(true)
      expect(l.status).not.toBe('auto')
    }
  })

  it('TC-REC-17 outgoing, zero and future-dated lines are listed, not reconciled', () => {
    const r = run([L(-4_500, 'BANK CHARGE', 'FEE'), L(0, 'BANK', 'ZERO'), L(500_000, 'J SMITH', 'NW-001', '2026-10-13')])
    expect(r.lines.map((l) => l.status)).toEqual(['skipped', 'skipped', 'future'])
    expect(r.totals.bank).toBe(0)
  })

  it('TC-REC-18 aged after more than 10 days (9 / 10 / 11)', () => {
    const r = run([L(1, 'X', '', '2026-10-03'), L(1, 'Y', '', '2026-10-02'), L(1, 'Z', '', '2026-10-01')])
    expect(r.lines.map((l) => l.aged)).toEqual([false, false, true])
  })

  it('TC-REC-19 ledger ties; pending suggestions keep the review check open', () => {
    const o = reconcile({ commitments: base, lines: [L(500_000, 'J SMITH', 'NW-001'), L(1_000_000, 'PRIYA SHAH', ''), L(7, 'Q', '')], decisions: {}, asOf: '2026-10-12', thresholdDays: 10 })
    if (!o.ok) throw new Error('failed')
    expect(o.result.totals.booked + o.result.totals.unbooked).toBe(o.result.totals.bank)
    expect(o.checks.find((c) => c.id === 'reviewed')).toMatchObject({ kind: 'review', pass: false })
  })

  it('TC-REC-20 the same reference twice is an input error naming both rows', () => {
    const o = reconcile({ commitments: [C('a', 'A', 'NW-001', 1), C('b', 'B', 'nw001', 1)], lines: [], decisions: {}, asOf: '2026-10-12', thresholdDays: 10 })
    expect(o.ok).toBe(false)
    expect(!o.ok && o.errors[0]).toMatchObject({ where: 'commitments row 2, reference', message: 'same reference as commitments row 1' })
  })

  it('TC-REC-21 overpayment stays behind as a refund when handing off', () => {
    const r = run([L(500_000, 'J SMITH', 'NW-001', '2026-10-09', 'a'), L(500_000, 'J SMITH', 'NW-001', '2026-10-10', 'b')])
    const h = handoffToAllocation(r)
    expect(h.ok && h.value.investors.find((x) => x.id === 'john')?.received).toBe(500_000)
    expect(h.ok && h.value.excess).toEqual([{ id: 'john', name: 'John Smith', amount: 500_000, reason: 'Over-paid' }])
  })

  it('TC-REC-22 ledger and chase-list exports', () => {
    const r = run([L(500_000, 'J SMITH', 'NW-001')])
    expect(ledgerCsv(r, 'GBP').split(/\r?\n/)[0]).toBe('transaction_id,date,amount,payer,reference,status,investor_id,investor_name,decided_by,withdrawn_on,currency')
    expect(ledgerCsv(r, 'GBP').split(/\r?\n/)[1]).toMatch(/,5000\.00,J SMITH,NW-001,auto,john,John Smith,auto,,GBP$/)
    expect(chaseListCsv(r, 'GBP', 'Deal').split(/\r?\n/)[0]).toBe(
      'investor_id,name,email,committed,received,difference,status,committed_original,committed_adjustment,message,currency',
    )
  })

  it('TC-REC-23 on-top fees: cash due includes the fee and flows through to £10,000 invested', () => {
    const r = run([L(1_030_000, 'PRIYA SHAH', 'NW-002')], {}, [C('priya', 'Priya Shah', 'NW-002', 1_030_000)])
    expect(status(r, 'priya').status).toBe('paid')
    const h = handoffToAllocation(r)
    if (!h.ok) throw new Error(h.reason)
    expect(h.value.investors[0].received).toBe(1_030_000)
    const a = allocate({ feeBasis: 'onTop', minimum: 0, cap: null, priceMicros: 1_000_000, fees: [{ id: 'p', label: 'p', kind: 'percent', value: 300, payer: 'investors' }], investors: h.value.investors })
    expect(a.ok && a.result.rows[0]).toMatchObject({ invested: 1_000_000, feesTotal: 30_000, refund: 0 })
  })

  it('TC-REC-24 a replace import drops old lines and their decisions', () => {
    const old = L(1_000_000, 'PRIYA SHAH', '')
    const decisions = { [old.id]: decide(old, base[1]) }
    const res = importBank('transaction_id,date,amount,payer,reference\nN1,2026-10-11,100,X,Y\n', 'GBP', 'replace', [old])
    if (!res.ok) throw new Error('import failed')
    expect(res.value.lines.map((l) => l.id)).toEqual(['t:N1'])
    expect(pruneDecisions(decisions, res.value.lines)).toEqual({})
  })

  it('TC-REC-25 at most three candidates, ties in list order, with reasons', () => {
    const smiths = ['s1', 's2', 's3', 's4'].map((id, i) => C(id, 'John Smith', `JS-00${i + 1}`, 100_000 + i))
    const l = line(run([L(1, 'J SMITH', '')], {}, smiths))
    expect(l.candidates.map((c) => [c.commitmentId, c.score, c.reasons])).toEqual([
      ['s1', 0.3, ['payer name matches']],
      ['s2', 0.3, ['payer name matches']],
      ['s3', 0.3, ['payer name matches']],
    ])
  })

  it('TC-REC-26 threshold is configurable and the wording is a reminder', () => {
    const r = run([L(1, 'X', '', '2026-10-07'), L(1, 'Y', '', '2026-10-06')], {}, base, '2026-10-12', 5)
    expect(r.lines.map((l) => l.aged)).toEqual([false, true])
    expect(AGED_NOTE).toMatch(/Operational reminder, not a regulatory deadline/)
  })

  it('TC-REC-27 the chase list holds only short and unpaid investors', () => {
    const r = run(SAMPLE_BANK, {}, SAMPLE_COMMITMENTS, '2026-10-16')
    // the message column holds line breaks, so the file is read as CSV, not split by line
    const names = Papa.parse<string[]>(chaseListCsv(r, 'GBP', 'Deal'), { skipEmptyLines: true }).data.slice(1).map((row) => row[1])
    expect(names).toEqual(['Chloe Martin', 'David Kim', 'Elena Rossi', 'James Whitfield', 'Kavya Iyer'])
  })

  it('TC-REC-28 maximum one-to-one name matching', () => {
    expect(nameSimilarity('J JOHN', 'JOHN JAMES')).toBe(1)
  })

  it('TC-REC-29 cannot hand off while a suggestion is pending', () => {
    const h = handoffToAllocation(run([L(1_000_000, 'PRIYA SHAH', '')]))
    expect(h.ok).toBe(false)
  })
})
