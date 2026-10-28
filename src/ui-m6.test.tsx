// @vitest-environment jsdom
// PRD v0.8 interface (Test Plan §2.5, 〔M6〕): withdrawal and "Change who pays a fee" panels, the end card's
// "Try next" items 1 and 2, and the new terms.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'
import { STORAGE_KEY } from './state'
import { context, stateAt, STEPS, tryNext } from './tour/script'
import { initialState, reducer, sampleState, type AppState } from './state'
import { deriveReconcile } from './derive'
import { decide, handoffToAllocation, reconcile } from './lib/reconcile'
import { SAMPLE_COMMITMENTS } from './lib/sample'

class MemoryStorage implements Storage {
  private m = new Map<string, string>()
  get length() {
    return this.m.size
  }
  clear() {
    this.m.clear()
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
}

afterEach(cleanup)

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const tab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }))

function reviewSample() {
  click('Load sample deal')
  click('Confirm Chloe Martin')
  click('Confirm Elena Rossi')
  click('Confirm Kavya Iyer')
  click('Mark t11 as not part of this deal')
  click('Mark t14 as not part of this deal')
}
/** the sample investor list as CSV, so a test can replace one row */
const SAMPLE_LIST = [
  'investor_id,name,email,reference,cash_due,scheme',
  ...SAMPLE_COMMITMENTS.map((c) => `${c.id},${c.name},${c.email},${c.reference},${c.cashDue / 100},${c.scheme}`),
].join('\n')
const statusRow = (id: string) => document.querySelector<HTMLElement>(`[data-status="${id}"]`)!
/** a cell commits 300 ms after typing; blur commits at once */
function type(label: string, value: string) {
  const el = screen.getByLabelText(label)
  fireEvent.change(el, { target: { value } })
  fireEvent.blur(el)
}

describe('withdrawal on the page (R-REC-11)', () => {
  it('TC-REC-47 Lucas marked withdrawn: status Withdrawn, summary line, refund listed, not handed off', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Mark Lucas Meyer withdrawn')
    fireEvent.click(screen.getByLabelText('Written consent from the investor received'))
    expect((screen.getByLabelText('Withdrawal date for Lucas Meyer') as HTMLInputElement).value).toBe('2026-10-16')
    click('Confirm withdrawal')
    expect(within(statusRow('c12')).getByText('Withdrawn')).toBeTruthy()
    expect(screen.getByTestId('withdrawn-summary').textContent).toBe('Withdrawn: 1 investor, £3,000.00 to refund')
    expect(screen.getByTestId('rec-refunds').textContent).toContain('Lucas Meyer: £3,000.00 (Withdrawn)')
    expect(screen.queryByRole('button', { name: 'Copy message for Lucas Meyer' })).toBeNull()
    click('Hand off to allocation')
    expect(document.querySelector('[data-investor="Lucas Meyer"]')).toBeNull()
    expect(screen.getByTestId('excess').textContent).toContain('Lucas Meyer: £3,000.00 (withdrawn before closing)')
    expect(screen.getByTestId('confirmation').textContent).toContain('Withdrawn before closing (refund in full):\n- Lucas Meyer: £3,000.00')
  })

  it('TC-REC-48 without consent, or with 31/02/2026, nothing is marked and the reason shows; undo restores Paid in full', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Mark Lucas Meyer withdrawn')
    click('Confirm withdrawal')
    expect(screen.getByRole('alert').textContent).toBe('Tick “Written consent from the investor received” first.')
    fireEvent.click(screen.getByLabelText('Written consent from the investor received'))
    fireEvent.change(screen.getByLabelText('Withdrawal date for Lucas Meyer'), { target: { value: '31/02/2026' } })
    click('Confirm withdrawal')
    expect(screen.getByRole('alert').textContent).toBe('Withdrawal date: "31/02/2026" is not a real date')
    expect(within(statusRow('c12')).queryByText('Withdrawn')).toBeNull()
    fireEvent.change(screen.getByLabelText('Withdrawal date for Lucas Meyer'), { target: { value: '16/10/2026' } })
    click('Confirm withdrawal')
    click('Undo withdrawal of Lucas Meyer')
    expect(within(statusRow('c12')).getByText('Paid in full')).toBeTruthy()
  })
})

