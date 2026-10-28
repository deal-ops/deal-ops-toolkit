// PRD v0.8 C-X-1, R-X-08: what the reducer writes to the activity log, and how it is saved (Test Plan §2.5, 〔M5〕).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bankRow, commitmentRow, initialState, makeReducer, parseSaved, saveState, STORAGE_KEY, trimAction, type Action, type AppState } from './state'
import { deriveReconcile } from './derive'
import { decide, handoffToAllocation, reconcile } from './lib/reconcile'
import { importBank } from './lib/csv'
import { SAMPLE_BANK, SAMPLE_COMMITMENTS } from './lib/sample'
import { appendEvents, dropOldest, emptyLog, LOG_CAP, type LogEvent } from './lib/activity'
import { plainMoney } from './lib/money'

const T0 = Date.UTC(2026, 9, 23, 13, 5, 9)
const reducer = makeReducer(() => ({ epochMs: T0, offsetMinutes: 60 }))
const run = (s: AppState, ...actions: Action[]) => actions.reduce(reducer, s)
const fresh = () => initialState(new Date('2026-10-20T12:00:00Z'))
const events = (s: AppState) => s.log.entries.map((e) => e.event)

function rec(s: AppState) {
  const d = deriveReconcile(s)
  if (!d.input) throw new Error(JSON.stringify(d.errors))
  const o = reconcile(d.input)
  if (!o.ok) throw new Error('reconcile failed')
  return o.result
}

/** Decide the way the page does: confirm a candidate, or mark not part of the deal. */
function decideOn(s: AppState, txn: string, investorId: string | null, via: 'candidate' | 'any' = 'candidate'): AppState {
  const r = rec(s)
  const l = r.lines.find((x) => x.line.txnId === txn)!
  const who = investorId ? r.commitments.find((c) => c.commitment.id === investorId)!.commitment : null
  return reducer(s, { type: 'decide', lineId: l.line.id, decision: decide(l.line, who), via, prevStatus: l.status })
}

function reviewed(s = run(fresh(), { type: 'loadSample' })): AppState {
  s = decideOn(s, 't03', 'c03')
  s = decideOn(s, 't05', 'c05')
  s = decideOn(s, 't12', 'c11')
  s = decideOn(s, 't11', null)
  return decideOn(s, 't14', null)
}

const sampleCsv = () =>
  ['transaction_id,date,amount,payer,reference', ...SAMPLE_BANK.map((l) => [l.txnId, l.date, plainMoney(l.amount), l.payer, l.reference].join(','))].join('\n')

function bankImport(s: AppState, text: string, mode: 'replace' | 'append'): AppState {
  const existing = mode === 'append' ? s.bank.map((r) => ({ ...r, amount: Math.round(Number(r.amount) * 100) })) : []
  const r = importBank(text, s.deal.currency, mode, existing)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  const added = r.value.lines.slice(existing.length).map(bankRow)
  return reducer(s, { type: 'importBank', mode, rows: mode === 'append' ? [...s.bank, ...added] : added })
}

