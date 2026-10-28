// PRD §4.1 payment reconciliation: import, match, review, status, exports, hand-off.
import { Fragment, useEffect, useRef, useState, type Dispatch } from 'react'
import { SYMBOL, formatMoney, type Currency } from '../lib/money'
import { AGED_NOTE, decide, type Commitment, type CommitmentStatus, type LineResult, type ReconcileResult } from '../lib/reconcile'
import type { InputError, Outcome } from '../lib/outcome'
import { importBank, importCommitments } from '../lib/csv'
import { chaseListCsv, ledgerCsv } from '../lib/exports'
import { bankRow, commitmentRow, type Action, type AppState } from '../state'
import { deriveBankLines, friendly } from '../derive'
import { Cell, Checks, ErrorList, ImportBox, Notice, Section, Term, UpdatingNotice } from './common'
import { useListMessage } from './listMessage'
import { download } from './download'
import { LINE_STATUS_WORDS } from '../lib/activity'
import { chaseMessage, queryMessage } from '../lib/messages'
import { CopyMessage } from './CopyMessage'
import { FeeChangeBanner } from './FeeChange'
import { activeChange, ADJUSTMENT_VOID_NOTE, adjustmentNote, NOT_COVERED_NOTE, withdrawalProblem, withdrawnSummary, type FeePayerChange } from '../lib/adjust'
import { longDate } from '../lib/messages'
import type { deriveChangeRecheck } from '../derive'

const LINE_STATUS = LINE_STATUS_WORDS