/** The reviewed sample with the minimum at £970, handed off, on the allocation page. */
function readyToChange() {
  render(<App storage={new MemoryStorage()} />)
  reviewSample()
  tab(/Deal settings/)
  type('Minimum commitment', '970')
  tab(/Reconciliation/)
  click('Hand off to allocation')
}

describe('Change who pays a fee on the page (R-ALL-12, R-REC-12)', () => {
  it('TC-ALL-39 investors and company need ticked consent; the lead is inform only; the button states the result', () => {
    readyToChange()
    const panel = () => screen.getByRole('region', { name: /Change who pays a fee/ })
    const apply = () => within(panel()).getByRole('button', { name: /^Apply:/ }) as HTMLButtonElement
    expect(screen.getByTestId('consent-text').textContent).toBe('The company’s consent needed — it pays by invoice or from the wire')
    expect(apply().textContent).toBe('Apply: 0 top-ups totalling £0.00 · 12 refunds totalling £3,720.00')
    expect(apply().disabled).toBe(true)
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'New payer' }), { target: { value: 'lead' } })
    expect(screen.getByTestId('consent-text').textContent).toBe('Inform only — no consent needed')
    expect(within(panel()).queryByLabelText('Consent evidence received')).toBeNull()
    expect(apply().disabled).toBe(false)
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'New payer' }), { target: { value: 'company' } })
    fireEvent.click(within(panel()).getByLabelText('Consent evidence received'))
    expect(apply().disabled).toBe(false)
    fireEvent.click(apply())
    expect(screen.getByTestId('fee-change-banner').textContent).toContain('Fee payer change active: Platform fee → company · consent recorded')
    click('Reverse')
    fireEvent.change(within(panel()).getByLabelText('Fee'), { target: { value: 'f1' } })
    expect(within(panel()).getByRole('combobox', { name: 'New payer' }).textContent).toBe('CompanyLead')
  })

  it('TC-ALL-36 applied on the page: Amelia shows £9,700.00 with where it came from; Reverse puts it back', () => {
    readyToChange()
    const panel = screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel).getByRole('button', { name: /^Apply:/ }))
    expect(screen.getByTestId('stale')).toBeTruthy()
    tab(/Reconciliation/)
    const amelia = statusRow('c01')
    expect(amelia.textContent).toContain('£9,700.00was £10,000.00 · −£300.00 fee payer change (Platform fee: investors → company)')
    expect(within(amelia).getByText('Overpaid')).toBeTruthy()
    expect(screen.getByTestId('fee-change-banner').textContent).toMatch(/^Fee payer change active: Platform fee → company · consent recorded · Reverse/)
    click('Reverse')
    expect(statusRow('c01').textContent).not.toContain('was £10,000.00')
    expect(within(statusRow('c01')).getByText('Paid in full')).toBeTruthy()
  })

  it('TC-ALL-37 while a change is active the panel shows only it and Reverse; a voided line says to redo it', () => {
    readyToChange()
    const panel = () => screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel()).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel()).getByRole('button', { name: /^Apply:/ }))
    tab(/Reconciliation/)
    expect(screen.getByRole('status', { name: 'Fee payer change coverage' }).textContent).toBe('') // present before anything is announced
    tab(/Allocation/)
    expect(within(panel()).queryByLabelText('Fee')).toBeNull()
    expect(within(panel()).getByRole('button', { name: 'Reverse' })).toBeTruthy()
    tab(/Reconciliation/)
    type('Investor 1 cash due', '10500')
    expect(statusRow('c01').textContent).toContain('This fee payer change no longer applies — redo it')
    expect(statusRow('c01').textContent).toContain('Not covered by the active fee payer change — reverse and redo')
    expect(screen.getByTestId('handoff-block').textContent).toMatch(/Reverse the fee payer change and redo it/)
    // announced: the coverage list sits in a live region that was there before (Codex M6 r8 #1)
    const live = screen.getByRole('status', { name: 'Fee payer change coverage' })
    expect(live.textContent).toBe(
      'Amelia Hart: This fee payer change no longer applies — redo itAmelia Hart: Not covered by the active fee payer change — reverse and redo',
    )
  })

  it('TC-ALL-38 the panel says why it is unavailable; fixed fees are not offered', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    tab(/Allocation/)
    expect(screen.getByTestId('fee-payer-block').textContent).toMatch(/Hand off from reconciliation first/)
    const panel = screen.getByRole('region', { name: /Change who pays a fee/ })
    expect((within(panel).getByLabelText('Fee') as HTMLSelectElement).disabled).toBe(true)
    expect(within(panel).getByLabelText('Fee').textContent).toBe('Platform fee — paid by investors') // Legal & admin is a fixed fee
  })

  it('TC-ALL-35 on the page: Isla blocks the change at the £1,000 minimum, named with the reason', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Hand off to allocation')
    expect(screen.getByTestId('fee-payer-blockers').textContent).toContain('Isla Campbell would fall below the minimum commitment')
    expect((screen.getByRole('button', { name: /^Apply:/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('TC-ALL-42 settings changed after applying: the reminder and the re-check blockers show', () => {
    readyToChange()
    const panel = screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel).getByRole('button', { name: /^Apply:/ }))
    tab(/Deal settings/)
    type('Minimum commitment', '1000')
    tab(/Allocation/)
    expect(screen.getByTestId('settings-changed').textContent).toBe('Allocation settings changed since this fee payer change — check the preview')
    expect(screen.getByTestId('recheck-blockers').textContent).toBe('Isla Campbell would fall below the minimum commitment')
  })
})

describe('Codex M6 round 1', () => {
  it('TC-ALL-39 a tick for one payer does not carry over when a fee-table edit switches the proposed payer (Codex M6 #1)', () => {
    readyToChange()
    const panel = () => screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel()).getByLabelText('Consent evidence received'))
    expect((within(panel()).getByLabelText('Consent evidence received') as HTMLInputElement).checked).toBe(true)
    // same page, no remount (Codex's steps): the fee table edit alone switches the proposal to company → investors
    fireEvent.change(screen.getByLabelText('Fee 1 paid by'), { target: { value: 'company' } })
    expect(within(panel()).getByRole('combobox', { name: 'New payer' }).textContent).toBe('InvestorsLead')
    expect(screen.getByTestId('consent-text').textContent).toBe('Investors’ consent needed — keep the evidence')
    expect((within(panel()).getByLabelText('Consent evidence received') as HTMLInputElement).checked).toBe(false)
    expect((within(panel()).getByRole('button', { name: /^Apply:/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('TC-ALL-42 the settings reminder and re-check blockers are inside a live region that exists before they appear (Codex M6 #2)', () => {
    readyToChange()
    const panel = screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel).getByRole('button', { name: /^Apply:/ }))
    const live = within(screen.getByRole('region', { name: /Change who pays a fee/ })).getByRole('status', { name: 'Fee payer change re-check' })
    expect(live.textContent).toBe('')
    tab(/Deal settings/)
    type('Minimum commitment', '1000')
    tab(/Allocation/)
    const after = within(screen.getByRole('region', { name: /Change who pays a fee/ })).getByRole('status', { name: 'Fee payer change re-check' })
    expect(after.textContent).toContain('Allocation settings changed since this fee payer change — check the preview')
    expect(after.textContent).toContain('Isla Campbell would fall below the minimum commitment')
  })
})

describe('Codex M6 round 4', () => {
  it('TC-REC-48 a ticked consent does not carry over to someone imported under the same ID: the form closes', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Load sample deal')
    click('Mark Lucas Meyer withdrawn')
    fireEvent.click(screen.getByLabelText('Written consent from the investor received'))
    const rows = SAMPLE_LIST.replace(/^c12,.*$/m, 'c12,New Investor,,NEW-123,3000,none')
    fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[0], { target: { value: rows } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Import pasted text' })[0])
    expect(screen.queryByRole('button', { name: 'Confirm withdrawal' })).toBeNull()
    expect(within(statusRow('c12')).queryByText('Withdrawn')).toBeNull()
  })

  it('TC-REC-48 a rename while the form is open clears the tick and says why', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Load sample deal')
    click('Mark Lucas Meyer withdrawn')
    fireEvent.click(screen.getByLabelText('Written consent from the investor received'))
    type('Investor 12 name', 'Someone Else')
    expect((screen.getByLabelText('Written consent from the investor received') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('alert').textContent).toBe('This investor’s name or reference changed. Check the details and tick consent again.')
  })
})

describe('Codex M6 round 9', () => {
  it('TC-REC-53 a withdrawn investor’s voided adjustment is announced too', () => {
    readyToChange()
    const panel = screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel).getByRole('button', { name: /^Apply:/ }))
    tab(/Reconciliation/)
    click('Mark Lucas Meyer withdrawn')
    fireEvent.click(screen.getByLabelText('Written consent from the investor received'))
    click('Confirm withdrawal')
    type('Investor 12 cash due', '3500')
    expect(screen.getByRole('status', { name: 'Fee payer change coverage' }).textContent).toBe('Lucas Meyer: This fee payer change no longer applies — redo it')
  })

  it('TC-ALL-37 a whole-change void is shown and announced on the allocation page, without switching pages', () => {
    readyToChange()
    const panel = () => screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel()).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel()).getByRole('button', { name: /^Apply:/ }))
    const status = within(panel()).getByRole('status', { name: 'Fee payer change status' })
    expect(status.textContent).toBe('') // in place while the change is active
    type('Fee 1 rate', '4')
    expect(within(panel()).getByRole('status', { name: 'Fee payer change status' })).toBe(status) // same region, now filled
    expect(status.textContent).toBe('The fee payer change (Platform fee → company) no longer applies — redo it.')
  })
})

