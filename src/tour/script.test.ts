// Guided tour script (R-X-01, docs/en/05_GUIDED_TOUR.md v0.2): replay, card figures, recovery.
import { describe, expect, it } from 'vitest'
import { MISSING, context, tourIntact, nothingToLose, prerequisitesMet, stateAt, STEPS, firstStepOf, DEMO_CAP_TEXT, SAMPLE_CAP_TEXT, tryNext } from './script'
import { initialState, reducer } from '../state'
import { carryIsFullShare, distribute } from '../lib/waterfall'

const base = initialState(new Date('2026-10-20T12:00:00Z'))

describe('carryIsFullShare', () => {
  it('TC-DIS-04 with a 100% catch-up the carry is 20% of all profit; TC-DIS-05 without one it is not', () => {
    const holdings = [
      { id: 'a', name: 'A', capital: 6_000_000 },
      { id: 'b', name: 'B', capital: 4_000_000 },
    ]
    const run = (c: number) => distribute({ holdings, proceeds: 30_000_000, exitCosts: 0, years100: 500, carry: { mode: 'fixed', k: 2000, h: 800, c } })
    const full = run(10_000)
    const none = run(0)
    if (!full.ok || !none.ok) throw new Error('engine failed')
    expect(carryIsFullShare(full.result, 2000)).toBe(true)
    expect(carryIsFullShare(none.result, 2000)).toBe(false)
  })
})