describe('C-X-1 events written by the reducer', () => {
  it('TC-X-05 sample, review, hand-off and one copied message, in order, numbered, timed and initialled', () => {
    let s = run(fresh(), { type: 'setDeal', patch: { initials: 'HY' } }, { type: 'loadSample' })
    expect(s.deal.initials).toBe('HY') // loading the sample keeps the initials
    s = reviewed(s)
    const h = handoffToAllocation(rec(s))
    if (!h.ok) throw new Error(h.reason)
    s = run(s, { type: 'handoff', handoff: h.value }, { type: 'messageCopied', template: 'A', investorId: 'c04', investorName: 'David Kim' })
    expect(events(s)).toEqual<LogEvent[]>([
      'sample_loaded',
      'confirm',
      'confirm',
      'confirm',
      'not_in_deal',
      'not_in_deal',
      'handoff_allocation',
      'message_copied',
    ])
    expect(s.log.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    for (const e of s.log.entries) expect([e.time, e.initials, e.currency]).toEqual(['2026-10-23T14:05:09+01:00', 'HY', 'GBP'])
    const chloe = s.log.entries[1]
    expect(chloe).toMatchObject({ investorId: 'c03', investorName: 'Chloe Martin', transactionId: 't03', amount: 2_000_000 })
    expect(chloe.detail).toBe('Needs review → Confirmed by you')
    expect(s.log.entries[4].detail).toMatch(/→ Not part of this deal$/)
    const handoff = s.log.entries[6]
    expect(handoff.detail).toMatch(/^snapshot v\d+ · 12 investors$/)
    expect(handoff.amount).toBe(h.value.investors.reduce((a, v) => a + v.received, 0))
    expect(s.log.entries[7]).toMatchObject({ investorName: 'David Kim', detail: 'template A' })
    expect(JSON.stringify(s.log.entries[7])).not.toContain('Hi David')
    // "Assign to…" is an assign, not a confirm; undo goes back to review
    let t = decideOn(run(fresh(), { type: 'loadSample' }), 't03', 'c03', 'any')
    expect(t.log.entries[1]).toMatchObject({ event: 'assign', detail: 'Needs review → Confirmed by you · assigned to Chloe Martin' })
    const line = rec(t).lines.find((l) => l.line.txnId === 't03')!
    t = reducer(t, { type: 'undoDecision', lineId: line.line.id, prevStatus: line.status })
    expect(t.log.entries[2]).toMatchObject({ event: 'undo', transactionId: 't03', investorName: 'Chloe Martin', detail: 'Confirmed by you → Needs review' })
  })

  it('TC-X-06 editing a decided line voids its decision once; typing into a name logs nothing', () => {
    let s = reviewed()
    const before = s.log.entries.length
    const i = s.bank.findIndex((r) => r.txnId === 't03')
    s = reducer(s, { type: 'editBank', index: i, rowId: s.bank[i].id, field: 'amount', value: '19999' })
    expect(events(s).slice(before)).toEqual(['decision_voided'])
    expect(s.log.entries[before]).toMatchObject({ transactionId: 't03', investorName: 'Chloe Martin', detail: 'line changed' })
    const n = s.log.entries.length
    const ben = s.commitments.findIndex((c) => c.id === 'c02')
    for (const v of ['B', 'Be', 'Ben', 'Ben O', 'Ben Okafor-Smith'])
      s = reducer(s, { type: 'editCommitment', index: ben, rowId: 'c02', field: 'name', value: v })
    expect(s.log.entries.length).toBe(n)
  })

  it('TC-X-13 a replacing import that clears 5 decisions is one entry; deleting a decided line is one more', () => {
    let s = bankImport(reviewed(), readFileSync('fixtures/bank.csv', 'utf8'), 'replace')
    const voided = s.log.entries.filter((e) => e.event === 'decision_voided')
    expect(voided.length).toBe(1)
    expect(voided[0].detail).toMatch(/^5 decisions voided \(statement imported/)
    // decide one of the new lines by hand, then delete it
    const open = rec(s).lines[0]
    s = reducer(s, { type: 'decide', lineId: open.line.id, decision: decide(open.line, null), prevStatus: open.status })
    const n = s.log.entries.length
    s = reducer(s, { type: 'deleteBank', index: s.bank.findIndex((b) => b.id === open.line.id) })
    expect(events(s).slice(n)).toEqual(['decision_voided'])
    expect(s.log.entries[n].detail).toBe('line deleted')
  })

  it('TC-X-17 import entries count the receipts each import booked automatically', () => {
    // ① the sample's own statement, replacing: 9 receipts book automatically
    let s = bankImport(reviewed(), sampleCsv(), 'replace')
    const imports = () => s.log.entries.filter((e) => e.event === 'import')
    expect(imports()[0].detail).toBe('bank statement · replace · 16 rows added · 9 auto-booked')
    // ② the same file appended: every row is a duplicate and is ignored
    s = bankImport(s, sampleCsv(), 'append')
    expect(imports()[1].detail).toBe('bank statement · append · 0 rows added · 0 auto-booked')
    // ③ a new investor list in which Kavya's reference is the one she typed: t12 now matches exactly
    const rows = SAMPLE_COMMITMENTS.map((c) => commitmentRow(c.id === 'c11' ? { ...c, reference: 'NW-11' } : c))
    s = reducer(s, { type: 'replaceCommitments', rows })
    expect(imports()[2].detail).toBe('investor list · replace · 12 rows added · 1 auto-booked')
  })

  it('TC-X-16 invalid initials leave entries unsigned; changing them is not logged', () => {
    let s = run(fresh(), { type: 'loadSample' }, { type: 'setDeal', patch: { initials: 'H@Y' } })
    const n = s.log.entries.length
    s = decideOn(s, 't03', 'c03')
    expect(s.log.entries[n].initials).toBe('')
    s = reducer(s, { type: 'setDeal', patch: { initials: 'HY' } })
    expect(s.log.entries.length).toBe(n + 1)
    s = decideOn(s, 't05', 'c05')
    expect(s.log.entries[n + 1].initials).toBe('HY')
  })

  it('TC-X-18 each entry keeps the currency it was written in', () => {
    let s = decideOn(run(fresh(), { type: 'loadSample' }), 't03', 'c03')
    s = reducer(s, { type: 'setDeal', patch: { currency: 'USD' } })
    s = decideOn(s, 't05', 'c05')
    s = reducer(s, { type: 'messageCopied', template: 'A', investorId: 'c04', investorName: 'David Kim' })
    const [, first, ...rest] = s.log.entries
    expect(first.currency).toBe('GBP')
    expect(rest.map((e) => e.currency)).toEqual(rest.map(() => 'USD'))
    expect(rest.at(-1)!.amount).toBeNull() // no amount, still the currency of the moment
  })

  it('TC-X-09 clearing empties the log; loading the sample leaves only sample_loaded', () => {
    let s = reviewed()
    s = run(s, { type: 'logExported' })
    expect(events(s).at(-1)).toBe('log_exported')
    s = run(s, { type: 'clearAll' })
    expect(s.log).toEqual(emptyLog())
    expect(s.deal.initials).toBe('')
    s = run(reviewed(), { type: 'loadSample' })
    expect(events(s)).toEqual(['sample_loaded'])
    expect(s.log.entries[0].seq).toBe(1)
  })

  it('TC-X-05 a log that cannot be written never stops the action', () => {
    const broken = makeReducer(() => {
      throw new Error('clock gone')
    })
    const s = broken(run(fresh(), { type: 'loadSample' }), { type: 'setDeal', patch: { name: 'Still renamed' } })
    expect(s.deal.name).toBe('Still renamed')
    const t = broken(s, { type: 'loadSample' })
    expect(t.commitments.length).toBe(12)
    expect(t.log.entries).toEqual([])
  })
})

describe('saving with the log (R-X-08.5)', () => {
  it('TC-X-08 a full store drops the oldest entries and saves the deal; if nothing fits, the full message and the log stays', () => {
    let s = reviewed()
    s = {
      ...s,
      log: appendEvents(
        s.log,
        Array.from({ length: 1_200 }, () => ({ event: 'confirm' as const })),
        { time: 'x', initials: '', currency: 'GBP' },
      ),
    }
    const store = new Map<string, string>()
    let fails = 2
    const flaky = {
      setItem: (k: string, v: string) => {
        if (fails-- > 0) throw new DOMException('full', 'QuotaExceededError')
        store.set(k, v)
      },
    }
    const saved = saveState(flaky, s)
    expect(saved.result).toBe('saved')
    expect(saved.log!.entries.length).toBe(s.log.entries.length - 1_000) // two retries of 500
    expect(saved.log!.truncated).toMatchObject({ count: 1_000, fromSeq: 1, toSeq: 1_000 })
    const back = parseSaved(store.get(STORAGE_KEY)!)!
    expect(back.commitments).toEqual(s.commitments)
    expect(back.decisions).toEqual(s.decisions)
    expect(back.log.truncated!.count).toBe(1_000)
    const never = {
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
    }
    const out = saveState(never, s)
    expect(out).toEqual({ result: 'full', log: null })
    expect(s.log.entries.length).toBe(1_206) // the log in memory is untouched, so it can still be exported
    expect(saveState(flaky, { ...s, log: emptyLog() }).result).toBe('saved')
  })

  it('TC-X-08 at the largest size, a browser counting 5 MiB in UTF-16 bytes keeps the deal and trims the log', () => {
    const long = (i: number) => `Investor ${String(i).padStart(3, '0')} ${'Longname-Doublebarrel '.repeat(2)}`.slice(0, 55)
    const commitments = Array.from({ length: 500 }, (_, i) => ({
      id: `c${i}`,
      name: long(i),
      email: `investor${i}@example.com`,
      reference: `REF-${i}`,
      cashDue: '1000.00',
      scheme: 'none',
    }))
    const bank = Array.from({ length: 2_000 }, (_, i) => ({
      id: `l${i}`,
      txnId: `T${i}`,
      date: '2026-10-01',
      amount: '250.00',
      payer: long(i % 500).toUpperCase(),
      reference: `NOT A REFERENCE ${i}`,
    }))
    const decisions = Object.fromEntries(
      bank.map((b, i) => [
        b.id,
        { kind: 'assign' as const, commitmentId: `c${i % 500}`, lineFp: JSON.stringify(b), commitmentFp: JSON.stringify(commitments[i % 500]) },
      ]),
    )
    const meta = { time: '2026-10-23T14:05:09+01:00', initials: 'HY', currency: 'GBP' as const }
    const log = appendEvents(
      emptyLog(),
      Array.from({ length: LOG_CAP }, (_, i) => ({
        event: 'confirm' as const,
        investorId: `c${i % 500}`,
        investorName: long(i % 500),
        transactionId: `T${i}`,
        amount: 25_000,
        detail: `Needs review → Confirmed by you · assigned to ${long(i % 500)}`,
      })),
      meta,
    )
    const s: AppState = { ...fresh(), commitments, bank, decisions, log }
    const LIMIT = 5 * 1024 * 1024
    const store = new Map<string, string>()
    const bytes = {
      setItem: (k: string, v: string) => {
        if ((k.length + v.length) * 2 > LIMIT) throw new DOMException('full', 'QuotaExceededError')
        store.set(k, v)
      },
    }
    const out = saveState(bytes, s)
    expect(out.result).toBe('saved')
    expect(out.log!.entries.length).toBeLessThan(LOG_CAP)
    const back = parseSaved(store.get(STORAGE_KEY)!)!
    expect(back.commitments.length).toBe(500)
    expect(Object.keys(back.decisions).length).toBe(2_000)
  })
})

describe('reading saved data (Tech Design §9.1)', () => {
  it('TC-X-10 data saved by v1.1.1 (schema 1) loads with the new fields empty', () => {
    const now = JSON.parse(JSON.stringify(reviewed()))
    const old = { ...now, schema: 1 }
    delete old.withdrawals
    delete old.feePayerChanges
    delete old.log
    delete old.deal.initials
    delete old.allocation.editedSinceHandoff
    const s = parseSaved(JSON.stringify(old))!
    expect(s.schema).toBe(2)
    expect(s.commitments).toEqual(now.commitments)
    expect(s.bank).toEqual(now.bank)
    expect(s.decisions).toEqual(now.decisions)
    expect({ ...s.withdrawals }).toEqual({})
    expect(s.feePayerChanges).toEqual([])
    expect(s.log).toEqual(emptyLog())
    expect(s.deal.initials).toBe('')
    expect(s.allocation.editedSinceHandoff).toBe(true) // unknown, so a fee payer change waits for a new hand-off
  })

  it('TC-X-19 schema 2 without withdrawals or fee payer changes is not read; without a log it is', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    for (const k of ['withdrawals', 'feePayerChanges']) {
      const bad = { ...good }
      delete bad[k]
      expect(parseSaved(JSON.stringify(bad))).toBeNull()
    }
    const noLog = { ...good }
    delete noLog.log
    const s = parseSaved(JSON.stringify(noLog))!
    expect(s.commitments).toEqual(good.commitments)
    expect(s.log).toEqual(emptyLog())
    expect(parseSaved(JSON.stringify(good))!.log).toEqual(good.log)
  })

  it('TC-X-19 damaged money fields refuse the whole save; a damaged log loses only the log', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    const w = { on: '2026-10-16', consent: true, reference: 'NW012' }
    expect(parseSaved(JSON.stringify({ ...good, withdrawals: { c12: w } }))!.withdrawals.c12).toEqual(w)
    for (const bad of [{ c12: { ...w, consent: false } }, { c12: { ...w, on: '2026-02-31' } }, { c12: { ...w, reference: 3 } }, []])
      expect(parseSaved(JSON.stringify({ ...good, withdrawals: bad }))).toBeNull()
    expect(parseSaved(JSON.stringify({ ...good, feePayerChanges: [{ id: 'x', status: 'active' }] }))).toBeNull()
    const entries = good.log.entries
    const broken = { ...good, log: { ...good.log, entries: [entries[1], entries[0], ...entries.slice(2)] } }
    const s = parseSaved(JSON.stringify(broken))!
    expect(s.decisions).toEqual(good.decisions)
    expect(s.log.entries).toEqual([])
    expect(s.log.nextSeq).toBe(entries.length + 1) // numbering carries on after the highest seq seen
    expect(s.log.truncated).toMatchObject({ count: entries.length, unexported: entries.length })
  })
})