describe('keyboard focus after the new actions (M6 self-test B#1)', () => {
  it('TC-REC-48 focus returns to the investor’s button after Confirm and after Cancel; the form opens on the consent box', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Mark Lucas Meyer withdrawn')
    expect(document.activeElement).toBe(screen.getByLabelText('Written consent from the investor received'))
    click('Cancel')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mark Lucas Meyer withdrawn' }))
    click('Mark Lucas Meyer withdrawn')
    fireEvent.click(screen.getByLabelText('Written consent from the investor received'))
    click('Confirm withdrawal')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo withdrawal of Lucas Meyer' }))
  })

  it('TC-ALL-39 after Apply focus is on Reverse; after Reverse on the panel heading; in reconciliation on the summary', () => {
    readyToChange()
    const panel = () => screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel()).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel()).getByRole('button', { name: /^Apply:/ }))
    expect(document.activeElement).toBe(within(panel()).getByRole('button', { name: 'Reverse' }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Reverse' }))
    expect(document.activeElement).toBe(within(panel()).getByRole('heading', { name: 'Change who pays a fee' }))
    tab(/Reconciliation/)
    click('Hand off to allocation')
    fireEvent.click(within(panel()).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel()).getByRole('button', { name: /^Apply:/ }))
    tab(/Reconciliation/)
    click('Reverse')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Summary' }))
  })
})

