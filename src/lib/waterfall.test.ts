import { describe, expect, it } from 'vitest'
import { distribute, type CarryTerms, type WaterfallInput, type WaterfallResult } from './waterfall'
import { allocate } from './allocation'
import { holdingsFromAllocation, isStale } from './snapshot'
import { distributionCsv, holdingsCsv, sharesDisplay } from './exports'
import { importHoldings } from './csv'

// Defaults (Test Plan §2.4): fixed, k 20%, h 0, c 0, costs 0, n 5; A £60,000, B £40,000.
const fixed = (k = 2000, h = 0, c = 0): CarryTerms => ({ mode: 'fixed', k, h, c })
const base: WaterfallInput = {
  holdings: [
    { id: 'A', name: 'A', capital: 6_000_000 },
    { id: 'B', name: 'B', capital: 4_000_000 },
  ],
  proceeds: 30_000_000,
  exitCosts: 0,
  years100: 500,
  carry: fixed(),
}
function run(input: Partial<WaterfallInput>): WaterfallResult {
  const o = distribute({ ...base, ...input })
  if (!o.ok) throw new Error(JSON.stringify(o.errors))
  return o.result
}
const dist = (r: WaterfallResult) => r.rows.map((x) => x.distribution)
const tiers3x = { mode: 'tiered' as const, tiers: [{ upTo100: 300n, rate: 2000 }, { upTo100: null, rate: 3000 }] }