describe('hostile inputs (Rules G2 step 0)', () => {
  it('TC-REC-45 names and deal names with quotes, line breaks, commas and emoji survive the chase list CSV exactly', async () => {
    const Papa = (await import('papaparse')).default
    const { chaseListCsv } = await import('./lib/exports')
    let s = run(fresh(), { type: 'loadSample' })
    const i = s.commitments.findIndex((c) => c.id === 'c04')
    s = reducer(s, { type: 'editCommitment', index: i, rowId: 'c04', field: 'name', value: 'D "Dee" Kim,\nJr 🚀' })
    const deal = '=SUM(A1) "Seed", 2026'
    const csv = chaseListCsv(rec(s), 'GBP', deal)
    const rows = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data
    const message = rows.find((r) => r[0] === 'c04')![9]
    expect(message.startsWith('Hi D "Dee" Kim,\nJr 🚀,\n\nFor =SUM(A1) "Seed", 2026, we have received')).toBe(true)
  })

  it('TC-X-19 an investor ID "__proto__" stays data in withdrawals and log entries', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    // Lucas saved under the ID "__proto__", withdrawn (a mark for someone not on the list is voided on load, M6)
    const raw = JSON.stringify({ ...good, withdrawals: {} })
      .replaceAll('"id":"c12"', '"id":"__proto__"')
      .replace('"withdrawals":{}', '"withdrawals":{"__proto__":{"on":"2026-10-16","consent":true,"reference":"NW012"}}')
    const s = parseSaved(raw)!
    expect(Object.hasOwn(s.withdrawals, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).on).toBeUndefined()
    const t = reducer(s, { type: 'messageCopied', template: 'A', investorId: '__proto__', investorName: '<img src=x onerror=alert(1)>' })
    expect(t.log.entries.at(-1)).toMatchObject({ investorId: '__proto__', investorName: '<img src=x onerror=alert(1)>' })
  })

  it('TC-X-19 crafted log values are refused, never trusted', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    const e = good.log.entries[0]
    for (const bad of [
      { ...e, event: 'drop_table' },
      { ...e, amount: 1.5 },
      { ...e, currency: 'JPY' },
      { ...e, seq: 0 },
      { ...e, detail: 5 },
    ]) {
      const s = parseSaved(JSON.stringify({ ...good, log: { ...good.log, entries: [bad, ...good.log.entries.slice(1)] } }))!
      expect(s.log.entries).toEqual([])
      expect(s.commitments).toEqual(good.commitments)
    }
    const big = parseSaved(
      JSON.stringify({ ...good, log: { ...good.log, entries: Array.from({ length: LOG_CAP + 1 }, (_, k) => ({ ...e, seq: k + 1 })), nextSeq: LOG_CAP + 2 } }),
    )!
    expect(big.log.entries).toEqual([])
    expect(big.log.nextSeq).toBe(LOG_CAP + 2)
    expect(parseSaved(JSON.stringify({ ...good, log: { ...good.log, nextSeq: 1 } }))!.log.entries).toEqual([]) // nextSeq not after the last entry
  })

  it('perf: saving the largest state with a full log takes well under a second', () => {
    const meta = { time: '2026-10-23T14:05:09+01:00', initials: 'HY', currency: 'GBP' as const }
    const log = appendEvents(
      emptyLog(),
      Array.from({ length: LOG_CAP }, (_, k) => ({ event: 'confirm' as const, investorName: `Investor ${k}`, detail: 'x'.repeat(200) })),
      meta,
    )
    const s = { ...reviewed(), log }
    const t = performance.now()
    JSON.stringify(s)
    expect(performance.now() - t).toBeLessThan(500)
  })
})

