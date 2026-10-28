// PRD v0.8 (Test Plan §2.5, 〔M6〕): withdrawal before closing (C-REC-7) and changing who pays a fee (C-ALL-10/11),
// through the reducer the page uses, with a fixed clock.
import { describe, expect, it } from 'vitest'
import {
  allocationStale,
  bankRow,
  commitmentRow,
  currencyLocked,
  feePayerChangeBlock,
  initialState,
  makeReducer,
  parseSaved,
  type Action,
  type AppState,
} from './state'
import { deriveAllocation, deriveChangeRecheck, deriveReconcile } from './derive'
import { decide, handoffToAllocation, reconcile } from './lib/reconcile'
import { allocate } from './lib/allocation'
import { adjustmentNote, changeBanner, withdrawalProblem, withdrawnSummary } from './lib/adjust'
import { chaseListCsv, closingConfirmation, ledgerCsv } from './lib/exports'
import { chaseMessage } from './lib/messages'

const T0 = Date.UTC(2026, 9, 26, 10, 0, 0)
const reducer = makeReducer(() => ({ epochMs: T0, offsetMinutes: 0 }))
const run = (s: AppState, ...actions: Action[]) => actions.reduce(reducer, s)
const fresh = () => initialState(new Date('2026-10-20T12:00:00Z'))
const events = (s: AppState) => s.log.entries.map((e) => e.event)

function rec(s: AppState) {
  const d = deriveReconcile(s)
  if (!d.input) throw new Error(JSON.stringify(d.errors))
  const o = reconcile(d.input)
  if (!o.ok) throw new Error('reconcile failed')
  return o
}
const row = (s: AppState, id: string) => rec(s).result.commitments.find((c) => c.commitment.id === id)!

function decideOn(s: AppState, txn: string, investorId: string | null): AppState {
  const r = rec(s).result
  const l = r.lines.find((x) => x.line.txnId === txn)!
  const who = investorId ? r.commitments.find((c) => c.commitment.id === investorId)!.commitment : null
  return reducer(s, { type: 'decide', lineId: l.line.id, decision: decide(l.line, who), via: 'candidate', prevStatus: l.status })
}

/** Test Plan §3: the sample after review (confirm t03, t05, t12; reject t11, t14). */
function reviewed(): AppState {
  let s = run(fresh(), { type: 'loadSample' })
  s = decideOn(s, 't03', 'c03')
  s = decideOn(s, 't05', 'c05')
  s = decideOn(s, 't12', 'c11')
  s = decideOn(s, 't11', null)
  return decideOn(s, 't14', null)
}
function handoff(s: AppState): AppState {
  const h = handoffToAllocation(rec(s).result)
  if (!h.ok) throw new Error(h.reason)
  return reducer(s, { type: 'handoff', handoff: h.value })
}
const withdraw = (id: string, on = '2026-10-16'): Action => ({ type: 'markWithdrawn', investorId: id, on, consent: true })
const at = (s: AppState, id: string) => s.commitments.findIndex((c) => c.id === id)
const edit = (s: AppState, id: string, field: 'name' | 'email' | 'reference' | 'cashDue' | 'id', value: string): Action => ({
  type: 'editCommitment',
  index: at(s, id),
  rowId: id,
  field,
  value,
})
/** The sample reviewed and handed off, minimum £970, the platform fee moved to the company with consent (TC-ALL-36). */
function applied(before: (s: AppState) => AppState = (s) => s): AppState {
  let s = before(reviewed())
  s = run(s, { type: 'setDeal', patch: { minimum: '970' } })
  s = handoff(s)
  return run(s, { type: 'applyFeePayerChange', feeId: 'f1', to: 'company', consent: true })
}
const fee = (s: AppState) => s.allocation.fees.find((f) => f.id === 'f1')!

