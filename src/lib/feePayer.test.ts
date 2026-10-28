// PRD C-ALL-10 (Test Plan §2.5, 〔M6〕): changing who pays a percentage fee — the hand calculations, the search for the
// new cash due, and the step-3 blockers.
import { describe, expect, it } from 'vitest'
import { allocate, type Fee } from './allocation'
import { applyLabel, lowerBound, minimalCashDue, previewFeePayerChange, type FeePayerInput } from './feePayer'
import { SAMPLE_CAP, SAMPLE_COMMITMENTS, SAMPLE_FEES, SAMPLE_PRICE_MICROS } from './sample'

const pct = (id: string, value: number, payer: Fee['payer']): Fee => ({ id, label: id, kind: 'percent', value, payer })
const one = (cashDue: number, over: Partial<FeePayerInput> = {}): FeePayerInput => ({
  feeBasis: 'deducted',
  minimum: 0,
  cap: null,
  priceMicros: 1_000_000,
  fees: [pct('f', 300, 'investors')],
  feeId: 'f',
  to: 'company',
  investors: [{ id: 'a', name: 'A', cashDue, scheme: 'none' }],
  ...over,
})
function ok(x: FeePayerInput) {
  const o = previewFeePayerChange(x)
  if (!o.ok) throw new Error(JSON.stringify(o.errors))
  return o.result
}

describe('C-ALL-10 hand calculations', () => {
  it('TC-ALL-31 investors → company: T £970.00, N £970.00, −£30.00; the fee £30.00 before, £29.10 after', () => {
    const p = ok(one(100_000))
    expect(p.rows[0]).toMatchObject({ target: 97_000, newDue: 97_000, difference: -3_000, participatingAfter: true, investedAfter: 97_000 })
    expect([p.feeBefore, p.feeAfter]).toEqual([3_000, 2_910])
    expect(p.canApply).toBe(true)
  })

  it('TC-ALL-32 company → investors: T £1,000.00, N £1,030.93 (£1,030.92 invests £999.99), +£30.93; fee £30.93, refund £0.00', () => {
    const p = ok(one(100_000, { fees: [pct('f', 300, 'company')], to: 'investors' }))
    expect(p.rows[0]).toMatchObject({ target: 100_000, newDue: 103_093, difference: 3_093 })
    const at = (R: number) => {
      const o = allocate({ feeBasis: 'deducted', minimum: 0, cap: null, priceMicros: 1_000_000, fees: [pct('f', 300, 'investors')], investors: [{ id: 'a', name: 'A', received: R, scheme: 'none' }] })
      if (!o.ok) throw new Error('alloc')
      return o.result.rows[0]
    }
    expect(at(103_093)).toMatchObject({ invested: 100_000, feesTotal: 3_093, refund: 0 })
    expect(at(103_092).invested).toBe(99_999)
  })

  it('TC-ALL-33 minimum £1,000: step 3 names the investor "would fall below the minimum commitment" and has nobody to allocate', () => {
    const p = ok(one(100_000, { minimum: 100_000 }))
    expect(p.canApply).toBe(false)
    expect(p.blockers.map((b) => [b.code, b.investorId])).toEqual([
      ['after-no-participants', null],
      ['would-fall-below-minimum', 'a'],
    ])
    expect(p.blockers.find((b) => b.code === 'would-fall-below-minimum')!.text).toBe('A would fall below the minimum commitment')
  })

  it('TC-ALL-34 fee on top, and a per-investor fee beside a percentage', () => {
    const onTop = ok(one(100_000, { feeBasis: 'onTop', fees: [pct('f', 300, 'company')], to: 'investors' }))
    expect(onTop.rows[0]).toMatchObject({ target: 100_000, newDue: 103_000, difference: 3_000 })
    const fixed = ok(
      one(102_500, { fees: [{ id: 'flat', label: 'flat', kind: 'perInvestor', value: 2_500, payer: 'investors' }, pct('f', 200, 'investors')] }),
    )
    expect(fixed.rows[0]).toMatchObject({ target: 98_000, newDue: 100_500, difference: -2_000 })
  })
})

const sample = (over: Partial<FeePayerInput> = {}): FeePayerInput => ({
  feeBasis: 'deducted',
  minimum: 100_000,
  cap: SAMPLE_CAP,
  priceMicros: SAMPLE_PRICE_MICROS,
  fees: SAMPLE_FEES,
  feeId: 'f1',
  to: 'company',
  investors: SAMPLE_COMMITMENTS.map((c) => ({ id: c.id, name: c.name, cashDue: c.cashDue, scheme: c.scheme, reference: c.reference })),
  ...over,
})

describe('C-ALL-10 on the sample', () => {
  it('TC-ALL-35 platform fee to the company: Isla blocks at £1,000; at £970 every N = 97%, £124,000.00 → £120,280.00', () => {
    const blockedP = ok(sample())
    expect(blockedP.canApply).toBe(false)
    expect(blockedP.blockers.map((b) => [b.code, b.investorId])).toEqual([['would-fall-below-minimum', 'c09']])
    expect(blockedP.rows.find((r) => r.id === 'c09')!.newDue).toBe(97_000)
    const p = ok(sample({ minimum: 97_000 }))
    expect(p.canApply).toBe(true)
    for (const r of p.rows) expect(r.newDue).toBe((r.currentDue * 97) / 100)
    expect([p.totals.currentDue, p.totals.newDue, p.totals.difference]).toEqual([12_400_000, 12_028_000, -372_000])
    expect(p.feeAfter).toBe(360_840)
    expect(applyLabel(p, 'GBP')).toBe('Apply: 0 top-ups totalling £0.00 · 12 refunds totalling £3,720.00')
  })

  it('TC-ALL-41 cap £80,000: the round is over the cap, plus scale-back below the minimum (Isla); no differences', () => {
    const p = ok(sample({ cap: 8_000_000 }))
    expect(p.computed).toBe(false)
    expect(p.canApply).toBe(false)
    const codes = p.blockers.map((b) => b.code)
    expect(codes).toContain('over-cap')
    expect(p.blockers.find((b) => b.code === 'over-cap')!.text).toBe('The round is over the cap — resolve the scale-back first')
    expect(p.blockers.filter((b) => b.code === 'before-scale-back-below-minimum').map((b) => b.investorId)).toContain('c09')
    expect(p.rows.every((r) => r.difference === 0 && r.target === null)).toBe(true)
  })
})

