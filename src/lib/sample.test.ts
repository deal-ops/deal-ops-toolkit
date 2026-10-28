// Test Plan §3: the fictional sample deal end to end, from an empty downstream.
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { decide, handoffToAllocation, reconcile, type Decisions } from './reconcile'
import { allocate } from './allocation'
import { distribute } from './waterfall'
import { holdingsFromAllocation } from './snapshot'
import { formatMicroShares } from './money'
import { SAMPLE_BANK, SAMPLE_CAP, SAMPLE_COMMITMENTS, SAMPLE_EXIT, SAMPLE_FEES, SAMPLE_PRICE_MICROS, SAMPLE_SETTINGS } from './sample'

const rec = (decisions: Decisions) => {
  const o = reconcile({ commitments: SAMPLE_COMMITMENTS, lines: SAMPLE_BANK, decisions, asOf: SAMPLE_SETTINGS.asOf, thresholdDays: 10 })
  if (!o.ok) throw new Error(JSON.stringify(o.errors))
  return o
}
const byId = (id: string) => SAMPLE_BANK.find((l) => l.id === id)!
const c = (id: string) => SAMPLE_COMMITMENTS.find((x) => x.id === id)!

describe('sample deal (Test Plan §3)', () => {
  it('SAMPLE-1 reconciliation before review', () => {
    const { result: r } = rec({})
    expect(r.totals).toMatchObject({ bank: 11_484_000, booked: 6_600_000 })
    const s = (st: string) => r.lines.filter((l) => l.status === st).map((l) => l.line.id)
    expect(s('auto')).toEqual(['t01', 't02', 't04', 't06', 't07', 't08', 't09', 't10', 't13'])
    expect(s('suggested')).toEqual(['t03', 't05', 't12'])
    expect(s('unmatched')).toEqual(['t11', 't14'])
    expect(s('skipped')).toEqual(['t15'])
    expect(s('future')).toEqual(['t16'])
    const top = (id: string) => r.lines.find((l) => l.line.id === id)!.candidates[0]
    expect([top('t03'), top('t05'), top('t12')].map((x) => [x.commitmentId, x.score])).toEqual([
      ['c03', 0.55],
      ['c05', 0.35],
      ['c11', 0.8],
    ])
    const st = Object.fromEntries(r.commitments.map((x) => [x.commitment.name.split(' ')[0], [x.status, x.difference]]))
    expect(st.David).toEqual(['partial', -50_000])
    expect(st.Hugo).toEqual(['overpaid', 500_000])
    for (const n of ['Chloe', 'Elena', 'Kavya', 'James']) expect(st[n][0]).toBe('outstanding')
  })

  it('SAMPLE-2 after confirming three and rejecting two', () => {
    const decisions: Decisions = {
      t03: decide(byId('t03'), c('c03')),
      t05: decide(byId('t05'), c('c05')),
      t12: decide(byId('t12'), c('c11')),
      t11: decide(byId('t11'), null),
      t14: decide(byId('t14'), null),
    }
    const o = rec(decisions)
    expect(o.result.totals).toMatchObject({ booked: 10_850_000, unbooked: 634_000 })
    const open = o.checks.filter((x) => !x.pass)
    expect(open.map((x) => x.id)).toEqual(['aged-t11'])

    const h = handoffToAllocation(o.result)
    if (!h.ok) throw new Error(h.reason)
    expect(h.value.excess).toEqual([{ id: 'c08', name: 'Hugo Bernard', amount: 500_000, reason: 'Over-paid' }])
    const received = Object.fromEntries(h.value.investors.map((x) => [x.id, x.received]))
    expect([received.c04, received.c08, received.c10]).toEqual([200_000, 500_000, 0])

    const a = allocate({ feeBasis: 'deducted', minimum: SAMPLE_SETTINGS.minimum, cap: SAMPLE_CAP, priceMicros: SAMPLE_PRICE_MICROS, fees: SAMPLE_FEES, investors: h.value.investors })
    if (!a.ok) throw new Error(JSON.stringify(a.errors))
    const t = a.result.totals
    expect(t).toMatchObject({ received: 10_350_000, invested: 10_039_500, investorFees: 310_500, refunds: 0, companyFees: 150_000, wire: 9_889_500 })
    expect(a.result.rows.filter((x) => x.participating)).toHaveLength(11)
    const row = (id: string) => a.result.rows.find((x) => x.id === id)!
    expect(row('c01')).toMatchObject({ invested: 970_000, claimableShares: 4018, claimableAmount: 969_824, nonClaimable: 176 })
    expect(formatMicroShares(row('c01').microShares)).toBe('4018.726436')
    expect(row('c04')).toMatchObject({ invested: 194_000, claimableShares: 803, claimableAmount: 193_820, nonClaimable: 180 })
    expect(formatMicroShares(row('c04').microShares)).toBe('803.745287')
    expect(row('c09')).toMatchObject({ participating: true, invested: 97_000 })

    const snap = holdingsFromAllocation(a.result, SAMPLE_PRICE_MICROS, 1)
    const w = distribute({ holdings: snap.data.rows, ...SAMPLE_EXIT })
    if (!w.ok) throw new Error(JSON.stringify(w.errors))
    expect(w.result).toMatchObject({
      returnOfCapital: 10_039_500,
      hurdlePaid: 5_891_925,
      catchUpTranche: 1_472_981,
      catchUpToLead: 1_472_981,
      carry: 5_702_100,
      investorsTotal: 32_847_900,
    })
  })
})

// Frozen expected output (Test Plan §3): regenerate only with FREEZE=1 after the owner re-approves.

function sampleChain() {
  const decisions: Decisions = {
    t03: decide(byId('t03'), c('c03')),
    t05: decide(byId('t05'), c('c05')),
    t12: decide(byId('t12'), c('c11')),
    t11: decide(byId('t11'), null),
    t14: decide(byId('t14'), null),
  }
  const r = rec(decisions).result
  const h = handoffToAllocation(r)
  if (!h.ok) throw new Error(h.reason)
  const a = allocate({ feeBasis: 'deducted', minimum: SAMPLE_SETTINGS.minimum, cap: SAMPLE_CAP, priceMicros: SAMPLE_PRICE_MICROS, fees: SAMPLE_FEES, investors: h.value.investors })
  if (!a.ok) throw new Error('allocation')
  const w = distribute({ holdings: holdingsFromAllocation(a.result, SAMPLE_PRICE_MICROS, 1).data.rows, ...SAMPLE_EXIT })
  if (!w.ok) throw new Error('waterfall')
  return {
    reconcile: r.commitments.map((x) => ({ id: x.commitment.id, received: x.received, status: x.status })),
    allocation: a.result.rows.map((x) => ({
      id: x.id,
      invested: x.invested,
      fees: x.fees,
      refund: x.refund,
      shares: formatMicroShares(x.microShares),
      claimableShares: x.claimableShares,
      claimableAmount: x.claimableAmount,
    })),
    exit: w.result.rows.map((x) => ({ id: x.id, capital: x.capital, distribution: x.distribution, multiple100: x.multiple100 })),
  }
}

describe('frozen sample (Test Plan §3)', () => {
  const file = new URL('./sample.expected.json', import.meta.url)
  it('SAMPLE-3 every row matches the frozen, oracle-agreed result', () => {
    const now = sampleChain()
    if (process.env.FREEZE === '1') writeFileSync(file, JSON.stringify(now, null, 2) + '\n')
    expect(now).toEqual(JSON.parse(readFileSync(file, 'utf8')))
  })
})
