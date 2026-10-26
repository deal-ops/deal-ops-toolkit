// State layer (Tech Design §2): text inputs, snapshots with versions, local saving.
import { describe, expect, it } from 'vitest'
import { allocationStale, exitStale, initialState, loadState, parseSaved, reducer, saveState, STORAGE_KEY, type Action, type AppState } from './state'
import { deriveAllocation, deriveBankLines, deriveDistribution, deriveReconcile } from './derive'
import { holdingsFromAllocation } from './lib/snapshot'
import { decide, handoffToAllocation, reconcile } from './lib/reconcile'
import { allocate } from './lib/allocation'

const run = (s: AppState, ...actions: Action[]) => actions.reduce(reducer, s)
const sample = () => run(initialState(new Date('2026-10-20T12:00:00Z')), { type: 'loadSample' })

function rec(s: AppState) {
  const d = deriveReconcile(s)
  if (!d.input) throw new Error(JSON.stringify(d.errors))
  const o = reconcile(d.input)
  if (!o.ok) throw new Error('reconcile failed')
  return { input: d.input, result: o.result }
}

/** Decide on a line by transaction id, the way the interface does. */
function decideOn(s: AppState, txn: string, investorId: string | null): AppState {
  const { result } = rec(s)
  const line = result.lines.find((l) => l.line.txnId === txn)!.line
  const who = investorId ? result.commitments.find((c) => c.commitment.id === investorId)!.commitment : null
  return reducer(s, { type: 'decide', lineId: line.id, decision: decide(line, who) })
}

function reviewed(): AppState {
  let s = sample()
  s = decideOn(s, 't03', 'c03')
  s = decideOn(s, 't05', 'c05')
  s = decideOn(s, 't12', 'c11')
  s = decideOn(s, 't11', null)
  s = decideOn(s, 't14', null)
  return s
}

function handedOff(s: AppState): AppState {
  const h = handoffToAllocation(rec(s).result)
  if (!h.ok) throw new Error(h.reason)
  return reducer(s, { type: 'handoff', handoff: h.value })
}

describe('state: sample and hand-off', () => {
  it('SAMPLE-UI the sample loads with the Test Plan §3 reconciliation figures and nothing downstream', () => {
    const s = sample()
    const { result } = rec(s)
    expect(result.totals).toMatchObject({ bank: 11_484_000, booked: 6_600_000 })
    expect(result.pendingSuggestions).toBe(3)
    expect(s.allocation.investors).toEqual([])
    expect(s.allocation.handoffVersion).toBeNull()
  })

  it('SAMPLE-UI after review and hand-off the allocation matches Test Plan §3', () => {
    const s = handedOff(reviewed())
    expect(rec(reviewed()).result.totals.booked).toBe(10_850_000)
    const d = deriveAllocation(s)
    expect(d.errors).toEqual([])
    const o = allocate(d.input!)
    if (!o.ok) throw new Error('allocation failed')
    expect(o.result.totals).toMatchObject({
      received: 10_350_000,
      invested: 10_039_500,
      investorFees: 310_500,
      refunds: 0,
      companyFees: 150_000,
      wire: 9_889_500,
    })
    expect(s.allocation.excess).toEqual([{ id: 'c08', name: 'Hugo Bernard', amount: 500_000, needsCheck: false }])
  })

  it('R-X-07 a change upstream marks the allocation out of date; handing off again replaces it whole', () => {
    let s = handedOff(reviewed())
    expect(allocationStale(s)).toBe(false)
    s = run(s, { type: 'editInvestor', index: 0, field: 'name', value: 'Edited downstream' }, { type: 'addInvestor' })
    expect(allocationStale(s)).toBe(false) // downstream edits are not upstream changes
    s = run(s, { type: 'undoDecision', lineId: 't03' })
    expect(allocationStale(s)).toBe(true)
    s = decideOn(s, 't03', 'c03')
    expect(allocationStale(s)).toBe(true) // the version moved on, even though the data is back
    s = handedOff(s)
    expect(allocationStale(s)).toBe(false)
    expect(s.allocation.investors.map((v) => v.name)).not.toContain('Edited downstream')
    expect(s.allocation.investors).toHaveLength(12)
  })

  it('R-X-07 a new decision on its own marks the allocation out of date', () => {
    expect(allocationStale(decideOn(handedOff(reviewed()), 't03', 'c01'))).toBe(true)
  })

  it('R-X-07 deal settings that change the reconciliation mark it out of date; others do not', () => {
    const s = handedOff(reviewed())
    expect(allocationStale(run(s, { type: 'setDeal', patch: { asOf: '2026-10-15' } }))).toBe(true)
    expect(allocationStale(run(s, { type: 'setDeal', patch: { currency: 'EUR' } }))).toBe(true)
    expect(allocationStale(run(s, { type: 'setDeal', patch: { name: 'x', minimum: '0', agedThresholdDays: '5' } }))).toBe(false)
  })

  it('R-X-07 importing allocation investors directly ends the link to reconciliation', () => {
    const s = run(handedOff(reviewed()), { type: 'replaceInvestors', rows: [{ id: 'a', name: 'A', received: '100', scheme: 'none' }] })
    expect(s.allocation.handoffVersion).toBeNull()
    expect(s.allocation.excess).toEqual([])
    expect(allocationStale(run(s, { type: 'undoDecision', lineId: 't03' }))).toBe(false)
  })
})

