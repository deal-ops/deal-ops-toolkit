import { describe, expect, it } from 'vitest'
import { allocate, SEIS_BEFORE_EIS_NOTE, SEIS_EIS_HINT, type AllocationInput, type AllocationResult, type Fee } from './allocation'
import { formatMicroShares, parsePercent, parsePrice } from './money'
import { closingConfirmation, allocationCsv } from './exports'
import { SAMPLE_CAP, SAMPLE_FEES, SAMPLE_PRICE_MICROS, SAMPLE_SETTINGS } from './sample'

const base: AllocationInput = { feeBasis: 'deducted', minimum: 0, cap: null, priceMicros: 1_000_000, fees: [], investors: [] }
const inv = (id: string, received: number, scheme: 'none' | 'SEIS' | 'EIS' = 'none') => ({ id, name: id, received, scheme })
const pct = (id: string, bps: number): Fee => ({ id, label: id, kind: 'percent', value: bps, payer: 'investors' })

function run(input: Partial<AllocationInput>): AllocationResult {
  const o = allocate({ ...base, ...input })
  if (!o.ok) throw new Error(JSON.stringify(o.errors))
  return o.result
}
const row = (r: AllocationResult, id: string) => r.rows.find((x) => x.id === id)!

describe('closing allocation', () => {
  it('TC-ALL-01 nominee, no fees: everything is invested', () => {
    const r = run({ investors: [inv('A', 100_000)] })
    expect(row(r, 'A')).toMatchObject({ invested: 100_000, refund: 0, participating: true })
    expect(formatMicroShares(row(r, 'A').microShares)).toBe('1000.000000')
  })

  it('TC-ALL-02 3% deducted from £10,000 → £9,700 invested, £300 fee', () => {
    const r = run({ fees: [pct('p', 300)], investors: [inv('A', 1_000_000)] })
    expect(row(r, 'A')).toMatchObject({ invested: 970_000, feesTotal: 30_000, refund: 0 })
  })

  it('TC-ALL-03 3% on top of £10,000 → £10,300 wired', () => {
    const r = run({ feeBasis: 'onTop', fees: [pct('p', 300)], investors: [inv('A', 1_030_000)] })
    expect(row(r, 'A')).toMatchObject({ invested: 1_000_000, feesTotal: 30_000, refund: 0 })
  })

  it('TC-ALL-05 S/EIS claimable whole shares at £2.4137', () => {
    const r = run({ priceMicros: 2_413_700, investors: [inv('A', 500_000, 'SEIS')] })
    const a = row(r, 'A')
    expect(a.invested).toBe(500_000)
    expect(formatMicroShares(a.microShares)).toBe('2071.508472')
    expect(a).toMatchObject({ claimableShares: 2071, claimableAmount: 499_877, nonClaimable: 123 })
  })

  it('TC-ALL-06 Isla: £1,000 at the £1,000 minimum is in, with fractional shares', () => {
    const r = run({ minimum: 100_000, priceMicros: 2_413_700, investors: [inv('Isla', 100_000)] })
    expect(row(r, 'Isla')).toMatchObject({ participating: true, invested: 100_000 })
    expect(formatMicroShares(row(r, 'Isla').microShares)).toBe('414.301694')
    expect(r.blockers).toEqual([])
  })

  it('TC-ALL-07 below the minimum: out, full refund, no fees', () => {
    const r = run({ minimum: 100_000, fees: [pct('p', 300)], investors: [inv('A', 90_000)] })
    expect(row(r, 'A')).toMatchObject({ participating: false, exclusion: 'below-minimum', refund: 90_000, feesTotal: 0 })
  })

  it('TC-ALL-08 on-top basis checks the minimum against M', () => {
    const r = run({ feeBasis: 'onTop', minimum: 100_000, fees: [pct('p', 300)], investors: [inv('A', 102_000)] })
    expect(row(r, 'A')).toMatchObject({ participating: false, exclusion: 'below-minimum', refund: 102_000 })
  })

  it('TC-ALL-09 pro-rata scale-back to the cap', () => {
    const r = run({ cap: 300_000, investors: [inv('A', 400_000), inv('B', 200_000)] })
    expect([row(r, 'A').invested, row(r, 'B').invested]).toEqual([200_000, 100_000])
    expect([row(r, 'A').refund, row(r, 'B').refund]).toEqual([200_000, 100_000])
    expect(r.scaledBack).toBe(true)
  })

  it('TC-ALL-10 scale-back below the minimum blocks the close and names who', () => {
    const r = run({ minimum: 100_000, cap: 150_000, investors: [inv('A', 100_000), inv('B', 100_000)] })
    expect(r.blockers).toEqual([{ code: 'scale-back-below-minimum', names: ['A', 'B'] }])
    expect(row(r, 'A').invested).toBe(75_000)
  })

  it('TC-ALL-11 per-investor fixed fees are charged item by item', () => {
    const fees: Fee[] = [
      { id: 'admin', label: 'admin', kind: 'perInvestor', value: 1_000, payer: 'investors' },
      { id: 'kyc', label: 'KYC', kind: 'perInvestor', value: 500, payer: 'investors' },
    ]
    const r = run({ fees, investors: [inv('A', 100_000), inv('B', 200_000)] })
    expect(row(r, 'A').fees).toEqual({ admin: 1_000, kyc: 500 })
    expect(row(r, 'B').fees).toEqual({ admin: 1_000, kyc: 500 })
    expect(r.feeTotals.map((f) => f.amount)).toEqual([2_000, 1_000])
    expect([row(r, 'A').invested, row(r, 'B').invested]).toEqual([98_500, 198_500])
  })

  it('TC-ALL-13 company-paid fees larger than the raise block the close', () => {
    const r = run({ fees: [{ id: 'c', label: 'legal', kind: 'fixed', value: 150_000, payer: 'company' }], investors: [inv('A', 100_000)] })
    expect(r.blockers.map((b) => b.code)).toEqual(['company-fees-exceed'])
  })

  it('TC-ALL-14 nobody to allocate blocks the close', () => {
    expect(run({ investors: [] }).blockers.map((b) => b.code)).toEqual(['no-participants'])
    expect(run({ minimum: 100_000, investors: [inv('A', 50_000)] }).blockers.map((b) => b.code)).toEqual(['no-participants'])
  })

  it('TC-ALL-15 company fee comes off the wire, lead fee is invoiced', () => {
    const r = run({
      fees: [
        { id: 'c', label: 'legal', kind: 'fixed', value: 150_000, payer: 'company' },
        { id: 'l', label: 'platform', kind: 'percent', value: 200, payer: 'lead' },
      ],
      investors: [inv('A', 1_000_000)],
    })
    expect(r.totals).toMatchObject({ wire: 850_000, leadInvoice: 20_000 })
    expect(row(r, 'A').refund).toBe(0)
  })

  it('TC-ALL-17 refund is never negative across every penny £10.00–£13.99', () => {
    for (let received = 1_000; received < 1_400; received++) {
      const r = run({ priceMicros: 333_333, fees: [pct('p', 350)], investors: [inv('A', received)] })
      const a = row(r, 'A')
      expect(a.refund).toBeGreaterThanOrEqual(0)
      expect(a.invested + a.feesTotal + a.refund).toBe(received)
    }
  })

  it('TC-ALL-18 groups by tax scheme and states the SEIS-before-EIS rule', () => {
    const r = run({ investors: [inv('A', 100_000, 'SEIS'), inv('B', 100_000, 'EIS'), inv('C', 100_000)] })
    for (const s of ['SEIS', 'EIS', 'none'] as const) expect(r.byScheme[s]).toMatchObject({ investors: 1, invested: 100_000 })
    expect(SEIS_BEFORE_EIS_NOTE).toMatch(/earlier day/)
  })

  it('TC-ALL-19 invalid inputs give no result', () => {
    expect(parsePrice('abc', 'GBP').ok).toBe(false)
    expect(parsePercent('120%').ok).toBe(false)
    expect(allocate({ ...base, investors: [inv('A', -1)] }).ok).toBe(false)
    expect(allocate({ ...base, fees: [{ id: 'x', label: 'x', kind: 'fixed', value: 100, payer: 'investors' }], investors: [inv('A', 100)] }).ok).toBe(false)
    expect(allocate({ ...base, fees: [pct('p', 12_000)], investors: [inv('A', 100)] }).ok).toBe(false)
  })

  it('TC-ALL-20 closing confirmation and CSV agree with the result', () => {
    const r = run({ ...sampleAllocInput() })
    const text = closingConfirmation(SAMPLE_SETTINGS.name, 'GBP', SAMPLE_PRICE_MICROS, r)
    for (const line of [
      'Cash received: £103,500.00',
      'Total invested: £100,395.00',
      'Platform fee (paid by investors): £3,105.00',
      'Legal & admin (paid by company): £1,500.00',
      'Refunds: £0.00',
      'Wire to company: £98,895.00',
      '- Amelia Hart: invests £9,700.00, fees £300.00, refund £0.00',
      '- James Whitfield: not in this close, refund £0.00',
    ])
      expect(text).toContain(line)
    const csvRows = allocationCsv(r).split(/\r?\n/)
    expect(csvRows).toHaveLength(13)
    expect(csvRows[1]).toBe('c01,Amelia Hart,SEIS,10000.00,9700.00,4018.726436,300.00,300.00,0.00,4018,9698.24,allocated')
    const header = allocationCsv(r).split(/\r?\n/)[0]
    expect(header).toBe(
      'investor_id,name,scheme,received,invested,units,fee_Platform fee,fees_total,refund,seis_eis_claimable_shares,seis_eis_claimable_amount,status',
    )
  })

  it('TC-ALL-21 fixed fees that use up the receipt: out, no fee', () => {
    const r = run({ fees: [{ id: 'f', label: 'f', kind: 'perInvestor', value: 1_000, payer: 'investors' }], investors: [inv('A', 1_000), inv('B', 10_000)] })
    expect(row(r, 'A')).toMatchObject({ participating: false, refund: 1_000, feesTotal: 0 })
    expect(row(r, 'B')).toMatchObject({ invested: 9_000, feesTotal: 1_000, refund: 0 })
  })

  it('TC-ALL-22 rounding five fees can need two retries', () => {
    const fees = [1, 2, 3, 4, 5].map((i) => pct(`f${i}`, 100))
    const r = run({ priceMicros: 10_000, fees, investors: [inv('A', 53)] })
    expect(row(r, 'A')).toMatchObject({ invested: 48, feesTotal: 5, refund: 0 })
    expect(Object.values(row(r, 'A').fees)).toEqual([1, 1, 1, 1, 1])
  })

  it('TC-ALL-23 scheme groups add up to the totals', () => {
    const r = run(sampleAllocInput())
    const g = Object.values(r.byScheme)
    expect(g.reduce((a, b) => a + b.invested, 0)).toBe(r.totals.invested)
    expect(g.reduce((a, b) => a + b.investors, 0)).toBe(r.rows.filter((x) => x.participating).length)
    expect(g.reduce((a, b) => a + b.microShares, 0n)).toBe(r.rows.reduce((a, b) => a + b.microShares, 0n))
  })

  it('TC-ALL-25 the S/EIS remainder warning uses the agreed wording', () => {
    const o = allocate({ ...base, priceMicros: 2_413_700, investors: [inv('A', 500_000, 'SEIS')] })
    // copied from PRD C-ALL-8, not from the code
    const prd =
      'This estimate uses whole shares in the final allocation. Fees, scale-back and rounding can leave a remainder even when the wire is a multiple of the share price. Check the final allocated share count.'
    expect(o.ok && o.checks.find((c) => c.kind === 'warning')?.detail).toBe(prd)
    expect(SEIS_EIS_HINT).toBe(prd)
  })
})

