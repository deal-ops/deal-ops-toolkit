// PRD §4.0 R-DEAL-01..04.
import type { Dispatch } from 'react'
import { CURRENCIES, type Currency } from '../lib/money'
import { HOLDING_STRUCTURE } from '../lib/deal'
import type { Action, DealText } from '../state'
import { Cell, Term } from './common'

export function DealSettings({ deal, dispatch }: { deal: DealText; dispatch: Dispatch<Action> }) {
  const set = (patch: Partial<DealText>) => dispatch({ type: 'setDeal', patch })
  return (
    <section className="panel" aria-labelledby="deal-h">
      <p className="eyebrow">Setup</p>
      <h2 id="deal-h">Deal settings</h2>
      <div className="form-grid">
        <label>
          Deal name
          <Cell className="field" label="Deal name" value={deal.name} onCommit={(v) => set({ name: v })} />
        </label>
        <label>
          Currency
          <select className="field" value={deal.currency} onChange={(e) => set({ currency: e.target.value as Currency })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          As-of date (YYYY-MM-DD or DD/MM/YYYY)
          <Cell className="field" label="As-of date" value={deal.asOf} onCommit={(v) => set({ asOf: v })} />
        </label>
        <label>
          <span>
            <Term term="minimum commitment">Minimum commitment</Term> (blank = none)
          </span>
          <Cell className="field" label="Minimum commitment" value={deal.minimum} onCommit={(v) => set({ minimum: v })} />
        </label>
        <label>
          Flag unmatched receipts after (days)
          <Cell className="field" label="Flag unmatched receipts after (days)" value={deal.agedThresholdDays} onCommit={(v) => set({ agedThresholdDays: v })} />
        </label>
      </div>
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
