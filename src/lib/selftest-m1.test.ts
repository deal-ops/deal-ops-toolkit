// Regression tests for the fresh-context self-test review (docs/en/REVIEW_SUMMARY.md, M1).
import { describe, expect, it } from 'vitest'
import { distribute } from './waterfall'
import { nameSimilarity, reconcile, type BankLine } from './reconcile'
import { importBank, importCommitments, importHoldings, importInvestors } from './csv'
import { allocate } from './allocation'
import { holdingsCsv } from './exports'

describe('self-test regressions', () => {
  it('TC-DIS-30 a hurdle larger than any safe number is clamped, not a crash (#1)', () => {
    const o = distribute({ holdings: [{ id: 'a', name: 'a', capital: 10_000 }], proceeds: 20_000, exitCosts: 0, years100: 5_000, carry: { mode: 'fixed', k: 2000, h: 10_000, c: 0 } })
    expect(o.ok && o.result).toMatchObject({ hurdlePaid: 10_000, carry: 0, investorsTotal: 20_000 })
  })

  it('TC-REC-34 line ids such as "constructor" are just data (#2)', () => {
    for (const id of ['constructor', 'toString', '__proto__']) {
      const line: BankLine = { id, txnId: id, date: '2026-10-10', amount: 100_000, payer: 'P', reference: 'NW-001' }
      const o = reconcile({ commitments: [{ id: 'c', name: 'C', email: '', reference: 'NW-001', cashDue: 100_000, scheme: 'none' }], lines: [line], decisions: {}, asOf: '2026-10-16', thresholdDays: 10 })
      expect(o.ok && o.result.lines[0].status, id).toBe('auto')
    }
  })

  it('TC-IO-27 duplicate investor ids are caught whatever they look like (#3)', () => {
    expect(importCommitments('investor_id,name,reference,cash_due\n__row7,A,NW-001,1\n__row7,B,NW-002,1\n', 'GBP').ok).toBe(false)
  })

  it('TC-IO-28 spreadsheet rows of empty cells are blank lines (#4)', () => {
    const r = importCommitments('name,reference,cash_due\nAnn,NW-001,1000\n,,\n', 'GBP')
    expect(r.ok && r.rows).toHaveLength(1)
  })

  it('TC-IO-29 error rows are right with CR-only line endings (#5)', () => {
    const r = importCommitments('name,reference,cash_due\rAnn,NW-001,1\rBob,NW-002,abc\r', 'GBP')
    expect(!r.ok && r.errors.map((e) => e.where)).toEqual(['row 3, cash_due'])
  })

  it('TC-ALL-29 two fees with the same label are refused (#7)', () => {
    const fee = (id: string) => ({ id, label: 'Fee', kind: 'percent' as const, value: 100, payer: 'investors' as const })
    expect(allocate({ feeBasis: 'deducted', minimum: 0, cap: null, priceMicros: 1_000_000, fees: [fee('a'), fee('b')], investors: [] }).ok).toBe(false)
  })

  it('TC-IO-30 our own export imports back unchanged, even with formula-like names (#9)', () => {
    const rows = [{ id: '-7', name: '+Ann', capital: 100 }]
    const back = importHoldings(holdingsCsv(rows, null, 'GBP'), 'GBP')
    expect(back.ok && back.rows).toEqual(rows)
  })

  it('TC-REC-35 non-English letters are letters; only a–z are upper-cased (#10)', () => {
    const run = (reference: string) =>
      reconcile({ commitments: [{ id: 'c', name: 'C', email: '', reference: 'SS-001', cashDue: 1, scheme: 'none' }], lines: [{ id: 'l', txnId: 'l', date: '2026-10-10', amount: 2, payer: '', reference }], decisions: {}, asOf: '2026-10-16', thresholdDays: 10 })
    for (const ref of ['ß001', 'Payment SS001É']) {
      const o = run(ref)
      expect(o.ok && o.result.lines[0].status, ref).not.toBe('auto')
    }
  })

  it('TC-REC-36 punctuation in payer names separates words (#11)', () => {
    expect(nameSimilarity('J.A. SMITH', 'John Andrew Smith')).toBe(1)
    expect(nameSimilarity('SMITH,JOHN', 'John Smith')).toBe(1)
    expect(nameSimilarity('MARY-JANE WATTS', 'Mary Jane Watts')).toBe(1)
  })
})