describe('M5 self-test review fixes', () => {
  it('TC-X-06 clearing a decision that was already voided says so, and names the status the line has now', () => {
    let s = decideOn(run(fresh(), { type: 'loadSample' }), 't03', 'c03')
    const i = s.bank.findIndex((r) => r.txnId === 't03')
    s = reducer(s, { type: 'editBank', index: i, rowId: s.bank[i].id, field: 'amount', value: '19999' })
    expect(events(s).at(-1)).toBe('decision_voided')
    s = reducer(s, { type: 'undoDecision', lineId: s.bank[i].id, prevStatus: 'suggested' })
    expect(s.log.entries.at(-1)!.detail).toBe('old decision cleared · Earlier decision, no longer valid → Needs review')
    // undo of a live decision on a line that then books itself names that status, not "review"
    let t = run(fresh(), { type: 'loadSample' })
    const r = rec(t).lines.find((l) => l.line.txnId === 't01')!
    t = reducer(t, { type: 'decide', lineId: r.line.id, decision: decide(r.line, null), prevStatus: r.status })
    t = reducer(t, { type: 'undoDecision', lineId: r.line.id, prevStatus: 'rejected' })
    expect(t.log.entries.at(-1)!.detail).toBe('Not part of this deal → Matched automatically')
  })

  it('TC-X-06 an investor ID changed by hand voids as "investor changed"; a deleted investor as "investor deleted", one entry per decision', () => {
    let s = decideOn(decideOn(run(fresh(), { type: 'loadSample' }), 't03', 'c03'), 't05', 'c03', 'any')
    const i = s.commitments.findIndex((c) => c.id === 'c03')
    const n = s.log.entries.length
    s = reducer(s, { type: 'editCommitment', index: i, rowId: 'c03', field: 'id', value: 'c03x' })
    expect(s.log.entries.slice(n).map((e) => [e.event, e.transactionId, e.detail])).toEqual([
      ['decision_voided', 't03', 'investor changed'],
      ['decision_voided', 't05', 'investor changed'],
    ])
    let t = decideOn(decideOn(run(fresh(), { type: 'loadSample' }), 't03', 'c03'), 't05', 'c03', 'any')
    const m = t.log.entries.length
    t = reducer(t, { type: 'deleteCommitment', index: t.commitments.findIndex((c) => c.id === 'c03') })
    expect(t.log.entries.slice(m).map((e) => e.detail)).toEqual(['investor deleted', 'investor deleted'])
  })

  it('TC-X-19 a damaged log keeps counting after everything it held or had removed; an inconsistent truncated line is refused', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    const e = { ...good.log.entries[0], seq: 10 }
    const read = (log: unknown) => parseSaved(JSON.stringify({ ...good, log }))!.log
    // (a) a bad entry: the earlier removals are kept in the count
    const a = read({ entries: [{ ...e, event: 'bogus' }], nextSeq: 11, lastExportedSeq: 0, truncated: { count: 9, fromSeq: 1, toSeq: 9, unexported: 9 } })
    expect(a.truncated).toEqual({ count: 10, fromSeq: 1, toSeq: 10, unexported: 10 })
    expect(a.nextSeq).toBe(11)
    // (b) a bad truncated line: numbering still carries on after the saved nextSeq
    const b = read({ entries: [], nextSeq: 4001, lastExportedSeq: 0, truncated: { count: 4000, fromSeq: 1, toSeq: 4000, unexported: 'x' } })
    expect(b.nextSeq).toBe(4001)
    // (c) removed entries numbered at or after the next seq: refused, so seq 1 is never used twice
    const c = read({ entries: [], nextSeq: 1, lastExportedSeq: 0, truncated: { count: 4000, fromSeq: 1, toSeq: 4000, unexported: 0 } })
    expect(c.nextSeq).toBe(4001)
    expect(read({ entries: [e], nextSeq: 11, lastExportedSeq: 0, truncated: { count: 10, fromSeq: 1, toSeq: 10, unexported: 0 } }).entries).toEqual([])
    const ok = { entries: [e], nextSeq: 11, lastExportedSeq: -1, truncated: { count: 9, fromSeq: 1, toSeq: 9, unexported: 0 } }
    expect(read(ok).entries).toEqual([]) // negative lastExportedSeq
    expect(read({ ...ok, lastExportedSeq: 0 }).entries).toEqual([e])
  })

  it('TC-X-19 a saved fee payer change is checked as money and its targets keep IDs like "toString" as data', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    const fee = { id: 'platform', label: 'Platform fee', payer: 'investors', kind: 'percent', value: 300 }
    const change = {
      id: 'fpc-1',
      feeId: 'platform',
      feeLabel: 'Platform fee',
      from: 'investors',
      to: 'company',
      consent: true,
      appliedAt: '2026-10-23T14:05:09+01:00',
      status: 'reversed',
      voidReason: null,
      feeAtApply: { rateBps: 300, basis: 'deducted' },
      settingsAtApply: { minimum: 97_000, cap: 15_000_000, priceMicros: 5_000_000, basis: 'deducted', fees: [fee] },
      targets: { c01: 970_000 },
      lines: [{ investorId: 'c01', reference: 'NW001', baseCashDue: 1_000_000, newCashDue: 970_000, voided: false, voidReason: null }],
    }
    const read = (c: unknown) => parseSaved(JSON.stringify({ ...good, feePayerChanges: [c] }))
    const s = read(change)!
    expect(s.feePayerChanges[0].targets.c01).toBe(970_000)
    expect(typeof s.feePayerChanges[0].targets['toString']).toBe('undefined')
    for (const bad of [
      { ...change, feeAtApply: { rateBps: -5, basis: 'deducted' } },
      { ...change, settingsAtApply: { ...change.settingsAtApply, minimum: -1 } },
      { ...change, settingsAtApply: { ...change.settingsAtApply, priceMicros: 0 } },
      { ...change, settingsAtApply: { ...change.settingsAtApply, fees: ['junk'] } },
      { ...change, settingsAtApply: { ...change.settingsAtApply, fees: [{ ...fee, value: 20_000 }] } },
      { ...change, targets: { c01: 0 } },
      { ...change, status: 'pending' },
      { ...change, lines: [change.lines[0], change.lines[0]] },
    ])
      expect(read(bad)).toBeNull()
    expect(
      parseSaved(
        JSON.stringify({
          ...good,
          feePayerChanges: [
            { ...change, status: 'active' },
            { ...change, id: 'b', status: 'active' },
          ],
        }),
      ),
    ).toBeNull()
  })
})

