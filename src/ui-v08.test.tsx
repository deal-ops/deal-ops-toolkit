// @vitest-environment jsdom
// PRD v0.8 interface cases for M5 (Test Plan §2.5, 〔M5〕): messages to investors, the activity log, initials.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'
import { initialState, sampleState, STORAGE_KEY, type AppState } from './state'
import { appendEvents } from './lib/activity'
import { chaseMessage, queryMessage } from './lib/messages'
import { reconcile } from './lib/reconcile'
import { SAMPLE_BANK, SAMPLE_COMMITMENTS, SAMPLE_SETTINGS } from './lib/sample'

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const DEAL = SAMPLE_SETTINGS.name

function sampleResult() {
  const o = reconcile({ commitments: SAMPLE_COMMITMENTS, lines: SAMPLE_BANK, decisions: {}, asOf: SAMPLE_SETTINGS.asOf, thresholdDays: 10 })
  if (!o.ok) throw new Error('sample')
  return o.result
}

function clipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

function reviewSample() {
  click('Load sample deal')
  click('Confirm Chloe Martin')
  click('Confirm Elena Rossi')
  click('Confirm Kavya Iyer')
  click('Mark t11 as not part of this deal')
  click('Mark t14 as not part of this deal')
}

describe('v0.8 messages (R-REC-10)', () => {
  it('TC-REC-46 Copy query before review and Copy message after it put the exact texts on the clipboard; nothing is sent', async () => {
    const writeText = clipboard()
    const open = vi.spyOn(window, 'open')
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    click('Load sample deal')
    click('Copy query for Chloe Martin about t03')
    expect(writeText.mock.calls[0][0]).toBe(queryMessage(DEAL, 'GBP', 'Chloe Martin', { amount: 2_000_000, date: '2026-10-07' }))
    expect(writeText.mock.calls[0][0]).toContain('we received a payment of £20,000.00 GBP on 7 October 2026 that we could not match')
    expect(await screen.findByText('Copied. Send it yourself from your usual email.')).toBeTruthy()
    click('Confirm Chloe Martin')
    click('Confirm Elena Rossi')
    click('Confirm Kavya Iyer')
    click('Mark t11 as not part of this deal')
    click('Mark t14 as not part of this deal')
    click('Copy message for David Kim')
    const david = sampleResult().commitments.find((c) => c.commitment.id === 'c04')!
    expect(writeText.mock.calls[1][0]).toBe(chaseMessage(DEAL, 'GBP', david))
    expect(await screen.findAllByText('Copied. Send it yourself from your usual email.')).toHaveLength(1)
    const copied = (JSON.parse(storage.getItem(STORAGE_KEY)!) as AppState).log.entries.filter((e) => e.event === 'message_copied')
    expect(copied.map((e) => [e.investorName, e.transactionId, e.detail])).toEqual([
      ['Chloe Martin', 't03', 'template B'],
      ['David Kim', '', 'template A'],
    ])
    // only people who are short or have not paid have a message
    expect(screen.queryByRole('button', { name: 'Copy message for Amelia Hart' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy message for Hugo Bernard' })).toBeNull() // overpaid: a refund, not a chase
    expect(screen.getByRole('button', { name: 'Copy message for James Whitfield' })).toBeTruthy()
    expect(document.querySelector('a[href^="mailto:"]:not(footer a)')).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it('TC-REC-46 without a clipboard the text is shown selected to copy by hand, and that is logged', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    reviewSample()
    click('Copy message for David Kim')
    expect(await screen.findByText('Could not copy. Select the text and copy it yourself.')).toBeTruthy()
    const box = screen.getByLabelText('Copy message for David Kim: text to copy') as HTMLTextAreaElement
    expect(box.readOnly).toBe(true)
    expect(box.value.startsWith('Hi David Kim,')).toBe(true)
    expect(document.activeElement).toBe(box)
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!) as AppState
    expect(saved.log.entries.at(-1)).toMatchObject({ event: 'message_copied', detail: 'template A · selected for manual copy' })
  })

  it('TC-REC-46 a clipboard that fails after the row has gone logs nothing and shows nothing (Codex M5 #3)', async () => {
    let reject: (e: Error) => void = () => undefined
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => new Promise<void>((_, no) => (reject = no)) },
      configurable: true,
    })
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    click('Load sample deal')
    click('Copy query for Chloe Martin about t03')
    click('Confirm Chloe Martin') // the review item, and its Copy query control, go away
    await act(async () => reject(new Error('denied')))
    expect(screen.queryByText('Could not copy. Select the text and copy it yourself.')).toBeNull()
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!) as AppState
    expect(saved.log.entries.map((e) => e.event)).not.toContain('message_copied')
  })

  it('TC-REC-46 a copy that finishes after Clear all data writes nothing back (Codex M5 r2 #1)', async () => {
    let done: () => void = () => undefined
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => new Promise<void>((yes) => (done = yes)) }, configurable: true })
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    click('Load sample deal')
    click('Copy query for Chloe Martin about t03')
    click('Clear all data')
    click('Clear everything')
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    await act(async () => done())
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('TC-REC-46 overlapping copies each write an entry, with the name as it was when copied (Codex M5 r3 #2)', async () => {
    const pending: (() => void)[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => new Promise<void>((yes) => pending.push(yes)) },
      configurable: true,
    })
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    reviewSample()
    click('Copy message for David Kim')
    click('Copy message for David Kim')
    await act(async () => pending.splice(0).forEach((f) => f()))
    const copied = () => (JSON.parse(storage.getItem(STORAGE_KEY)!) as AppState).log.entries.filter((e) => e.event === 'message_copied')
    expect(copied().map((e) => e.investorName)).toEqual(['David Kim', 'David Kim'])
    click('Copy message for David Kim')
    const name = screen.getByLabelText('Investor 4 name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Dave Kim' } })
    fireEvent.blur(name)
    await act(async () => pending.splice(0).forEach((f) => f()))
    expect(copied().map((e) => e.investorName)).toEqual(['David Kim', 'David Kim', 'David Kim'])
  })

  it('TC-REC-46 a copy that finishes after moving to another page is still logged; a failure then success logs no manual copy (Codex M5 r4 #2 #3)', async () => {
    const pending: { yes: () => void; no: (e: Error) => void }[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => new Promise<void>((yes, no) => pending.push({ yes, no })) },
      configurable: true,
    })
    const storage = new MemoryStorage()
    render(<App storage={storage} />)
    click('Load sample deal')
    click('Copy query for Chloe Martin about t03')
    fireEvent.click(screen.getByRole('tab', { name: /^Activity log$/ }))
    await act(async () => pending.shift()!.yes())
    const events = () => (JSON.parse(storage.getItem(STORAGE_KEY)!) as AppState).log.entries.map((e) => `${e.event}:${e.detail}`)
    expect(events()).toEqual(['sample_loaded:fictional sample deal', 'message_copied:template B'])
    fireEvent.click(screen.getByRole('tab', { name: /Reconciliation/ }))
    click('Copy query for Chloe Martin about t03')
    click('Copy query for Chloe Martin about t03')
    await act(async () => {
      const [first, second] = pending.splice(0)
      first.no(new Error('denied'))
      second.yes()
    })
    expect(screen.queryByText('Could not copy. Select the text and copy it yourself.')).toBeNull()
    expect(events().slice(2)).toEqual(['message_copied:template B'])
  })

  it('TC-X-11 "Take me to it" copes with a transaction ID holding a quote (Codex M5 r3 #1)', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Exit (steps 12–12)' }))
    click('Finish')
    fireEvent.click(screen.getByRole('tab', { name: /Reconciliation/ }))
    fireEvent.change(screen.getAllByLabelText('Paste CSV text (first line is the header)')[1], {
      target: { value: 'transaction_id,date,amount,payer,reference\n"""",2026-10-07,20000,CHLOE MARTIN,' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Import pasted text' })[1])
    click('Confirm Chloe Martin')
    // item 3 is the last "Take me to it" (items 1 and 2 may also be on the card, TC-X-12)
    fireEvent.click(screen.getAllByRole('button', { name: 'Take me to it' }).at(-1)!)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo decision on "' }))
  })

  it('TC-X-14 MT103 / UETR has a one-line explanation on the reconciliation page', () => {
    render(<App storage={new MemoryStorage()} />)
    click('Load sample deal')
    click('What is MT103 / UETR?')
    expect(screen.getByRole('note').textContent).toMatch(/UETR/)
    // PRD v0.8.2: generic wording, no waiting period
    expect(screen.getByText(/gives you a chase email/).textContent).toMatch(/anyone who has already paid to send the bank’s MT103 \/ UETR/)
    expect(document.body.textContent).not.toMatch(/business days/)
    const glossary = screen.getByText('Glossary').closest('details')!
    expect(within(glossary).getByText('MT103 / UETR', { selector: 'dt' }).nextElementSibling!.textContent!.length).toBeGreaterThan(20)
  })
})

