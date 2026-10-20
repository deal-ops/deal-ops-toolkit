import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseDate, parseMoney, parsePercent, parsePrice } from './money'
import { importBank, importCommitments, importHoldings, toCsv } from './csv'
import { referenceProblem, reconcile, tokenRuns, normRef } from './reconcile'
import { allocate } from './allocation'
import { distribute } from './waterfall'
import { holdingsCsv } from './exports'
import { defaultDeal, HOLDING_STRUCTURE } from './deal'

const fixture = (f: string) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8')
const value = <T,>(r: { ok: boolean; value?: T }) => (r.ok ? r.value : 'ERR')

describe('input rules and CSV', () => {
  it('TC-IO-01 valid amounts', () => {
    expect(['1,234.56', '£1,234', '1234.5'].map((s) => value(parseMoney(s, 'GBP')))).toEqual([123_456, 123_400, 123_450])
  })

  it('TC-IO-02 invalid amounts', () => {
    for (const s of ['1,23', '12,34.5', '1.234', '€5', 'abc', '']) expect(parseMoney(s, 'GBP').ok).toBe(false)
  })

  it('TC-IO-03 over the limit', () => {
    expect(parseMoney('1000000000.01', 'GBP').ok).toBe(false)
    expect(parseMoney('1000000000.00', 'GBP').ok).toBe(true)
  })

  it('TC-IO-04 valid percentages', () => {
    expect(['3', '3.5%', '100'].map((s) => value(parsePercent(s)))).toEqual([300, 350, 10_000])
  })

  it('TC-IO-05 invalid percentages', () => {
    for (const s of ['-1', '100.01', '3.333']) expect(parsePercent(s).ok).toBe(false)
  })

  it('TC-IO-06 share prices', () => {
    expect(value(parsePrice('2.4137', 'GBP'))).toBe(2_413_700)
    for (const s of ['0', '0.0000001', '1000000.01']) expect(parsePrice(s, 'GBP').ok).toBe(false)
  })

  it('TC-IO-07 dates', () => {
    expect(value(parseDate('2026-10-16'))).toBe('2026-10-16')
    expect(value(parseDate('16/10/2026'))).toBe('2026-10-16')
    expect(parseDate('31/02/2026').ok).toBe(false)
    expect(parseDate('10/16/2026').ok).toBe(false)
  })

  it('TC-IO-08 one bad row stops the whole import and every error is located', () => {
    const csv = 'transaction_id,date,amount,payer,reference\nA,2026-10-06,10,X,R\nB,2026-10-06,,X,R\nC,2026-10-06,10,X,R\nD,2026-13-40,10,X,R\n'
    const r = importBank(csv, 'GBP', 'replace', [])
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors.map((e) => e.where)).toEqual(['row 3, amount', 'row 5, date'])
  })

  it('TC-IO-09 a missing required column is named', () => {
    const r = importCommitments('name,cash_due\nA,10\n', 'GBP')
    expect(!r.ok && r.errors.map((e) => e.message)).toContain('missing required column "reference"')
  })

  it('TC-IO-10 aliases: Cash Due (£) accepted, Committed (£) refused with an explanation', () => {
    const good = importCommitments('Investor Name,Payment Reference,Cash Due (£)\nA,NW-001,10\n', 'GBP')
    expect(good.ok && good.rows[0]).toMatchObject({ name: 'A', reference: 'NW-001', cashDue: 1_000 })
    const bad = importCommitments('Investor Name,Payment Reference,Committed (£)\nA,NW-001,10\n', 'GBP')
    expect(!bad.ok && bad.errors.some((e) => /cash_due.*including any fees/.test(e.message))).toBe(true)
  })

  it('TC-IO-11 formulas are neutralised on export', () => {
    expect(toCsv(['name'], [['=HYPERLINK("x")']])).toContain(`'=HYPERLINK`)
    expect(toCsv(['name'], [['\t=1+1']])).toContain(`'\t=1+1`)
    // a text column is escaped even when it looks like a number; a numeric column is not
    expect(toCsv(['id', 'amount'], [['-00123', '-45.00']], ['amount'])).toContain(`'-00123,-45.00`)
  })

  it('TC-IO-12 more than 500 investors is refused', () => {
    const rows = Array.from({ length: 501 }, (_, i) => `I${i},NW-${String(i).padStart(4, '0')},10`).join('\n')
    const r = importCommitments(`name,reference,cash_due\n${rows}\n`, 'GBP')
    expect(!r.ok && r.errors.some((e) => /at most 500/.test(e.message))).toBe(true)
  })

  it('TC-IO-13 fixture import fills missing IDs uniquely', () => {
    const r = importCommitments(fixture('commitments.csv'), 'GBP')
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    expect(r.rows.map((x) => [x.name, x.cashDue, x.scheme])).toEqual([
      ['Amelia Hart', 1_000_000, 'SEIS'],
      ['Ben Okafor', 500_000, 'EIS'],
      ['Chloe Martin', 2_000_000, 'none'],
      ['David Kim', 250_000, 'SEIS'],
    ])
    const ids = r.rows.map((x) => x.id)
    expect(ids[0]).toBe('c01')
    expect(new Set(ids).size).toBe(4)
    expect(ids.every(Boolean)).toBe(true)
  })

  it('TC-IO-14 every allowed reference format matches itself; four parts are refused', () => {
    for (const ref of ['NW-001', 'NW 001 A', 'AB/12', 'X_1.Z']) {
      expect(referenceProblem(ref)).toBeNull()
      expect(tokenRuns(ref)).toContain(normRef(ref))
      const o = reconcile({
        commitments: [{ id: 'a', name: 'A', email: '', reference: ref, cashDue: 1, scheme: 'none' }],
        lines: [{ id: 'l', txnId: 'l', date: '2026-10-01', amount: 1, payer: '', reference: ref }],
        decisions: {},
        asOf: '2026-10-02',
        thresholdDays: 10,
      })
      expect(o.ok && o.result.lines[0].status).toBe('auto')
    }
    expect(referenceProblem('UK-NW-A-001')).not.toBeNull()
  })

  it('TC-IO-15 same transaction ID with different details is a conflict', () => {
    const first = importBank('transaction_id,date,amount\nT9,2026-10-06,10\n', 'GBP', 'replace', [])
    if (!first.ok) throw new Error('setup')
    const r = importBank('transaction_id,date,amount\nT9,2026-10-06,11\n', 'GBP', 'append', first.value.lines)
    expect(!r.ok && r.errors[0]).toMatchObject({ where: 'row 2, transaction_id', message: expect.stringContaining('"T9" already exists') })
  })

  it('TC-IO-16 field rules: negative costs, zero capital, duplicate ids, 100% deducted fees, mixed prices', () => {
    expect(distribute({ holdings: [{ id: 'a', name: 'a', capital: 1 }], proceeds: 10, exitCosts: -1, years100: 0, carry: { mode: 'fixed', k: 0, h: 0, c: 0 } }).ok).toBe(false)
    expect(importHoldings('name,capital\nA,0\n', 'GBP').ok).toBe(false)
    expect(importCommitments('investor_id,name,reference,cash_due\nx,A,NW-001,1\nx,B,NW-002,1\n', 'GBP').ok).toBe(false)
    const fees = [{ id: 'a', label: 'a', kind: 'percent' as const, value: 6_000, payer: 'investors' as const }, { id: 'b', label: 'b', kind: 'percent' as const, value: 4_000, payer: 'investors' as const }]
    expect(allocate({ feeBasis: 'deducted', minimum: 0, cap: null, priceMicros: 1_000_000, fees, investors: [{ id: 'i', name: 'i', received: 100, scheme: 'none' }] }).ok).toBe(false)
    expect(importHoldings('name,capital,share_price\nA,1,2\nB,1,3\n', 'GBP').ok).toBe(false)
  })

  it('TC-IO-17 holdings export → import is lossless and pays the same', () => {
    const rows = [
      { id: 'A', name: 'A', capital: 19 },
      { id: 'B', name: 'B', capital: 10 },
    ]
    const price = 100_000_000_000
    const back = importHoldings(holdingsCsv(rows, price, 'GBP'), 'GBP')
    if (!back.ok) throw new Error(JSON.stringify(back.errors))
    expect(back.rows).toEqual(rows)
    expect(back.sharePriceMicros).toBe(price)
    const pay = (h: typeof rows) => {
      const o = distribute({ holdings: h, proceeds: 2_900, exitCosts: 0, years100: 0, carry: { mode: 'fixed', k: 0, h: 0, c: 0 } })
      return o.ok ? o.result.rows.map((r) => r.distribution) : null
    }
    expect(pay(back.rows)).toEqual(pay(rows))
    expect(pay(back.rows)).toEqual([1_900, 1_000])
  })

  it('TC-IO-18 bank fixture: positive rows in, zero and negative listed', () => {
    const r = importBank(fixture('bank.csv'), 'GBP', 'replace', [])
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    expect(r.value.lines).toHaveLength(5)
    expect(r.value.nonPositive).toBe(2)
    const o = reconcile({ commitments: [], lines: r.value.lines, decisions: {}, asOf: '2026-10-16', thresholdDays: 10 })
    expect(o.ok && o.result.lines.filter((l) => l.status === 'skipped').map((l) => l.line.txnId)).toEqual(['T3', 'T4'])
  })

  it('TC-IO-19 header currency must match the deal', () => {
    for (const h of ['Amount (£)', 'amount gbp']) expect(importBank(`date,${h}\n2026-10-01,1\n`, 'GBP', 'replace', []).ok).toBe(true)
    for (const h of ['Amount (€)', 'amount usd']) expect(importBank(`date,${h}\n2026-10-01,1\n`, 'GBP', 'replace', []).ok).toBe(false)
  })

  it('TC-DEAL-01 defaults, currency, fixed holding structure', () => {
    const d = defaultDeal(new Date(2026, 9, 17))
    expect(d).toEqual({ name: 'New deal', currency: 'GBP', asOf: '2026-10-17', feeBasis: 'deducted', minimum: 0, agedThresholdDays: 10 })
    expect(parseMoney('£5', 'EUR').ok).toBe(false)
    expect(value(parseMoney('€5', 'EUR'))).toBe(500)
    expect(HOLDING_STRUCTURE).toMatch(/^Holding structure: nominee \(bare trust\)/)
  })
})