describe('state: decisions follow the data (R-REC-04.4)', () => {
  it('R-REC-04.4 deleting a bank line by hand deletes the decision about it', () => {
    let s = reviewed()
    const idx = s.bank.findIndex((b) => b.id === 't03')
    s = run(s, { type: 'deleteBank', index: idx })
    expect(Object.keys(s.decisions)).not.toContain('t03')
    expect(Object.keys(s.decisions)).toHaveLength(4)
  })

  it('TC-REC-09 editing a confirmed line in the table voids the decision and sends it back to review', () => {
    let s = reviewed()
    s = run(s, { type: 'editBank', index: s.bank.findIndex((b) => b.id === 't03'), field: 'amount', value: '9000' })
    const line = rec(s).result.lines.find((l) => l.line.id === 't03')!
    expect(line.status).toBe('suggested')
    expect(line.staleDecision).toBe(true)
    expect(rec(s).result.pendingSuggestions).toBe(1)
  })

  it('TC-REC-10 deleting the investor a line was confirmed to voids the decision', () => {
    let s = reviewed()
    s = run(s, { type: 'deleteCommitment', index: s.commitments.findIndex((c) => c.id === 'c03') })
    const line = rec(s).result.lines.find((l) => l.line.id === 't03')!
    expect(line.status).toBe('suggested')
    expect(line.assignedTo).toBeNull()
  })

  it('TC-REC-30 changing an investor’s email voids a decision made for them', () => {
    let s = reviewed()
    s = run(s, { type: 'editCommitment', index: s.commitments.findIndex((c) => c.id === 'c05'), field: 'email', value: 'new@example.com' })
    expect(rec(s).result.lines.find((l) => l.line.id === 't05')!.status).toBe('suggested')
  })

  it('TC-REC-24 a replace import clears every decision; an append keeps decisions on lines still there', () => {
    const s = reviewed()
    expect(run(s, { type: 'importBank', mode: 'replace', rows: s.bank }).decisions).toEqual({})
    expect(Object.keys(run(s, { type: 'importBank', mode: 'append', rows: s.bank }).decisions)).toHaveLength(5)
  })

  it('R-REC-04.2 undo returns a line to its suggestions', () => {
    const s = run(reviewed(), { type: 'undoDecision', lineId: 't05' })
    expect(rec(s).result.lines.find((l) => l.line.id === 't05')!.status).toBe('suggested')
  })
})