const INVESTOR_STATUS: Record<CommitmentStatus, string> = {
  paid: 'Paid in full',
  partial: 'Underpaid',
  overpaid: 'Overpaid',
  outstanding: 'Not paid',
  withdrawn: 'Withdrawn',
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
  copyGate,
  recheck,
}: {
  /** the active fee payer change and its re-check (R-REC-12 banner) */
  recheck: ReturnType<typeof deriveChangeRecheck>
  /** the page's current data generation, read when a copy finishes: a copy clicked before a clear or a reload is not logged */
  copyGate: { readonly current: string }
  pending: boolean
  onStartTour?: () => void
  state: AppState
  dispatch: Dispatch<Action>
  derivedErrors: InputError[]
  outcome: Outcome<ReconcileResult> | null
  onHandoff: () => void
}) {
  const cur = state.deal.currency
  /**
   * Called at the click: notes the page's data generation then, and logs the copy when it finishes only if that is still the
   * data on the page — a clear or a reload in the meantime drops it (Codex M5 r2 #1, r4 #2).
   */
  const logCopy = (a: Omit<Extract<Action, { type: 'messageCopied' }>, 'manual' | 'type'>) => {
    const gen = copyGate.current
    return (manual: boolean) => {
      if (copyGate.current === gen) dispatch({ ...a, type: 'messageCopied', manual })
    }
  }
  const [investorMsg, setInvestorMsg] = useListMessage<ImportMsg>(state.tables.commitments)
  const [bankMsg, setBankMsg] = useListMessage<ImportMsg>(state.tables.bank)
  const [bankMode, setBankMode] = useState<'replace' | 'append'>('replace')
  const result = outcome?.ok ? outcome.result : null
  const internal = outcome !== null && !outcome.ok && Boolean(outcome.internal)
  const m = (x: number) => formatMoney(x, cur)
  const sym = SYMBOL[cur] // money fields say which currency they are in (owner review 2026-10-20)
  const summaryRef = useRef<HTMLHeadingElement>(null)

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
          : result && result.notCovered.length > 0
            ? 'Reverse the fee payer change and redo it: it does not cover every investor.'
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

      <h3 ref={summaryRef} tabIndex={-1}>
        Summary
      </h3>
      <ErrorList errors={derivedErrors} title="Input errors — no results until these are fixed" />
      {/* after Reverse the banner goes: keyboard focus moves to the summary heading instead of being lost */}
      <FeeChangeBanner state={state} dispatch={dispatch} recheck={recheck} currency={cur} onReversed={() => summaryRef.current?.focus()} />
      {pending && <UpdatingNotice />}
      {result ? (
        <div className={pending ? 'figures pending' : 'figures'} aria-busy={pending}>
          <RecResult
            change={activeChange(state.feePayerChanges)}
            asOf={state.deal.asOf}
            result={result}
            cur={cur}
            dealName={state.deal.name}
            dispatch={dispatch}
            m={m}
            gen={`${state.tables.commitments}:${state.tables.bank}`}
            logCopy={logCopy}
          />
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
          onClick={() => result && download(`chase_list_${cur}.csv`, chaseListCsv(result, cur, state.deal.name))}
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

function RecResult({
  result,
  cur,
  dealName,
  dispatch,
  m,
  gen,
  logCopy,
  change,
  asOf,
}: {
  change: FeePayerChange | undefined
  asOf: string
  logCopy: (a: Omit<Extract<Action, { type: 'messageCopied' }>, 'manual' | 'type'>) => (manual: boolean) => void
  result: ReconcileResult
  cur: Currency
  dealName: string
  /** table generations: a replaced list or a reloaded sample makes every copy control new (Codex M5 r2 #1) */
  gen: string
  dispatch: Dispatch<Action>
  m: (x: number) => string
}) {
  const byId = new Map(result.commitments.map((c) => [c.commitment.id, c.commitment]))
  // the investor whose withdrawal form is open (one at a time, in its own full-width row)
  // the open form belongs to this list as loaded: a replaced list (new table generation) closes it (Codex M6 r4 #1)
  const [open, setOpen] = useState<{ id: string; gen: string } | null>(null)
  const withdrawing = open?.gen === gen ? open.id : null
  const setWithdrawing = (id: string | null) => setOpen(id === null ? null : { id, gen })
  // when the form closes, keyboard focus goes back to that investor's withdrawal button (now Mark or Undo)
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    const id = refocus.current
    if (withdrawing !== null || id === null) return
    refocus.current = null
    // compared as data, never put into a selector: an ID can hold quotes (Codex M5 r3 #1)
    for (const row of document.querySelectorAll<HTMLElement>('[data-status]'))
      if (row.dataset.status === id) row.querySelector<HTMLElement>('[data-tour] button')?.focus()
  })
  const closeForm = () => {
    refocus.current = withdrawing
    setWithdrawing(null)
  }
  // investors on the list whose line of the active change is voided (R-REC-12), for the live region below
  const voidedLines = (change?.lines ?? []).filter((l) => l.voided && byId.has(l.investorId)).map((l) => l.investorId)
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
        <div>
          <dt>Cash due{result.totals.withdrawn.count > 0 ? ' (excluding withdrawn)' : ''}</dt>
          <dd>{m(result.totals.cashDue)}</dd>
        </div>
      </dl>
      {result.totals.withdrawn.count > 0 && (
        <p className="hint" data-testid="withdrawn-summary">
          {withdrawnSummary(result.totals.withdrawn.count, result.totals.withdrawn.toRefund, cur)}
        </p>
      )}

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
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'decide', lineId: l.line.id, decision: decide(l.line, who), via: 'candidate', prevStatus: l.status })}
                        >
                          Confirm {who.name}
                        </button>{' '}
                        <span className="score">score {c.score.toFixed(2)}</span> — {c.reasons.join(', ')}{' '}
                        {/* R-REC-10.2: only the amount and date go in, never the payer, bank reference or transaction ID */}
                        <CopyMessage
                          key={gen}
                          label="Copy query"
                          name={`Copy query for ${who.name} about ${l.line.txnId ?? `${l.line.date} ${l.line.payer}`}`}
                          text={() => queryMessage(dealName, cur, who.name, { amount: l.line.amount, date: l.line.date })}
                          onCopy={() => logCopy({ template: 'B', investorId: who.id, investorName: who.name, transactionId: l.line.txnId ?? l.line.id })}
                        />
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
      <p className="hint">Mark an investor withdrawn before closing: everything they paid moves to refunds.</p>
      {/* always there, so investors becoming not covered (which holds hand-off) are announced when it happens (Codex M6 r8 #1) */}
      <div role="status" aria-label="Fee payer change coverage">
        {(result.notCovered.length > 0 || voidedLines.length > 0) && (
          <ul className="plain warn-text" data-testid="not-covered">
            {/* voided lines first, withdrawn investors included (they are never "not covered"; Codex M6 r9 #1) */}
            {voidedLines.map((id) => (
              <li key={`void-${id}`}>
                {byId.get(id)?.name ?? id}: {ADJUSTMENT_VOID_NOTE}
              </li>
            ))}
            {result.notCovered.map((id) => (
              <li key={id}>
                {byId.get(id)?.name ?? id}: {NOT_COVERED_NOTE}
              </li>
            ))}
          </ul>
        )}
      </div>
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
              <th>Chase</th>
              <th>
                <Term term="withdrawal">Withdrawal</Term>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.commitments.map((c) => {
              const line = change?.lines.find((l) => l.investorId === c.commitment.id)
              const id = c.commitment.id
              return (
                <Fragment key={id}>
                  <tr data-tour={`status-${c.commitment.id}`} data-status={c.commitment.id}>
                    <td className="nowrap">{c.commitment.name}</td>
                    <td className="mono">{c.commitment.reference}</td>
                    <td className="num due">
                      {m(c.due)}
                      {/* R-REC-12: where the amount comes from; the list value itself is never rewritten (C-ALL-11) */}
                      {change && c.due !== c.commitment.cashDue && <span className="sub">{adjustmentNote(c.commitment.cashDue, c.due, change, cur)}</span>}
                      {line?.voided && <span className="sub warn-text">{ADJUSTMENT_VOID_NOTE}</span>}
                      {result.notCovered.includes(c.commitment.id) && <span className="sub warn-text">{NOT_COVERED_NOTE}</span>}
                    </td>
                    <td className="num">{m(c.received)}</td>
                    <td className="num">
                      {c.difference > 0 ? '+' : ''}
                      {m(c.difference)}
                    </td>
                    <td>
                      <span className={`badge ${c.status}`}>{INVESTOR_STATUS[c.status]}</span>
                      {c.withdrawnOn && <span className="sub">on {longDate(c.withdrawnOn)}</span>}
                    </td>
                    <td>
                      {(c.status === 'partial' || c.status === 'outstanding') && (
                        <CopyMessage
                          key={gen}
                          label="Copy message"
                          name={`Copy message for ${c.commitment.name}`}
                          tour={`copy-message-${c.commitment.id}`}
                          text={() => chaseMessage(dealName, cur, c)}
                          onCopy={() => logCopy({ template: 'A', investorId: c.commitment.id, investorName: c.commitment.name })}
                        />
                      )}
                    </td>
                    <td className="nowrap" data-tour={`withdraw-${id}`}>
                      {c.withdrawnOn !== null ? (
                        <button
                          type="button"
                          className="link"
                          aria-label={`Undo withdrawal of ${c.commitment.name}`}
                          onClick={() => dispatch({ type: 'undoWithdrawal', investorId: id })}
                        >
                          Undo withdrawal
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="link"
                          aria-label={`Mark ${c.commitment.name} withdrawn`}
                          aria-expanded={withdrawing === id}
                          onClick={() => setWithdrawing(withdrawing === id ? null : id)}
                        >
                          Mark withdrawn
                        </button>
                      )}
                    </td>
                  </tr>
                  {withdrawing === id && c.withdrawnOn === null && (
                    <tr className="withdraw-row">
                      <td colSpan={8}>
                        <WithdrawForm
                          key={gen}
                          id={id}
                          name={c.commitment.name}
                          reference={c.commitment.reference}
                          asOf={asOf}
                          dispatch={dispatch}
                          onClose={closeForm}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {result.refunds.length > 0 && (
        <>
          <h4>To refund · {result.refunds.length}</h4>
          <ul className="plain" data-testid="rec-refunds">
            {result.refunds.map((x) => (
              <li key={x.id}>
                {x.name}: {m(x.amount)} ({x.reason === 'Withdrawn' ? 'Withdrawn' : 'Over-paid'})
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="hint">
        “Copy message” gives you a chase email for each investor who is short or has not paid, to send yourself. It asks anyone who has already paid to send the
        bank’s <Term term="MT103 / UETR" />.
      </p>

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
      <button
        type="button"
        className="link"
        aria-label={`Undo decision on ${label}`}
        data-tour={`undo-${l.line.txnId ?? l.line.id}`}
        onClick={() => dispatch({ type: 'undoDecision', lineId: l.line.id, prevStatus: l.status })}
      >
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
          if (who) dispatch({ type: 'decide', lineId: l.line.id, decision: decide(l.line, who), via: 'any', prevStatus: l.status })
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
        onClick={() => dispatch({ type: 'decide', lineId: l.line.id, decision: decide(l.line, null), prevStatus: l.status })}
      >
        Not part of this deal
      </button>
      {l.staleDecision && (
        <>
          {' '}
          <button type="button" className="link" onClick={() => dispatch({ type: 'undoDecision', lineId: l.line.id, prevStatus: l.status })}>
            Clear old decision
          </button>
        </>
      )}
    </span>
  )
}

/** R-REC-11.1: written consent and a date (the as-of date unless changed) before an investor is marked withdrawn. */
function WithdrawForm({
  id,
  name,
  reference,
  asOf,
  dispatch,
  onClose,
}: {
  id: string
  name: string
  reference: string
  asOf: string
  dispatch: Dispatch<Action>
  onClose: () => void
}) {
  const [consent, setConsent] = useState(false)
  const [on, setOn] = useState(asOf)
  const [problem, setProblem] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)
  // the investor the consent is for, as shown when the box was ticked; the action carries it and the reducer checks it
  const [who, setWho] = useState({ name, reference })
  if (who.name !== name || who.reference !== reference) {
    // edited while the form is open: the tick was for the details shown before (Codex M6 r4 #1)
    setWho({ name, reference })
    setConsent(false)
    setProblem('This investor’s name or reference changed. Check the details and tick consent again.')
  }
  // opened from the far right of a wide table on a phone, the form starts at the left: bring it into view, ready to tick
  useEffect(() => {
    // at once, not smoothly: the consent box is ready to tick as soon as the form opens
    box.current?.scrollIntoView?.({ block: 'nearest', inline: 'start' })
    box.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="withdraw-form" role="group" aria-label={`Withdraw ${name}`}>
      <label className="check">
        <input ref={box} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Written consent from the investor received
      </label>
      <label>
        Withdrawal date
        <input className="field" value={on} onChange={(e) => setOn(e.target.value)} aria-label={`Withdrawal date for ${name}`} />
      </label>
      <div className="row-actions">
        <button
          type="button"
          onClick={() => {
            const p = withdrawalProblem(consent, on)
            setProblem(p)
            if (!p) {
              dispatch({ type: 'markWithdrawn', investorId: id, on, consent, name: who.name, reference: who.reference })
              onClose()
            }
          }}
        >
          Confirm withdrawal
        </button>
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
      {problem && (
        <p className="warn-text" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