describe('guided tour script', () => {
  it('R-X-01 has the 12 approved steps in three chapters', () => {
    expect(STEPS).toHaveLength(12)
    expect([firstStepOf('Reconciliation'), firstStepOf('Allocation'), firstStepOf('Exit')]).toEqual([0, 7, 11])
  })

  it('R-X-01 replaying every action reaches the Test Plan §3 exit figures', () => {
    const c = context(stateAt(STEPS.length, base))
    expect(c.rec?.totals.booked).toBe(10_850_000)
    expect(c.alloc?.totals.invested).toBe(10_039_500)
    expect(c.exit?.carry).toBe(5_702_100)
    expect(c.exit?.investorsTotal).toBe(32_847_900)
  })

  it('R-X-01 every card quotes real figures from the engines (nothing missing)', () => {
    const texts = STEPS.map((step, i) => {
      const c = context(stateAt(i, base))
      return [
        step.text(c, false),
        ...(step.id === 'scale-back' ? [step.text(context(reducer(stateAt(i, base), { type: 'setAllocation', patch: { cap: DEMO_CAP_TEXT } })), true)] : []),
      ]
    }).flat()
    for (const t of texts) expect(t).not.toContain(MISSING)
    const all = texts.join('\n')
    for (const figure of [
      '12 investors, 16 bank lines. 9 receipts',
      'score 0.55',
      'score 0.35',
      'high (score 0.80)',
      'after 13 days',
      'David is £500.00 short',
      'Hugo paid £5,000.00 more than due',
      'less the 3% platform fee: £10,000.00 buys £9,700.00',
      'David is in on £2,000.00, not £2,500.00',
      "James's £3,000.00 arrived after the as-of date",
      'Amelia holds 4018.726436 shares: 4,018 can be claimed, £1.76',
      'Isla Campbell would fall below the £1,000.00 minimum',
      'back to £150,000.00',
      '£390,000.00 back, £4,500.00 costs, after 6 years',
      'their £100,395.00 back first, then a hurdle of 8% a year, then the lead catches up',
      'exactly 20% of the profit: £57,021.00',
    ])
      expect(all).toContain(figure)
  })

  it('R-X-01 each action step is not done before its action and done after it', () => {
    STEPS.forEach((step, i) => {
      if (!step.action) return
      const before = stateAt(i, base)
      expect(step.action.done(context(before))).toBe(false)
      expect(step.action.done(context(step.action.perform(before)))).toBe(true)
    })
  })

  it('R-X-01 a wrong decision is named, and "Fix it for me" restores the right one', () => {
    const i = STEPS.findIndex((s) => s.id === 'family-office')
    let s = stateAt(i, base)
    const c = context(s)
    const line = c.rec!.lines.find((l) => l.line.txnId === 't05')!.line
    const ben = c.rec!.commitments.find((x) => x.commitment.id === 'c02')!.commitment
    s = reducer(s, {
      type: 'decide',
      lineId: line.id,
      decision: {
        kind: 'assign',
        commitmentId: ben.id,
        lineFp: JSON.stringify([line.id, line.txnId, line.date, line.amount, line.payer, line.reference]),
        commitmentFp: JSON.stringify([ben.id, ben.name, ben.email, ben.reference, ben.cashDue, ben.scheme]),
      },
    })
    const action = STEPS[i].action!
    expect(action.done(context(s))).toBe(false) // booked, but to the wrong person
    expect(action.wrong!(context(s))).toBe("That booked £15,000.00 to Ben Okafor. In this sample it's Elena's — undo it, then confirm Elena.")
    expect(action.done(context(action.fix!(s)))).toBe(true)
  })

  it('R-X-01 resume needs every earlier action to still hold', () => {
    const s = stateAt(5, base)
    expect(prerequisitesMet(5, s)).toBe(true)
    expect(prerequisitesMet(5, reducer(s, { type: 'undoDecision', lineId: 't03' }))).toBe(false)
    expect(prerequisitesMet(1, base)).toBe(false) // no sample loaded
  })

  it('R-X-01 starting the tour only asks first when there is something to lose', () => {
    // a fresh page is one made today: `base` is pinned to 2026-10-20, so it only counts as fresh on that day (G3 v1.1.0 check)
    expect(nothingToLose(initialState())).toBe(true)
    expect(nothingToLose(reducer(base, { type: 'loadSample' }))).toBe(true)
    expect(nothingToLose(stateAt(3, base))).toBe(false) // decisions made
    expect(nothingToLose(reducer(base, { type: 'addCommitment' }))).toBe(false)
  })

  it('the demo cap and the sample cap are what step 10 sets and restores', () => {
    expect([DEMO_CAP_TEXT, SAMPLE_CAP_TEXT]).toEqual(['80000', '150000.00'])
  })

  it('R-X-01 anything a person typed counts as something to lose, not just the tables (review M3 #1)', () => {
    const yesterday = initialState(new Date('2026-10-19T12:00:00Z'))
    expect(nothingToLose(yesterday)).toBe(false) // a page from another day: its date may have been set on purpose, so ask (Codex M3 R3 #11)
    expect(nothingToLose(reducer(base, { type: 'setDeal', patch: { name: 'My real deal' } }))).toBe(false)
    expect(nothingToLose(reducer(base, { type: 'setAllocation', patch: { price: '1.5' } }))).toBe(false)
    expect(nothingToLose(reducer(base, { type: 'addFee' }))).toBe(false)
    expect(nothingToLose(reducer(base, { type: 'setExit', patch: { proceeds: '2500000' } }))).toBe(false)
  })

  it('R-X-01 a demo cap left behind stops resuming past step 10 (review M3 #2)', () => {
    const at10 = stateAt(9, base)
    const demo = reducer(at10, { type: 'setAllocation', patch: { cap: DEMO_CAP_TEXT } })
    expect(prerequisitesMet(10, at10)).toBe(true)
    expect(prerequisitesMet(10, demo)).toBe(false)
    expect(prerequisitesMet(9, demo)).toBe(true) // at the demo step itself the tour can still put it back
  })

  it('R-X-01 the exit card only says what the engine shows when the terms are changed (review M3 #4)', () => {
    const i = STEPS.findIndex((st) => st.id === 'exit')
    const changed = reducer(stateAt(i, base), { type: 'setExit', patch: { proceeds: '110000' } })
    const t = STEPS[i].text(context(changed), false)
    expect(t).not.toContain('exactly')
    expect(t).not.toContain('catches up')
    expect(t).toContain('Carry to the lead: £0.00.')
  })

  it('R-X-01 a confirmation step, once done, points at the booked row and no longer says "not booked" (Codex M3 R1 #5)', () => {
    const i = STEPS.findIndex((st) => st.id === 'no-reference')
    const before = stateAt(i, base)
    expect(STEPS[i].targets(context(before), false)).toEqual(['review-t03'])
    const after = STEPS[i].action!.perform(before)
    expect(STEPS[i].targets(context(after), false)).toEqual(['line-t03'])
    const t = STEPS[i].text(context(after), false)
    expect(t).toBe('£20,000.00 from CHLOE MARTIN is now booked to Chloe Martin — by you, not by a guess.')
  })

  it('R-X-01 step 6 tells each payment as it now stands (Codex M3 R1 #3)', () => {
    const i = STEPS.findIndex((st) => st.id === 'short-and-over')
    let s = stateAt(i, base)
    s = reducer(s, { type: 'editBank', index: s.bank.findIndex((b) => b.id === 't04'), field: 'amount', value: '3000' })
    expect(STEPS[i].text(context(s), false)).toContain('David paid £500.00 more than due — listed as a refund, not invested.')
  })

  it('R-X-01 the exit card tells a loss and a shortfall as they are (Codex M3 R1 #4)', () => {
    const i = STEPS.findIndex((st) => st.id === 'exit')
    const at = stateAt(i, base)
    const loss = STEPS[i].text(context(reducer(at, { type: 'setExit', patch: { proceeds: '80000' } })), false)
    expect(loss).toContain('Investors get back £75,500.00 of the £100,395.00 they put in. There is no profit, so no carry.')
    const short = STEPS[i].text(context(reducer(at, { type: 'setExit', patch: { proceeds: '1000' } })), false)
    expect(short).toContain('The costs are more than the proceeds by £3,500.00, so nothing can be paid out.')
  })

  it('R-X-01 the tour data check ignores the order of decisions and only the demo cap during the demo (Codex M3 R1 #1, #3)', () => {
    const at6 = stateAt(5, base)
    expect(tourIntact(5, at6)).toBe(true)
    expect(tourIntact(1, STEPS[1].action!.perform(stateAt(1, base)))).toBe(true) // step 2 with its own action done
    expect(tourIntact(1, stateAt(3, base))).toBe(false) // two actions ahead is not where step 2 left it
    // the same decisions made in another order are still the tour's state
    const reordered = { ...at6, decisions: Object.fromEntries(Object.entries(at6.decisions).reverse()) }
    expect(tourIntact(5, reordered)).toBe(true)
    expect(tourIntact(5, reducer(at6, { type: 'editBank', index: 3, field: 'amount', value: '3000' }))).toBe(false)
    const at10 = stateAt(9, base)
    const demo = reducer(at10, { type: 'setAllocation', patch: { cap: DEMO_CAP_TEXT } })
    expect(tourIntact(9, demo, SAMPLE_CAP_TEXT)).toBe(true) // the demo replaced the sample's own cap
    expect(tourIntact(9, demo)).toBe(false)
    expect(tourIntact(9, demo, '120000')).toBe(false) // Codex M3 R2 #8 A: the demo replaced the person's cap
    expect(tourIntact(9, reducer(at10, { type: 'setAllocation', patch: { cap: '120000' } }), SAMPLE_CAP_TEXT)).toBe(false) // B: edited during the demo
  })

  it('R-ALL-11 "Do this for me" cannot hand off a blocked allocation', () => {
    const i = STEPS.findIndex((st) => st.id === 'confirmation')
    const blockedState = reducer(stateAt(i, base), { type: 'setAllocation', patch: { cap: DEMO_CAP_TEXT } })
    const after = STEPS[i].action!.perform(blockedState)
    expect(after).toBe(blockedState)
    expect(STEPS[i].action!.done(context(after))).toBe(false)
  })

  it('R-X-01 the demo card names the cap it will put back', () => {
    const i = STEPS.findIndex((st) => st.id === 'scale-back')
    const s = reducer(stateAt(i, base), { type: 'setAllocation', patch: { cap: DEMO_CAP_TEXT } })
    expect(STEPS[i].text(context(s, '120000'), true)).toContain('Next puts the cap back to £120,000.00.')
    expect(STEPS[i].text(context(s, ''), true)).toContain('Next puts the cap back to no cap.')
  })
})