/** Decide every sample suggestion as Test Plan §3 does, on any state. */
function reviewState(s: AppState): AppState {
  const steps: [string, string | null][] = [
    ['t03', 'c03'],
    ['t05', 'c05'],
    ['t12', 'c11'],
    ['t11', null],
    ['t14', null],
  ]
  for (const [t, who] of steps) {
    const o = reconcile(deriveReconcile(s).input!)
    if (!o.ok) throw new Error('rec')
    const l = o.result.lines.find((x) => x.line.txnId === t)!
    s = reducer(s, {
      type: 'decide',
      lineId: l.line.id,
      decision: decide(l.line, who ? o.result.commitments.find((c) => c.commitment.id === who)!.commitment : null),
    })
  }
  return s
}

describe('more of the page (M6 self-test B, test gaps)', () => {
  it('TC-ALL-37 a fee rate edit voids the whole change and reconciliation says to redo it', () => {
    readyToChange()
    const panel = screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel).getByRole('button', { name: /^Apply:/ }))
    type('Fee 1 rate', '4')
    tab(/Reconciliation/)
    expect(screen.getByTestId('fee-change-voided').textContent).toBe('The fee payer change (Platform fee → company) no longer applies — redo it.')
    expect(screen.queryByTestId('fee-change-banner')).toBeNull()
    expect(statusRow('c01').textContent).not.toContain('was £10,000.00')
  })

  it('TC-ALL-44 the preview shows a non-participant as "Not participating — unchanged"', () => {
    let s: AppState = { ...sampleState(initialState(new Date('2026-10-20T12:00:00Z'))), disclaimerAccepted: true }
    s = reducer(s, { type: 'setDeal', patch: { minimum: '970' } })
    // Isla's cash due lowered to £500: below the minimum, so outside the commitment allocation
    s = reviewState(reducer(s, { type: 'editCommitment', index: 8, rowId: 'c09', field: 'cashDue', value: '500' }))
    const o = reconcile(deriveReconcile(s).input!)
    if (!o.ok) throw new Error('rec')
    const h = handoffToAllocation(o.result)
    if (!h.ok) throw new Error(h.reason)
    s = reducer(s, { type: 'handoff', handoff: h.value })
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(s))
    render(<App storage={storage} />)
    tab(/Allocation/)
    const isla = within(screen.getByRole('table', { name: 'Fee payer change preview' }))
      .getByText('Isla Campbell')
      .closest('tr')!
    expect(isla.textContent).toBe('Isla Campbell£500.00Not participating — unchanged')
  })
})