describe('derive: text is parsed, never guessed (I-07)', () => {
  it('I-07 a bad or blank cash due is an error at its row, not 0, and there is no result', () => {
    let s = run(sample(), { type: 'editCommitment', index: 2, field: 'cashDue', value: '20,00' })
    s = run(s, { type: 'editCommitment', index: 4, field: 'cashDue', value: '' })
    const d = deriveReconcile(s)
    expect(d.input).toBeNull()
    expect(d.errors.map((e) => e.where)).toEqual(['Investors row 3, cash due', 'Investors row 5, cash due'])
    expect(d.errors[1].message).toBe('required')
  })

  it('TC-DEAL-01 after switching to EUR, £5 is an error and €5 is fine', () => {
    let s = run(
      initialState(),
      { type: 'addCommitment' },
      { type: 'editCommitment', index: 0, field: 'name', value: 'A' },
      { type: 'editCommitment', index: 0, field: 'reference', value: 'AB-001' },
    )
    s = run(s, { type: 'setDeal', patch: { currency: 'EUR' } }, { type: 'editCommitment', index: 0, field: 'cashDue', value: '£5' })
    expect(deriveReconcile(s).errors[0].message).toMatch(/uses £ but this deal is in EUR/)
    s = run(s, { type: 'editCommitment', index: 0, field: 'cashDue', value: '€5' })
    expect(deriveReconcile(s).errors).toEqual([])
  })

  it('TC-ALL-19 share price "abc" and a 120% fee are located input errors with no result', () => {
    let s = handedOff(reviewed())
    s = run(s, { type: 'setAllocation', patch: { price: 'abc' } }, { type: 'editFee', index: 0, patch: { value: '120%' } })
    const d = deriveAllocation(s)
    expect(d.input).toBeNull()
    expect(d.errors.map((e) => e.where)).toEqual(['Allocation, share price', 'Fee 1 (Platform fee), rate'])
  })

  it('an edit aimed at a row that has since been replaced is dropped (Codex M2 round 2 #7)', () => {
    const s = sample()
    expect(run(s, { type: 'editCommitment', index: 0, rowId: 'someone-else', field: 'cashDue', value: '1' })).toBe(s)
    expect(run(s, { type: 'editBank', index: 0, rowId: 't02', field: 'amount', value: '1' })).toBe(s)
    expect(run(s, { type: 'editCommitment', index: 0, rowId: 'c01', field: 'cashDue', value: '1' }).commitments[0].cashDue).toBe('1')
  })

  it('R-ALL-02 changing who pays keeps the fee type valid for that payer', () => {
    let s = run(initialState(), { type: 'addFee' }, { type: 'editFee', index: 0, patch: { kind: 'perInvestor' } })
    s = run(s, { type: 'editFee', index: 0, patch: { payer: 'company' } })
    expect(s.allocation.fees[0].kind).toBe('fixed')
    s = run(s, { type: 'editFee', index: 0, patch: { payer: 'investors' } })
    expect(s.allocation.fees[0].kind).toBe('perInvestor')
  })

  it('engine errors are shown in interface words', () => {
    const s = run(sample(), { type: 'editCommitment', index: 1, field: 'reference', value: 'nw001' })
    expect(deriveReconcile(s).errors).toEqual([{ where: 'Investors row 2, reference', message: 'same reference as Investors row 1' }])
  })

  it('an append import needs a clean bank table to de-duplicate against', () => {
    const s = run(sample(), { type: 'editBank', index: 0, field: 'date', value: '31/02/2026' })
    expect(deriveBankLines(s).input).toBeNull()
    expect(deriveBankLines(sample()).input).toHaveLength(16)
  })
})