describe('guided tour v0.3 (PRD v0.8 R-X-01.2)', () => {
  const COPY = " 'Copy message' next to each name gives you the chase email to send yourself."
  it('TC-X-11 still 12 steps; step 6 adds the Copy message sentence and target, step 2 is unchanged', () => {
    expect(STEPS).toHaveLength(12)
    const six = STEPS[5]
    const c = context(stateAt(5, base))
    expect(six.text(c, false)).toBe(
      'David is £500.00 short — on the chase list you can export. Hugo paid £5,000.00 more than due — listed as a refund, not invested.' + COPY,
    )
    expect(six.targets(c, false)).toEqual(['status-c04', 'status-c08', 'chase-export', 'copy-message-c04'])
    expect(STEPS[1].text(context(stateAt(1, base)), false)).not.toContain('Copy')
    // nobody left on the chase list: the sentence goes, so it never points at a missing button
    let paid = stateAt(5, base)
    paid = reducer(paid, { type: 'replaceCommitments', rows: paid.commitments.filter((r) => r.id !== 'c04' && r.id !== 'c10') })
    expect(six.text(context(paid), false)).not.toContain('Copy message')
  })

  it('TC-X-11 the end card offers item 3 (undo a confirmed payment) and focuses its Undo', () => {
    const items = tryNext(context(stateAt(STEPS.length, base)))
    // item 3 comes last, after the two M6 items (TC-X-12)
    expect(items.at(-1)).toEqual({ text: "Undo a confirmed payment to see 'Copy query'.", tab: 'rec', target: 'undo-t03' })
    // nothing confirmed by hand: the item is left out
    expect(tryNext(context(stateAt(0, base))).map((t) => t.target)).not.toContain('undo-t03')
  })

  it("TC-X-11 the tour's own decisions are logged as the tour's; a replay starts the log again without doubles", () => {
    const end = stateAt(STEPS.length, base)
    const ev = end.log.entries.map((e) => e.event)
    expect(ev).toEqual(['sample_loaded', 'confirm', 'confirm', 'confirm', 'not_in_deal', 'not_in_deal', 'handoff_allocation', 'handoff_exit'])
    for (const e of end.log.entries.slice(1)) expect(e.detail).toMatch(/ · guided tour$/)
    expect(end.log.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // jump back to chapter 1 from the finished tour, and replay to the end again
    const again = stateAt(STEPS.length, stateAt(firstStepOf('Reconciliation'), end))
    expect(again.log.entries.map((e) => e.event)).toEqual(ev)
    // the log and the initials are not data the tour compares
    expect(tourIntact(STEPS.length, { ...end, deal: { ...end.deal, initials: 'HY' }, log: { ...end.log, entries: [] } })).toBe(true)
    // a fresh page with only initials typed has nothing to lose: starting the tour does not ask first
    const today = initialState()
    expect(nothingToLose({ ...today, deal: { ...today.deal, initials: 'HY' } })).toBe(true)
  })
})