export function sampleAllocInput(): AllocationInput {
  const received: [string, string, number, 'none' | 'SEIS' | 'EIS'][] = [
    ['c01', 'Amelia Hart', 1_000_000, 'SEIS'],
    ['c02', 'Ben Okafor', 500_000, 'EIS'],
    ['c03', 'Chloe Martin', 2_000_000, 'none'],
    ['c04', 'David Kim', 200_000, 'SEIS'],
    ['c05', 'Elena Rossi', 1_500_000, 'EIS'],
    ['c06', 'Farhan Malik', 1_000_000, 'EIS'],
    ['c07', 'Grace Liu', 2_500_000, 'none'],
    ['c08', 'Hugo Bernard', 500_000, 'SEIS'],
    ['c09', 'Isla Campbell', 100_000, 'none'],
    ['c10', 'James Whitfield', 0, 'EIS'],
    ['c11', 'Kavya Iyer', 750_000, 'SEIS'],
    ['c12', 'Lucas Meyer', 300_000, 'none'],
  ]
  return {
    feeBasis: 'deducted',
    minimum: SAMPLE_SETTINGS.minimum,
    cap: SAMPLE_CAP,
    priceMicros: SAMPLE_PRICE_MICROS,
    fees: SAMPLE_FEES,
    investors: received.map(([id, name, r, scheme]) => ({ id, name, received: r, scheme })),
  }
}