describe('Codex M1 round 2 (partial run) regressions', () => {
  it('TC-DIS-31 fields from the other carry mode are an input error', () => {
    const base = { holdings: [{ id: 'A', name: 'A', capital: 10_000 }], proceeds: 20_000, exitCosts: 0, years100: 100 }
    const fixedWithTiers = { mode: 'fixed', k: 2000, h: 0, c: 0, tiers: [{ upTo100: null, rate: 9000 }] } as never
    const tieredWithK = { mode: 'tiered', tiers: [{ upTo100: null, rate: 2000 }], k: 9000 } as never
    expect(distribute({ ...base, carry: fixedWithTiers }).ok).toBe(false)
    expect(distribute({ ...base, carry: tieredWithK }).ok).toBe(false)
  })
})

describe('Codex M1 round 2 regressions', () => {
  const C1 = (reference: string, name = 'C') => ({ id: 'c', name, email: '', reference, cashDue: 10_000, scheme: 'none' as const })
  const L1 = (reference: string, payer = '') => ({ id: 'l', txnId: 'l', date: '2026-10-10', amount: 10_000, payer, reference })
  const run = (c: ReturnType<typeof C1>, l: ReturnType<typeof L1>) => reconcile({ commitments: [c], lines: [l], decisions: {}, asOf: '2026-10-16', thresholdDays: 10 })

  it('TC-REC-37 investor references are English letters and digits only (R2-1)', () => {
    expect(run(C1('É001'), L1('É001')).ok).toBe(false)
    const ok = run(C1('NW-001'), L1('Zahlung NW-001 München'))
    expect(ok.ok && ok.result.lines[0].status).toBe('auto')
  })

  it('TC-REC-38 initials compare by character, not by UTF-16 unit (R2-2)', () => {
    const o = run(C1('NW001', '𐐀BC'), L1('', '𐐀'))
    expect(o.ok && o.result.lines[0].candidates[0]?.score).toBe(0.55)
    expect(o.ok && o.checks.find((k) => k.id === 'reviewed')?.pass).toBe(false)
  })

  it('TC-IO-31 a literal leading apostrophe survives export and import (R2-3)', () => {
    const rows = [
      { id: "'a", name: "'+Ann", capital: 100 },
      { id: 'b', name: '+Bob', capital: 200 },
    ]
    const back = importHoldings(holdingsCsv(rows, null, 'GBP'), 'GBP')
    expect(back.ok && back.rows).toEqual(rows)
  })

  it('TC-IO-32 investor and holdings imports apply the length limits (R2-4)', () => {
    const row = `${'i'.repeat(41)},${'n'.repeat(121)},1`
    expect(importInvestors(`investor_id,name,received\n${row}\n`, 'GBP').ok).toBe(false)
    expect(importHoldings(`investor_id,name,capital\n${row}\n`, 'GBP').ok).toBe(false)
  })

  it('TC-IO-33 a transaction ID can never collide with a generated line key (R2-7)', () => {
    const first = importBank('date,amount,payer\n2026-10-01,1,A\n', 'GBP', 'replace', [])
    if (!first.ok) throw new Error('setup')
    const generated = first.value.lines[0].id
    const second = importBank(`transaction_id,date,amount\n${generated},2026-10-02,2\n`, 'GBP', 'append', first.value.lines)
    if (!second.ok) throw new Error(JSON.stringify(second.errors))
    const ids = second.value.lines.map((l) => l.id)
    expect(new Set(ids).size).toBe(2)
    expect(reconcile({ commitments: [], lines: second.value.lines, decisions: {}, asOf: '2026-10-16', thresholdDays: 10 }).ok).toBe(true)
  })
})