describe('withdrawal before closing (C-REC-7, R-REC-11)', () => {
  it('TC-REC-47 Lucas withdrawn: not chased, not handed off, all £3,000.00 to refund; receivable down £3,000.00; refunds tie to £8,000.00', () => {
    const before = rec(reviewed()).result
    const s = run(reviewed(), withdraw('c12'))
    const o = rec(s)
    const r = o.result
    const lucas = r.commitments.find((c) => c.commitment.id === 'c12')!
    expect([lucas.status, lucas.received, lucas.withdrawnOn]).toEqual(['withdrawn', 300_000, '2026-10-16'])
    expect(chaseListCsv(r, 'GBP', 'D')).not.toContain('Lucas')
    expect(r.refunds).toEqual([
      { id: 'c08', name: 'Hugo Bernard', amount: 500_000, reason: 'Over-paid' },
      { id: 'c12', name: 'Lucas Meyer', amount: 300_000, reason: 'Withdrawn' },
    ])
    expect(before.totals.cashDue - r.totals.cashDue).toBe(300_000)
    expect(withdrawnSummary(r.totals.withdrawn.count, r.totals.withdrawn.toRefund, 'GBP')).toBe('Withdrawn: 1 investor, £3,000.00 to refund')
    expect(o.checks.find((c) => c.id === 'refunds-tie')).toMatchObject({ kind: 'invariant', pass: true })
    expect(r.refunds.reduce((a, b) => a + b.amount, 0)).toBe(800_000)
    const h = handoff(s)
    expect(h.allocation.investors.map((v) => v.id)).not.toContain('c12')
    expect(h.allocation.excess.find((x) => x.id === 'c12')).toMatchObject({ amount: 300_000, reason: 'Withdrawn' })
  })

  it('TC-REC-48 no consent, or 31/02/2026, marks nothing and says why; marked then undone is Paid in full again, both logged', () => {
    const s = reviewed()
    expect(run(s, { type: 'markWithdrawn', investorId: 'c12', on: '2026-10-16', consent: false })).toBe(s)
    expect(run(s, { type: 'markWithdrawn', investorId: 'c12', on: '31/02/2026', consent: true })).toBe(s)
    // the consent names the investor it was ticked for: a different name or reference under the same ID marks nothing
    expect(run(s, { ...withdraw('c12'), name: 'Lucas Meyer', reference: 'NW 012' } as Action).withdrawals).toHaveProperty('c12')
    expect(run(s, { ...withdraw('c12'), name: 'New Investor', reference: 'NW-012' } as Action)).toBe(s)
    expect(run(s, { ...withdraw('c12'), name: 'Lucas Meyer', reference: 'NEW-123' } as Action)).toBe(s)
    expect(withdrawalProblem(false, '2026-10-16')).toBe('Tick “Written consent from the investor received” first.')
    expect(withdrawalProblem(true, '31/02/2026')).toBe('Withdrawal date: "31/02/2026" is not a real date')
    const back = run(s, withdraw('c12', '16/10/2026'), { type: 'undoWithdrawal', investorId: 'c12' })
    expect(row(back, 'c12').status).toBe('paid')
    expect(events(back).slice(-2)).toEqual(['withdrawn', 'withdrawal_undone'])
    expect(back.log.entries.at(-2)).toMatchObject({
      investorId: 'c12',
      investorName: 'Lucas Meyer',
      detail: 'withdrawn on 2026-10-16 · written consent received',
    })
    expect(back.log.entries.at(-1)).toMatchObject({ investorId: 'c12', detail: 'was withdrawn on 2026-10-16' })
    expect(back.log.entries.length - s.log.entries.length).toBe(2) // each written once
  })

  it('TC-REC-49 name, email and cash due edits and a same-ID import keep the mark; a new reference or a delete voids it, logged', () => {
    const s = run(reviewed(), withdraw('c12'))
    const kept = run(s, edit(s, 'c12', 'name', 'Lucas M'), edit(s, 'c12', 'email', 'l@x.test'), edit(s, 'c12', 'cashDue', '3500'))
    expect(row(kept, 'c12').status).toBe('withdrawn')
    const imported = run(s, { type: 'replaceCommitments', rows: s.commitments.map((c) => ({ ...c, name: c.name + ' ' })) })
    expect(row(imported, 'c12').status).toBe('withdrawn')
    const n = s.log.entries.length
    const ref = run(s, edit(s, 'c12', 'reference', 'NW-099'))
    expect(events(ref).slice(n)).toEqual(['withdrawal_voided'])
    expect(row(ref, 'c12').status).not.toBe('withdrawn')
    expect(ref.log.entries.at(-1)).toMatchObject({
      event: 'withdrawal_voided',
      investorId: 'c12',
      detail: 'withdrawal on 2026-10-16 voided (reference changed)',
    })
    const gone = run(s, { type: 'deleteCommitment', index: at(s, 'c12') })
    expect(gone.withdrawals).toEqual({})
    expect(gone.log.entries.at(-1)).toMatchObject({ event: 'withdrawal_voided', detail: 'withdrawal on 2026-10-16 voided (investor deleted)' })
    // an import that drops the investor, or an ID changed by hand, voids it too
    expect(run(s, edit(s, 'c12', 'id', 'c99')).log.entries.at(-1)?.detail).toBe('withdrawal on 2026-10-16 voided (ID changed)')
    const dropped = run(s, { type: 'replaceCommitments', rows: s.commitments.filter((c) => c.id !== 'c12') })
    expect(dropped.withdrawals).toEqual({})
    expect(events(dropped).slice(n)).toEqual(['import', 'withdrawal_voided'])
    expect(dropped.log.entries.at(-1)?.detail).toBe('withdrawal on 2026-10-16 voided (investor deleted)')
  })

  it('TC-REC-50 a payment after withdrawing still books to Lucas automatically and adds to the refund', () => {
    const s = run(reviewed(), withdraw('c12'), {
      type: 'importBank',
      mode: 'append',
      rows: [...reviewed().bank, bankRow({ id: 't17', txnId: 't17', date: '2026-10-16', amount: 50_000, payer: 'L MEYER', reference: 'NW-012' })],
    })
    const r = rec(s).result
    expect(r.lines.find((l) => l.line.id === 't17')).toMatchObject({ status: 'auto', assignedTo: 'c12' })
    expect(r.refunds.find((x) => x.id === 'c12')!.amount).toBe(350_000)
  })

  it('TC-REC-51 James (nothing received) withdrawn: not chased, nothing to refund, receivable down £20,000.00', () => {
    const before = rec(reviewed()).result
    const r = rec(run(reviewed(), withdraw('c10'))).result
    expect(chaseListCsv(r, 'GBP', 'D')).not.toContain('James')
    expect(r.refunds.map((x) => x.id)).toEqual(['c08'])
    expect(before.totals.cashDue - r.totals.cashDue).toBe(2_000_000)
    expect(r.totals.withdrawn).toEqual({ count: 1, toRefund: 0 })
  })

  it('TC-REC-52 after a hand-off, marking, undoing and voiding a withdrawal each make the allocation out of date', () => {
    const s = handoff(reviewed())
    expect(allocationStale(s)).toBe(false)
    const marked = run(s, withdraw('c12'))
    expect(allocationStale(marked)).toBe(true)
    const again = handoff(marked)
    expect(allocationStale(run(again, { type: 'undoWithdrawal', investorId: 'c12' }))).toBe(true)
    expect(allocationStale(run(again, edit(again, 'c12', 'reference', 'NW-099')))).toBe(true)
  })
})