describe('v0.8 activity log (R-X-08)', () => {
  it('TC-X-05 the Activity log page lists what was done, newest first, and exports it', () => {
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      created.push(b as Blob)
      return 'blob:x'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<App storage={new MemoryStorage()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Activity log' }))
    expect(screen.getByText('Decisions you make appear here.')).toBeTruthy()
    expect(
      screen.getByText(
        'Kept in this browser only. A working record, not a regulatory ledger. Anyone using this browser can clear it, and once it holds 5,000 entries the oldest are removed. Export the CSV to keep a full copy.',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Reconciliation/ }))
    reviewSample()
    fireEvent.click(screen.getByRole('tab', { name: 'Activity log' }))
    const rows = within(screen.getByRole('table', { name: 'Activity log' }))
      .getAllByRole('row')
      .slice(1)
    expect(rows.map((r) => r.children[3].textContent)).toEqual(['not_in_deal', 'not_in_deal', 'confirm', 'confirm', 'confirm', 'sample_loaded'])
    expect(rows[4].textContent).toContain('20,000.00 GBP')
    click('Export activity log CSV')
    expect(created).toHaveLength(1)
    const after = within(screen.getByRole('table', { name: 'Activity log' })).getAllByRole('row')
    expect(after[1].children[3].textContent).toBe('log_exported')
    // no control to change or delete an entry
    expect(within(screen.getByRole('table', { name: 'Activity log' })).queryAllByRole('button')).toEqual([])
  })

  it('TC-X-07 the 80% notice shows on every page, and turns into a count once unexported entries are removed', () => {
    const at = (n: number): AppState => {
      const s = sampleState(initialState(new Date('2026-10-20T12:00:00Z')))
      return {
        ...s,
        disclaimerAccepted: true,
        log: appendEvents(
          s.log,
          Array.from({ length: n }, () => ({ event: 'confirm' as const })),
          { time: 't', initials: '', currency: 'GBP' },
        ),
      }
    }
    const open = (s: AppState) => {
      const storage = new MemoryStorage()
      storage.setItem(STORAGE_KEY, JSON.stringify(s))
      return render(<App storage={storage} />)
    }
    let view = open(at(3_999))
    expect(screen.queryByTestId('log-near-full')).toBeNull()
    view.unmount()
    view = open(at(4_000))
    for (const tab of [/^Deal settings$/, /Reconciliation/, /Allocation/, /Exit distribution/, /^Activity log$/]) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      expect(screen.getByTestId('log-near-full').textContent).toBe('Activity log is 80% full. Export it now; after 5,000 entries the oldest are removed.')
    }
    view.unmount()
    open(at(5_003))
    expect(screen.getByTestId('log-removed').textContent).toBe('3 entries were removed before export.')
    expect(screen.queryByTestId('log-near-full')).toBeNull()
    click('Confirm Chloe Martin') // still works
    expect(screen.getByRole('button', { name: 'Undo decision on t03' })).toBeTruthy()
  })

  it('TC-X-08 when the store is full the oldest entries go, the deal is saved, and the page says entries were removed', () => {
    let fullOnce = false
    class FullOnce extends MemoryStorage {
      setItem(k: string, v: string) {
        if (fullOnce) {
          fullOnce = false
          throw new DOMException('full', 'QuotaExceededError')
        }
        super.setItem(k, v)
      }
    }
    const storage = new FullOnce()
    render(<App storage={storage} />)
    fullOnce = true
    click('Load sample deal')
    expect(screen.getByTestId('log-removed').textContent).toBe('1 entry was removed before export.')
    expect(screen.queryByText(/storage for this page is full/)).toBeNull()
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!) as AppState
    expect(saved.commitments).toHaveLength(12)
    expect(saved.log.truncated).toMatchObject({ count: 1, unexported: 1 })
    fireEvent.click(screen.getByRole('tab', { name: /^Activity log$/ }))
    expect(screen.getByText('1 earlier entry removed (seq 1–1); 1 not exported before removal')).toBeTruthy()
  })

  it('TC-X-07 the truncated line is shown first, on the first page of the log (Codex M5 #4)', () => {
    const s0 = sampleState(initialState(new Date('2026-10-20T12:00:00Z')))
    const s: AppState = {
      ...s0,
      disclaimerAccepted: true,
      log: appendEvents(
        s0.log,
        Array.from({ length: 5_001 }, () => ({ event: 'confirm' as const })),
        { time: 't', initials: '', currency: 'GBP' },
      ),
    }
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(s))
    render(<App storage={storage} />)
    fireEvent.click(screen.getByRole('tab', { name: /^Activity log$/ }))
    const rows = within(screen.getByRole('table', { name: 'Activity log' }))
      .getAllByRole('row')
      .slice(1)
    expect(rows[0].children[3].textContent).toBe('truncated')
    expect(rows[0].textContent).toContain('1 earlier entry removed (seq 1–1)')
    expect(rows[1].children[0].textContent).toBe('5001')
    expect(rows).toHaveLength(201)
  })

  it('TC-X-16 the initials field says what is wrong and keeps working', () => {
    render(<App storage={new MemoryStorage()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Deal settings' }))
    const field = screen.getByLabelText('Your initials') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'H@Y' } })
    fireEvent.blur(field)
    expect(screen.getByText(/Up to 10 letters, digits, spaces, dots or hyphens/)).toBeTruthy()
    fireEvent.change(field, { target: { value: 'HY' } })
    fireEvent.blur(field)
    expect(screen.queryByText(/Up to 10 letters/)).toBeNull()
  })
})