describe('C-ALL-10 step 3', () => {
  it('TC-ALL-40 fee on top, minimum £1,000: A (out before, M = £970.87) would join once the fee leaves investors', () => {
    const p = ok({
      ...one(100_000, { feeBasis: 'onTop', minimum: 100_000 }),
      investors: [
        { id: 'A', name: 'A', cashDue: 100_000, scheme: 'none' },
        { id: 'B', name: 'B', cashDue: 200_000, scheme: 'none' },
      ],
    })
    expect(p.rows.find((r) => r.id === 'A')).toMatchObject({ participatingBefore: false, unchanged: true, newDue: 100_000 })
    expect(p.blockers.map((b) => [b.code, b.investorId])).toEqual([['would-join', 'A']])
    expect(p.blockers[0].text).toBe('A would join the allocation')
  })

  it('TC-ALL-44 minimum £970: B (£500) is not participating and stays unchanged; A gets £970.00; it can apply', () => {
    const p = ok({
      ...one(100_000, { minimum: 97_000 }),
      investors: [
        { id: 'A', name: 'A', cashDue: 100_000, scheme: 'none' },
        { id: 'B', name: 'B', cashDue: 50_000, scheme: 'none' },
      ],
    })
    expect(p.canApply).toBe(true)
    expect(p.rows.map((r) => [r.id, r.unchanged, r.newDue])).toEqual([
      ['A', false, 97_000],
      ['B', true, 50_000],
    ])
  })

  it('TC-ALL-49 company fees would exceed the amount raised (−£19.10 wire): blocked even though N = I = T = £970.00', () => {
    const p = ok(one(100_000, { fees: [pct('f', 300, 'investors'), { id: 'legal', label: 'legal', kind: 'fixed', value: 96_000, payer: 'company' }] }))
    expect(p.rows[0]).toMatchObject({ target: 97_000, newDue: 97_000, investedAfter: 97_000 })
    expect(p.blockers.map((b) => b.code)).toEqual(['after-company-fees-exceed'])
    expect(p.canApply).toBe(false)
  })

  it('TC-ALL-38 a fixed fee cannot be chosen; investors paying 60% + 40% deducted is an input error', () => {
    const fixed = previewFeePayerChange(one(100_000, { fees: [{ id: 'f', label: 'f', kind: 'fixed', value: 100, payer: 'company' }], to: 'investors' }))
    expect(fixed.ok).toBe(false)
    const full = previewFeePayerChange(one(100_000, { fees: [pct('a', 6_000, 'investors'), pct('f', 4_000, 'company')], to: 'investors' }))
    expect(full.ok).toBe(false)
    if (!full.ok) expect(full.errors.map((e) => e.message).join(' ')).toMatch(/less than 100%/)
  })

  it('C-ALL-10 a new cash due above the 1,000,000,000 limit is an input error naming the investor', () => {
    const o = previewFeePayerChange(one(99_999_000_000, { fees: [pct('f', 300, 'company')], to: 'investors' }))
    expect(o.ok).toBe(false)
    if (!o.ok) expect(o.errors[0].where).toBe('Fee payer change, A')
  })
})

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('C-ALL-10 step 2 search', () => {
  it('TC-ALL-32 the lower bound rounds up: ⌈1,000.00 ÷ 0.97⌉ = £1,030.93, ⌈1,000.00 × 1.03⌉ = £1,030.00, plus per-investor fees', () => {
    expect(lowerBound(100_000, [pct('f', 300, 'investors')], 'deducted')).toBe(103_093)
    expect(lowerBound(100_001, [pct('f', 300, 'investors')], 'onTop')).toBe(103_002) // 103,001.03 → 103,002
    expect(lowerBound(98_000, [pct('f', 0, 'investors'), { id: 'x', label: 'x', kind: 'perInvestor', value: 2_500, payer: 'investors' }], 'deducted')).toBe(100_500)
  })

  it('TC-ALL-43 3,000 random inputs: I(N) = T and one penny less invests under T', () => {
    const r = rng(20261026)
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
    const bad: string[] = []
    for (let i = 0; i < 3_000; i++) {
      const basis = r() < 0.5 ? 'deducted' : 'onTop'
      const fees: Fee[] = Array.from({ length: int(1, 5) }, (_, k) => pct(`p${k}`, int(0, 1_800), 'investors'))
      if (r() < 0.5) fees.push({ id: 'flat', label: 'flat', kind: 'perInvestor', value: int(1, 5_000), payer: 'investors' })
      const T = int(1, 5_000_000)
      const n = minimalCashDue(T, fees, basis, 1_000_000)
      const I = (R: number) => {
        const o = allocate({ feeBasis: basis, minimum: 0, cap: null, priceMicros: 1_000_000, fees, investors: [{ id: 'x', name: 'x', received: R, scheme: 'none' }] })
        return o.ok ? o.result.rows[0].invested : NaN
      }
      if (!n.ok || I(n.value) !== T || I(n.value - 1) >= T) bad.push(JSON.stringify({ basis, fees, T, n }))
    }
    expect(bad.slice(0, 3)).toEqual([])
  })
})