describe('M5 Codex review fixes', () => {
  it('TC-X-19 a log with a null entry loses only the log, never the deal (Codex M5 #1)', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    for (const entries of [[null], [good.log.entries[0], null], [42], ['x']]) {
      const s = parseSaved(JSON.stringify({ ...good, log: { ...good.log, entries } }))!
      expect(s.commitments).toEqual(good.commitments)
      expect(s.bank).toEqual(good.bank)
      expect(s.log.truncated?.count).toBe(entries.length) // and the lost entries are counted, not silently dropped
    }
    expect(parseSaved(JSON.stringify({ ...good, log: 'junk' }))!.commitments).toEqual(good.commitments)
  })

  it('TC-X-19 a recovered log is accepted again after a save and reload, and keeps its count (Codex M5 #2)', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    const first = parseSaved(JSON.stringify({ ...good, log: { entries: [{}, {}], nextSeq: 1, lastExportedSeq: 0, truncated: null } }))!
    expect(first.log.truncated).toEqual({ count: 2, fromSeq: 1, toSeq: 2, unexported: 2 })
    expect(first.log.nextSeq).toBe(3)
    const after = reducer(first, { type: 'messageCopied', template: 'A', investorId: 'c04', investorName: 'David Kim' })
    const again = parseSaved(JSON.stringify(after))!
    expect(again.log).toEqual(after.log)
    expect(again.log.entries.map((e) => e.seq)).toEqual([3])
  })
})

