// PRD C-ALL-11 / C-REC-7 (Test Plan §2.5, 〔M6〕): the effective cash due and coverage, as pure functions.
import { describe, expect, it } from 'vitest'
import { effectiveDue, notCovered, type FeePayerChange } from './adjust'

const change = (over: Partial<FeePayerChange> = {}): FeePayerChange => ({
  id: 'x',
  feeId: 'f1',
  feeLabel: 'Platform fee',
  from: 'investors',
  to: 'company',
  consent: true,
  appliedAt: '2026-10-26T10:00:00+00:00',
  status: 'active',
  voidReason: null,
  feeAtApply: { rateBps: 300, basis: 'deducted' },
  settingsAtApply: { minimum: 0, cap: null, priceMicros: 1_000_000, basis: 'deducted', fees: [] },
  targets: { a: 97_000 },
  lines: [{ investorId: 'a', reference: 'NW001', baseCashDue: 100_000, newCashDue: 97_000, voided: false, voidReason: null }],
  ...over,
})

const A = { id: 'a', cashDue: 100_000, reference: 'NW-001' }
const B = { id: 'b', cashDue: 50_000, reference: 'NW-002' }

describe('effective cash due (C-ALL-11)', () => {
  it('TC-ALL-37 the adjusted amount applies only while the change is active and the list amount and reference are as applied', () => {
    expect(effectiveDue(change(), 'a', 100_000, 'NW 001').due).toBe(97_000)
    // second guard: even if a void were missed, a changed amount or reference falls back to the list
    expect(effectiveDue(change(), 'a', 105_000, 'NW-001').due).toBe(105_000)
    expect(effectiveDue(change(), 'a', 100_000, 'NW-002').due).toBe(100_000)
    expect(effectiveDue(change({ status: 'reversed' }), 'a', 100_000, 'NW-001').due).toBe(100_000)
    expect(effectiveDue(undefined, 'a', 100_000, 'NW-001').due).toBe(100_000)
  })

  it('TC-REC-53 not covered: no line or a voided line, unless withdrawn', () => {
    const voided = change({ lines: [{ ...change().lines[0], voided: true, voidReason: 'cash due changed' }] })
    expect(notCovered(change(), [A, B], {})).toEqual(['b'])
    expect(notCovered(voided, [A], {})).toEqual(['a'])
    expect(notCovered(change(), [A, B], { b: { on: '2026-10-16', consent: true, reference: 'NW002' } })).toEqual([])
    expect(notCovered(change({ status: 'reversed' }), [B], {})).toEqual([])
    // a standing line that no longer fits the list counts as not covered, as effectiveDue falls back (Codex M6 r6 #3)
    expect(notCovered(change(), [{ ...A, cashDue: 200_000 }], {})).toEqual(['a'])
    expect(notCovered(change(), [{ ...A, reference: 'NW-009' }], {})).toEqual(['a'])
  })
})