describe('self-test before Codex round 3', () => {
  const line = (reference: string, extra: Partial<BankLine> = {}): BankLine => ({ id: 'l', txnId: 'l', date: '2026-10-10', amount: 10_000, payer: '', reference, ...extra })
  const c0 = { id: 'c0', name: 'C', email: '', reference: 'NW001', cashDue: 10_000, scheme: 'none' as const }
  const go = (lines: BankLine[], commitments = [c0]) => reconcile({ commitments, lines, decisions: {}, asOf: '2026-10-16', thresholdDays: 10 })

  it('TC-IO-34 an 80-character transaction id imports and reconciles (R3 #1)', () => {
    for (const n of [79, 80]) {
      const imp = importBank(`transaction_id,date,amount\n${'A'.repeat(n)},2026-10-01,1\n`, 'GBP', 'replace', [])
      if (!imp.ok) throw new Error('import')
      expect(go(imp.value.lines).ok, String(n)).toBe(true)
    }
  })

  it('TC-REC-39 edit distance counts characters, not UTF-16 units (R3 #2)', () => {
    const o = go([line('NW00𝐀')])
    expect(o.ok && o.result.lines[0].candidates[0]).toMatchObject({ commitmentId: 'c0', score: 0.5 })
  })

  it('TC-REC-40 non-ASCII characters are part of a token, whatever the Unicode version (R3 #3)', () => {
    for (const ref of ['NW001Ɤ', 'NW001\u{11F04}', 'NW001É']) {
      const o = go([line(ref)])
      expect(o.ok && o.result.lines[0].status, ref).not.toBe('auto')
    }
    const split = go([line('Ref NW001 Ɤ')])
    expect(split.ok && split.result.lines[0].status).toBe('auto')
    // only a–z are upper-cased: é/í stay as they are (documented limitation in PRD C-REC-3)
    expect(nameSimilarity('José García', 'josé garcía')).toBe(1)
    expect(nameSimilarity('José García', 'JOSÉ GARCÍA')).toBe(0)
  })

  it('TC-REC-41 investor references have no empty parts or loose separators (R3 #4)', () => {
    for (const ref of ['NW--001', ' NW001', '-NW001', 'NW001.']) expect(go([], [{ ...c0, reference: ref }]).ok, ref).toBe(false)
  })

  it('TC-IO-35 the escape apostrophe is removed and the rest kept exactly (R3 #5, R3-1)', () => {
    const r = importBank('date,amount,payer\n2026-10-01,1,"\'\t"\n', 'GBP', 'replace', [])
    expect(r.ok && r.value.lines[0].payer).toBe('\t')
  })
})

describe('Codex M1 round 3 regressions', () => {
  it('TC-IO-36 a trailing non-breaking space in an imported reference is kept, so it is reviewed, not auto-booked (R3-1)', () => {
    const imp = importBank('date,amount,reference\n2026-10-10,100,NW001 \n', 'GBP', 'replace', [])
    if (!imp.ok) throw new Error('import')
    expect(imp.value.lines[0].reference).toBe('NW001 ')
    const o = reconcile({ commitments: [{ id: 'c', name: 'C', email: '', reference: 'NW001', cashDue: 10_000, scheme: 'none' }], lines: imp.value.lines, decisions: {}, asOf: '2026-10-16', thresholdDays: 10 })
    expect(o.ok && o.result.lines[0]).toMatchObject({ status: 'suggested', assignedTo: null })
    expect(o.ok && o.result.lines[0].candidates[0].score).toBe(0.5)
  })

  it('TC-IO-37 text cells round-trip exactly, including leading tabs and spaces (R3-1)', () => {
    const rows = [
      { id: 'a', name: '\tAnn', capital: 100 },
      { id: 'b', name: ' Bob ', capital: 200 },
    ]
    const back = importHoldings(holdingsCsv(rows, null, 'GBP'), 'GBP')
    expect(back.ok && back.rows).toEqual(rows)
  })
})

