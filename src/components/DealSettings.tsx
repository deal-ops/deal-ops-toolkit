// PRD §4.0 R-DEAL-01..04.
import { useEffect, useId, useRef, useState, type Dispatch } from 'react'
import { CURRENCIES, SYMBOL, type Currency } from '../lib/money'
import { HOLDING_STRUCTURE } from '../lib/deal'
import { parseInitials } from '../lib/activity'
import { CURRENCY_LOCKED_TEXT, type Action, type DealText } from '../state'
import { Cell, Term } from './common'

/**
 * `amounts`: how many amounts a change of currency would relabel (R-DEAL-01, v0.7.5). `currencyLocked`: a fee payer change
 * is active, so the currency waits until it is reversed (R-DEAL-01 v0.8.1, decision 12).
 */
export function DealSettings({
  deal,
  dispatch,
  amounts,
  currencyLocked = false,
}: {
  deal: DealText
  dispatch: Dispatch<Action>
  amounts: number
  currencyLocked?: boolean
}) {
  const set = (patch: Partial<DealText>) => dispatch({ type: 'setDeal', patch })
  // nothing is converted: with amounts on the page, a new currency is confirmed first (decision 10)
  const [askCurrency, setAskCurrency] = useState<Currency | null>(null)
  const lockId = useId()
  // focus goes to Cancel when the confirmation opens and back to the select when it closes (Codex UI polish #3)
  const currencySelect = useRef<HTMLSelectElement>(null)
  const cancelCurrency = useRef<HTMLButtonElement>(null)
  const askWasOpen = useRef(false)
  useEffect(() => {
    if (askCurrency) cancelCurrency.current?.focus()
    else if (askWasOpen.current) currencySelect.current?.focus()
    askWasOpen.current = askCurrency !== null
  }, [askCurrency])
  const ccyId = useId()
  const initialsId = useId()
  const initialsBad = parseInitials(deal.initials) === null
  const chooseCurrency = (c: Currency) => {
    if (c === deal.currency) return setAskCurrency(null)
    if (amounts > 0) return setAskCurrency(c)
    set({ currency: c })
  }
  return (
    <section className="panel" aria-labelledby="deal-h">
      <p className="eyebrow">Setup</p>
      <h2 id="deal-h">Deal settings</h2>
      {/* the currency in the accessible description of money fields: their aria-label hides the visible label (Codex UI polish #2) */}
      <span id={ccyId} hidden>
        In {deal.currency}
      </span>
      <div className="form-grid">
        <label>
          Deal name
          <Cell className="field" label="Deal name" value={deal.name} onCommit={(v) => set({ name: v })} />
        </label>
        <label>
          Currency
          <select
            className="field"
            ref={currencySelect}
            value={deal.currency}
            aria-label="Currency"
            disabled={currencyLocked}
            aria-describedby={currencyLocked ? lockId : undefined}
            onChange={(e) => chooseCurrency(e.target.value as Currency)}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {currencyLocked && (
            <span className="hint" id={lockId} data-testid="currency-locked">
              {CURRENCY_LOCKED_TEXT}
            </span>
          )}
        </label>
        <label>
          As-of date (YYYY-MM-DD or DD/MM/YYYY)
          <Cell className="field" label="As-of date" value={deal.asOf} onCommit={(v) => set({ asOf: v })} />
        </label>
        <label>
          <span>
            <Term term="minimum commitment">Minimum commitment</Term> ({SYMBOL[deal.currency]}, blank = none)
          </span>
          <Cell className="field" label="Minimum commitment" describedBy={ccyId} value={deal.minimum} onCommit={(v) => set({ minimum: v })} />
        </label>
        <label>
          Flag unmatched receipts after (days)
          <Cell className="field" label="Flag unmatched receipts after (days)" value={deal.agedThresholdDays} onCommit={(v) => set({ agedThresholdDays: v })} />
        </label>
        <label>
          Your initials (optional, added to each Activity log entry)
          <Cell
            className="field"
            label="Your initials"
            describedBy={initialsBad ? initialsId : undefined}
            value={deal.initials}
            onCommit={(v) => set({ initials: v })}
          />
          {initialsBad && (
            <span id={initialsId} className="warn-text">
              Up to 10 letters, digits, spaces, dots or hyphens. Entries are recorded without initials until this is fixed.
            </span>
          )}
        </label>
      </div>
      <p className="hint">Currency: amounts are not converted. Changing it only changes what they are in.</p>
      {askCurrency && (
        <div className="notice warn" role="alertdialog" aria-labelledby="ccy-q">
          <p id="ccy-q">
            {amounts === 1 ? '1 amount' : `${amounts} amounts`} will be recorded in {askCurrency} instead of {deal.currency}, with the same values. Nothing is
            converted.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                set({ currency: askCurrency })
                setAskCurrency(null)
              }}
            >
              Change to {askCurrency}
            </button>
            <button type="button" ref={cancelCurrency} onClick={() => setAskCurrency(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <fieldset className="choice">
        <legend>Investor percentage fees</legend>
        <label>
          <input type="radio" name="feeBasis" checked={deal.feeBasis === 'deducted'} onChange={() => set({ feeBasis: 'deducted' })} /> Deducted from the money
          wired (default) — the fee is a share of the cash used for this deal
        </label>
        <label>
          <input type="radio" name="feeBasis" checked={deal.feeBasis === 'onTop'} onChange={() => set({ feeBasis: 'onTop' })} /> Added on top of the investment
          — the fee is a share of the amount invested
        </label>
      </fieldset>
      <p className="structure" data-testid="holding-structure">
        {HOLDING_STRUCTURE}
      </p>
      <p className="hint">
        Every deal here is an <Term term="SPV" /> holding shares as <Term term="nominee / bare trust" />; investors hold a <Term term="beneficial interest" />.
        There is no other option.
      </p>
    </section>
  )
}