describe('changing who pays a fee (C-ALL-10/11, R-ALL-12, R-REC-12)', () => {
  it('TC-ALL-36 applied: the list keeps £10,000; Amelia is due £9,700.00 and over-paid £300.00; 1 + 12 entries; reversed: all back', () => {
    const s = applied()
    expect(s.commitments.find((c) => c.id === 'c01')!.cashDue).toBe(reviewed().commitments.find((c) => c.id === 'c01')!.cashDue)
    expect(fee(s).payer).toBe('company')
    const amelia = row(s, 'c01')
    expect([amelia.due, amelia.status, amelia.difference]).toEqual([970_000, 'overpaid', 30_000])
    const change = s.feePayerChanges[0]
    expect(adjustmentNote(amelia.commitment.cashDue, amelia.due, change, 'GBP')).toBe(
      'was £10,000.00 · −£300.00 fee payer change (Platform fee: investors → company)',
    )
    expect(rec(s).result.refunds.find((x) => x.id === 'c01')).toMatchObject({ amount: 30_000, reason: 'Over-paid' })
    expect(changeBanner(change)).toBe('Fee payer change active: Platform fee → company · consent recorded')
    expect(allocationStale(s)).toBe(true)
    const fp = s.log.entries.filter((e) => e.event === 'fee_payer_changed')
    expect(fp).toHaveLength(13)
    expect(fp[0].detail).toBe('Platform fee: investors → company · consent evidence received')
    expect(fp[1]).toMatchObject({ investorId: 'c01', amount: -30_000, detail: 'cash due 10,000.00 → 9,700.00' })
    const back = run(s, { type: 'reverseFeePayerChange', changeId: change.id })
    expect(fee(back).payer).toBe('investors')
    expect(row(back, 'c01').due).toBe(1_000_000)
    expect(back.feePayerChanges[0].status).toBe('reversed')
    expect(events(back).slice(s.log.entries.length)).toEqual(['fee_payer_change_reversed'])
    expect(back.log.entries.at(-1)!.detail).toBe('whole change · Platform fee back to investors')
  })

  it('TC-ALL-37 a new cash due for Amelia voids only her line; a 4% rate voids the whole change; while active no other change starts', () => {
    const s = applied()
    const one = run(s, edit(s, 'c01', 'cashDue', '10500'))
    expect(one.feePayerChanges[0].lines.filter((l) => l.voided).map((l) => l.investorId)).toEqual(['c01'])
    expect(row(one, 'c01').due).toBe(1_050_000)
    expect(row(one, 'c02').due).toBe(485_000)
    expect(events(one).slice(s.log.entries.length)).toEqual(['adjustment_voided'])
    expect(one.log.entries.at(-1)).toMatchObject({ event: 'adjustment_voided', investorId: 'c01', detail: 'this investor · cash due changed' })
    const i = s.allocation.fees.findIndex((f) => f.id === 'f1')
    const all = run(s, { type: 'editFee', index: i, rowId: 'f1', patch: { value: '4' } })
    expect(all.feePayerChanges[0]).toMatchObject({ status: 'voided', voidReason: 'rate changed' })
    expect(row(all, 'c02').due).toBe(500_000)
    expect(events(all).slice(s.log.entries.length)).toEqual(['fee_payer_change_voided'])
    expect(all.log.entries.at(-1)!.detail).toBe('whole change · Platform fee · rate changed')
    expect(all.recVersion).toBeGreaterThan(s.recVersion)
    const basis = run(s, { type: 'setDeal', patch: { feeBasis: 'onTop' } })
    expect(basis.feePayerChanges[0]).toMatchObject({ status: 'voided', voidReason: 'fee basis changed' })
    // the same value submitted again is no change
    expect(run(s, { type: 'editFee', index: i, rowId: 'f1', patch: { value: '3.00' } }).feePayerChanges[0].status).toBe('active')
    expect(feePayerChangeBlock(handoff(s))).toBe('A fee payer change is already active. Reverse it before making another.')
    expect(run(handoff(s), { type: 'applyFeePayerChange', feeId: 'f1', to: 'lead', consent: false }).feePayerChanges).toHaveLength(1)
  })

  it('TC-ALL-33 the reducer refuses a change whose preview is blocked (Isla below the £1,000 minimum), even with consent', () => {
    const s = handoff(reviewed())
    expect(feePayerChangeBlock(s)).toBeNull()
    const after = run(s, { type: 'applyFeePayerChange', feeId: 'f1', to: 'company', consent: true })
    expect(after.feePayerChanges).toEqual([])
    expect(fee(after).payer).toBe('investors')
  })

  it('TC-REC-49 prototype names as investor IDs stay data: "__proto__" and "constructor" can be withdrawn, adjusted and saved', () => {
    let s = reviewed()
    s = run(s, edit(s, 'c12', 'id', '__proto__'), edit(s, 'c09', 'id', 'constructor'))
    s = run(s, withdraw('__proto__'))
    expect(Object.keys(s.withdrawals)).toEqual(['__proto__'])
    expect(row(s, '__proto__').status).toBe('withdrawn')
    expect(row(s, 'constructor').status).toBe('paid')
    s = run(s, { type: 'setDeal', patch: { minimum: '970' } })
    s = handoff(s)
    s = run(s, { type: 'applyFeePayerChange', feeId: 'f1', to: 'company', consent: true })
    expect(row(s, 'constructor').due).toBe(97_000)
    const back = parseSaved(JSON.stringify(s))!
    expect(Object.getPrototypeOf(back.withdrawals)).toBeNull()
    expect(row(back, '__proto__').status).toBe('withdrawn')
    expect(row(back, 'constructor').due).toBe(97_000)
    expect(rec(back).result.notCovered).toEqual([])
  })

  it('TC-ALL-38 not available when the investors were imported here, the allocation is out of date, or the table was edited', () => {
    const s = handoff(run(reviewed(), { type: 'setDeal', patch: { minimum: '970' } }))
    expect(feePayerChangeBlock(s)).toBeNull()
    const imported = run(s, { type: 'replaceInvestors', rows: s.allocation.investors })
    expect(feePayerChangeBlock(imported)).toMatch(/not carried in/)
    expect(feePayerChangeBlock(run(s, withdraw('c12')))).toMatch(/out of date/)
    const edited = run(s, { type: 'editInvestor', index: 0, rowId: s.allocation.investors[0].id, field: 'name', value: 'A' })
    expect(feePayerChangeBlock(edited)).toMatch(/edited after the hand-off/)
    for (const x of [imported, edited]) expect(run(x, { type: 'applyFeePayerChange', feeId: 'f1', to: 'company', consent: true }).feePayerChanges).toEqual([])
  })

  it('TC-ALL-39 to investors or the company needs ticked consent; to the lead applies without it', () => {
    const s = handoff(run(reviewed(), { type: 'setDeal', patch: { minimum: '970' } }))
    expect(run(s, { type: 'applyFeePayerChange', feeId: 'f1', to: 'company', consent: false }).feePayerChanges).toEqual([])
    const lead = run(s, { type: 'applyFeePayerChange', feeId: 'f1', to: 'lead', consent: false })
    expect(lead.feePayerChanges[0]).toMatchObject({ to: 'lead', consent: false, status: 'active' })
    expect(changeBanner(lead.feePayerChanges[0])).toBe('Fee payer change active: Platform fee → lead · no consent needed')
    expect(lead.log.entries.find((e) => e.event === 'fee_payer_changed')!.detail).toBe('Platform fee: investors → lead · inform only')
  })

  it('TC-ALL-42 minimum back to £1,000 after applying: still active, the settings reminder shows, the re-check blocks on Isla', () => {
    const s = run(applied(), { type: 'setDeal', patch: { minimum: '1000' } })
    expect(s.feePayerChanges[0].status).toBe('active')
    const r = deriveChangeRecheck(s)!
    expect(r.changed).toBe(true)
    expect(r.recheck?.ok && r.recheck.result.blockers.map((b) => [b.code, b.investorId])).toEqual([['would-fall-below-minimum', 'c09']])
    expect(deriveChangeRecheck(applied())!.changed).toBe(false)
  })

  it('TC-ALL-42 the re-check covers whoever the change still covers, not the allocation table (Codex M6 r3 #1)', () => {
    // Isla withdrawn and handed off again (out of the allocation table), then reinstated: her line still stands
    let s = run(applied(), withdraw('c09'))
    s = handoff(s)
    s = run(s, { type: 'undoWithdrawal', investorId: 'c09' }, { type: 'setDeal', patch: { minimum: '1000' } })
    expect(row(s, 'c09').due).toBe(97_000)
    const r = deriveChangeRecheck(s)!
    expect(r.recheck?.ok && r.recheck.result.blockers.map((b) => [b.code, b.investorId])).toEqual([['would-fall-below-minimum', 'c09']])
    expect(deriveChangeRecheck(parseSaved(JSON.stringify(s))!)!.recheck).toEqual(r.recheck)
  })

  it('TC-ALL-37 the whole change voids on its payer, its type, or its deletion; logged once, reconciliation data changed', () => {
    const s = applied()
    const i = s.allocation.fees.findIndex((f) => f.id === 'f1')
    const cases: [Action, string][] = [
      [{ type: 'editFee', index: i, rowId: 'f1', patch: { payer: 'lead' } }, 'payer changed'],
      [{ type: 'editFee', index: i, rowId: 'f1', patch: { kind: 'fixed', value: '100' } }, 'type changed'],
      [{ type: 'deleteFee', index: i }, 'fee deleted'],
    ]
    for (const [a, reason] of cases) {
      const x = run(s, a)
      expect(x.feePayerChanges[0]).toMatchObject({ status: 'voided', voidReason: reason })
      expect(events(x).slice(s.log.entries.length)).toEqual(['fee_payer_change_voided'])
      expect(x.log.entries.at(-1)!.detail).toBe(`whole change · Platform fee · ${reason}`)
      expect(x.recVersion).toBeGreaterThan(s.recVersion)
      expect(row(x, 'c01').due).toBe(1_000_000)
    }
  })

  it('TC-ALL-37 an investor deleted or given a new ID voids their line, logged once with the reason; the new ID is not covered', () => {
    const s = applied()
    const gone = run(s, { type: 'deleteCommitment', index: at(s, 'c02') })
    expect(gone.feePayerChanges[0].lines.find((l) => l.investorId === 'c02')).toMatchObject({ voided: true, voidReason: 'investor deleted' })
    expect(events(gone).slice(s.log.entries.length)).toEqual(['adjustment_voided'])
    const moved = run(s, edit(s, 'c02', 'id', 'c02b'))
    expect(moved.feePayerChanges[0].lines.find((l) => l.investorId === 'c02')).toMatchObject({ voided: true, voidReason: 'ID changed' })
    expect(events(moved).slice(s.log.entries.length)).toEqual(['adjustment_voided'])
    expect(moved.log.entries.at(-1)).toMatchObject({ investorId: 'c02', investorName: 'Ben Okafor', detail: 'this investor · ID changed' })
    expect(rec(moved).result.notCovered).toEqual(['c02b'])
  })

  it('TC-ALL-45 reverse right after applying (allocation out of date) and while reconciliation is in review, no consent asked', () => {
    const s = applied()
    expect(allocationStale(s)).toBe(true)
    const id = s.feePayerChanges[0].id
    expect(run(s, { type: 'reverseFeePayerChange', changeId: id }).feePayerChanges[0].status).toBe('reversed')
    const t03 = rec(s).result.lines.find((l) => l.line.txnId === 't03')!
    const inReview = run(s, { type: 'undoDecision', lineId: t03.line.id, prevStatus: 'confirmed' })
    expect(rec(inReview).result.pendingSuggestions).toBe(1)
    expect(run(inReview, { type: 'reverseFeePayerChange', changeId: id }).feePayerChanges[0].status).toBe('reversed')
  })

  it('TC-ALL-46 a £10 per-investor fee added after applying, saved and reloaded: reminder, and all 12 invest £10.00 less than T_i', () => {
    let s = applied()
    s = run(s, { type: 'addFee' })
    const i = s.allocation.fees.length - 1
    const id = s.allocation.fees[i].id
    s = run(
      s,
      { type: 'editFee', index: i, rowId: id, patch: { label: 'Admin', kind: 'perInvestor' } },
      { type: 'editFee', index: i, rowId: id, patch: { value: '10' } },
    )
    expect(s.allocation.fees[i]).toMatchObject({ payer: 'investors', kind: 'perInvestor' })
    const loaded = parseSaved(JSON.stringify(s))!
    const r = deriveChangeRecheck(loaded)!
    expect(r.changed).toBe(true)
    if (!r.recheck?.ok) throw new Error('recheck')
    expect(r.recheck.result.blockers.map((b) => b.code)).toEqual(Array(12).fill('invested-differs'))
    expect(r.recheck.result.rows.find((x) => x.id === 'c09')).toMatchObject({ target: 97_000, investedAfter: 96_000 })
    expect(r.recheck.result.blockers.find((b) => b.investorId === 'c09')!.text).toMatch(/^Isla Campbell would invest/)
  })

  it('TC-ALL-48 £10,500 then £10,000 again leaves Amelia void and not covered; submitting £10,000 straight away is no change', () => {
    const s = applied()
    const twice = run(s, edit(s, 'c01', 'cashDue', '10500'), edit(s, 'c01', 'cashDue', '10000'))
    expect(row(twice, 'c01').due).toBe(1_000_000)
    expect(rec(twice).result.notCovered).toEqual(['c01'])
    // a void stays when another line voids in the same action (a whole-list import restoring Amelia, changing Ben)
    const imported = run(twice, { type: 'replaceCommitments', rows: twice.commitments.map((c) => (c.id === 'c02' ? { ...c, reference: 'NW-099' } : c)) })
    expect(imported.feePayerChanges[0].lines.filter((l) => l.voided).map((l) => l.investorId)).toEqual(['c01', 'c02'])
    expect(row(imported, 'c01').due).toBe(1_000_000)
    const same = run(s, edit(s, 'c01', 'cashDue', '10000'))
    expect(row(same, 'c01').due).toBe(970_000)
    expect(same.feePayerChanges[0].lines.some((l) => l.voided)).toBe(false)
  })
})