describe('self-test before Codex round 4 (CSV text handling)', () => {
  it('TC-IO-38 identifier fields lose edge ASCII whitespace; the same payment is not counted twice', () => {
    const first = importBank('transaction_id,date,amount\nT1,2026-01-01,10\n', 'GBP', 'replace', [])
    if (!first.ok) throw new Error('setup')
    const again = importBank('transaction_id,date,amount\n T1 ,2026-01-01,10\n', 'GBP', 'append', first.value.lines)
    expect(again.ok && again.value.lines.length).toBe(1)
    expect(importCommitments('investor_id,name,reference,cash_due\nA1,A,NW-001,1\nA1 ,B,NW-002,1\n', 'GBP').ok).toBe(false)
  })

  it('TC-IO-39 mixed line endings do not leak a CR into the last cell', () => {
    const r = importBank('date,amount,payer\n2026-10-01,1,Bob\r\n2026-10-02,2,Ann\n', 'GBP', 'replace', [])
    expect(r.ok && r.value.lines.map((l) => l.payer)).toEqual(['Bob', 'Ann'])
    const c = importCommitments('name,cash_due,reference\nA,1,NW001\r\n', 'GBP')
    expect(c.ok && c.rows[0].reference).toBe('NW001')
  })

  it('TC-IO-40 whitespace-only optional identifiers are blank, and edge spaces in references, emails and prices are ignored', () => {
    const b = importBank('transaction_id,date,amount\n"  ",2026-10-01,1\n', 'GBP', 'replace', [])
    expect(b.ok && b.value.lines[0].txnId).toBeNull()
    const c = importCommitments('investor_id,name,email,reference,cash_due\n" ",A, a@b.com , NW001 ,1\n', 'GBP')
    expect(c.ok && c.rows[0]).toMatchObject({ email: 'a@b.com', reference: 'NW001' })
    expect(c.ok && c.rows[0].id).not.toBe(' ')
    const h = importHoldings('name,capital,share_price\nA,1," "\n', 'GBP')
    expect(h.ok && h.sharePriceMicros).toBeNull()
  })

  it('TC-IO-41 free text stays exact (R3-1 still holds)', () => {
    const r = importBank('date,amount,payer,reference\n2026-10-01,1, Bob ,NW001 \n', 'GBP', 'replace', [])
    expect(r.ok && r.value.lines[0]).toMatchObject({ payer: ' Bob ', reference: 'NW001 ' })
  })
})

describe('Codex M1 round 4 regressions', () => {
  it('TC-IO-42 mixed line endings work whichever comes first; quoted line breaks are kept (R4-1)', () => {
    const crlfFirst = importBank('date,amount,reference\r\n2026-10-10,100,NW001\n2026-10-11,100,NW002\r\n', 'GBP', 'replace', [])
    expect(crlfFirst.ok && crlfFirst.value.lines.map((l) => l.reference)).toEqual(['NW001', 'NW002'])
    const lfFirst = importBank('date,amount,reference\n2026-10-10,100,NW001\r\n2026-10-11,100,NW002\r2026-10-12,1,X\n', 'GBP', 'replace', [])
    expect(lfFirst.ok && lfFirst.value.lines.map((l) => l.reference)).toEqual(['NW001', 'NW002', 'X'])
    const quoted = importBank('date,amount,payer\r\n2026-10-10,1,"line1\r\nline2"\n', 'GBP', 'replace', [])
    expect(quoted.ok && quoted.value.lines[0].payer).toBe('line1\r\nline2')
  })

  it('TC-IO-43 parsed fields trim ASCII whitespace only; a non-breaking space is a format error (R4-2)', () => {
    expect(importCommitments('name,reference,cash_due,scheme\nA,NW001,100,\u00A0\n', 'GBP').ok).toBe(false)
    expect(importBank('date,amount\n2026-10-10,\u00A0100\u00A0\n', 'GBP', 'replace', []).ok).toBe(false)
    expect(importBank('date,amount\n 2026-10-10 , 100 \n', 'GBP', 'replace', []).ok).toBe(true)
  })
})
