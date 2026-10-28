// @vitest-environment jsdom
// M2 interface cases (Test Plan §2, 〔M2〕).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'
import { Checks } from './components/common'
import { readFileSync } from 'node:fs'
import { STORAGE_KEY } from './state'

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

/** Type into a commit-on-blur cell. */
function edit(label: string, value: string) {
  const el = screen.getByLabelText(label) as HTMLInputElement
  fireEvent.change(el, { target: { value } })
  fireEvent.blur(el)
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const values = (prefix: RegExp) => screen.getAllByLabelText(prefix).map((e) => (e as HTMLInputElement).value)

function reviewSample() {
  click('Load sample deal')
  click('Confirm Chloe Martin')
  click('Confirm Elena Rossi')
  click('Confirm Kavya Iyer')
  click('Mark t11 as not part of this deal')
  click('Mark t14 as not part of this deal')
}

describe('M2 interface', () => {
  it('TC-IO-20 paste 3 investors, then edit a name, add a row and delete a row in the table', () => {
    render(<App storage={new MemoryStorage()} />)
    fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[0], {
      target: { value: 'name,reference,cash_due\nAnn Lee,AL-001,1000\nBo Chen,BC-002,2000\nCy Diaz,CD-003,3000' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Import pasted text' })[0])
    expect(screen.getByText('Imported 3 investors. Amounts read as GBP.')).toBeTruthy()
    expect(values(/^Investor \d+ name$/)).toEqual(['Ann Lee', 'Bo Chen', 'Cy Diaz'])
    const pastedIds = values(/^Investor \d+ ID$/)
    expect(pastedIds.every((id) => id.length > 0)).toBe(true)
    expect(new Set(pastedIds).size).toBe(3)

    edit('Investor 2 name', 'Bo Chen-Wong')
    click('Add investor')
    edit('Investor 4 name', 'Di Evans')
    edit('Investor 4 reference', 'DE-004')
    edit('Investor 4 cash due', '4000')
    click('Delete investor 1')

    expect(values(/^Investor \d+ name$/)).toEqual(['Bo Chen-Wong', 'Cy Diaz', 'Di Evans'])
    expect(values(/^Investor \d+ reference$/)).toEqual(['BC-002', 'CD-003', 'DE-004'])
    const ids = values(/^Investor \d+ ID$/)
    expect(ids[0]).toBe(pastedIds[1])
    expect(ids[2]).not.toBe('')
    expect(new Set(ids).size).toBe(3)
    // the edited list is what the engine reconciles: three investors, nothing paid yet
    const status = screen.getByRole('table', { name: 'Investor payment status' })
    expect(within(status).getAllByText('Not paid')).toHaveLength(3)
    expect(within(status).getByText('Di Evans')).toBeTruthy()
  })

  it('TC-IO-20 clearing an investor ID fills in a generated one', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Add investor')
    edit('Investor 1 ID', '  ')
    expect(values(/^Investor \d+ ID$/)[0].trim()).not.toBe('')
  })

  it('TC-DEAL-02 a renamed deal is still there after a reload', () => {
    const storage = new MemoryStorage()
    const first = render(<App storage={storage} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    edit('Deal name', 'Acme Seed SPV')
    expect(screen.getByTestId('deal-name').textContent).toBe('Acme Seed SPV')
    first.unmount()
    render(<App storage={storage} />)
    expect(screen.getByTestId('deal-name').textContent).toBe('Acme Seed SPV')
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).deal.name).toBe('Acme Seed SPV')
  })

  it('TC-ALL-24 copying the closing confirmation puts exactly the on-screen text on the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Hand off to allocation')
    const shown = screen.getByTestId('confirmation').textContent!
    expect(shown).toContain('Wire to company: £98,895.00')
    // the refund section says what reconciliation found, independently of the clipboard check
    expect(shown).toContain('Over-payments to refund (not part of the allocation):\n- Hugo Bernard: £5,000.00')
    click('Copy closing confirmation')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toBe(shown)
    expect(await screen.findByText('Copied to the clipboard.')).toBeTruthy()
  })

  it('TC-X-01 every term listed in R-X-05 has an explanation on the page', () => {
    render(<App storage={new MemoryStorage()} />)
    // the PRD's list, written out here rather than read from the code
    const prd = [
      'SPV',
      'nominee / bare trust',
      'beneficial interest',
      'minimum commitment',
      'scale-back',
      'S/EIS',
      'carry',
      'hurdle',
      'catch-up',
      'tiered carry',
      'waterfall',
    ]
    const glossary = screen.getByText('Glossary').closest('details')!
    for (const term of prd) {
      const dt = within(glossary).getByText(term, { selector: 'dt' })
      const dd = dt.nextElementSibling!
      expect(dd.tagName).toBe('DD')
      expect(dd.textContent!.length).toBeGreaterThan(20)
    }
  })

  it('TC-X-01 a term in the interface expands to its explanation', () => {
    render(<App storage={new MemoryStorage()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    click('What is SPV?')
    expect(screen.getByRole('note').textContent).toMatch(/special purpose vehicle/i)
  })

  it('TC-X-01 the explanation closes with Esc or a click elsewhere, and only one is open at a time', () => {
    render(<App storage={new MemoryStorage()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    click('What is SPV?')
    fireEvent.keyDown(screen.getByRole('note'), { key: 'Escape' })
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'What is SPV?' }))
    click('What is SPV?')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'What is beneficial interest?' }))
    click('What is beneficial interest?')
    expect(screen.getAllByRole('note').map((n) => n.textContent)).toEqual([expect.stringMatching(/economic rights/i)])
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('TC-X-01 keyboard: opening a second explanation closes the first; moving focus away closes it (UI polish self-test #3)', () => {
    render(<App storage={new MemoryStorage()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    click('What is SPV?') // a keyboard press: a click with no pointer-down
    click('What is nominee / bare trust?')
    expect(screen.getAllByRole('note').map((n) => n.textContent)).toEqual([expect.stringMatching(/bare trust|nominee/i)])
    const q = screen.getByRole('button', { name: 'What is nominee / bare trust?' })
    fireEvent.focusOut(q, { relatedTarget: screen.getByRole('button', { name: 'What is beneficial interest?' }) })
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('TC-X-01 Esc on an open explanation closes only the explanation, not the guided tour', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    click('What is SPV?')
    // Esc goes wherever focus is: opening must put focus on the "?" itself, as Safari does not (Codex UI polish #1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'What is SPV?' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByTestId('tour-card')).toBeTruthy()
  })

  it('TC-X-03 theme: System by default, Dark is remembered after reopening, Clear all data goes back to System', () => {
    const storage = new MemoryStorage()
    const pressed = () => screen.getAllByRole('button', { pressed: true }).map((b) => b.textContent)
    const first = render(<App storage={storage} />)
    const theme = within(screen.getByRole('group', { name: 'Theme' }))
    expect(within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { pressed: true }).textContent).toBe('System')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    fireEvent.click(theme.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    first.unmount()
    document.documentElement.removeAttribute('data-theme')
    render(<App storage={storage} />)
    expect(pressed()).toContain('Dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    click('Clear all data')
    click('Clear everything')
    expect(within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { pressed: true }).textContent).toBe('System')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(storage.length).toBe(0)
  })

  it('TC-X-02 the footer has a mailto feedback link with "Please don\'t send real investor information"', () => {
    render(<App storage={new MemoryStorage()} />)
    const link = screen.getByRole('link', { name: /feedback/i })
    expect(link.getAttribute('href')).toMatch(/^mailto:haixiangyuann@gmail\.com\?/) // the owner's address, not a placeholder
    expect(link.parentElement!.textContent).toContain("Please don't send real investor information")
  })

  it('TC-REC-29 hand-off is disabled while a suggestion is waiting, with the reason shown', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Load sample deal')
    expect((screen.getByRole('button', { name: 'Hand off to allocation' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('handoff-block').textContent).toContain('Review the 3 suggested matches first.')
    click('Confirm Chloe Martin')
    click('Confirm Elena Rossi')
    click('Confirm Kavya Iyer')
    expect((screen.getByRole('button', { name: 'Hand off to allocation' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('TC-ALL-19 share price "abc": no result, checks unavailable, copy and export disabled', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Hand off to allocation')
    edit('Share price', 'abc')
    expect(screen.queryByTestId('alloc-totals')).toBeNull()
    expect(screen.queryByTestId('confirmation')).toBeNull()
    expect(screen.getByTestId('checks-status').textContent).toContain('Unavailable')
    expect(screen.getByRole('alert').textContent).toContain('Allocation, share price')
    for (const name of ['Copy closing confirmation', 'Export allocation CSV'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('R-ALL-04.2 cap £80,000 on the sample: scaled back, "Can\'t close yet" with names, copy and export disabled (M-04)', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Hand off to allocation')
    expect((screen.getByRole('button', { name: 'Export allocation CSV' }) as HTMLButtonElement).disabled).toBe(false)
    edit('Round cap', '80000')
    const blockers = screen.getByTestId('blockers')
    expect(blockers.textContent).toContain("Can't close yet")
    expect(blockers.textContent).toContain('Isla Campbell')
    expect(screen.getByTestId('alloc-totals').textContent).toContain('£80,000.00')
    for (const name of ['Copy closing confirmation', 'Export allocation CSV'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('R-X-02 "Clear all data" also empties pasted text and import messages', () => {
    render(<App storage={new MemoryStorage()} />)
    const box = () => screen.getAllByLabelText('Paste CSV text (first line is the header)')[0] as HTMLTextAreaElement
    fireEvent.change(box(), { target: { value: 'name,reference,cash_due\nAnn Lee,AL-001,1000' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Import pasted text' })[0])
    expect(screen.getByText('Imported 1 investors. Amounts read as GBP.')).toBeTruthy()
    click('Clear all data')
    click('Clear everything')
    expect(box().value).toBe('')
    expect(screen.queryByText('Imported 1 investors. Amounts read as GBP.')).toBeNull()
    expect(screen.queryByText('Ann Lee')).toBeNull()
  })

  it('wording the PRD requires verbatim is on screen (R-X-02, R-X-03, R-DEAL-02, R-REC-06, C-ALL-8)', () => {
    render(<App storage={new MemoryStorage()} />)
    const page = () => document.body.textContent!
    // written out from the PRD, not imported from the code
    expect(page()).toContain(
      'Your deal data is processed in your browser and never sent by this app. The hosting provider still receives normal page requests.',
    )
    expect(page()).toMatch(/not investment, tax or legal advice\. Check every result yourself/)
    expect(page()).toContain('Not affiliated with any platform')
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    expect(screen.getByTestId('holding-structure').textContent).toBe(
      'Holding structure: nominee (bare trust) — investors hold beneficial interests; fractional shares allowed',
    )
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('name'))).toEqual(['feeBasis', 'feeBasis']) // no holding-structure choice
    fireEvent.click(screen.getByRole('tab', { name: /Reconciliation/ }))
    reviewSample()
    expect(page()).toMatch(/Operational reminder, not a regulatory deadline/)
    click('Hand off to allocation')
    expect(page()).toContain(
      'This estimate uses whole shares in the final allocation. Fees, scale-back and rounding can leave a remainder even when the wire is a multiple of the share price. Check the final allocated share count.',
    )
  })

  it('R-X-02 a file read that finishes after "Clear all data" does not bring the data back (Codex M2 #3)', async () => {
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    let finish!: (t: string) => void
    const file = { name: 'x.csv', text: () => new Promise<string>((r) => (finish = r)) }
    const input = screen.getAllByLabelText('Or choose a CSV file')[0]
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
    click('Clear all data')
    click('Clear everything')
    await act(async () => finish('name,reference,cash_due\nZara Quinn,ZQ-001,1234.56'))
    expect(screen.queryByText('Imported 1 investors. Amounts read as GBP.')).toBeNull()
    expect(screen.queryByDisplayValue('Zara Quinn')).toBeNull()
    expect(storage.getItem(STORAGE_KEY) ?? '').not.toContain('Zara')
  })

  it('R-REC-01.1 a file upload imports through the same importer', async () => {
    render(<App storage={new MemoryStorage()} />)
    const file = { name: 'x.csv', text: () => Promise.resolve('name,reference,cash_due\nZara Quinn,ZQ-001,1234.56') }
    const input = screen.getAllByLabelText('Or choose a CSV file')[0]
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => fireEvent.change(input))
    expect(values(/^Investor \d+ name$/)).toEqual(['Zara Quinn'])
  })

  it('C-03 results follow what is typed after a short pause, without leaving the field (Codex M2 #4)', () => {
    vi.useFakeTimers()
    try {
      render(<App storage={new MemoryStorage()} />)
      reviewSample()
      click('Hand off to allocation')
      fireEvent.change(screen.getByLabelText('Share price'), { target: { value: 'abc' } }) // no blur, no Enter
      act(() => vi.advanceTimersByTime(300))
      expect(screen.getByTestId('checks-status').textContent).toContain('Unavailable')
      expect(screen.queryByTestId('confirmation')).toBeNull()
      for (const name of ['Copy closing confirmation', 'Export allocation CSV'])
        expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('R-REC-01.1 a blank investor ID is held while typing and only filled in on leaving the field', () => {
    vi.useFakeTimers()
    try {
      render(<App storage={new MemoryStorage()} />)
      click('Add investor')
      const el = screen.getByLabelText('Investor 1 ID') as HTMLInputElement
      fireEvent.change(el, { target: { value: '' } })
      act(() => vi.advanceTimersByTime(1000))
      expect(el.value).toBe('')
      fireEvent.blur(el)
      expect(el.value).not.toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('R-REC-02.4 every import error stays reachable, even past the first 50 (Codex M2 #6)', () => {
    render(<App storage={new MemoryStorage()} />)
    const rows = Array.from({ length: 51 }, () => '2026-10-01,abc').join('\n')
    fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[1], { target: { value: `date,amount\n${rows}` } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Import pasted text' })[1])
    const box = screen.getByText('Nothing was imported').closest('.errors')!
    expect(box.textContent).toContain('Show the other 1 errors')
    expect(box.textContent).toContain('row 52, amount')
  })

  it('C-03 review: hand-off disabled but the ledger and chase list can be exported', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Load sample deal')
    expect((screen.getByRole('button', { name: 'Hand off to allocation' }) as HTMLButtonElement).disabled).toBe(true)
    for (const name of ['Export ledger CSV', 'Export chase list CSV']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('R-REC-08 a refund flagged after a hand edit blocks copy until kept or removed (Codex M2 #2)', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Hand off to allocation')
    edit('Allocation investor 8 received', '10000')
    expect(screen.getByTestId('excess').textContent).toContain('Does this refund still apply?')
    expect((screen.getByRole('button', { name: 'Copy closing confirmation' }) as HTMLButtonElement).disabled).toBe(true)
    click('Remove refund')
    expect(screen.queryByTestId('excess')).toBeNull()
    expect((screen.getByRole('button', { name: 'Copy closing confirmation' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId('confirmation').textContent).not.toContain('Over-payments to refund')
  })

  it('R-DEAL-03 switching investor fees to "on top" recalculates the allocation on that basis', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Hand off to allocation')
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    fireEvent.click(screen.getByLabelText(/Added on top of the investment/))
    fireEvent.click(screen.getByRole('tab', { name: /Allocation/ }))
    const shown = screen.getByTestId('alloc-totals').textContent!
    const ameliaInvested = within(document.querySelector('[data-investor="Amelia Hart"]') as HTMLElement).getAllByText(/£/)[1].textContent
    expect(ameliaInvested).toBe('£9,708.73') // floor(10,000 ÷ 1.03), C-ALL-1 on top
    expect(shown).not.toContain('£100,395.00')
  })

  it('R-DEAL-01 switching the currency to EUR shows euro amounts', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Load sample deal')
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    fireEvent.change(screen.getByDisplayValue('GBP'), { target: { value: 'EUR' } })
    click('Change to EUR')
    fireEvent.click(screen.getByRole('tab', { name: /Reconciliation/ }))
    expect(screen.getByTestId('rec-totals').textContent).toContain('€114,840.00')
  })

  it('TC-DEAL-03 changing the currency over existing amounts asks first and converts nothing; a new deal changes at once', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Load sample deal')
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    expect(screen.getByText('Currency: amounts are not converted. Changing it only changes what they are in.')).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('GBP'), { target: { value: 'EUR' } })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })) // Codex UI polish #3
    const ask = screen.getByRole('alertdialog').textContent!
    // sample: minimum 1 + 12 investors' cash due + 16 bank lines + share price + cap + 1 fixed fee + exit proceeds + exit costs = 34
    expect(ask).toMatch(/^34 amounts will be recorded in EUR instead of GBP, with the same values\. Nothing is converted\./)
    click('Cancel')
    expect(screen.getByDisplayValue('GBP')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByDisplayValue('GBP'))
    fireEvent.change(screen.getByDisplayValue('GBP'), { target: { value: 'EUR' } })
    click('Change to EUR')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByLabelText('Minimum commitment')).toHaveProperty('value', '1000.00')
    // after a hand-off: + 12 investors' cash received + 1 over-payment listed for refund (Hugo Bernard) (UI polish self-test #5)
    fireEvent.click(screen.getByRole('tab', { name: /Reconciliation/ }))
    for (const b of [
      'Confirm Chloe Martin',
      'Confirm Elena Rossi',
      'Confirm Kavya Iyer',
      'Mark t11 as not part of this deal',
      'Mark t14 as not part of this deal',
    ])
      click(b)
    click('Hand off to allocation')
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    fireEvent.change(screen.getByDisplayValue('EUR'), { target: { value: 'GBP' } })
    expect(screen.getByRole('alertdialog').textContent).toMatch(/^47 amounts will be recorded in GBP instead of EUR/)
    click('Cancel')
    fireEvent.click(screen.getByRole('tab', { name: /Reconciliation/ }))
    expect(screen.getByTestId('rec-totals').textContent).toContain('€114,840.00')
    cleanup()
    render(<App storage={new MemoryStorage()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    fireEvent.change(screen.getByDisplayValue('GBP'), { target: { value: 'USD' } })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByDisplayValue('USD')).toBeTruthy()
    expect(document.body.textContent).toContain('(US$, blank = none)')
  })

  it('R-DEAL-01 every money field names the deal currency and follows a change of currency (owner review 2026-10-20)', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Load sample deal')
    const tab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }))
    const labels = () => document.body.textContent!
    tab(/Deal settings/)
    expect(labels()).toContain('(£, blank = none)')
    fireEvent.change(screen.getByDisplayValue('GBP'), { target: { value: 'EUR' } })
    click('Change to EUR')
    expect(labels()).toContain('(€, blank = none)')
    tab(/Reconciliation/)
    for (const t of ['Cash due (€, including any fees charged to the investor)', 'Amount (€)']) expect(labels()).toContain(t)
    tab(/Allocation/)
    for (const t of ['Share price (€ per share)', 'Round cap (€, blank = no cap)', 'Rate (%) or amount (€)', 'Cash received (€)']) expect(labels()).toContain(t)
    tab(/Exit distribution/)
    for (const t of ['Exit proceeds (€)', 'Exit costs (€, blank = none)', 'Amount invested (€, excluding fees)']) expect(labels()).toContain(t)
    expect(labels()).not.toContain('£')
    // a screen reader hears the currency too: the fields' aria-label hides the visible label (Codex UI polish #2)
    const described = (label: string) => document.getElementById(screen.getByLabelText(label).getAttribute('aria-describedby') ?? '')?.textContent
    expect(['Exit proceeds', 'Exit costs'].map(described)).toEqual(['In EUR', 'In EUR'])
    tab(/Allocation/)
    expect(['Share price', 'Round cap', 'Fee 2 amount'].map(described)).toEqual(['In EUR', 'In EUR', 'In EUR'])
    expect(screen.getByLabelText('Fee 1 rate').hasAttribute('aria-describedby')).toBe(false)
    tab(/Deal settings/)
    expect(described('Minimum commitment')).toBe('In EUR')
  })

  it('C-03 an internal error shows no figures and asks for a report', () => {
    render(<Checks checks={[]} internal />)
    expect(screen.getByTestId('checks-status').textContent).toMatch(/Internal error: a self-check failed, so no figures are shown/)
  })

  it('C-03 the moment a value is retyped, figures are marked as updating and copy/export wait (Codex M2 round 2 #4)', () => {
    vi.useFakeTimers()
    try {
      render(<App storage={new MemoryStorage()} />)
      reviewSample()
      click('Hand off to allocation')
      fireEvent.change(screen.getByLabelText('Share price'), { target: { value: 'abc' } }) // no pause, no blur
      expect(screen.getByTestId('updating')).toBeTruthy()
      expect(screen.getByTestId('confirmation').getAttribute('aria-busy')).toBe('true')
      for (const name of ['Copy closing confirmation', 'Export allocation CSV'])
        expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
      act(() => vi.advanceTimersByTime(300))
      expect(screen.queryByTestId('updating')).toBeNull()
      expect(screen.getByTestId('checks-status').textContent).toContain('Unavailable')
    } finally {
      vi.useRealTimers()
    }
  })

  it('C-03 a pending edit in reconciliation holds back hand-off and exports', () => {
    vi.useFakeTimers()
    try {
      render(<App storage={new MemoryStorage()} />)
      reviewSample()
      fireEvent.click(screen.getByText(/^Bank statement \(16 lines\)$/))
      fireEvent.change(screen.getByLabelText('Bank line 1 amount'), { target: { value: '9999' } })
      for (const name of ['Hand off to allocation', 'Export ledger CSV', 'Export chase list CSV'])
        expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByTestId('handoff-block').textContent).toContain('Finish your edit first.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a pending edit is dropped, not written into the investor who replaced that row (Codex M2 round 2 #7)', async () => {
    vi.useFakeTimers()
    try {
      render(<App storage={new MemoryStorage()} />)
      fireEvent.click(screen.getByRole('tab', { name: /Allocation/ }))
      fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[0], {
        target: { value: 'investor_id,name,received,scheme\nalice,Alice,100,none' },
      })
      click('Import pasted text')
      let finish!: (t: string) => void
      const file = { name: 'x.csv', text: () => new Promise<string>((r) => (finish = r)) }
      const input = screen.getAllByLabelText('Or choose a CSV file')[0]
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      fireEvent.change(input)
      fireEvent.change(screen.getByLabelText('Allocation investor 1 received'), { target: { value: '150' } }) // typed, not committed
      await act(async () => finish('investor_id,name,received,scheme\nbob,Bob,200,none'))
      act(() => vi.advanceTimersByTime(1000))
      expect(screen.getByLabelText('Allocation investor 1 name')).toHaveProperty('value', 'Bob')
      expect(screen.getByLabelText('Allocation investor 1 received')).toHaveProperty('value', '200.00')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a pending edit is dropped when the same investor is re-imported with a new amount', async () => {
    vi.useFakeTimers()
    try {
      render(<App storage={new MemoryStorage()} />)
      fireEvent.click(screen.getByRole('tab', { name: /Allocation/ }))
      fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[0], {
        target: { value: 'investor_id,name,received,scheme\nalice,Alice,100,none' },
      })
      click('Import pasted text')
      let finish!: (t: string) => void
      const file = { name: 'x.csv', text: () => new Promise<string>((r) => (finish = r)) }
      const input = screen.getAllByLabelText('Or choose a CSV file')[0]
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      fireEvent.change(input)
      fireEvent.change(screen.getByLabelText('Allocation investor 1 received'), { target: { value: '150' } })
      await act(async () => finish('investor_id,name,received,scheme\nalice,Alice,300,none'))
      act(() => vi.advanceTimersByTime(1000))
      expect(screen.getByLabelText('Allocation investor 1 received')).toHaveProperty('value', '300.00')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a typed draft never moves to a different investor who replaces the row with the same amount (Codex M2 round 3 #7)', async () => {
    vi.useFakeTimers()
    try {
      const storage = new MemoryStorage()
      render(<App storage={storage} />)
      fireEvent.click(screen.getByRole('tab', { name: /Allocation/ }))
      fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[0], {
        target: { value: 'investor_id,name,received,scheme\nalice,Alice,100,none' },
      })
      click('Import pasted text')
      let finish!: (t: string) => void
      const file = { name: 'x.csv', text: () => new Promise<string>((r) => (finish = r)) }
      const input = screen.getAllByLabelText('Or choose a CSV file')[0]
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      fireEvent.change(input)
      fireEvent.change(screen.getByLabelText('Allocation investor 1 received'), { target: { value: '150' } })
      await act(async () => finish('investor_id,name,received,scheme\nbob,Bob,100,none')) // same amount as Alice
      const field = screen.getByLabelText('Allocation investor 1 received') as HTMLInputElement
      expect(field.value).toBe('100.00') // the draft did not move to Bob
      act(() => vi.advanceTimersByTime(1000))
      fireEvent.blur(field)
      fireEvent.keyDown(field, { key: 'Enter' })
      expect(field.value).toBe('100.00')
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).allocation.investors).toEqual([{ id: 'bob', name: 'Bob', received: '100.00', scheme: 'none' }])
      expect(screen.queryByTestId('updating')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  /** A file whose read finishes only when the test says so. */
  function deferredFile(input: HTMLElement) {
    let finish!: (t: string) => void
    const file = { name: 'x.csv', text: () => new Promise<string>((r) => (finish = r)) }
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
    return (text: string) => act(async () => finish(text))
  }

  function aliceDeal() {
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    const boxes = () => screen.getAllByLabelText('Paste CSV text (first line is the header)')
    fireEvent.change(boxes()[0], { target: { value: 'investor_id,name,reference,cash_due\na1,Alice,ALICE,200' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Import pasted text' })[0])
    fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[1], {
      target: { value: 'transaction_id,date,amount,payer,reference\nt1,2026-10-01,100,Alice,ALICE' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Import pasted text' })[1])
    fireEvent.click(screen.getByText(/^Bank statement \(1 lines\)$/))
    fireEvent.click(screen.getByLabelText(/Append \(same transaction ID/))
    return storage
  }
  const t2 = 'transaction_id,date,amount,payer,reference\nt2,2026-10-02,50,Alice,ALICE'

  it('R-REC-02.2 an append that finishes after an edit keeps the edit (Codex M2 round 4 #9)', async () => {
    aliceDeal()
    const finish = deferredFile(screen.getAllByLabelText('Or choose a CSV file')[1])
    edit('Bank line 1 amount', '150') // committed before the file read completes
    await finish(t2)
    expect(screen.getByLabelText('Bank line 1 amount')).toHaveProperty('value', '150') // kept exactly as typed
    expect(screen.getByLabelText('Bank line 2 amount')).toHaveProperty('value', '50.00')
    expect(screen.getByTestId('rec-totals').textContent).toContain('£200.00')
  })

  it('R-REC-02.2 an append keeps an edit that is still being typed in an existing row', async () => {
    vi.useFakeTimers()
    try {
      const storage = aliceDeal()
      const finish = deferredFile(screen.getAllByLabelText('Or choose a CSV file')[1])
      fireEvent.change(screen.getByLabelText('Bank line 1 amount'), { target: { value: '150' } }) // not committed yet
      await finish(t2)
      expect(screen.getByLabelText('Bank line 1 amount')).toHaveProperty('value', '150')
      act(() => vi.advanceTimersByTime(300))
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).bank.map((b: { amount: string }) => b.amount)).toEqual(['150', '50.00'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a fee being typed survives an investor import that finishes meanwhile (Codex M2 round 4 #8)', async () => {
    vi.useFakeTimers()
    try {
      const storage = new MemoryStorage()
      render(<App storage={storage} />)
      click('Load sample deal')
      fireEvent.click(screen.getByRole('tab', { name: /Allocation/ }))
      const finish = deferredFile(screen.getAllByLabelText('Or choose a CSV file')[0])
      fireEvent.change(screen.getByLabelText('Fee 1 rate'), { target: { value: '10' } })
      await finish('investor_id,name,received,scheme\nbob,Bob,100,none')
      expect(screen.getByLabelText('Fee 1 rate')).toHaveProperty('value', '10')
      act(() => vi.advanceTimersByTime(300))
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).allocation.fees[0].value).toBe('10')
    } finally {
      vi.useRealTimers()
    }
  })

  it('R-REC-02.2 an append does not re-format existing rows, so a second edit in progress survives (Codex M2 round 5 #9)', async () => {
    vi.useFakeTimers()
    try {
      const storage = aliceDeal()
      edit('Bank line 1 amount', '150') // committed, not in canonical form
      const finish = deferredFile(screen.getAllByLabelText('Or choose a CSV file')[1])
      fireEvent.change(screen.getByLabelText('Bank line 1 amount'), { target: { value: '175' } }) // still typing
      await finish(t2)
      expect(screen.getByLabelText('Bank line 1 amount')).toHaveProperty('value', '175')
      expect(screen.getByTestId('updating')).toBeTruthy()
      act(() => vi.advanceTimersByTime(300))
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).bank.map((b: { amount: string }) => b.amount)).toEqual(['175', '50.00'])
      expect(screen.getByTestId('rec-totals').textContent).toContain('£225.00')
    } finally {
      vi.useRealTimers()
    }
  })

  function toExitTab() {
    fireEvent.click(screen.getByRole('tab', { name: /Exit distribution/ }))
  }
  function pasteHoldings(csv: string) {
    fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[0], { target: { value: csv } })
    click('Import pasted text')
  }

  it('TC-DIS-21 (a) editing one holding changes only that row; £29 splits 19:20 as £14.13 / £14.87', () => {
    render(<App storage={new MemoryStorage()} />)
    toExitTab()
    pasteHoldings('investor_id,name,capital,share_price\na,A,0.19,100000\nb,B,0.10,100000') // TC-DIS-22 holdings
    edit('Holding 2 amount invested', '0.20')
    edit('Exit proceeds', '29')
    edit('Years held', '1')
    edit('Carry rate', '0')
    expect(screen.getByLabelText('Holding 1 amount invested')).toHaveProperty('value', '0.19')
    const row = (n: string) => document.querySelector(`[data-holder="${n}"]`)!.textContent!
    expect(row('A')).toContain('£14.13')
    expect(row('B')).toContain('£14.87')
  })

  it('TC-DIS-21 (b) importing fixtures/holdings.csv replaces the table with exactly the file', () => {
    render(<App storage={new MemoryStorage()} />)
    toExitTab()
    pasteHoldings('name,capital\nOld,1')
    const csv = readFileSync('fixtures/holdings.csv', 'utf8')
    pasteHoldings(csv)
    const fileRows = csv
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.split(','))
    expect(values(/^Holding \d+ name$/)).toEqual(fileRows.map((r) => r[1]))
    expect(values(/^Holding \d+ amount invested$/)).toEqual(fileRows.map((r) => r[2]))
    expect(screen.getByTestId('exit-price').textContent).toContain('£2.4137')
  })

  it('R-DIS-07 exit costs above proceeds: shortfall shown, no distribution, export disabled', () => {
    render(<App storage={new MemoryStorage()} />)
    toExitTab()
    pasteHoldings('name,capital\nA,100')
    edit('Exit proceeds', '1')
    edit('Exit costs', '2')
    edit('Years held', '1')
    edit('Carry rate', '20')
    expect(screen.getByTestId('shortfall').textContent).toContain('£1.00')
    expect(screen.queryByTestId('exit-totals')).toBeNull()
    expect((screen.getByRole('button', { name: 'Export distribution CSV' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('R-DIS-03/04 switching carry mode clears what does not apply', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Load sample deal')
    toExitTab()
    fireEvent.click(screen.getByLabelText(/Tiered/))
    expect(screen.queryByLabelText('Hurdle rate')).toBeNull()
    fireEvent.click(screen.getByLabelText(/Fixed rate/))
    expect(screen.getByLabelText('Hurdle rate')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Carry rate')).toHaveProperty('value', '')
  })

  it('Clear all data asks first; Cancel keeps everything (owner decision 2026-10-20)', () => {
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    click('Load sample deal')
    click('Clear all data')
    expect(screen.getByRole('alertdialog').textContent).toContain('Clear all data in this browser? This cannot be undone.')
    expect(screen.getByRole('button', { name: 'Clear all data' })).toHaveProperty('disabled', true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })) // UI polish self-test #2
    click('Cancel')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear all data' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('deal-name').textContent).toContain('Northwind')
    click('Clear all data')
    click('Clear everything')
    expect(screen.getByTestId('deal-name').textContent).toBe('New deal')
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('R-ALL-11 hand-off to exit is disabled while the allocation is blocked', () => {
    render(<App storage={new MemoryStorage()} />)
    reviewSample()
    click('Hand off to allocation')
    expect((screen.getByRole('button', { name: 'Hand off to exit distribution' }) as HTMLButtonElement).disabled).toBe(false)
    edit('Round cap', '80000')
    expect((screen.getByRole('button', { name: 'Hand off to exit distribution' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('R-X-01 the tour puts back only the demo cap it set, and Exit tour keeps the data', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Allocation (steps 8–11)' }))
    click('Next')
    click('Next')
    expect(screen.getByTestId('tour-card').textContent).toContain('Step 10 of 12')
    click('Try a £80,000 cap')
    expect(screen.getByTestId('blockers').textContent).toContain('Isla Campbell')
    click('Next')
    expect(screen.getByLabelText('Round cap')).toHaveProperty('value', '150000.00')
    click('Exit tour')
    expect(screen.queryByTestId('tour-card')).toBeNull()
    expect(screen.getByTestId('alloc-totals').textContent).toContain('£100,395.00')
    expect(screen.getByRole('button', { name: 'Resume tour (step 11 of 12)' })).toBeTruthy()
  })

  it('R-X-01 starting the tour over your own data warns first; Not now changes nothing', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    click('Add investor')
    click('Take the tour')
    expect(screen.getByTestId('tour-start').textContent).toContain('This replaces the deal currently on this page.')
    click('Not now')
    expect(screen.queryByTestId('tour-start')).toBeNull()
    expect(screen.getAllByLabelText(/^Investor \d+ name$/)).toHaveLength(1)
  })

  it('R-X-01 after a reload in the middle of the step-10 demo, Resume and Next still put the cap back (review M3 #2)', () => {
    const storage = new MemoryStorage()
    const first = render(<App storage={storage} />)
    click('I understand — take the 3-minute tour')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Allocation (steps 8–11)' }))
    click('Next')
    click('Next')
    click('Try a £80,000 cap')
    first.unmount()
    render(<App storage={storage} />)
    click('Resume tour (step 10 of 12)')
    expect(screen.getByTestId('tour-card').textContent).toContain('Next puts the cap back to £150,000.00')
    click('Next')
    expect(screen.getByLabelText('Round cap')).toHaveProperty('value', '150000.00')
    expect(screen.getByTestId('tour-card').textContent).toContain('Step 11 of 12')
  })

  it('R-X-01 restarting a resumed tour over your own data warns first (review M3 #5)', () => {
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    click('I understand — take the 3-minute tour')
    click('Next')
    click('Exit tour')
    click('Clear all data')
    click('Clear everything')
    click('I understand')
    storage.setItem('deal-ops-toolkit:tour', JSON.stringify({ step: 5, demo: false }))
    cleanup()
    render(<App storage={storage} />)
    click('Add investor')
    click('Resume tour (step 6 of 12)')
    expect(screen.getByTestId('tour-stale').textContent).toContain('This replaces the deal currently on this page.')
  })

  it('R-X-01 keyboard: → moves on only when the step allows, never while typing; the target is described by the card', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    const card = () => screen.getByTestId('tour-card').textContent!
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(card()).toContain('Step 2 of 12')
    fireEvent.keyDown(document.body, { key: 'ArrowRight' }) // Chloe not confirmed yet
    expect(card()).toContain('Step 2 of 12')
    const target = document.querySelector('[data-tour="review-t03"]')!
    expect(target.classList.contains('tour-target')).toBe(true)
    expect(document.getElementById(target.getAttribute('aria-describedby')!)?.textContent).toContain('No reference at all')
    click('Do this for me')
    fireEvent.keyDown(screen.getAllByLabelText('Paste CSV text (first line is the header)')[0], { key: 'ArrowRight' })
    expect(card()).toContain('Step 2 of 12')
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(card()).toContain('Step 3 of 12')
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(card()).toContain('Step 2 of 12')
    expect(card()).toContain('Done ✓') // Back shows the decision, it does not undo it
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('tour-card')).toBeNull()
  })

  it('R-ALL-11 hand-off to exit also waits for input errors and edits in progress', () => {
    vi.useFakeTimers()
    try {
      render(<App storage={new MemoryStorage()} />)
      reviewSample()
      click('Hand off to allocation')
      const exitButton = () => (screen.getByRole('button', { name: 'Hand off to exit distribution' }) as HTMLButtonElement).disabled
      fireEvent.change(screen.getByLabelText('Round cap'), { target: { value: '160000' } }) // typed, not yet calculated
      expect(exitButton()).toBe(true)
      act(() => vi.advanceTimersByTime(300))
      expect(exitButton()).toBe(false)
      edit('Share price', 'abc')
      expect(exitButton()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('C-DIS-7 holdings show shares and can be exported before the exit terms are filled in (review M3 #6)', () => {
    render(<App storage={new MemoryStorage()} />)
    toExitTab()
    pasteHoldings('name,capital,share_price\nA,10,2')
    expect(document.querySelector('table[aria-label="Holdings"] tbody tr')!.textContent).toContain('5.000000')
    expect((screen.getByRole('button', { name: 'Export holdings CSV' }) as HTMLButtonElement).disabled).toBe(false)
  })

  function tourToStep10(storage = new MemoryStorage()) {
    render(<App storage={storage} />)
    click('I understand — take the 3-minute tour')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Allocation (steps 8–11)' }))
    click('Next')
    click('Next')
    return storage
  }

  it('R-X-01 the demo puts back the cap that was there before it (Codex M3 R1 #2 A)', () => {
    tourToStep10()
    edit('Round cap', '120000')
    click('Try a £80,000 cap')
    expect(screen.getByTestId('tour-card').textContent).toContain('Next puts the cap back to £120,000.00.')
    click('Next')
    expect(screen.getByLabelText('Round cap')).toHaveProperty('value', '120000')
  })

  it("R-X-01 after Exit tour the demo is over: a cap the person types later is never the tour's (Codex M3 R1 #2 B)", () => {
    const storage = tourToStep10()
    click('Try a £80,000 cap')
    click('Exit tour')
    expect(screen.getByLabelText('Round cap')).toHaveProperty('value', '150000.00')
    expect(JSON.parse(storage.getItem('deal-ops-toolkit:tour')!).demoFrom).toBeNull()
    edit('Round cap', '80000')
    click('Resume tour (step 10 of 12)')
    // the person's 80,000 blocks the allocation, so the tour asks before replaying instead of treating it as its own
    expect(screen.getByTestId('tour-stale')).toBeTruthy()
    click('Cancel')
    expect(screen.getByLabelText('Round cap')).toHaveProperty('value', '80000')
  })

  it('R-X-01 resuming after the sample was edited asks first (Codex M3 R1 #3)', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    for (let i = 0; i < 5; i++) {
      const doIt = screen.queryByRole('button', { name: 'Do this for me' })
      if (doIt) fireEvent.click(doIt)
      click('Next')
    }
    expect(screen.getByTestId('tour-card').textContent).toContain('Step 6 of 12')
    click('Exit tour')
    fireEvent.click(screen.getByText(/^Bank statement \(16 lines\)$/))
    edit('Bank line 4 amount', '3000')
    click('Resume tour (step 6 of 12)')
    expect(screen.getByTestId('tour-stale').textContent).toContain('This replaces the deal currently on this page.')
  })

  it('R-X-01 a chapter jump over edited data asks first; Replace and jump replays (Codex M3 R1 #1)', () => {
    tourToStep10()
    edit('Share price', '5')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Exit (steps 12–12)' }))
    expect(screen.getByTestId('tour-jump').textContent).toContain('This replaces the deal currently on this page.')
    expect(screen.queryByTestId('tour-card')).toBeNull()
    click('Cancel')
    expect(screen.getByLabelText('Share price')).toHaveProperty('value', '5')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Exit (steps 12–12)' }))
    click('Replace and jump')
    expect(screen.getByTestId('tour-card').textContent).toContain('Step 12 of 12')
    expect(screen.getByTestId('exit-totals').textContent).toContain('£57,021.00')
  })

  it('C-03 the holdings export uses the full holdings validation (Codex M3 R1 #6)', () => {
    render(<App storage={new MemoryStorage()} />)
    toExitTab()
    pasteHoldings('name,capital\nA,10')
    expect((screen.getByRole('button', { name: 'Export holdings CSV' }) as HTMLButtonElement).disabled).toBe(false)
    edit('Holding 1 name', 'A'.repeat(121))
    expect((screen.getByRole('button', { name: 'Export holdings CSV' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('R-X-01 Replay after edits at the end asks first (Codex M3 R2 #7)', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Exit (steps 12–12)' }))
    click('Finish')
    expect(screen.getByTestId('tour-end')).toBeTruthy()
    edit('Exit proceeds', '80000')
    click('Replay tour')
    expect(screen.getByTestId('tour-start').textContent).toContain('This replaces the deal currently on this page.')
    click('Not now')
    expect(screen.getByLabelText('Exit proceeds')).toHaveProperty('value', '80000')
  })

  it('R-X-01 an untouched finished tour replays without a warning', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Exit (steps 12–12)' }))
    click('Finish')
    click('Replay tour')
    expect(screen.getByTestId('tour-card').textContent).toContain('Step 1 of 12')
  })

  it('R-X-01 a jump during the demo protects a cap set before or during it (Codex M3 R2 #8)', () => {
    tourToStep10()
    edit('Round cap', '120000')
    click('Try a £80,000 cap')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Exit (steps 12–12)' }))
    expect(screen.getByTestId('tour-jump')).toBeTruthy()
    cleanup()
    tourToStep10()
    click('Try a £80,000 cap')
    edit('Round cap', '120000')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Exit (steps 12–12)' }))
    expect(screen.getByTestId('tour-jump')).toBeTruthy()
  })

  it("R-X-01 restarting from the tour's own state does not warn; after an edit it does", () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    click('Next')
    click('Do this for me')
    click('Load sample deal') // during the tour this is a restart
    expect(screen.getByTestId('tour-start').textContent).not.toContain('This replaces')
    click('Not now')
    edit('Bank line 1 amount', '1')
    click('Load sample deal')
    expect(screen.getByTestId('tour-start').textContent).toContain('This replaces the deal currently on this page.')
  })

  it("R-X-01 a cap the person sets during the demo is theirs, even if they type the demo's value again (Codex M3 R3 #9)", () => {
    const storage = tourToStep10()
    click('Try a £80,000 cap')
    edit('Round cap', '120000')
    edit('Round cap', '80000')
    expect(JSON.parse(storage.getItem('deal-ops-toolkit:tour')!).demoFrom).toBeNull()
    click('Exit tour')
    expect(screen.getByLabelText('Round cap')).toHaveProperty('value', '80000')
  })

  it('R-X-01 the first-visit tour button warns if something was typed underneath (Codex M3 R3 #10)', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Add investor')
    edit('Investor 1 name', 'My Investor')
    click('I understand — take the 3-minute tour')
    expect(screen.getByTestId('tour-start').textContent).toContain('This replaces the deal currently on this page.')
    click('Not now')
    expect(screen.getByLabelText('Investor 1 name')).toHaveProperty('value', 'My Investor')
  })

  it('R-X-01 an edited as-of date counts as something to lose (Codex M3 R3 #11)', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    edit('As-of date', '2026-09-30')
    click('Take the tour')
    expect(screen.getByTestId('tour-start').textContent).toContain('This replaces the deal currently on this page.')
  })
})

describe('M4 visual refresh (the M4 visual plan (not published) v0.2)', () => {
  it('P6 copy items 1, 2, 4: Reconciliation heading under "Step 1 of 3", "Needs your review · N", "Summary"', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    click('Load sample deal')
    expect(screen.getByRole('heading', { level: 2, name: 'Reconciliation' })).toBeTruthy()
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 4, name: 'Needs your review · 3' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Summary' })).toBeTruthy()
    expect(screen.queryByText('Payment reconciliation')).toBeNull()
  })

  it('P6 copy item 7: an empty investor list says "No investors yet" and goes once there is one', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    expect(screen.getByText('No investors yet')).toBeTruthy()
    expect(screen.getByText('Import a CSV or load the sample deal to see how it works.')).toBeTruthy()
    click('Add investor')
    expect(screen.queryByText('No investors yet')).toBeNull()
  })

  it('P6 the breadcrumb names the open module and follows the tabs', () => {
    render(<App storage={new MemoryStorage()} />)
    const crumb = () => document.querySelector('.crumb')!.textContent
    expect(crumb()).toBe('Deal Ops Toolkit / Reconciliation')
    fireEvent.click(screen.getByRole('tab', { name: /Allocation/ }))
    expect(crumb()).toBe('Deal Ops Toolkit / Allocation')
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    expect(crumb()).toBe('Deal Ops Toolkit / Deal settings')
  })

  // a list section stays open once the person adds a row or imports, so the new row or the message is seen (G3 M-11)
  const sectionOf = (summary: RegExp) => screen.getByRole('heading', { name: summary }).closest('details')!
  const paste = (index: number, csv: string) => {
    fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[index], { target: { value: csv } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Import pasted text' })[index])
  }

  it('M-11 adding the first investor or bank line by hand keeps the section open', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    click('Add investor')
    expect(screen.getAllByLabelText(/^Investor \d+ name$/)).toHaveLength(1)
    expect(sectionOf(/^Investors \(1\)$/).open).toBe(true)
    click('Add bank line')
    expect(sectionOf(/^Bank statement \(1 lines?\)$/).open).toBe(true)
  })

  it('M-11 an import keeps the investor and bank sections open, so "Imported …" is seen', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    paste(0, 'name,reference,cash_due\nAnn Lee,AL-001,1000\nBo Chen,BC-002,2000')
    expect(screen.getByText('Imported 2 investors. Amounts read as GBP.').closest('details')!.open).toBe(true)
    paste(1, 'date,amount,payer,reference\n2026-10-10,1000,ANN LEE,AL-001')
    expect(screen.getByText(/^Replaced the statement with 1 line/).closest('details')!.open).toBe(true)
  })

  it('M-11 the allocation and exit lists stay open after adding a row or importing', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    fireEvent.click(screen.getByRole('tab', { name: /Allocation/ }))
    click('Add investor')
    expect(sectionOf(/^Investors \(1\)$/).open).toBe(true)
    paste(0, 'name,received,scheme\nAnn Lee,1000,none\nBo Chen,2000,none')
    expect(screen.getByText(/^Imported 2 investors\./).closest('details')!.open).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: /Exit distribution/ }))
    click('Add holding')
    expect(sectionOf(/^Holdings \(1\)$/).open).toBe(true)
    paste(0, 'name,capital\nAnn Lee,1000\nBo Chen,2000')
    expect(screen.getByText(/^Imported 2 holdings\./).closest('details')!.open).toBe(true)
  })

  it('M-11 importing over a list keeps keyboard focus on the import button (Codex G3 #1)', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    click('Load sample deal')
    fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[0], {
      target: { value: 'name,reference,cash_due\nAnn Lee,AL-001,1000' },
    })
    const button = screen.getAllByRole('button', { name: 'Import pasted text' })[0]
    button.focus()
    fireEvent.click(button)
    expect(screen.getByText('Imported 1 investors. Amounts read as GBP.')).toBeTruthy()
    expect(document.activeElement).toBe(button)
    expect(button.isConnected).toBe(true)
  })

  it('M-11 a section the person folds stays folded through other edits, and opens again when they choose', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    click('Add investor')
    const investors = sectionOf(/^Investors \(1\)$/)
    investors.open = false
    fireEvent(investors, new Event('toggle'))
    click('Add bank line')
    expect(sectionOf(/^Investors \(1\)$/).open).toBe(false)
    investors.open = true
    fireEvent(investors, new Event('toggle'))
    click('Add bank line')
    expect(sectionOf(/^Investors \(1\)$/).open).toBe(true)
  })

  it('M-11 an import message does not outlive its list: after loading the sample it is gone and the list folds (G3 acceptance)', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    paste(0, 'name,reference,cash_due\nAnn Lee,AL-001,1000')
    expect(screen.getByText('Imported 1 investors. Amounts read as GBP.')).toBeTruthy()
    click('Load sample deal')
    expect(screen.queryByText('Imported 1 investors. Amounts read as GBP.')).toBeNull()
    expect(sectionOf(/^Investors \(12\)$/).open).toBe(false)
  })

  it('M-11 loading the sample replaces the lists, which start folded as before', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    click('Add investor')
    click('Load sample deal')
    expect(sectionOf(/^Investors \(12\)$/).open).toBe(false)
  })

  it('M-11 an allocation with no share price says where to start; the hint goes once a price is entered', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand')
    fireEvent.click(screen.getByRole('tab', { name: /Allocation/ }))
    expect(screen.getByTestId('price-hint').textContent).toContain('Start with the share price for this round.')
    fireEvent.change(screen.getByLabelText('Share price'), { target: { value: '1.2' } }) // still typing: not yet the round's price
    expect(screen.getByTestId('price-hint')).toBeTruthy()
    fireEvent.blur(screen.getByLabelText('Share price'))
    expect(screen.queryByTestId('price-hint')).toBeNull()
    edit('Share price', '   ')
    expect(screen.getByTestId('price-hint')).toBeTruthy()
    edit('Share price', '1.25')
    expect(screen.queryByTestId('price-hint')).toBeNull()
    edit('Share price', '')
    expect(screen.getByTestId('price-hint')).toBeTruthy()
  })

  it('R-X-01 copy item 8: leaving the tour points at the Resume tour button that is on screen', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    click('Exit tour')
    expect(screen.getByText('Tour paused. Pick it up any time with Resume tour.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Resume tour \(step 1 of 12\)$/ })).toBeTruthy()
  })

  it('TC-X-04 a full store says the storage is full, a blocked one says blocked, and the message goes once saving works', () => {
    let fail: Error | null = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    class FailingStorage extends MemoryStorage {
      setItem(k: string, v: string) {
        if (fail) throw fail
        super.setItem(k, v)
      }
    }
    const full = /storage for this page is full, so your latest changes are not being saved/
    const blocked = /storage is blocked/
    const storage = new FailingStorage()
    fail = null
    render(<App storage={storage} />)
    const region = screen.getByRole('status', { name: 'Save status' })
    expect(region.textContent).toBe('')
    fail = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    click('Load sample deal')
    // the same live region, mounted before the failure, carries the message, so screen readers announce it mid-session
    expect(screen.getByRole('status', { name: 'Save status' })).toBe(region)
    expect(region.textContent).toMatch(full)
    expect(screen.getByText(full)).toBeTruthy()
    expect(screen.queryByText(blocked)).toBeNull()
    fail = new DOMException('The operation is insecure.', 'SecurityError')
    click('Clear all data')
    click('Clear everything')
    click('Load sample deal')
    expect(screen.getByText(blocked)).toBeTruthy()
    expect(screen.queryByText(full)).toBeNull()
    fail = null
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    edit('Deal name', 'Acme Seed SPV')
    expect(screen.queryByText(blocked)).toBeNull()
    expect(screen.queryByText(full)).toBeNull()
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).deal.name).toBe('Acme Seed SPV') // really saved after recovery
  })

  it('TC-X-04 a browser that refuses storage before any write (site data blocked, or no localStorage) shows the blocked message', () => {
    const blocked = /storage is blocked/
    const refuse = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    try {
      render(<App />)
      expect(screen.getByRole('status', { name: 'Save status' }).textContent).toMatch(blocked)
      cleanup()
      refuse.mockImplementation(() => null as unknown as Storage)
      render(<App />)
      expect(screen.getByRole('status', { name: 'Save status' }).textContent).toMatch(blocked)
    } finally {
      refuse.mockRestore()
    }
    cleanup()
    render(<App />)
    expect(screen.getByRole('status', { name: 'Save status' }).textContent).toBe('')
  })
})