describe('Codex M6 round 5', () => {
  it('TC-REC-47 a row added in the allocation and given a withdrawn investor’s ID flags that refund for review', () => {
    let s = handoff(run(reviewed(), withdraw('c12')))
    s = run(s, { type: 'addInvestor' })
    const i = s.allocation.investors.length - 1
    const id = s.allocation.investors[i].id
    s = run(
      s,
      { type: 'editInvestor', index: i, rowId: id, field: 'name', value: 'Lucas Meyer' },
      { type: 'editInvestor', index: i, rowId: id, field: 'received', value: '3000' },
    )
    expect(s.allocation.excess.find((x) => x.id === 'c12')!.needsCheck).toBe(false)
    s = run(s, { type: 'editInvestor', index: i, rowId: id, field: 'id', value: 'c12' })
    expect(s.allocation.excess.find((x) => x.id === 'c12')).toMatchObject({ reason: 'Withdrawn', needsCheck: true })
    // over-payments the same way (Hugo)
    expect(
      run(s, { type: 'editInvestor', index: 0, rowId: s.allocation.investors[0].id, field: 'id', value: 'c08' }).allocation.excess.find((x) => x.id === 'c08')!
        .needsCheck,
    ).toBe(true)
  })

  it('TC-ALL-45 Reverse acts on the active change only; a save with two changes sharing an ID is refused', () => {
    const s = applied()
    const active = s.feePayerChanges[0]
    // a historical record listed first with the same ID (only a crafted save could do this)
    const crafted: AppState = { ...s, feePayerChanges: [{ ...active, status: 'reversed', from: 'company', to: 'investors' }, active] }
    const back = run(crafted, { type: 'reverseFeePayerChange', changeId: active.id })
    expect(back.feePayerChanges.map((c) => c.status)).toEqual(['reversed', 'reversed'])
    expect(fee(back).payer).toBe('investors')
    expect(row(back, 'c01').due).toBe(1_000_000)
    expect(events(back).at(-1)).toBe('fee_payer_change_reversed')
    expect(parseSaved(JSON.stringify(crafted))).toBeNull()
    expect(parseSaved(JSON.stringify(s))).not.toBeNull()
  })
})