describe('self-test review fixes', () => {
  it('I-09 a non-breaking space in the cap or minimum is a format error, not "blank"', () => {
    let s = handedOff(reviewed())
    s = run(s, { type: 'setAllocation', patch: { cap: '\u00a0' } }, { type: 'setDeal', patch: { minimum: '\u00a0' } })
    const d = deriveAllocation(s)
    expect(d.input).toBeNull()
    expect(d.errors.map((e) => e.where).sort()).toEqual(['Allocation, round cap', 'Deal settings, minimum commitment'])
  })

  it('R-REC-08 a renamed investor keeps their refund under the new name; scheme edits leave it alone (Codex M2 #2)', () => {
    const s = handedOff(reviewed())
    const hugo = s.allocation.investors.findIndex((v) => v.id === 'c08')
    expect(run(s, { type: 'editInvestor', index: hugo, field: 'name', value: 'Hugo Bernard Jr' }).allocation.excess).toEqual([
      { id: 'c08', name: 'Hugo Bernard Jr', amount: 500_000, needsCheck: false },
    ])
    expect(run(s, { type: 'editInvestor', index: hugo, field: 'scheme', value: 'EIS' }).allocation.excess).toEqual(s.allocation.excess)
    expect(run(s, { type: 'editInvestor', index: 0, field: 'received', value: '1' }).allocation.excess).toEqual(s.allocation.excess)
  })

  it('R-REC-08 changing the amount or ID of, or deleting, that investor flags the refund for a person to keep or remove', () => {
    const s = handedOff(reviewed())
    const hugo = s.allocation.investors.findIndex((v) => v.id === 'c08')
    for (const edited of [
      run(s, { type: 'editInvestor', index: hugo, field: 'received', value: '10000' }),
      run(s, { type: 'editInvestor', index: hugo, field: 'id', value: 'h1' }),
      run(s, { type: 'deleteInvestor', index: hugo }),
    ]) {
      expect(edited.allocation.excess).toEqual([{ id: 'c08', name: 'Hugo Bernard', amount: 500_000, needsCheck: true }])
      expect(run(edited, { type: 'keepRefund', id: 'c08' }).allocation.excess[0].needsCheck).toBe(false)
      expect(run(edited, { type: 'removeRefund', id: 'c08' }).allocation.excess).toEqual([])
    }
  })
})

describe('decisions stay void once voided (R-REC-04.4, Codex M2 #1)', () => {
  const statusOf = (s: AppState, id: string) => rec(s).result.lines.find((l) => l.line.id === id)!.status

  it('TC-REC-09 changing a confirmed amount and then changing it back does not revive the decision', () => {
    let s = reviewed()
    const i = s.bank.findIndex((b) => b.id === 't03')
    s = run(s, { type: 'editBank', index: i, field: 'amount', value: '9000' }, { type: 'editBank', index: i, field: 'amount', value: '20000.00' })
    expect(statusOf(s, 't03')).toBe('suggested')
    expect(rec(s).result.totals.booked).toBe(8_850_000)
    expect(rec(s).result.pendingSuggestions).toBe(1)
  })

  it('TC-REC-10 deleting the investor and re-importing the same list does not revive the decision', () => {
    let s = reviewed()
    const original = s.commitments
    s = run(s, { type: 'deleteCommitment', index: 2 }, { type: 'replaceCommitments', rows: original })
    expect(statusOf(s, 't03')).toBe('suggested')
  })

  it('TC-REC-30 an investor edit and revert voids a decision even on a line with an exact reference', () => {
    let s = sample()
    s = decideOn(s, 't01', 'c01') // confirm an exact-match line by hand
    expect(statusOf(s, 't01')).toBe('confirmed')
    s = run(s, { type: 'editCommitment', index: 0, field: 'scheme', value: 'EIS' }, { type: 'editCommitment', index: 0, field: 'scheme', value: 'SEIS' })
    expect(statusOf(s, 't01')).toBe('suggested') // back to a person, not auto-booked
  })

  it('a reject is voided the same way, and a fresh decision or undo clears the void', () => {
    let s = reviewed()
    const i = s.bank.findIndex((b) => b.id === 't11')
    s = run(s, { type: 'editBank', index: i, field: 'payer', value: 'X' }, { type: 'editBank', index: i, field: 'payer', value: 'WESTBRIDGE SUPPLIES' })
    expect(statusOf(s, 't11')).toBe('suggested')
    expect(statusOf(decideOn(s, 't11', null), 't11')).toBe('rejected')
    expect(statusOf(run(s, { type: 'undoDecision', lineId: 't11' }), 't11')).toBe('unmatched')
  })

  it('edits that do not touch a decision’s data leave it valid', () => {
    let s = reviewed()
    s = run(
      s,
      { type: 'editBank', index: 0, field: 'payer', value: 'AMELIA HART' },
      { type: 'editCommitment', index: 0, field: 'name', value: 'Amelia J Hart' },
    )
    expect(statusOf(s, 't03')).toBe('confirmed')
    expect(rec(s).result.pendingSuggestions).toBe(0)
  })
})

