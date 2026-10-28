// PRD v0.8 R-REC-10, C-REC-8: messages to investors (Test Plan §2.5, 〔M5〕).
import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { reconcile, type CommitmentResult } from './reconcile'
import { SAMPLE_BANK, SAMPLE_COMMITMENTS, SAMPLE_SETTINGS } from './sample'
import { amountWithCode, chaseMessage, longDate, queryMessage } from './messages'
import { chaseListCsv } from './exports'

const DEAL = 'Northwind Robotics — Seed SPV (fictional sample)'
const MT103 =
  'If you have already sent this payment, please ask your bank for the MT103 (or equivalent) for the transfer, showing its UETR, and send it to us so we can trace the payment.'

function sample() {
  const o = reconcile({ commitments: SAMPLE_COMMITMENTS, lines: SAMPLE_BANK, decisions: {}, asOf: SAMPLE_SETTINGS.asOf, thresholdDays: 10 })
  if (!o.ok) throw new Error('sample did not reconcile')
  return o.result
}
const person = (id: string) => sample().commitments.find((c) => c.commitment.id === id)!

describe('C-REC-8 messages', () => {
  it('TC-REC-42 template A for an investor who is short, word for word', () => {
    expect(SAMPLE_SETTINGS.name).toBe(DEAL)
    const david = person('c04')
    expect([david.commitment.cashDue, david.received, david.status]).toEqual([250_000, 200_000, 'partial'])
    expect(chaseMessage(DEAL, 'GBP', david)).toBe(
      [
        'Hi David Kim,',
        `For ${DEAL}, we have received £2,000.00 GBP of the £2,500.00 GBP due from you, so £500.00 GBP is still outstanding. Please pay it using the payment reference NW-004 exactly as written.`,
        MT103,
        'Thank you.',
      ].join('\n\n'),
    )
  })

  it('TC-REC-43 template A for an investor who has not paid; a USD deal writes US$ … USD', () => {
    const james = person('c10')
    expect([james.received, james.status]).toEqual([0, 'outstanding']) // t16 arrived after the as-of date
    const text = chaseMessage(DEAL, 'GBP', james)
    expect(text.split('\n\n')).toEqual([
      'Hi James Whitfield,',
      `For ${DEAL}, we have not yet received the £20,000.00 GBP due from you. Please pay it using the payment reference NW-010 exactly as written.`,
      MT103,
      'Thank you.',
    ])
    expect(chaseMessage(DEAL, 'USD', james)).toContain('we have not yet received the US$20,000.00 USD due from you.')
    expect(chaseMessage(DEAL, 'EUR', person('c04'))).toContain('received €2,000.00 EUR of the €2,500.00 EUR due from you, so €500.00 EUR is still')
    expect(amountWithCode(125_000, 'GBP')).toBe('£1,250.00 GBP')
    expect(amountWithCode(50_000, 'USD')).toBe('US$500.00 USD')
  })

  it('TC-REC-44 template B gives only the amount and the date — never the payer, bank reference or transaction ID', () => {
    const t03 = sample().lines.find((l) => l.line.txnId === 't03')!
    expect(t03.status).toBe('suggested')
    expect(queryMessage(DEAL, 'GBP', 'Chloe Martin', { amount: t03.line.amount, date: t03.line.date })).toBe(
      [
        'Hi Chloe Martin,',
        `For ${DEAL}, we received a payment of £20,000.00 GBP on 7 October 2026 that we could not match to an investor automatically. If you sent it, please reply with the name on the account it came from and the payment reference you used. If you did not send it, there is nothing you need to do.`,
        'Thank you.',
      ].join('\n\n'),
    )
    // a made-up receipt whose details belong to someone else: none of them can reach the text
    const line = { id: 'x', txnId: 'T-SECRET', date: '2026-10-09', amount: 1_000_000, payer: 'BEN OKAFOR', reference: 'NW-002 =cmd' }
    // even handed a whole bank line, the template reads only the amount and the date
    const fromLine = queryMessage(DEAL, 'GBP', 'Amelia Hart', line)
    const text = queryMessage(DEAL, 'GBP', 'Amelia Hart', { amount: line.amount, date: line.date })
    for (const t of [text, fromLine]) for (const secret of ['BEN OKAFOR', 'NW-002', '=cmd', 'T-SECRET']) expect(t).not.toContain(secret)
  })

  it('TC-REC-44 long dates are built from the date parts alone', () => {
    expect(longDate('2026-10-14')).toBe('14 October 2026')
    expect(longDate('2026-01-01')).toBe('1 January 2026')
    expect(longDate('2026-12-31')).toBe('31 December 2026')
    expect(longDate('2028-02-29')).toBe('29 February 2028')
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    for (const [i, name] of months.entries()) expect(longDate(`2026-${String(i + 1).padStart(2, '0')}-09`)).toBe(`9 ${name} 2026`)
  })

  it('TC-REC-45 the chase list CSV carries each message; names that look like formulas are escaped', () => {
    const r = sample()
    const rows = Papa.parse<string[]>(chaseListCsv(r, 'GBP', DEAL), { skipEmptyLines: true }).data
    const header = rows[0]
    expect(header.slice(-4)).toEqual(['committed_original', 'committed_adjustment', 'message', 'currency'])
    const col = (n: string) => header.indexOf(n)
    const chased = r.commitments.filter((c) => c.status === 'partial' || c.status === 'outstanding')
    expect(rows.length - 1).toBe(chased.length)
    for (const [i, c] of chased.entries()) {
      const row = rows[i + 1]
      expect(row[col('message')]).toBe(chaseMessage(DEAL, 'GBP', c))
      expect(row[col('message')].startsWith('Hi ')).toBe(true)
      expect(row[col('committed_original')]).toBe('')
      expect(row[col('committed_adjustment')]).toBe('')
    }
    const hostile: CommitmentResult = { ...person('c04'), commitment: { ...person('c04').commitment, name: '=HYPERLINK("x")' } }
    const csv = chaseListCsv({ ...r, commitments: [hostile] }, 'GBP', DEAL)
    const row = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data[1]
    expect(row[col('name')]).toBe('\'=HYPERLINK("x")')
    expect(row[col('message')].startsWith('Hi =HYPERLINK')).toBe(true) // plain text: the name goes in as it is
  })
})
