// PRD v0.7.5 decision 10: currency on input, on import and in every export (Test Plan TC-IO-44..46, TC-ALL-30).
import { describe, expect, it } from 'vitest'
import { formatMoney, formatPrice, parseMoney, parsePrice } from './money'
import { importBank, importCommitments, importHoldings, importInvestors } from './csv'
import { reconcile } from './reconcile'
import { allocate } from './allocation'
import { distribute } from './waterfall'
import { allocationCsv, chaseListCsv, closingConfirmation, distributionCsv, holdingsCsv, ledgerCsv } from './exports'
import { SAMPLE_BANK, SAMPLE_CAP, SAMPLE_COMMITMENTS, SAMPLE_EXIT, SAMPLE_FEES, SAMPLE_PRICE_MICROS, SAMPLE_SETTINGS } from './sample'

// the sample round with every investor's cash in (not imported from allocation.test.ts, which would run its cases twice)
const sampleAllocInput = () => ({
  feeBasis: 'deducted' as const,
  minimum: SAMPLE_SETTINGS.minimum,
  cap: SAMPLE_CAP,
  priceMicros: SAMPLE_PRICE_MICROS,
  fees: SAMPLE_FEES,
  investors: SAMPLE_COMMITMENTS.map((c) => ({ id: c.id, name: c.name, received: c.cashDue, scheme: c.scheme })),
})

const value = <T>(r: { ok: boolean; value?: T }) => (r.ok ? r.value : 'ERR')

describe('currency', () => {
  it('TC-IO-44 USD takes $ and US$; share prices take the deal symbol and thousands commas', () => {
    expect(['$5', 'US$5', 'US$1,250.50'].map((s) => value(parseMoney(s, 'USD')))).toEqual([500, 500, 125_050])
    expect(['US$1,250.50', '1,250.5'].map((s) => value(parsePrice(s, 'USD')))).toEqual([1_250_500_000, 1_250_500_000])
    expect(parseMoney('US$5', 'GBP').ok).toBe(false)
    expect(parsePrice('$5', 'GBP').ok).toBe(false)
    expect(parsePrice('1,25.5', 'GBP').ok).toBe(false)
    expect(value(parsePrice('£2.4137', 'GBP'))).toBe(2_413_700)
    expect(value(parsePrice('1,000,000', 'GBP'))).toBe(1_000_000_000_000)
    expect(parsePrice('1,000,000.000001', 'GBP').ok).toBe(false)
    expect(formatMoney(-123_450, 'USD')).toBe('-US$1,234.50')
    expect(formatPrice(SAMPLE_PRICE_MICROS, 'USD')).toBe('US$2.4137')
  })

  it('TC-IO-45 a currency column is checked on every import: the deal code in any case or blank passes, another code fails on its row', () => {
    const files = {
      commitments: (c: string) => `name,reference,cash_due,currency\nAnn,AB-001,100,GBP\nBo,AB-002,200,gbp\nCy,AB-003,300,${c}`,
      bank: (c: string) => `date,amount,currency\n2026-10-01,100,GBP\n2026-10-02,200,${c}`,
      investors: (c: string) => `name,received,ccy\nAnn,100,GBP\nBo,200,${c}`,
      holdings: (c: string) => `name,capital,Currency\nAnn,100,GBP\nBo,200,${c}`,
    }
    const run = {
      commitments: (t: string) => importCommitments(t, 'GBP'),
      bank: (t: string) => importBank(t, 'GBP', 'replace', []),
      investors: (t: string) => importInvestors(t, 'GBP'),
      holdings: (t: string) => importHoldings(t, 'GBP'),
    }
    for (const kind of Object.keys(files) as (keyof typeof files)[]) {
      const ok = run[kind](files[kind](''))
      expect(ok.ok, kind).toBe(true)
      if (ok.ok) expect(ok.ignoredColumns, kind).toEqual([])
      const bad = run[kind](files[kind]('EUR'))
      expect(bad.ok, kind).toBe(false)
      if (!bad.ok)
        expect(
          bad.errors.map((e) => e.where),
          kind,
        ).toContain(kind === 'commitments' ? 'row 4, currency' : 'row 3, currency')
    }
    expect(importBank('date,amount,currency,ccy\n2026-10-01,100,GBP,GBP', 'GBP', 'replace', []).ok).toBe(false)
  })

  it('TC-IO-46 every export of a EUR deal ends with a currency column holding EUR on each row; holdings round-trip only into EUR', () => {
    const rec = reconcile({ commitments: SAMPLE_COMMITMENTS, lines: SAMPLE_BANK, decisions: {}, asOf: SAMPLE_SETTINGS.asOf, thresholdDays: 10 })
    const alloc = allocate(sampleAllocInput())
    const holdings = [
      { id: 'A', name: 'Ann', capital: 970_000 },
      { id: 'B', name: 'Bo', capital: 485_000 },
    ]
    const exit = distribute({
      holdings,
      proceeds: SAMPLE_EXIT.proceeds,
      exitCosts: SAMPLE_EXIT.exitCosts,
      years100: SAMPLE_EXIT.years100,
      carry: SAMPLE_EXIT.carry,
    })
    if (!rec.ok || !alloc.ok || !exit.ok) throw new Error('sample did not run')
    const files = [
      ledgerCsv(rec.result, 'EUR'),
      chaseListCsv(rec.result, 'EUR'),
      allocationCsv(alloc.result, 'EUR'),
      distributionCsv(exit.result, SAMPLE_PRICE_MICROS, 'EUR'),
      holdingsCsv(holdings, SAMPLE_PRICE_MICROS, 'EUR'),
    ]
    for (const f of files) {
      const [header, ...rows] = f.split(/\r?\n/)
      expect(header.endsWith(',currency')).toBe(true)
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) expect(r.endsWith(',EUR')).toBe(true)
    }
    const back = importHoldings(files[4], 'EUR')
    expect(back.ok && back.rows.map((h) => h.capital)).toEqual([970_000, 485_000])
    expect(back.ok && back.sharePriceMicros).toBe(SAMPLE_PRICE_MICROS)
    expect(importHoldings(files[4], 'GBP').ok).toBe(false)
  })

  it('TC-ALL-30 the closing confirmation names the currency code on its second line', () => {
    const alloc = allocate(sampleAllocInput())
    if (!alloc.ok) throw new Error('sample did not run')
    expect(closingConfirmation(SAMPLE_SETTINGS.name, 'GBP', SAMPLE_PRICE_MICROS, alloc.result).split('\n')[1]).toBe('Currency: GBP')
    expect(closingConfirmation(SAMPLE_SETTINGS.name, 'USD', SAMPLE_PRICE_MICROS, alloc.result)).toMatch(/\nWire to company: US\$\d{1,3}(,\d{3})*\.\d\d\n/)
  })
})