describe('exit distribution state (R-ALL-11, R-X-07)', () => {
  const exitOf = (s: AppState) => {
    const d = deriveAllocation(s)
    const o = allocate(d.input!)
    if (!o.ok) throw new Error('allocation failed')
    const snap = holdingsFromAllocation(o.result, d.input!.priceMicros, s.allocVersion)
    return run(s, { type: 'handoffToExit', holdings: snap.data.rows, sharePriceMicros: snap.data.sharePriceMicros! })
  }

  it('R-ALL-11 hand-off carries participants only, with the share price', () => {
    const s = exitOf(handedOff(reviewed()))
    expect(s.exit.holdings).toHaveLength(11)
    expect(s.exit.holdings[0]).toEqual({ id: 'c01', name: 'Amelia Hart', capital: '9700.00' })
    expect(s.exit.sharePriceMicros).toBe(2_413_700)
    expect(exitStale(s)).toBe(false)
  })

  it('R-X-07 allocation and deal changes mark the exit out of date; refund flags and exit edits do not', () => {
    const s = exitOf(handedOff(reviewed()))
    expect(exitStale(run(s, { type: 'setAllocation', patch: { price: '5' } }))).toBe(true)
    expect(exitStale(run(s, { type: 'editFee', index: 0, patch: { value: '2' } }))).toBe(true)
    expect(exitStale(run(s, { type: 'setDeal', patch: { feeBasis: 'onTop' } }))).toBe(true)
    expect(exitStale(run(s, { type: 'setDeal', patch: { minimum: '0' } }))).toBe(true)
    expect(exitStale(run(s, { type: 'setDeal', patch: { name: 'x' } }))).toBe(false)
    expect(exitStale(run(s, { type: 'keepRefund', id: 'c08' }))).toBe(false)
    expect(exitStale(run(s, { type: 'editHolding', index: 0, field: 'capital', value: '1' }, { type: 'setExit', patch: { proceeds: '1' } }))).toBe(false)
  })

  it('a direct holdings import ends the link to the allocation', () => {
    const s = run(exitOf(handedOff(reviewed())), { type: 'replaceHoldings', rows: [{ id: 'a', name: 'A', capital: '1' }], sharePriceMicros: null })
    expect(s.exit.handoffVersion).toBeNull()
    expect(exitStale(run(s, { type: 'setAllocation', patch: { price: '5' } }))).toBe(false)
  })

  it('C-DIS switching carry mode clears the fields of the other mode; a new tier goes before the open-ended last one', () => {
    let s = sample()
    expect(s.exit.carry).toBe('20')
    s = run(s, { type: 'setCarryMode', mode: 'tiered' })
    expect([s.exit.carry, s.exit.hurdle, s.exit.catchUp]).toEqual(['', '', ''])
    s = run(s, { type: 'editTier', index: 0, field: 'rate', value: '30' }, { type: 'addTier' })
    expect(s.exit.tiers.map((t) => t.rate)).toEqual(['', '30'])
    s = run(s, { type: 'setCarryMode', mode: 'fixed' })
    expect(s.exit.tiers).toEqual([])
  })

  it('R-X-07 a new hand-off into the allocation and changes to its investor list or currency mark the exit out of date', () => {
    const s = exitOf(handedOff(reviewed()))
    expect(exitStale(handedOff(s))).toBe(true)
    expect(exitStale(run(s, { type: 'replaceInvestors', rows: [{ id: 'a', name: 'A', received: '1', scheme: 'none' }] }))).toBe(true)
    expect(exitStale(run(s, { type: 'addInvestor' }))).toBe(true)
    expect(exitStale(run(s, { type: 'deleteInvestor', index: 0 }))).toBe(true)
    expect(exitStale(run(s, { type: 'setDeal', patch: { currency: 'EUR' } }))).toBe(true)
  })

  it('C-DIS-6 whichever tier ends up last loses its hidden ceiling (review M3 #3)', () => {
    let s = run(sample(), { type: 'setCarryMode', mode: 'tiered' }, { type: 'addTier' })
    s = run(
      s,
      { type: 'editTier', index: 0, field: 'upTo', value: '3' },
      { type: 'editTier', index: 0, field: 'rate', value: '20' },
      { type: 'editTier', index: 1, field: 'rate', value: '30' },
    )
    s = run(s, { type: 'deleteTier', index: 1 })
    expect(s.exit.tiers.map((t) => t.upTo)).toEqual([''])
    s = exitOf(handedOff(reviewed()))
    s = run(s, { type: 'setCarryMode', mode: 'tiered' }, { type: 'editTier', index: 0, field: 'rate', value: '20' })
    expect(deriveDistribution({ ...s, exit: { ...s.exit, tiers: [{ ...s.exit.tiers[0], upTo: '3' }] } }).errors).toEqual([]) // a stale value in the last tier is ignored
  })

  it('the sample exit terms derive to Test Plan §3 inputs', () => {
    const s = exitOf(handedOff(reviewed()))
    const d = deriveDistribution(s)
    expect(d.errors).toEqual([])
    expect(d.input).toMatchObject({ proceeds: 39_000_000, exitCosts: 450_000, years100: 600, carry: { mode: 'fixed', k: 2000, h: 800, c: 10_000 } })
  })

  it('I-07 bad exit text is a located error, not 0', () => {
    let s = sample()
    s = run(
      s,
      { type: 'setExit', patch: { proceeds: '', years: '50.5' } },
      { type: 'setCarryMode', mode: 'tiered' },
      { type: 'editTier', index: 0, field: 'rate', value: 'abc' },
    )
    const where = deriveDistribution(s).errors.map((e) => e.where)
    expect(where).toEqual(expect.arrayContaining(['Exit, proceeds', 'Exit, years held', 'Tier 1, carry', 'Holdings']))
  })
})

