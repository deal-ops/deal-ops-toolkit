// Tech design §5: timings at the v1 limits. Runs only with BENCH=1 and records docs/perf.md.
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { reconcile, type BankLine, type Commitment } from './reconcile'
import { allocate } from './allocation'
import { distribute } from './waterfall'

const time = (f: () => unknown, runs = 5) => {
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    f()
    t.push(performance.now() - s)
  }
  return t.sort((a, b) => a - b)[Math.floor(runs / 2)]
}

describe.skipIf(process.env.BENCH !== '1')('performance at the v1 limits', () => {
  it('PERF-01 500 investors / 2,000 bank lines', () => {
    const commitments: Commitment[] = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, name: `Investor Number${i} Surname${i % 37}`, email: '', reference: `NW-${String(i).padStart(4, '0')}`, cashDue: 100_000 + i, scheme: 'none' }))
    const lines: BankLine[] = Array.from({ length: 2_000 }, (_, i) => ({
      id: `l${i}`,
      txnId: `l${i}`,
      date: '2026-10-10',
      amount: 100_000 + (i % 500),
      payer: `I SURNAME${i % 37}`,
      reference: i % 3 === 0 ? `NW-${String(i % 500).padStart(4, '0')}` : i % 3 === 1 ? '' : `NW ${i % 500}`,
    }))
    const rec = time(() => reconcile({ commitments, lines, decisions: {}, asOf: '2026-10-16', thresholdDays: 10 }), 3)
    const investors = commitments.map((c) => ({ id: c.id, name: c.name, received: c.cashDue, scheme: 'none' as const }))
    const fees = [{ id: 'p', label: 'p', kind: 'percent' as const, value: 300, payer: 'investors' as const }]
    const alloc = time(() => allocate({ feeBasis: 'deducted', minimum: 0, cap: 40_000_000, priceMicros: 2_413_700, fees, investors }))
    const holdings = commitments.map((c) => ({ id: c.id, name: c.name, capital: c.cashDue }))
    const exit = time(() => distribute({ holdings, proceeds: 200_000_000, exitCosts: 0, years100: 500, carry: { mode: 'fixed', k: 2000, h: 800, c: 10_000 } }))
    const md = `# Performance (Tech design §5)

Measured ${new Date().toISOString().slice(0, 10)} with Node ${process.version} on ${process.platform}/${process.arch} (median of runs). Browser timings are checked again at M2.

| Module | Size | Median | Target |
|---|---|---|---|
| Reconcile | 500 investors × 2,000 lines | ${rec.toFixed(1)} ms | < 200 ms |
| Allocate | 500 investors, scale-back | ${alloc.toFixed(1)} ms | < 50 ms |
| Distribute | 500 holdings, hurdle + catch-up | ${exit.toFixed(1)} ms | < 10 ms |
`
    writeFileSync(new URL('../../docs/perf.md', import.meta.url), md)
    console.log(md)
    expect(rec).toBeLessThan(200)
    expect(alloc).toBeLessThan(50)
    expect(exit).toBeLessThan(10)
  })
})