describe('M5 Codex round 2 fixes', () => {
  it('TC-X-19 hostile log values that throw on coercion, and huge arrays, keep the numbering (Codex M5 r2 #2)', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    const e = { ...good.log.entries[0], seq: 41 }
    const raw = JSON.stringify({ ...good, log: { ...good.log, entries: [e], nextSeq: 42 } }).replace(
      `"currency":"GBP","detail"`,
      `"currency":{"toString":null},"detail"`,
    )
    const s = parseSaved(raw)!
    expect(s.commitments).toEqual(good.commitments)
    expect(s.log.nextSeq).toBe(42)
    expect(s.log.truncated).toMatchObject({ count: 1, toSeq: 41 })
    const huge = Array.from({ length: 150_000 }, (_, i) => ({ seq: i + 1 }))
    const t = parseSaved(JSON.stringify({ ...good, log: { ...good.log, entries: huge, nextSeq: 150_001 } }))!
    expect(t.log.nextSeq).toBe(150_001)
    expect(t.log.truncated!.count).toBe(150_000)
  })

  it('TC-X-19 saved enums must be real strings: arrays and coercible objects are refused (Codex M5 r2 #3)', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    expect(parseSaved(JSON.stringify({ ...good, deal: { ...good.deal, currency: ['GBP'] } }))).toBeNull()
    expect(parseSaved(JSON.stringify({ ...good, deal: { ...good.deal, feeBasis: ['deducted'] } }))).toBeNull()
    const fee = { id: 'platform', label: 'Platform fee', payer: 'investors', kind: 'percent', value: 300 }
    const change = {
      id: 'a',
      feeId: 'platform',
      feeLabel: 'Platform fee',
      from: 'investors',
      to: 'company',
      consent: true,
      appliedAt: 't',
      status: 'reversed',
      voidReason: null,
      feeAtApply: { rateBps: 300, basis: 'deducted' },
      settingsAtApply: { minimum: 0, cap: null, priceMicros: 5_000_000, basis: 'deducted', fees: [fee] },
      targets: {},
      lines: [],
    }
    const read = (cs: unknown[]) => parseSaved(JSON.stringify({ ...good, feePayerChanges: cs }))
    expect(read([change])).not.toBeNull()
    expect(
      read([
        { ...change, status: ['active'] },
        { ...change, id: 'b', status: ['active'] },
      ]),
    ).toBeNull()
    expect(read([{ ...change, from: ['investors'] }])).toBeNull()
    expect(read([{ ...change, feeAtApply: { rateBps: 300, basis: ['deducted'] } }])).toBeNull()
    expect(read([{ ...change, settingsAtApply: { ...change.settingsAtApply, fees: [{ ...fee, payer: ['investors'] }] } }])).toBeNull()
  })

  it('TC-X-08 a trim acknowledged after a newer entry keeps that entry; one for a replaced log is ignored (Codex M5 r2 #4)', () => {
    const base = reviewed()
    const source = base.log
    const trimmed = dropOldest(source, 3)
    const trim = trimAction(source, trimmed)!
    expect(trim).toEqual({ type: 'logTrimmed', last: source.entries[2] })
    const newer = reducer(base, { type: 'messageCopied', template: 'B', investorId: 'c03', investorName: 'Chloe Martin', transactionId: 't03' })
    const after = reducer(newer, trim)
    expect(after.log.entries.map((e) => e.seq)).toEqual([...trimmed.entries.map((e) => e.seq), source.nextSeq])
    expect(after.log.nextSeq).toBe(newer.log.nextSeq)
    expect(after.log.truncated).toEqual(trimmed.truncated)
    expect(reducer(base, trim).log).toEqual(trimmed)
    const reloaded = reducer(newer, { type: 'loadSample' })
    expect(reducer(reloaded, trim).log).toBe(reloaded.log)
  })

  it('TC-X-08 a trim acknowledged after many new entries never goes over the cap or loses either removal (Codex M5 r4 #1)', () => {
    const meta = { time: 't', initials: '', currency: 'GBP' as const }
    let s = reviewed()
    s = {
      ...s,
      log: appendEvents(
        s.log,
        Array.from({ length: LOG_CAP }, () => ({ event: 'confirm' as const })),
        meta,
      ),
    }
    const source = s.log // 5,000 entries; the first few were removed by the cap already
    const saved = saveState(
      {
        setItem: (_k: string, v: string) => {
          if (v.length > JSON.stringify({ ...s, log: dropOldest(source, 500) }).length) throw new DOMException('full', 'QuotaExceededError')
        },
      },
      s,
    )
    expect(saved.log!.entries.length).toBe(LOG_CAP - 500)
    // 600 more entries arrive before the acknowledgement
    const busy = {
      ...s,
      log: appendEvents(
        source,
        Array.from({ length: 600 }, () => ({ event: 'decision_voided' as const })),
        meta,
      ),
    }
    const after = reducer(busy, trimAction(source, saved.log)!)
    expect(after.log.entries.length).toBeLessThanOrEqual(LOG_CAP)
    expect(after.log.entries.at(-1)!.seq).toBe(busy.log.nextSeq - 1)
    // every seq ever written is either kept or counted as removed
    expect(after.log.truncated!.count + after.log.entries.length).toBe(after.log.nextSeq - 1)
    expect(parseSaved(JSON.stringify(after))!.log).toEqual(after.log)
  })

  it('TC-X-05 the exit hand-off entry has the snapshot version, the number of holdings and their total', async () => {
    const { stateAt, STEPS } = await import('./tour/script')
    const end = stateAt(STEPS.length, fresh())
    const exit = end.log.entries.find((e) => e.event === 'handoff_exit')!
    expect(exit.detail).toMatch(/^snapshot v\d+ · 11 holdings · guided tour$/)
    expect(end.exit.holdings).toHaveLength(11) // James is not in this close
    expect(exit.amount).toBe(end.exit.holdings.reduce((a, h) => a + Math.round(Number(h.capital) * 100), 0))
  })

  it('TC-X-17 an append mixing duplicates and new receipts counts only the new rows and what they booked', () => {
    let s = run(fresh(), { type: 'loadSample' })
    const csv = [
      'transaction_id,date,amount,payer,reference',
      ...SAMPLE_BANK.slice(0, 2).map((l) => [l.txnId, l.date, plainMoney(l.amount), l.payer, l.reference].join(',')), // already there
      'n1,2026-10-15,500.00,L MEYER,NW-012', // books to Lucas
      'n2,2026-10-15,99.00,SOMEONE,NO REF', // does not
    ].join('\n')
    s = bankImport(s, csv, 'append')
    expect(s.log.entries.at(-1)!.detail).toBe('bank statement · append · 2 rows added · 1 auto-booked')
  })
})

