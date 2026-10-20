// PRD §4.1 payment reconciliation: import, match, review, status, exports, hand-off.
import { useState, type Dispatch } from 'react'
import { SYMBOL, formatMoney, type Currency } from '../lib/money'
import { AGED_NOTE, decide, type Commitment, type CommitmentStatus, type LineResult, type LineStatus, type ReconcileResult } from '../lib/reconcile'
import type { InputError, Outcome } from '../lib/outcome'
import { importBank, importCommitments } from '../lib/csv'
import { chaseListCsv, ledgerCsv } from '../lib/exports'
import { bankRow, commitmentRow, type Action, type AppState } from '../state'
import { deriveBankLines, friendly } from '../derive'
import { Cell, Checks, ErrorList, ImportBox, Notice, Section, Term, UpdatingNotice } from './common'
import { useListMessage } from './listMessage'
import { download } from './download'

const LINE_STATUS: Record<LineStatus, string> = {
  auto: 'Matched automatically',
  confirmed: 'Confirmed by you',
  suggested: 'Needs review',
  unmatched: 'Not matched',
  rejected: 'Not part of this deal',
  skipped: 'Skipped: not a receipt',
  future: 'After the as-of date: not counted',
}

const INVESTOR_STATUS: Record<CommitmentStatus, string> = {
  paid: 'Paid in full',
  partial: 'Underpaid',
  overpaid: 'Overpaid',
  outstanding: 'Not paid',
}

type ImportMsg = { ok: true; text: string } | { ok: false; errors: InputError[] } | null