describe('local saving (Tech Design §1)', () => {
  it('R-X-02 state round-trips through storage under one key', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const s = reviewed()
    expect(saveState(storage, s)).toBe('saved')
    expect([...store.keys()]).toEqual([STORAGE_KEY])
    expect(loadState(storage)).toEqual(JSON.parse(JSON.stringify(s)))
  })

  it('blocked storage does not break the app', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
    }
    expect(loadState(throwing)).toBeNull()
    expect(saveState(throwing, initialState())).toBe('blocked')
    expect(loadState(undefined)).toBeNull()
  })

  it('TC-X-04 a failed save reports a full store apart from a blocked one', () => {
    const failing = (e: unknown) => ({
      setItem: () => {
        throw e
      },
    })
    const ok = { setItem: () => undefined }
    expect(saveState(ok, initialState())).toBe('saved')
    expect(saveState(undefined, initialState())).toBe('blocked') // the browser gave no storage at all
    for (const e of [
      new DOMException('quota', 'QuotaExceededError'),
      { name: 'QuotaExceededError' }, // newer engines may drop the legacy code
      { name: 'NS_ERROR_DOM_QUOTA_REACHED' },
      { name: 'Error', code: 22 },
      { code: 1014 },
    ])
      expect(saveState(failing(e), initialState())).toBe('full')
    for (const e of [
      new DOMException('insecure', 'SecurityError'),
      new Error('QuotaExceededError'),
      null,
      undefined,
      42,
      'QuotaExceededError',
      { code: '22' },
      { name: 'quotaexceedederror' },
    ])
      expect(saveState(failing(e), initialState())).toBe('blocked')
  })

  it('damaged or foreign saved data is ignored, not trusted', () => {
    const good = JSON.parse(JSON.stringify(reviewed()))
    expect(parseSaved('{')).toBeNull()
    expect(parseSaved('null')).toBeNull()
    expect(parseSaved(JSON.stringify({ ...good, schema: 2 }))).toBeNull()
    expect(parseSaved(JSON.stringify({ ...good, commitments: [{ id: 1 }] }))).toBeNull()
    expect(parseSaved(JSON.stringify({ ...good, bank: [{ ...good.bank[0], txnId: 5 }] }))).toBeNull()
    expect(parseSaved(JSON.stringify({ ...good, decisions: { t03: { kind: 'assign' } } }))).toBeNull()
    expect(
      parseSaved(JSON.stringify({ ...good, allocation: { ...good.allocation, fees: [{ id: 'f', label: 'x', value: '1', payer: 'bank', kind: 'percent' }] } })),
    ).toBeNull()
    expect(parseSaved(JSON.stringify(good))).not.toBeNull()
  })

  it('saved refunds are checked as money: negative, zero, unflagged or duplicate refunds are refused (Codex M2 #5)', () => {
    const good = JSON.parse(JSON.stringify(handedOff(reviewed())))
    const withRefunds = (excess: unknown) => JSON.stringify({ ...good, allocation: { ...good.allocation, excess } })
    const hugo = good.allocation.excess[0]
    expect(parseSaved(withRefunds([{ ...hugo, amount: -500000 }]))).toBeNull()
    expect(parseSaved(withRefunds([{ ...hugo, amount: 0 }]))).toBeNull()
    expect(parseSaved(withRefunds([{ ...hugo, amount: 1.5 }]))).toBeNull()
    expect(parseSaved(withRefunds([{ id: hugo.id, name: hugo.name, amount: hugo.amount }]))).toBeNull()
    expect(parseSaved(withRefunds([hugo, hugo]))).toBeNull()
    expect(parseSaved(withRefunds([hugo]))).not.toBeNull()
  })

  it('data saved before table generations existed still loads', () => {
    const old = JSON.parse(JSON.stringify(reviewed()))
    delete old.tables
    expect(parseSaved(JSON.stringify(old))!.tables).toEqual({ commitments: 0, bank: 0, investors: 0, fees: 0, holdings: 0, tiers: 0 })
  })

  it('data saved before the exit module existed loads with an empty exit; damaged exit data is refused', () => {
    const old = JSON.parse(JSON.stringify(reviewed()))
    delete old.exit
    delete old.allocVersion
    const loaded = parseSaved(JSON.stringify(old))!
    expect(loaded.exit.holdings).toEqual([])
    expect(loaded.allocVersion).toBe(1)
    const good = JSON.parse(JSON.stringify(sample()))
    expect(parseSaved(JSON.stringify({ ...good, exit: { ...good.exit, sharePriceMicros: -1 } }))).toBeNull()
    expect(parseSaved(JSON.stringify({ ...good, exit: { ...good.exit, mode: 'other' } }))).toBeNull()
    expect(parseSaved(JSON.stringify({ ...good, exit: { ...good.exit, holdings: [{ id: 'a', name: 'A', capital: 1 }] } }))).toBeNull()
  })

  it('a saved decision keyed "__proto__" stays data and does not touch any prototype', () => {
    const good = JSON.parse(JSON.stringify(sample()))
    const raw = JSON.stringify(good).replace('"decisions":{}', '"decisions":{"__proto__":{"kind":"reject","lineFp":"x"}}')
    const s = parseSaved(raw)!
    expect(Object.hasOwn(s.decisions, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).kind).toBeUndefined()
  })
})