describe('M5 Codex round 3 fixes', () => {
  const good = () => JSON.parse(JSON.stringify(reviewed()))
  const read = (log: unknown) => parseSaved(JSON.stringify({ ...good(), log }))!.log

  it('TC-X-19 one damaged field of the truncated line keeps the others: numbering and count survive (Codex M5 r3 #3)', () => {
    const log = read({ entries: [], nextSeq: 2, lastExportedSeq: 0, truncated: { count: 100, fromSeq: 1, toSeq: 100, unexported: 'damaged' } })
    expect(log.nextSeq).toBe(101)
    expect(log.truncated).toEqual({ count: 100, fromSeq: 1, toSeq: 100, unexported: 100 })
    // each source of the numbering counts on its own: the removed range alone, or the saved nextSeq alone
    expect(read({ entries: [], nextSeq: 2, lastExportedSeq: 0, truncated: { count: 10, fromSeq: 91, toSeq: 100, unexported: 'x' } }).nextSeq).toBe(101)
    expect(read({ entries: [{ seq: 'unreadable' }], nextSeq: 50, lastExportedSeq: 0, truncated: null }).nextSeq).toBe(50)
  })

  it('TC-X-07 an export mark ahead of the log is not trusted (Codex M5 r3 #4)', () => {
    const e = good().log.entries[0]
    const log = read({ entries: [e], nextSeq: 2, lastExportedSeq: 10_000, truncated: null })
    expect(log.lastExportedSeq).toBe(0)
    const full = appendEvents(
      log,
      Array.from({ length: LOG_CAP }, () => ({ event: 'confirm' as const })),
      { time: 't', initials: '', currency: 'GBP' },
    )
    expect(full.truncated!.unexported).toBe(full.truncated!.count)
  })

  it('TC-X-19 numbering near the float limit never repeats a number, across a save and reload (Codex M5 r3 #5, r4 #4)', () => {
    const meta = { time: 't', initials: '', currency: 'GBP' as const }
    for (const start of [1_000_000_000_000, Number.MAX_SAFE_INTEGER - 3, Number.MAX_SAFE_INTEGER]) {
      let s = { ...reviewed(), log: read({ entries: [], nextSeq: start, lastExportedSeq: 0, truncated: null }) }
      const seen: number[] = []
      for (let k = 0; k < 4; k++) {
        const before = s.log.entries.length
        s = { ...s, log: appendEvents(s.log, [{ event: 'confirm' }], meta) }
        if (s.log.entries.length > before) seen.push(s.log.entries.at(-1)!.seq) // at the very end, nothing more is numbered
        s = parseSaved(JSON.stringify(s))! // save and reload between appends
        expect(s.log.nextSeq).toBeGreaterThan(Math.max(0, ...seen))
      }
      expect(new Set(seen).size).toBe(seen.length)
      for (const n of seen) expect(Number.isSafeInteger(n)).toBe(true)
    }
  })
})