describe('currency lock on the page (R-DEAL-01 v0.8.1)', () => {
  it('TC-ALL-36 while a change is active the currency select is disabled and says to reverse first', () => {
    readyToChange()
    const panel = screen.getByRole('region', { name: /Change who pays a fee/ })
    fireEvent.click(within(panel).getByLabelText('Consent evidence received'))
    fireEvent.click(within(panel).getByRole('button', { name: /^Apply:/ }))
    tab(/Deal settings/)
    const select = screen.getByRole('combobox', { name: 'Currency' }) as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(screen.getByTestId('currency-locked').textContent).toBe('Reverse the fee payer change before changing the currency')
    expect(select.getAttribute('aria-describedby')).toBe(screen.getByTestId('currency-locked').id)
  })
})

describe('terms and panel sentences (R-X-05, R-X-01.2)', () => {
  it('TC-X-15 withdrawal and fee payer each have a one-line explanation', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('What is withdrawal?')
    expect(screen.getByRole('note').textContent).toMatch(/written consent/)
    tab(/Allocation/)
    click('What is fee payer?')
    expect(screen.getByRole('note').textContent).toMatch(/Who bears a fee/)
  })

  it('TC-X-12 each new panel has its sentence', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    expect(screen.getByText(/Mark an investor withdrawn before closing: everything they paid moves to refunds\./)).toBeTruthy()
    tab(/Allocation/)
    expect(
      screen.getByText(
        'Move a percentage fee to investors, the company or the lead before closing. Each investor’s amount due changes so their investment stays the same.',
      ),
    ).toBeTruthy()
  })
})

const ITEM1 = "Mark Lucas Meyer withdrawn. You'll need his written consent. His £3,000.00 moves to refunds."
const ITEM2 =
  "Change who pays the platform fee to the company. Isla's £1,000.00 minimum blocks it: lower the minimum commitment (Deal settings) to £970.00, then apply and see each investor's new amount due."