describe('exit distribution', () => {
  it('TC-DIS-01 20% carry on a 3x', () => {
    const r = run({})
    expect(r.carry).toBe(4_000_000)
    expect(dist(r)).toEqual([15_600_000, 10_400_000])
  })

  it('TC-DIS-02 capital not returned: no carry, loss is not an error', () => {
    const r = run({ proceeds: 8_000_000 })
    expect(r.carry).toBe(0)
    expect(r.investorsTotal).toBe(8_000_000)
  })

  it('TC-DIS-03 exit costs come off the top', () => {
    expect(run({ exitCosts: 1_000_000 }).carry).toBe(3_800_000)
  })

  it('TC-DIS-04 8% hurdle, 5 years, full catch-up', () => {
    const r = run({ carry: fixed(2000, 800, 10_000) })
    expect(r.hurdlePaid).toBe(4_693_281)
    expect(r.catchUpTranche).toBe(1_173_320)
    expect(r.catchUpToLead).toBe(1_173_320)
    expect(r.carry).toBe(4_000_000)
  })

  it('TC-DIS-05 hurdle without catch-up', () => {
    expect(run({ carry: fixed(2000, 800, 0) }).carry).toBe(3_061_344)
  })

  it('TC-DIS-06 50% catch-up, fully funded', () => {
    const r = run({ carry: fixed(2000, 800, 5000) })
    expect(r.catchUpTranche).toBe(3_128_854)
    expect(r.catchUpToLead).toBe(1_564_427)
    expect(r.carry).toBe(4_000_000)
  })

  it('TC-DIS-07 profit inside the hurdle: no carry', () => {
    expect(run({ proceeds: 14_000_000, carry: fixed(2000, 800, 10_000) }).carry).toBe(0)
  })

  it('TC-DIS-08 fractional years', () => {
    const r = run({ years100: 250, carry: fixed(2000, 800, 0) })
    expect(r.hurdlePaid).toBe(2_121_584)
    expect(r.carry).toBe(3_575_683)
  })

  it('TC-DIS-09 tiered: 20% to 3x, 30% above', () => {
    expect(run({ proceeds: 50_000_000, carry: tiers3x }).carry).toBe(10_000_000)
  })

  it('TC-DIS-10 tiered boundary with exit costs', () => {
    expect(run({ proceeds: 31_000_000, exitCosts: 1_000_000, carry: tiers3x }).carry).toBe(4_000_000)
    expect(run({ proceeds: 31_001_000, exitCosts: 1_000_000, carry: tiers3x }).carry).toBe(4_000_300)
  })

  it('TC-DIS-12 pennies split by largest remainder, ties to the earlier row', () => {
    const r = run({
      holdings: ['A', 'B', 'C'].map((id) => ({ id, name: id, capital: 1 })),
      proceeds: 100,
      carry: fixed(0),
    })
    expect(dist(r)).toEqual([34, 33, 33])
  })

  it('TC-DIS-13 exit costs above proceeds: blocked, shortfall shown', () => {
    const o = distribute({ ...base, proceeds: 100, exitCosts: 200 })
    expect(o.ok && o.result.shortfall).toBe(100)
    expect(o.ok && o.checks.some((c) => c.kind === 'blocker' && !c.pass)).toBe(true)
    expect(o.ok && dist(o.result)).toEqual([0, 0])
  })

  it('TC-DIS-14 invalid terms give no result', () => {
    expect(distribute({ ...base, holdings: [] }).ok).toBe(false)
    expect(distribute({ ...base, carry: fixed(2000, 0, 5000) }).ok).toBe(false)
    expect(distribute({ ...base, carry: fixed(2000, 800, 2000) }).ok).toBe(false)
    expect(distribute({ ...base, carry: { mode: 'tiered', tiers: [{ upTo100: 300n, rate: 2000 }, { upTo100: 200n, rate: 3000 }, { upTo100: null, rate: 3000 }] } }).ok).toBe(false)
  })

  it('TC-DIS-15 distribution CSV columns, rows and totals', () => {
    const lines = distributionCsv(run({}), null).split(/\r?\n/)
    expect(lines).toEqual([
      'investor_id,name,capital,shares_display,distribution,profit,multiple_excl_entry_fees',
      'A,A,60000.00,—,156000.00,96000.00,2.60',
      'B,B,40000.00,—,104000.00,64000.00,2.60',
    ])
  })

  it('TC-DIS-16 catch-up runs out of cash', () => {
    const r = run({ proceeds: 16_000_000, carry: fixed(2000, 800, 5000) })
    expect(r.catchUpTranche).toBe(1_306_719)
    expect(r.catchUpToLead).toBe(653_360)
    expect(r.carry).toBe(653_360)
    expect(r.investorsTotal).toBe(15_346_640)
  })

  it('TC-DIS-17 tier boundary −1p / exact / +1p', () => {
    for (const g of [29_999_999, 30_000_000, 30_000_001]) expect(run({ proceeds: g, carry: tiers3x }).carry).toBe(4_000_000)
  })

  it('TC-DIS-18 half-penny boundary is rounded before the bands', () => {
    const r = run({
      holdings: [{ id: 'A', name: 'A', capital: 1 }],
      proceeds: 2,
      carry: { mode: 'tiered', tiers: [{ upTo100: 150n, rate: 10_000 }, { upTo100: null, rate: 10_000 }] },
    })
    expect(r.carry).toBe(1)
    expect(r.investorsTotal).toBe(1)
  })

  it('TC-DIS-19 profit and multiple per investor', () => {
    const r = run({})
    expect(r.rows.map((x) => [x.profit, x.multiple100])).toEqual([
      [9_600_000, 260],
      [6_400_000, 260],
    ])
  })

  it('TC-DIS-20 hurdle or catch-up are not accepted in tiered mode', () => {
    expect(distribute({ ...base, carry: { ...tiers3x, h: 800 } }).ok).toBe(false)
    expect(distribute({ ...base, carry: { ...tiers3x, c: 5000 } }).ok).toBe(false)
  })

  it('TC-DIS-22 nominee weights are exact: 19p and 10p at £100,000 a share', () => {
    const price = 100_000_000_000
    const a = allocate({ feeBasis: 'deducted', minimum: 0, cap: null, priceMicros: price, fees: [], investors: [{ id: 'A', name: 'A', received: 19, scheme: 'none' }, { id: 'B', name: 'B', received: 10, scheme: 'none' }] })
    if (!a.ok) throw new Error('allocation failed')
    const snap = holdingsFromAllocation(a.result, price, 1)
    expect(dist(run({ holdings: snap.data.rows, proceeds: 2_900, carry: fixed(0) }))).toEqual([1_900, 1_000])
  })

  const viaAllocation = (price: number, received: number[]) => {
    const a = allocate({ feeBasis: 'deducted', minimum: 0, cap: null, priceMicros: price, fees: [], investors: received.map((r, i) => ({ id: 'AB'[i], name: 'AB'[i], received: r, scheme: 'none' })) })
    if (!a.ok) throw new Error('allocation failed')
    return holdingsFromAllocation(a.result, price, 1).data
  }

  it('TC-DIS-23 a 1p holding still carries weight through the hand-off; display truncates', () => {
    const price = 100_000_000_000
    const h = viaAllocation(price, [1, 100])
    expect(h.rows.map((x) => x.capital)).toEqual([1, 100])
    expect(h.rows.map((x) => sharesDisplay(x.capital, h.sharePriceMicros))).toEqual(['0.000000', '0.000010'])
    expect(dist(run({ holdings: h.rows, proceeds: 101, carry: fixed(0) }))).toEqual([1, 100])
  })

  it('TC-DIS-24 a tiny share price stays within bounds through the hand-off', () => {
    const h = viaAllocation(1, [1_000_000])
    expect(sharesDisplay(h.rows[0].capital, h.sharePriceMicros)).toBe('10000000000.000000')
    expect(run({ holdings: h.rows, proceeds: 2_000_000 }).investorsTotal).toBe(1_800_000)
  })

  it('TC-DIS-26 the snapshot keeps its own share price; no price shows a dash', () => {
    const price = 100_000_000_000
    const snap = holdingsFromAllocation(
      { rows: [{ id: 'A', name: 'A', participating: true, invested: 19 }] } as never,
      price,
      7,
    )
    // the allocation price later changes to £50,000: the snapshot display does not move, it is only marked stale
    expect(sharesDisplay(snap.data.rows[0].capital, snap.data.sharePriceMicros)).toBe('0.000001')
    expect(isStale(snap, 8)).toBe(true)
    const imported = importHoldings('name,capital\nA,0.19\n', 'GBP')
    expect(imported.ok && imported.sharePriceMicros).toBe(null)
    expect(sharesDisplay(19, null)).toBe('—')
    expect(holdingsCsv([{ id: 'A', name: 'A', capital: 19 }], null)).toContain('A,A,0.19,—,')
  })
})