describe('Codex M6 round 6: bindings that no longer fit are voided, never trusted', () => {
  it('TC-REC-49 a second row taking an investor’s ID voids that investor’s mark and line; deleting either row later revives nothing', () => {
    let s = run(twoInvestors(), withdraw('A'))
    const n = s.log.entries.length
    s = run(s, edit(s, 'B', 'reference', 'XA-001'))
    s = run(s, { type: 'editCommitment', index: 1, rowId: 'B', field: 'id', value: 'A' })
    expect(s.withdrawals).toEqual({})
    expect(s.feePayerChanges[0].lines.find((l) => l.investorId === 'A')).toMatchObject({ voided: true, voidReason: 'ID duplicated' })
    // B's own line goes when B's reference changes; A's mark and line when B takes A's ID
    expect(events(s).slice(n)).toEqual(['adjustment_voided', 'withdrawal_voided', 'adjustment_voided'])
    const left = run(s, { type: 'deleteCommitment', index: 0 }) // the original A goes; Bob keeps the ID
    expect(row(left, 'A').status).not.toBe('withdrawn')
    expect(row(left, 'A').due).toBe(50_000) // Bob's own £500 from the list, never Alice's adjusted £970
    expect(rec(left).result.notCovered).toEqual(['A'])
  })

  it('TC-ALL-37 a save whose active change no longer fits its fee, or lacks the consent it needs, loads with the change voided', () => {
    const s = applied()
    const save = (f: (x: AppState) => AppState) => parseSaved(JSON.stringify(f(JSON.parse(JSON.stringify(s)) as AppState)))!
    const fee1 = (x: AppState, patch: object) => ({
      ...x,
      allocation: { ...x.allocation, fees: x.allocation.fees.map((f) => (f.id === 'f1' ? { ...f, ...patch } : f)) },
    })
    const cases: [(x: AppState) => AppState, string][] = [
      [(x) => fee1(x, { payer: 'investors' }), 'payer changed'],
      [(x) => fee1(x, { value: '4' }), 'rate changed'],
      [(x) => fee1(x, { kind: 'fixed', value: '100' }), 'type changed'],
      [(x) => ({ ...x, deal: { ...x.deal, feeBasis: 'onTop' } }), 'fee basis changed'],
      [(x) => ({ ...x, allocation: { ...x.allocation, fees: x.allocation.fees.filter((f) => f.id !== 'f1') } }), 'fee deleted'],
      [(x) => ({ ...x, allocation: { ...x.allocation, fees: [...x.allocation.fees, x.allocation.fees[0]] } }), 'fee duplicated'],
      [(x) => ({ ...x, feePayerChanges: x.feePayerChanges.map((c) => ({ ...c, consent: false })) }), 'no consent recorded'],
    ]
    for (const [f, reason] of cases) {
      const loaded = save(f)
      expect(loaded.feePayerChanges[0], reason).toMatchObject({ status: 'voided', voidReason: reason })
      expect(row(loaded, 'c01').due, reason).toBe(1_000_000)
    }
    expect(save((x) => x).feePayerChanges[0].status).toBe('active')
  })

  it('TC-REC-49 a save whose withdrawal or adjustment no longer fits the investor loads with it voided; a void stays void', () => {
    const s = run(applied(), withdraw('c12'))
    const edited = (patch: (c: AppState['commitments'][number]) => object, id: string) => {
      const x = JSON.parse(JSON.stringify(s)) as AppState
      x.commitments = x.commitments.map((c) => (c.id === id ? { ...c, ...patch(c) } : c))
      return parseSaved(JSON.stringify(x))!
    }
    // second guard at calculation time, for a state that never went through the reducer or a load
    const direct: AppState = { ...s, commitments: s.commitments.map((c) => (c.id === 'c12' ? { ...c, reference: 'NW-099' } : c)) }
    expect(row(direct, 'c12').status).not.toBe('withdrawn')
    const lucas = edited(() => ({ reference: 'NW-099' }), 'c12')
    expect(Object.hasOwn(lucas.withdrawals, 'c12')).toBe(false)
    expect(row(lucas, 'c12').status).not.toBe('withdrawn')
    const amelia = edited(() => ({ cashDue: '2000' }), 'c01')
    expect(amelia.feePayerChanges[0].lines.find((l) => l.investorId === 'c01')).toMatchObject({ voided: true, voidReason: 'cash due changed' })
    expect(rec(amelia).result.notCovered).toEqual(['c01'])
    expect(handoffToAllocation(rec(amelia).result).ok).toBe(false)
    const back = run(amelia, edit(amelia, 'c01', 'cashDue', '10000'))
    expect(row(back, 'c01').due).toBe(1_000_000) // not £9,700.00 again
  })
})