describe('end card "Try next" items 1 and 2 (guide v0.3 §3.2)', () => {
  const finished = () => stateAt(STEPS.length, initialState(new Date('2026-10-20T12:00:00Z')))

  it('TC-X-12 after the tour: three items in order, figures from the results; Take me to it only brings the control into focus', () => {
    expect(tryNext(context(finished())).map((t) => [t.text, t.tab, t.target])).toEqual([
      [ITEM1, 'rec', 'withdraw-c12'],
      [ITEM2, 'alloc', 'fee-payer'],
      ["Undo a confirmed payment to see 'Copy query'.", 'rec', 'undo-t03'],
    ])
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    click('I understand — take the 3-minute tour')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Exit (steps 12–12)' }))
    click('Finish')
    const end = screen.getByTestId('tour-end')
    const links = within(end).getAllByRole('button', { name: 'Take me to it' })
    expect(links).toHaveLength(3)
    const saved = () => storage.getItem(STORAGE_KEY)!.replace(/"log":.*$/, '')
    const before = saved()
    fireEvent.click(links[0])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mark Lucas Meyer withdrawn' }))
    fireEvent.click(within(screen.getByTestId('tour-end')).getAllByRole('button', { name: 'Take me to it' })[1])
    expect(screen.getByRole('tab', { name: /Allocation/, selected: true })).toBeTruthy()
    expect(document.activeElement).toBe(within(screen.getByRole('region', { name: /Change who pays a fee/ })).getByLabelText('Fee'))
    expect(saved()).toBe(before) // nothing changed
    // doing item 1 makes the allocation out of date; item 2 stays on the card and its panel says why (guide §8 item 2)
    fireEvent.click(within(screen.getByTestId('tour-end')).getAllByRole('button', { name: 'Take me to it' })[0])
    click('Mark Lucas Meyer withdrawn')
    fireEvent.click(screen.getByLabelText('Written consent from the investor received'))
    click('Confirm withdrawal')
    const end2 = screen.getByTestId('tour-end')
    expect(end2.textContent).toContain('Change who pays the platform fee to the company.')
    expect(end2.textContent).not.toContain('Mark Lucas Meyer withdrawn') // item 1 is done
    fireEvent.click(within(end2).getAllByRole('button', { name: 'Take me to it' })[0])
    expect(screen.getByTestId('fee-payer-block').textContent).toMatch(/out of date/)
    expect(document.activeElement).toBe(screen.getByTestId('fee-payer-block')) // the reason, since the choices are disabled
  })

  it('TC-X-20 item 2 shows on the finished tour; not with an £80,000 cap, nor with James at £980 handed off again', () => {
    const s = finished()
    expect(tryNext(context(s)).map((t) => t.text)).toContain(ITEM2)
    // with the minimum already at £970 the preview is not blocked: the short text, without the minimum part
    const lowered = reducer(s, { type: 'setDeal', patch: { minimum: '970' } })
    expect(tryNext(context(lowered)).find((t) => t.target === 'fee-payer')?.text).toBe(
      "Change who pays the platform fee to the company, then apply and see each investor's new amount due.",
    )
    const capped = reducer(s, { type: 'setAllocation', patch: { cap: '80000' } })
    expect(tryNext(context(capped)).map((t) => t.target)).not.toContain('fee-payer')
    let james = reducer(s, { type: 'editCommitment', index: 9, rowId: 'c10', field: 'cashDue', value: '980' })
    const d = deriveReconcile(james)
    const o = reconcile(d.input!)
    if (!o.ok) throw new Error('rec')
    const h = handoffToAllocation(o.result)
    if (!h.ok) throw new Error(h.reason)
    james = reducer(james, { type: 'handoff', handoff: h.value })
    expect(tryNext(context(james)).map((t) => t.target)).not.toContain('fee-payer')
    // an investor table edited after the hand-off hides item 2 (an out-of-date allocation does not, guide §8 item 7)
    const edited = reducer(s, { type: 'editInvestor', index: 0, rowId: s.allocation.investors[0].id, field: 'name', value: 'A' })
    expect(tryNext(context(edited)).map((t) => t.target)).not.toContain('fee-payer')
    // item 1 needs Lucas on the list, not withdrawn, with money received
    const gone = reducer(s, { type: 'markWithdrawn', investorId: 'c12', on: '2026-10-16', consent: true })
    expect(tryNext(context(gone)).map((t) => t.target)).not.toContain('withdraw-c12')
  })
})