describe('M5 Codex round 5 fixes', () => {
  it('TC-X-19 a bank line id "__proto__" with no decision logs no decision_voided when deleted (Codex M5 r5 #1)', () => {
    const good = JSON.parse(JSON.stringify(run(fresh(), { type: 'loadSample' })))
    good.decisions = {}
    good.bank[0].id = '__proto__'
    let s = parseSaved(JSON.stringify(good))!
    expect(s.bank[0].id).toBe('__proto__')
    const m = s.log.entries.length
    s = reducer(s, { type: 'deleteBank', index: 1 })
    s = reducer(s, { type: 'deleteBank', index: 0 })
    expect(s.log.entries.slice(m).map((e) => e.event)).not.toContain('decision_voided')
    expect(reducer(s, { type: 'undoDecision', lineId: '__proto__' }).log.entries.length).toBe(s.log.entries.length)
  })

  it('TC-X-19 a readable fromSeq alone keeps numbering past it when toSeq is damaged (Codex M5 r5 #2)', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    const log = parseSaved(
      JSON.stringify({ ...good, log: { entries: [], nextSeq: 2, lastExportedSeq: 0, truncated: { count: 10, fromSeq: 91, toSeq: 'damaged', unexported: 0 } } }),
    )!.log
    expect(log.nextSeq).toBe(92)
    const after = appendEvents(
      log,
      Array.from({ length: 81 }, () => ({ event: 'confirm' as const })),
      { time: 't', initials: '', currency: 'GBP' },
    )
    expect(after.entries.map((e) => e.seq)).not.toContain(91)
    // the recovered log survives a save and reload unchanged
    const again = parseSaved(JSON.stringify({ ...good, log: after }))!.log
    expect(again).toEqual(after)
  })
})