describe('Codex M6 round 7', () => {
  it('TC-REC-52 a withdrawal voided on load makes a current allocation out of date', () => {
    const s = handoff(run(reviewed(), withdraw('c12')))
    expect(allocationStale(s)).toBe(false)
    const x = JSON.parse(JSON.stringify(s)) as AppState
    x.withdrawals.c12 = { ...x.withdrawals.c12, reference: 'OLD' }
    const loaded = parseSaved(JSON.stringify(x))!
    expect(Object.hasOwn(loaded.withdrawals, 'c12')).toBe(false)
    expect(allocationStale(loaded)).toBe(true)
    expect(feePayerChangeBlock(loaded)).toMatch(/out of date/)
    expect(allocationStale(parseSaved(JSON.stringify(s))!)).toBe(false) // nothing voided: still current
  })

  it('TC-ALL-37 an adjustment voided on load makes a current allocation out of date', () => {
    const s = handoff(applied())
    expect(allocationStale(s)).toBe(false)
    const x = JSON.parse(JSON.stringify(s)) as AppState
    x.commitments = x.commitments.map((c) => (c.id === 'c01' ? { ...c, cashDue: '12000' } : c))
    const loaded = parseSaved(JSON.stringify(x))!
    expect(rec(loaded).result.notCovered).toEqual(['c01'])
    expect(allocationStale(loaded)).toBe(true)
  })

  it('TC-ALL-36 company → investors applied: top-ups chased with the new amount, logged as positive, reversed back', () => {
    // the platform fee starts company-paid; Amelia then owes £10,309.28 (T = £10,000.00 under 3% deducted)
    let s = reviewed()
    s = run(s, { type: 'editFee', index: 0, rowId: 'f1', patch: { payer: 'company' } }, { type: 'setDeal', patch: { minimum: '970' } })
    s = handoff(s)
    s = run(s, { type: 'applyFeePayerChange', feeId: 'f1', to: 'investors', consent: true })
    expect(s.feePayerChanges[0]).toMatchObject({ from: 'company', to: 'investors', status: 'active' })
    const amelia = row(s, 'c01')
    expect([amelia.due, amelia.status, amelia.difference]).toEqual([1_030_928, 'partial', -30_928])
    const r = rec(s).result
    expect(chaseMessage(s.deal.name, 'GBP', amelia)).toContain(
      'we have received £10,000.00 GBP of the £10,309.28 GBP due from you, so £309.28 GBP is still outstanding',
    )
    expect(chaseListCsv(r, 'GBP', s.deal.name)).toContain('c01,Amelia Hart,amelia@example.com,10309.28,10000.00,-309.28,partial,10000.00,309.28,')
    expect(s.log.entries.find((e) => e.event === 'fee_payer_changed' && e.investorId === 'c01')).toMatchObject({
      amount: 30_928,
      detail: 'cash due 10,000.00 → 10,309.28',
    })
    const back = run(s, { type: 'reverseFeePayerChange', changeId: s.feePayerChanges[0].id })
    expect(fee(back).payer).toBe('company')
    expect(row(back, 'c01')).toMatchObject({ due: 1_000_000, status: 'paid' })
  })
})