export function Reconciliation({
  state,
  dispatch,
  derivedErrors,
  outcome,
  onHandoff,
  pending,
  onStartTour,
}: {
  pending: boolean
  onStartTour?: () => void
  state: AppState
  dispatch: Dispatch<Action>
  derivedErrors: InputError[]
  outcome: Outcome<ReconcileResult> | null
  onHandoff: () => void
}) {
  const cur = state.deal.currency
  const [investorMsg, setInvestorMsg] = useListMessage<ImportMsg>(state.tables.commitments)
  const [bankMsg, setBankMsg] = useListMessage<ImportMsg>(state.tables.bank)
  const [bankMode, setBankMode] = useState<'replace' | 'append'>('replace')
  const result = outcome?.ok ? outcome.result : null
  const internal = outcome !== null && !outcome.ok && Boolean(outcome.internal)
  const m = (x: number) => formatMoney(x, cur)
  const sym = SYMBOL[cur] // money fields say which currency they are in (owner review 2026-10-20)

  const importInvestors = (text: string) => {
    const r = importCommitments(text, cur)
    if (!r.ok) return setInvestorMsg({ ok: false, errors: r.errors }, false)
    dispatch({ type: 'replaceCommitments', rows: r.rows.map(commitmentRow) })
    setInvestorMsg({ ok: true, text: `Imported ${r.rows.length} investors. Amounts read as ${cur}.${ignored(r.ignoredColumns)}` }, true)
  }
  const importStatement = (text: string) => {
    let existing: ReturnType<typeof deriveBankLines>['input'] = []
    if (bankMode === 'append') {
      const d = deriveBankLines(state)
      if (!d.input)
        return setBankMsg({ ok: false, errors: [{ where: 'Bank table', message: 'fix the errors in the bank table before appending' }, ...d.errors] }, false)
      existing = d.input
    }
    const r = importBank(text, cur, bankMode, existing)
    if (!r.ok) return setBankMsg({ ok: false, errors: r.errors }, false)
    // append keeps the existing rows exactly as typed (re-formatting them would reset an edit in progress, Codex R5 #9);
    // only the new lines are converted to table text
    const added = r.value.lines.slice(existing.length).map(bankRow)
    dispatch({ type: 'importBank', mode: bankMode, rows: bankMode === 'append' ? [...state.bank, ...added] : added })
    const dup = r.ignoredDuplicates ? ` ${r.ignoredDuplicates} already imported (ignored).` : ''
    setBankMsg(
      {
        ok: true,
        text: `${bankMode === 'replace' ? 'Replaced the statement with' : 'Appended'} ${r.added} lines. Amounts read as ${cur}.${dup}${ignored(r.ignoredColumns)}`,
      },
      bankMode === 'replace',
    )
  }

  const handoffBlock = pending
    ? 'Finish your edit first.'
    : derivedErrors.length > 0
      ? 'Fix the input errors first.'
      : internal
        ? 'A self-check failed; hand-off is disabled.'
        : result && result.pendingSuggestions > 0
          ? `Review the ${result.pendingSuggestions} suggested match${result.pendingSuggestions === 1 ? '' : 'es'} first.`
          : null

  return (
    <section className="panel" aria-labelledby="rec-h">
      <p className="eyebrow">Step 1 of 3</p>
      <h2 id="rec-h">Reconciliation</h2>
      <p className="hint" data-tour="rec-rule">
        A receipt is booked automatically only when its bank reference contains exactly one investor’s payment reference. Everything else is a suggestion until
        you decide.
      </p>

      {state.commitments.length === 0 && state.bank.length === 0 && onStartTour && (
        <p className="hint">
          New here?{' '}
          <button type="button" className="link" onClick={onStartTour}>
            Take the guided tour on a fictional deal.
          </button>
        </p>
      )}
      <Section resetKey={state.tables.commitments} startOpen={state.commitments.length === 0} keepOpen={investorMsg !== null}>
        <summary>
          <h3>Investors ({state.commitments.length})</h3>
        </summary>
        <ImportBox
          title="Import investors (replaces the list)"
          help={
            <>
              Columns: <code>investor_id</code> (optional), <code>name</code>, <code>email</code>, <code>reference</code>, <code>cash_due</code>,{' '}
              <code>scheme</code> (none / SEIS / EIS). Cash due is everything the investor should wire, including any fees charged to them.
            </>
          }
          onImport={importInvestors}
        />
        <ImportResult msg={investorMsg} />
        <div className="table-wrap">
          <table className="grid" aria-label="Investors">
            <thead>
              <tr>
                <th>#</th>
                <th>Investor ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Payment reference</th>
                <th>Cash due ({sym}, including any fees charged to the investor)</th>
                <th>
                  <Term term="S/EIS">Scheme</Term>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.commitments.map((c, i) => {
                const edit = (field: keyof typeof c) => (value: string) => dispatch({ type: 'editCommitment', index: i, rowId: c.id, field, value })
                return (
                  <tr key={`${state.tables.commitments}:${i}`}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <Cell label={`Investor ${i + 1} ID`} value={c.id} onCommit={edit('id')} holdBlank />
                    </td>
                    <td>
                      <Cell label={`Investor ${i + 1} name`} value={c.name} onCommit={edit('name')} />
                    </td>
                    <td>
                      <Cell label={`Investor ${i + 1} email`} value={c.email} onCommit={edit('email')} />
                    </td>
                    <td>
                      <Cell label={`Investor ${i + 1} reference`} value={c.reference} onCommit={edit('reference')} />
                    </td>
                    <td>
                      <Cell className="cell num" label={`Investor ${i + 1} cash due`} value={c.cashDue} onCommit={edit('cashDue')} />
                    </td>
                    <td>
                      <SchemeSelect label={`Investor ${i + 1} scheme`} value={c.scheme} onChange={edit('scheme')} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link danger"
                        aria-label={`Delete investor ${i + 1}`}
                        onClick={() => dispatch({ type: 'deleteCommitment', index: i })}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {state.commitments.length === 0 && (
            <div className="empty-state">
              <p className="empty-title">No investors yet</p>
              <p className="hint">Import a CSV or load the sample deal to see how it works.</p>
            </div>
          )}
        </div>
        <button type="button" onClick={() => dispatch({ type: 'addCommitment' })}>
          Add investor
        </button>
      </Section>

      <Section resetKey={state.tables.bank} startOpen={state.bank.length === 0} keepOpen={bankMsg !== null}>
        <summary>
          <h3>Bank statement ({state.bank.length} lines)</h3>
        </summary>
        <ImportBox
          title="Import bank statement"
          help={
            <>
              Columns: <code>transaction_id</code> (optional), <code>date</code>, <code>amount</code>, <code>payer</code>, <code>reference</code>. Payments out
              and zero amounts are skipped and listed. Nothing is imported if any row has an error.
            </>
          }
          extra={
            <fieldset className="choice inline">
              <legend>When importing</legend>
              <label>
                <input type="radio" name="bankMode" checked={bankMode === 'replace'} onChange={() => setBankMode('replace')} /> Replace the statement (clears
                your decisions)
              </label>
              <label>
                <input type="radio" name="bankMode" checked={bankMode === 'append'} onChange={() => setBankMode('append')} /> Append (same transaction ID and
                details are ignored)
              </label>
            </fieldset>
          }
          onImport={importStatement}
        />
        <ImportResult msg={bankMsg} />
        <div className="table-wrap">
          <table className="grid" aria-label="Bank statement">
            <thead>
              <tr>
                <th>#</th>
                <th>Transaction ID</th>
                <th>Date</th>
                <th>Amount ({sym})</th>
                <th>Payer</th>
                <th>Bank reference</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.bank.map((l, i) => {
                const edit = (field: 'date' | 'amount' | 'payer' | 'reference') => (value: string) =>
                  dispatch({ type: 'editBank', index: i, rowId: l.id, field, value })
                return (
                  <tr key={`${state.tables.bank}:${l.id}`}>
                    <td className="num">{i + 1}</td>
                    <td className="mono">{l.txnId ?? '—'}</td>
                    <td>
                      <Cell label={`Bank line ${i + 1} date`} value={l.date} onCommit={edit('date')} />
                    </td>
                    <td>
                      <Cell className="cell num" label={`Bank line ${i + 1} amount`} value={l.amount} onCommit={edit('amount')} />
                    </td>
                    <td>
                      <Cell label={`Bank line ${i + 1} payer`} value={l.payer} onCommit={edit('payer')} />
                    </td>
                    <td>
                      <Cell label={`Bank line ${i + 1} reference`} value={l.reference} onCommit={edit('reference')} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link danger"
                        aria-label={`Delete bank line ${i + 1}`}
                        onClick={() => dispatch({ type: 'deleteBank', index: i })}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => dispatch({ type: 'addBank' })}>
          Add bank line
        </button>
      </Section>

      <h3>Summary</h3>
      <ErrorList errors={derivedErrors} title="Input errors — no results until these are fixed" />
      {pending && <UpdatingNotice />}
      {result ? (
        <div className={pending ? 'figures pending' : 'figures'} aria-busy={pending}>
          <RecResult result={result} cur={cur} dispatch={dispatch} m={m} />
        </div>
      ) : (
        !internal && derivedErrors.length === 0 && <p className="hint">The summary appears here.</p>
      )}
      <Checks tour="rec-checks" checks={outcome?.ok ? outcome.checks : []} unavailable={derivedErrors.length > 0} internal={internal} pending={pending} />

      <div className="row-actions">
        <button type="button" disabled={!result || pending} onClick={() => result && download(`ledger_${cur}.csv`, ledgerCsv(result, cur))}>
          Export ledger CSV
        </button>
        <button
          type="button"
          data-tour="chase-export"
          disabled={!result || pending}
          onClick={() => result && download(`chase_list_${cur}.csv`, chaseListCsv(result, cur))}
        >
          Export chase list CSV
        </button>
        <button type="button" className="primary" data-tour="handoff" disabled={handoffBlock !== null || !result} onClick={onHandoff}>
          Hand off to allocation
        </button>
      </div>
      {result && handoffBlock && (
        <p className="hint" data-testid="handoff-block">
          Hand-off disabled: {handoffBlock}
        </p>
      )}
      {result && !handoffBlock && (
        <p className="hint">Hand-off carries each investor’s received amount, up to their cash due. Anything above it is listed as a refund.</p>
      )}
    </section>
  )
}

const ignored = (cols: string[]) => (cols.length ? ` Ignored columns: ${cols.join(', ')}.` : '')

function ImportResult({ msg }: { msg: ImportMsg }) {
  if (!msg) return null
  return msg.ok ? <Notice kind="ok">{msg.text}</Notice> : <ErrorList errors={msg.errors.map(friendly)} title="Nothing was imported" />
}

export function SchemeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const known = ['none', 'SEIS', 'EIS']
  return (
    <select className="cell" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {!known.includes(value) && <option value={value}>{value}</option>}
      {known.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  )
}

function RecResult({ result, cur, dispatch, m }: { result: ReconcileResult; cur: Currency; dispatch: Dispatch<Action>; m: (x: number) => string }) {
  const byId = new Map(result.commitments.map((c) => [c.commitment.id, c.commitment]))
  const review = result.lines.filter((l) => l.status === 'suggested')
  const anyAged = result.lines.some((l) => l.aged)
  return (
    <>
      <dl className="totals" data-testid="rec-totals" data-tour="rec-summary">
        <div>
          <dt>Receipts in scope</dt>
          <dd>{m(result.totals.bank)}</dd>
        </div>
        <div>
          <dt>Booked to investors</dt>
          <dd>{m(result.totals.booked)}</dd>
        </div>
        <div>
          <dt>Not booked</dt>
          <dd>{m(result.totals.unbooked)}</dd>
        </div>
        <div>
          <dt>Waiting for review</dt>
          <dd>{result.pendingSuggestions}</dd>
        </div>
      </dl>

      <h4>Needs your review · {review.length}</h4>
      {review.length === 0 ? (
        <p className="hint">Nothing to review.</p>
      ) : (
        <ul className="review" aria-label="Review queue">
          {review.map((l) => (
            <li key={l.line.id} className="review-item" data-tour={`review-${l.line.txnId ?? l.line.id}`}>
              <LineSummary l={l} m={m} />
              {l.staleDecision && <p className="warn-text">Your earlier decision no longer matches the data, so it was set aside.</p>}
              {l.candidates.length > 0 && (
                <ul className="candidates">
                  {l.candidates.map((c) => {
                    const who = byId.get(c.commitmentId)!
                    return (
                      <li key={c.commitmentId}>
                        <button type="button" onClick={() => dispatch({ type: 'decide', lineId: l.line.id, decision: decide(l.line, who) })}>
                          Confirm {who.name}
                        </button>{' '}
                        <span className="score">score {c.score.toFixed(2)}</span> — {c.reasons.join(', ')}
                      </li>
                    )
                  })}
                </ul>
              )}
              <LineActions l={l} commitments={result.commitments.map((c) => c.commitment)} dispatch={dispatch} />
            </li>
          ))}
        </ul>
      )}

      <h4>Investors</h4>
      <div className="table-wrap">
        <table className="grid read" aria-label="Investor payment status">
          <thead>
            <tr>
              <th>Name</th>
              <th>Reference</th>
              <th className="num">Cash due</th>
              <th className="num">Received</th>
              <th className="num">Difference</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {result.commitments.map((c) => (
              <tr key={c.commitment.id} data-tour={`status-${c.commitment.id}`}>
                <td className="nowrap">{c.commitment.name}</td>
                <td className="mono">{c.commitment.reference}</td>
                <td className="num">{m(c.commitment.cashDue)}</td>
                <td className="num">{m(c.received)}</td>
                <td className="num">
                  {c.difference > 0 ? '+' : ''}
                  {m(c.difference)}
                </td>
                <td>
                  <span className={`badge ${c.status}`}>{INVESTOR_STATUS[c.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Bank lines</h4>
      {anyAged && <p className="hint">“Unmatched for N days”: {AGED_NOTE}</p>}
      <div className="table-wrap">
        <table className="grid read" aria-label="Bank line status">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Amount</th>
              <th>Payer</th>
              <th>Reference</th>
              <th>Status</th>
              <th>Investor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.lines.map((l) => (
              <tr key={l.line.id} data-line={l.line.txnId ?? l.line.id} data-tour={`line-${l.line.txnId ?? l.line.id}`}>
                <td className="nowrap">{l.line.date}</td>
                <td className="num">{m(l.line.amount)}</td>
                <td>{l.line.payer}</td>
                <td className="mono">{l.line.reference}</td>
                <td>
                  <span className={`badge ${l.status}`}>{LINE_STATUS[l.status]}</span>
                  {l.suspectedDuplicate && <span className="badge warn">Possible duplicate import</span>}
                  {l.aged && <span className="badge warn">Needs review: unmatched for {l.ageDays} days</span>}
                </td>
                <td className="nowrap">{l.assignedTo ? byId.get(l.assignedTo)?.name : ''}</td>
                <td>
                  {l.status === 'unmatched' || l.status === 'confirmed' || l.status === 'rejected' ? (
                    <LineActions l={l} commitments={result.commitments.map((c) => c.commitment)} dispatch={dispatch} compact />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Amounts in {cur}. Status “Not matched” lines do not block hand-off, but their money is not counted for anyone.</p>
    </>
  )
}

function LineSummary({ l, m }: { l: LineResult; m: (x: number) => string }) {
  return (
    <p className="line-summary">
      <strong>{m(l.line.amount)}</strong> on {l.line.date} from <strong>{l.line.payer || 'unknown payer'}</strong>, reference “{l.line.reference}”
      {l.line.txnId ? <span className="mono"> ({l.line.txnId})</span> : null}
    </p>
  )
}

/** R-REC-04.2: confirm, assign to anyone, mark as not part of this deal, or undo. */
function LineActions({ l, commitments, dispatch, compact }: { l: LineResult; commitments: Commitment[]; dispatch: Dispatch<Action>; compact?: boolean }) {
  const label = l.line.txnId ?? l.line.date + ' ' + l.line.payer
  if (l.status === 'confirmed' || l.status === 'rejected')
    return (
      <button type="button" className="link" aria-label={`Undo decision on ${label}`} onClick={() => dispatch({ type: 'undoDecision', lineId: l.line.id })}>
        Undo
      </button>
    )
  return (
    <span className={compact ? 'line-actions compact' : 'line-actions'}>
      <select
        className="cell"
        aria-label={`Assign ${label} to an investor`}
        value=""
        onChange={(e) => {
          const who = commitments.find((c) => c.id === e.target.value)
          if (who) dispatch({ type: 'decide', lineId: l.line.id, decision: decide(l.line, who) })
        }}
      >
        <option value="">Assign to…</option>
        {commitments.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.reference})
          </option>
        ))}
      </select>{' '}
      <button
        type="button"
        aria-label={`Mark ${label} as not part of this deal`}
        onClick={() => dispatch({ type: 'decide', lineId: l.line.id, decision: decide(l.line, null) })}
      >
        Not part of this deal
      </button>
      {l.staleDecision && (
        <>
          {' '}
          <button type="button" className="link" onClick={() => dispatch({ type: 'undoDecision', lineId: l.line.id })}>
            Clear old decision
          </button>
        </>
      )}
    </span>
  )
}
