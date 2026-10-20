// PRD §4.2 closing allocation: inputs, result, blockers, S/EIS, confirmation, export.
import { useId, useState, type Dispatch } from 'react'
import { SYMBOL, formatMicroShares, formatMoney } from '../lib/money'
import { SEIS_BEFORE_EIS_NOTE, SEIS_EIS_HINT, type AllocationResult, type FeeKind, type FeePayer } from '../lib/allocation'
import type { InputError, Outcome } from '../lib/outcome'
import { blocked } from '../lib/outcome'
import { importInvestors } from '../lib/csv'
import { allocationCsv, closingConfirmation } from '../lib/exports'
import { investorRow, type Action, type AppState, type FeeRow } from '../state'
import { Cell, Checks, ErrorList, ImportBox, Notice, Section, Term, UpdatingNotice } from './common'
import { useListMessage } from './listMessage'
import { download } from './download'
import { SchemeSelect } from './Reconciliation'

const BLOCKER_TEXT: Record<AllocationResult['blockers'][number]['code'], string> = {
  'no-participants': 'No investor can be allocated.',
  'company-fees-exceed': 'Company-paid fees are more than the total invested.',
  'scale-back-below-minimum': 'After scale-back, these investors fall below the minimum commitment:',
}

const EXCLUSION_TEXT = {
  'no-funds': 'No money received',
  'fees-exceed-receipt': 'Fees take everything received',
  'below-minimum': 'Below the minimum commitment',
  'zero-investment': 'Nothing left to invest after fees',
} as const

const KIND_OPTIONS: Record<FeePayer, { value: FeeKind; label: string }[]> = {
  investors: [
    { value: 'percent', label: 'Percentage' },
    { value: 'perInvestor', label: 'Fixed amount per investor' },
  ],
  company: [
    { value: 'percent', label: 'Percentage of amount raised' },
    { value: 'fixed', label: 'Fixed total' },
  ],
  lead: [
    { value: 'percent', label: 'Percentage of amount raised' },
    { value: 'fixed', label: 'Fixed total' },
  ],
}