describe('currency locked while a fee payer change is active (R-DEAL-01 v0.8.1, decision 12)', () => {
  it('TC-ALL-36 the currency does not change while the change is active; after Reverse it does', () => {
    const s = applied()
    expect(currencyLocked(s)).toBe(true)
    expect(run(s, { type: 'setDeal', patch: { currency: 'USD' } })).toBe(s)
    const back = run(s, { type: 'reverseFeePayerChange', changeId: s.feePayerChanges[0].id })
    expect(currencyLocked(back)).toBe(false)
    expect(run(back, { type: 'setDeal', patch: { currency: 'USD' } }).deal.currency).toBe('USD')
  })
})

describe('withdrawals and fee payer changes together (C-REC-7 × C-ALL-11)', () => {
  it('TC-REC-53 Lucas withdrawn at apply, then undone, is not covered and holds hand-off; so is an investor added later; reversing clears it', () => {
    const s = applied((x) => run(x, withdraw('c12')))
    expect(s.feePayerChanges[0].lines).toHaveLength(11)
    const undone = run(s, { type: 'undoWithdrawal', investorId: 'c12' })
    const o = rec(undone)
    expect(o.result.notCovered).toEqual(['c12'])
    expect(o.checks.find((c) => c.id === 'fee-change-coverage')).toMatchObject({ kind: 'review', pass: false })
    expect(handoffToAllocation(o.result).ok).toBe(false)
    const added = run(s, { type: 'addCommitment' })
    expect(
      rec(
        run(
          added,
          edit(added, added.commitments.at(-1)!.id, 'name', 'New Person'),
          edit(added, added.commitments.at(-1)!.id, 'reference', 'NW-050'),
          edit(added, added.commitments.at(-1)!.id, 'cashDue', '1000'),
        ),
      ).result.notCovered,
    ).toEqual([added.commitments.at(-1)!.id])
    const reversed = run(undone, { type: 'reverseFeePayerChange', changeId: s.feePayerChanges[0].id })
    expect(rec(reversed).result.notCovered).toEqual([])
  })

  it('TC-REC-54 NW-001 → NW 001 and NW-012 → NW 012 are not changes: Amelia stays at £9,700.00, Lucas stays withdrawn', () => {
    let s = run(applied(), withdraw('c12'))
    const n = s.log.entries.length
    s = run(s, edit(s, 'c01', 'reference', 'NW 001'), edit(s, 'c12', 'reference', 'NW 012'))
    expect(row(s, 'c01').due).toBe(970_000)
    expect(row(s, 'c12').status).toBe('withdrawn')
    expect(s.log.entries.slice(n).map((e) => e.event)).toEqual([])
  })

  it('TC-IO-47 exports: withdrawn_on on t13; David committed 2425.00 / 2500.00 / -75.00; currency last; confirmation lists Lucas', () => {
    const s = applied((x) => run(x, withdraw('c12')))
    expect(s.feePayerChanges[0].lines).toHaveLength(11)
    const r = rec(s).result
    const ledger = ledgerCsv(r, 'GBP').split(/\r?\n/)
    const head = ledger[0].split(',')
    expect(head.at(-1)).toBe('currency')
    const t13 = ledger.find((l) => l.startsWith('t13,'))!.split(',')
    expect(t13[head.indexOf('withdrawn_on')]).toBe('2026-10-16')
    expect(ledger.filter((l) => l.startsWith('t0')).every((l) => l.split(',')[head.indexOf('withdrawn_on')] === '')).toBe(true)
    const chase = chaseListCsv(r, 'GBP', s.deal.name)
    const ch = chase.split(/\r?\n/)[0].split(',')
    expect(ch.at(-1)).toBe('currency')
    const david = r.commitments.find((c) => c.commitment.id === 'c04')!
    expect(chase).toContain(`c04,David Kim,david@example.com,2425.00,2000.00,-425.00,partial,2500.00,-75.00,`)
    expect(chaseMessage(s.deal.name, 'GBP', david)).toContain(
      'we have received £2,000.00 GBP of the £2,425.00 GBP due from you, so £425.00 GBP is still outstanding',
    )
    const h = handoff(s)
    const a = deriveAllocation(h)
    const o = allocate(a.input!)
    if (!o.ok) throw new Error('alloc')
    const text = closingConfirmation(h.deal.name, 'GBP', a.input!.priceMicros, o.result, h.allocation.excess)
    expect(text).toContain('- Hugo Bernard: £5,150.00\n')
    expect(text).toContain('\n\nWithdrawn before closing (refund in full):\n- Lucas Meyer: £3,000.00')
    expect(text.slice(text.indexOf('Over-payments to refund'), text.indexOf('Withdrawn before closing'))).not.toContain('Lucas')
    expect(text.indexOf('Over-payments to refund')).toBeLessThan(text.indexOf('Withdrawn before closing'))
  })

  it('TC-ALL-44 minimum £970, A £1,000 and B £500: B is "not participating — unchanged" yet covered, so hand-off is not held', () => {
    const s = twoInvestors()
    const r = rec(s).result
    expect(s.feePayerChanges[0].lines.map((l) => [l.investorId, l.newCashDue])).toEqual([
      ['A', 97_000],
      ['B', 50_000],
    ])
    expect(r.notCovered).toEqual([])
    expect(handoffToAllocation(r).ok).toBe(true)
  })

  it('TC-ALL-47 B given another reference and £1,000 (same ID): B is void and not covered, hand-off held, and still so after reload', () => {
    let s = twoInvestors()
    s = run(s, edit(s, 'B', 'reference', 'XB-002'), edit(s, 'B', 'cashDue', '1000'))
    const check = (x: AppState) => {
      const r = rec(x).result
      expect(x.feePayerChanges[0].lines.find((l) => l.investorId === 'B')!.voided).toBe(true)
      expect(r.notCovered).toEqual(['B'])
      expect(handoffToAllocation(r).ok).toBe(false)
    }
    check(s)
    check(parseSaved(JSON.stringify(s))!)
  })
})