describe('v0.8 tour end card (R-X-01.2, guide v0.3 §3.2)', () => {
  it('TC-X-11 the end card names the Activity log and "Try next" item 3; Take me to it only focuses Undo', () => {
    render(<App storage={new MemoryStorage()} />)
    click('I understand — take the 3-minute tour')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Exit (steps 12–12)' }))
    click('Finish')
    const end = screen.getByTestId('tour-end')
    expect(end.textContent).toContain('Every decision you just made is in the Activity log.')
    expect(end.textContent).toContain("Undo a confirmed payment to see 'Copy query'.")
    const before = document.querySelectorAll('[data-tour^="undo-"]').length
    // item 3 is the last of the three (items 1 and 2 are M6, TC-X-12)
    fireEvent.click(within(end).getAllByRole('button', { name: 'Take me to it' }).at(-1)!)
    expect(screen.getByRole('tab', { name: /Reconciliation/, selected: true })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo decision on t03' }))
    expect(document.querySelectorAll('[data-tour^="undo-"]').length).toBeGreaterThanOrEqual(before) // nothing was undone
    expect(screen.getByTestId('tour-end')).toBeTruthy() // the card stays open
    fireEvent.click(screen.getByRole('tab', { name: /^Activity log$/ }))
    const rows = within(screen.getByRole('table', { name: 'Activity log' }))
      .getAllByRole('row')
      .slice(1)
    expect(rows.at(-1)!.children[3].textContent).toBe('sample_loaded')
    expect(rows.filter((r) => r.textContent!.includes('guided tour')).length).toBe(7)
  })
})