export function Allocation({
  state,
  dispatch,
  derivedErrors,
  outcome,
  stale,
  priceMicros,
  canHandoff,
  onHandoff,
  pending,
  canHandoffToExit,
  onHandoffToExit,
}: {
  pending: boolean
  canHandoffToExit: boolean
  onHandoffToExit: () => void
  state: AppState
  dispatch: Dispatch<Action>
  derivedErrors: InputError[]
  outcome: Outcome<AllocationResult> | null
  stale: boolean
  priceMicros: number | null
  canHandoff: boolean
  onHandoff: () => void
}) {
  const cur = state.deal.currency
  const a = state.allocation
  const m = (x: number) => formatMoney(x, cur)
  const sym = SYMBOL[cur] // money fields say which currency they are in (owner review 2026-10-20)
  const ccyId = useId()
  // bumps whenever the investor list is replaced whole: the section and its rows start afresh (Codex M2 R3 #7, G3 M-11)
  const listKey = state.tables.investors
  const [importMsg, setImportMsg] = useListMessage<{ ok: true; text: string } | { ok: false; errors: InputError[] }>(listKey)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const result = outcome?.ok ? outcome.result : null
  const internal = outcome !== null && !outcome.ok && Boolean(outcome.internal)
  const isBlocked = outcome?.ok ? blocked(outcome.checks) : true
  const refundsToCheck = a.excess.filter((x) => x.needsCheck)
  const confirmation = result && priceMicros !== null ? closingConfirmation(state.deal.name, cur, priceMicros, result, a.excess) : ''

  const doImport = (text: string) => {
    const r = importInvestors(text, cur)
    if (!r.ok) return setImportMsg({ ok: false, errors: r.errors }, false)
    dispatch({ type: 'replaceInvestors', rows: r.rows.map(investorRow) })
    setImportMsg(
      {
        ok: true,
        text: `Imported ${r.rows.length} investors. Amounts read as ${cur}.${r.ignoredColumns.length ? ` Ignored columns: ${r.ignoredColumns.join(', ')}.` : ''}`,
      },
      true,
    )
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(confirmation)
      setCopyMsg('Copied to the clipboard.')
    } catch {
      setCopyMsg('Could not copy. Select the text above and copy it yourself.')
    }
  }

  return (
    <section className="panel" aria-labelledby="all-h">
      <p className="eyebrow">Step 2 of 3</p>
      <h2 id="all-h">Closing allocation</h2>
      {stale && (
        <Notice kind="warn">
          <span data-testid="stale">Out of date: reconciliation has changed since this hand-off.</span>{' '}
          {canHandoff ? (
            <button type="button" onClick={onHandoff}>
              Hand off again (replaces the investor list)
            </button>
          ) : (
            'Finish the review in reconciliation, then hand off again.'
          )}
        </Notice>
      )}
      {a.handoffVersion !== null && !stale && (
        <p className="hint">Investors were carried in from reconciliation. Editing them here does not change reconciliation.</p>
      )}

      <h3>Round</h3>
      {a.price.trim() === '' && (
        <p className="hint" data-testid="price-hint">
          Start with the share price for this round. Add any fees, such as a platform fee, under Fees below.
        </p>
      )}
      {/* the currency in the accessible description of money fields: their aria-label hides the visible label (Codex UI polish #2) */}
      <span id={ccyId} hidden>
        In {cur}
      </span>
      <div className="form-grid">
        <label>
          Share price ({sym} per share)
          <Cell
            className="field"
            label="Share price"
            describedBy={ccyId}
            value={a.price}
            onCommit={(v) => dispatch({ type: 'setAllocation', patch: { price: v } })}
          />
        </label>
        <label data-tour="cap">
          Round cap ({sym}, blank = no cap)
          <Cell
            className="field"
            label="Round cap"
            describedBy={ccyId}
            value={a.cap}
            onCommit={(v) => dispatch({ type: 'setAllocation', patch: { cap: v } })}
          />
        </label>
      </div>
      <p className="hint">
        Over the cap, everyone is cut back pro rata (<Term term="scale-back" />
        ). Fractional shares are allowed: each investor holds a <Term term="beneficial interest" /> through the nominee.
      </p>

      <h3>Fees</h3>
      <div className="table-wrap">
        <table className="grid fees" aria-label="Fees">
          <thead>
            <tr>
              <th>Name</th>
              <th>Paid by</th>
              <th>Type</th>
              <th>Rate (%) or amount ({sym})</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {a.fees.map((f, i) => (
              <FeeEditor key={`${state.tables.fees}:${f.id}`} f={f} i={i} dispatch={dispatch} ccyId={ccyId} />
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => dispatch({ type: 'addFee' })}>
        Add fee
      </button>
      <p className="hint">
        Investor percentage fees are {state.deal.feeBasis === 'deducted' ? 'deducted from the money wired' : 'added on top of the investment'} (change this in
        Deal settings). Company-paid fees come out of the wire to the company; lead-paid fees are invoiced to the lead.
      </p>

      <Section resetKey={listKey} startOpen={a.investors.length === 0} keepOpen={importMsg !== null}>
        <summary>
          <h3>Investors ({a.investors.length})</h3>
        </summary>
        <ImportBox
          title="Import investors (replaces the list)"
          help={
            <>
              Columns: <code>investor_id</code> (optional), <code>name</code>, <code>received</code>, <code>scheme</code>. Use this when you are not coming from
              reconciliation.
            </>
          }
          onImport={doImport}
        />
        {importMsg && (importMsg.ok ? <Notice kind="ok">{importMsg.text}</Notice> : <ErrorList errors={importMsg.errors} title="Nothing was imported" />)}
        <div className="table-wrap">
          <table className="grid" aria-label="Allocation investors">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Cash received ({sym})</th>
                <th>Scheme</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {a.investors.map((v, i) => (
                <tr key={`${listKey}:${i}`}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <Cell
                      label={`Allocation investor ${i + 1} name`}
                      value={v.name}
                      onCommit={(value) => dispatch({ type: 'editInvestor', index: i, rowId: v.id, field: 'name', value })}
                    />
                  </td>
                  <td>
                    <Cell
                      className="cell num"
                      label={`Allocation investor ${i + 1} received`}
                      value={v.received}
                      onCommit={(value) => dispatch({ type: 'editInvestor', index: i, rowId: v.id, field: 'received', value })}
                    />
                  </td>
                  <td>
                    <SchemeSelect
                      label={`Allocation investor ${i + 1} scheme`}
                      value={v.scheme}
                      onChange={(value) => dispatch({ type: 'editInvestor', index: i, rowId: v.id, field: 'scheme', value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link danger"
                      aria-label={`Delete allocation investor ${i + 1}`}
                      onClick={() => dispatch({ type: 'deleteInvestor', index: i })}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => dispatch({ type: 'addInvestor' })}>
          Add investor
        </button>
      </Section>

      {a.excess.length > 0 && (
        <>
          <h4>Over-payments to refund (not carried into the allocation)</h4>
          <ul data-testid="excess">
            {a.excess.map((x) => (
              <li key={x.id}>
                {x.name}: {m(x.amount)}
                {x.needsCheck && (
                  <>
                    {' '}
                    <span className="warn-text">— this investor was changed by hand after hand-off. Does this refund still apply?</span>{' '}
                    <button type="button" onClick={() => dispatch({ type: 'keepRefund', id: x.id })}>
                      Keep refund
                    </button>{' '}
                    <button type="button" className="danger" onClick={() => dispatch({ type: 'removeRefund', id: x.id })}>
                      Remove refund
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Result</h3>
      <ErrorList errors={derivedErrors} title="Input errors — no results until these are fixed" />
      {pending && <UpdatingNotice />}
      {result && (
        <div className={pending ? 'figures pending' : 'figures'} aria-busy={pending}>
          <AllocResult r={result} m={m} />
        </div>
      )}
      <Checks checks={outcome?.ok ? outcome.checks : []} unavailable={derivedErrors.length > 0} internal={internal} pending={pending} />

      {result && (
        <>
          <h3>Closing confirmation</h3>
          <p className="hint">A summary for the lead to confirm. Copy it into your message.</p>
          <pre className={pending ? 'confirmation pending' : 'confirmation'} data-testid="confirmation" data-tour="confirmation" aria-busy={pending}>
            {confirmation}
          </pre>
        </>
      )}
      <div className="row-actions">
        <button type="button" disabled={!result || pending || isBlocked || refundsToCheck.length > 0} onClick={copy}>
          Copy closing confirmation
        </button>
        <button
          type="button"
          disabled={!result || pending || isBlocked || refundsToCheck.length > 0}
          onClick={() => result && download(`allocation_${cur}.csv`, allocationCsv(result, cur))}
        >
          Export allocation CSV
        </button>
        <button type="button" className="primary" data-tour="handoff-exit" disabled={!canHandoffToExit} onClick={onHandoffToExit}>
          Hand off to exit distribution
        </button>
      </div>
      {copyMsg && <Notice kind="info">{copyMsg}</Notice>}
      {result && isBlocked && <p className="hint">Copy and export are disabled until the blockers above are resolved.</p>}
      {result && refundsToCheck.length > 0 && <p className="hint">Copy and export are disabled until you keep or remove the flagged refund.</p>}
    </section>
  )
}

function FeeEditor({ f, i, dispatch, ccyId }: { f: FeeRow; i: number; dispatch: Dispatch<Action>; ccyId: string }) {
  const edit = (patch: Partial<Omit<FeeRow, 'id'>>) => dispatch({ type: 'editFee', index: i, rowId: f.id, patch })
  return (
    <tr>
      <td>
        <Cell label={`Fee ${i + 1} name`} value={f.label} onCommit={(label) => edit({ label })} />
      </td>
      <td>
        <select className="cell" aria-label={`Fee ${i + 1} paid by`} value={f.payer} onChange={(e) => edit({ payer: e.target.value as FeePayer })}>
          <option value="investors">Investors</option>
          <option value="company">Company</option>
          <option value="lead">Lead</option>
        </select>
      </td>
      <td>
        <select className="cell" aria-label={`Fee ${i + 1} type`} value={f.kind} onChange={(e) => edit({ kind: e.target.value as FeeKind })}>
          {KIND_OPTIONS[f.payer].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <Cell
          className="cell num"
          label={`Fee ${i + 1} ${f.kind === 'percent' ? 'rate' : 'amount'}`}
          value={f.value}
          placeholder={f.kind === 'percent' ? 'e.g. 3' : 'e.g. 500.00'}
          describedBy={f.kind === 'percent' ? undefined : ccyId}
          onCommit={(value) => edit({ value })}
        />
      </td>
      <td>
        <button type="button" className="link danger" aria-label={`Delete fee ${i + 1}`} onClick={() => dispatch({ type: 'deleteFee', index: i })}>
          Delete
        </button>
      </td>
    </tr>
  )
}

function AllocResult({ r, m }: { r: AllocationResult; m: (x: number) => string }) {
  const investorFees = r.feeTotals.filter((f) => f.payer === 'investors')
  const anyClaimable = r.rows.some((x) => x.participating && x.scheme !== 'none')
  return (
    <>
      {r.blockers.length > 0 && (
        <div className="notice bad" role="alert" data-testid="blockers" data-tour="blockers">
          <p>
            <strong>Can&apos;t close yet</strong>
          </p>
          <ul>
            {r.blockers.map((b) => (
              <li key={b.code}>
                {BLOCKER_TEXT[b.code]} {b.names.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="totals" data-testid="alloc-totals" data-tour="alloc-totals">
        <div>
          <dt>Cash received</dt>
          <dd>{m(r.totals.received)}</dd>
        </div>
        <div>
          <dt>Total invested</dt>
          <dd>{m(r.totals.invested)}</dd>
        </div>
        <div>
          <dt>Investor fees</dt>
          <dd>{m(r.totals.investorFees)}</dd>
        </div>
        <div>
          <dt>Refunds</dt>
          <dd>{m(r.totals.refunds)}</dd>
        </div>
        <div>
          <dt>Company-paid fees</dt>
          <dd>{m(r.totals.companyFees)}</dd>
        </div>
        <div>
          <dt>Wire to company</dt>
          <dd>{m(r.totals.wire)}</dd>
        </div>
        {r.totals.leadInvoice > 0 && (
          <div>
            <dt>Invoice to lead</dt>
            <dd>{m(r.totals.leadInvoice)}</dd>
          </div>
        )}
      </dl>
      {r.scaledBack && <Notice kind="info">Demand was over the round cap, so every investor was scaled back pro rata.</Notice>}

      <h4>Fees</h4>
      <ul className="plain">
        {r.feeTotals.map((f) => (
          <li key={f.id}>
            {f.label} (paid by {f.payer === 'lead' ? 'the lead' : f.payer}
            {f.kind === 'percent' ? '' : f.kind === 'perInvestor' ? ', per investor' : ', fixed'}): {m(f.amount)}
          </li>
        ))}
      </ul>

      <h4>Per investor</h4>
      <div className="table-wrap">
        <table className="grid read" aria-label="Allocation result">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scheme</th>
              <th className="num">Received</th>
              <th className="num">Invested</th>
              <th className="num">Shares</th>
              {investorFees.map((f) => (
                <th key={f.id} className="num">
                  {f.label}
                </th>
              ))}
              <th className="num">Refund</th>
              {anyClaimable && <th className="num">S/EIS claimable (est.)</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.id} data-investor={x.name} data-tour={`alloc-${x.id}`}>
                <td className="nowrap">{x.name}</td>
                <td>{x.scheme}</td>
                <td className="num">{m(x.received)}</td>
                <td className="num">{m(x.invested)}</td>
                <td className="num">{x.participating ? formatMicroShares(x.microShares) : '—'}</td>
                {investorFees.map((f) => (
                  <td key={f.id} className="num">
                    {m(x.fees[f.id] ?? 0)}
                  </td>
                ))}
                <td className="num">{m(x.refund)}</td>
                {anyClaimable && (
                  <td className="num" data-tour={`seis-${x.id}`}>
                    {x.participating && x.scheme !== 'none' ? (
                      <>
                        {x.claimableShares.toLocaleString('en-GB')} shares / {m(x.claimableAmount)}
                        {x.nonClaimable > 0 && <span className="warn-text"> · not claimable {m(x.nonClaimable)}</span>}
                      </>
                    ) : (
                      ''
                    )}
                  </td>
                )}
                <td>{x.participating ? (x.scaledBack ? 'Scaled back' : 'Allocated') : `Out: ${EXCLUSION_TEXT[x.exclusion!]}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Invested = cash received less fees and refund. Shares = invested ÷ share price, shown to 6 decimal places. Investors below the minimum or with nothing
        left after fees are refunded in full and pay no fees.
      </p>
      {r.rows.some((x) => x.participating && x.scheme !== 'none' && x.nonClaimable > 0) && <p className="hint">S/EIS: {SEIS_EIS_HINT}</p>}

      <h4>
        By <Term term="S/EIS">tax scheme</Term>
      </h4>
      <div className="table-wrap">
        <table className="grid read" aria-label="By tax scheme">
          <thead>
            <tr>
              <th>Scheme</th>
              <th className="num">Investors</th>
              <th className="num">Invested</th>
              <th className="num">Shares</th>
            </tr>
          </thead>
          <tbody>
            {(['SEIS', 'EIS', 'none'] as const).map((k) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="num">{r.byScheme[k].investors}</td>
                <td className="num">{m(r.byScheme[k].invested)}</td>
                <td className="num">{formatMicroShares(r.byScheme[k].microShares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{SEIS_BEFORE_EIS_NOTE} Schemes are labels you entered; this tool does not check eligibility.</p>
    </>
  )
}