/** TC-ALL-44 / 47: A owes £1,000 and B £500, both paid; minimum £970; one 3% investor-paid fee moved to the company. */
function twoInvestors(): AppState {
  let s = run(fresh(), { type: 'acceptDisclaimer' }, { type: 'setDeal', patch: { asOf: '2026-10-16', minimum: '970' } })
  s = run(
    s,
    {
      type: 'replaceCommitments',
      rows: [
        commitmentRow({ id: 'A', name: 'Ann Able', email: '', reference: 'XA-001', cashDue: 100_000, scheme: 'none' }),
        commitmentRow({ id: 'B', name: 'Bob Baker', email: '', reference: 'XB-001', cashDue: 50_000, scheme: 'none' }),
      ],
    },
    {
      type: 'importBank',
      mode: 'replace',
      rows: [
        bankRow({ id: 'a', txnId: 'a', date: '2026-10-10', amount: 100_000, payer: 'ANN ABLE', reference: 'XA-001' }),
        bankRow({ id: 'b', txnId: 'b', date: '2026-10-10', amount: 50_000, payer: 'BOB BAKER', reference: 'XB-001' }),
      ],
    },
    { type: 'setAllocation', patch: { price: '1' } },
    { type: 'addFee' },
  )
  const f = s.allocation.fees[0]
  s = run(s, { type: 'editFee', index: 0, rowId: f.id, patch: { label: 'Fee' } }, { type: 'editFee', index: 0, rowId: f.id, patch: { value: '3' } })
  s = handoff(s)
  return run(s, { type: 'applyFeePayerChange', feeId: f.id, to: 'company', consent: true })
}
