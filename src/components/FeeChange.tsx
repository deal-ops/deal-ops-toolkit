// PRD R-ALL-12 / R-REC-12: "Change who pays a fee" and the banner of an active change. Every figure comes from
// src/lib/feePayer.ts and src/lib/adjust.ts; this file only shows them and dispatches.
import { useEffect, useRef, useState, type Dispatch, type Ref } from 'react'
import { formatMoney, type Currency } from '../lib/money'
import type { FeePayer } from '../lib/allocation'
import { applyLabel, blockerText, CONSENT_TEXT, needsConsent, previewFeePayerChange } from '../lib/feePayer'
import { changeBanner, SETTINGS_CHANGED_NOTE } from '../lib/adjust'
import { canReverse, feePayerChangeBlock, type Action, type AppState } from '../state'
import { deriveFeePayerInput, type deriveChangeRecheck } from '../derive'
import { ErrorList, Notice, Term } from './common'

type Recheck = ReturnType<typeof deriveChangeRecheck>

const PAYERS: FeePayer[] = ['investors', 'company', 'lead']
const PAYER_LABEL: Record<FeePayer, string> = { investors: 'Investors', company: 'Company', lead: 'Lead' }

/** R-REC-12 banner above the reconciliation summary, and the head of the panel while a change is active. */
export function FeeChangeBanner({
  state,
  dispatch,
  recheck,
  currency,
  onReversed,
  reverseRef,
}: {
  state: AppState
  dispatch: Dispatch<Action>
  recheck: Recheck
  currency: Currency
  /** where keyboard focus goes once the banner, and its button, are gone */
  onReversed?: () => void
  reverseRef?: Ref<HTMLButtonElement>
}) {
  const last = state.feePayerChanges.at(-1)
  // the most recent change was voided by an edit: say so until a new one is applied (C-ALL-11). The live region is there
  // while the change is still active, so the notice is announced the moment it voids (Codex M6 r9 #2)
  const voided = (
    <div role="status" aria-label="Fee payer change status">
      {!recheck && last?.status === 'voided' && (
        <Notice kind="warn">
          <span data-testid="fee-change-voided">
            The fee payer change ({last.feeLabel} → {last.to}) no longer applies — redo it.
          </span>
        </Notice>
      )}
    </div>
  )
  if (!recheck) return voided
  const c = recheck.change
  return (
    <>
      {voided}
      <div className="notice info" data-testid="fee-change-banner">
        <p>
          {changeBanner(c)} ·{' '}
          <button
            type="button"
            className="link"
            ref={reverseRef}
            disabled={!canReverse(state, c.id)}
            onClick={() => {
              dispatch({ type: 'reverseFeePayerChange', changeId: c.id })
              onReversed?.()
            }}
          >
            Reverse
          </button>
        </p>
        {/* a live region that is there before its content, so the reminder and the blockers are announced when they appear (Codex M6 #2) */}
        <div role="status" aria-label="Fee payer change re-check">
          {recheck.changed && (
            <>
              <p className="warn-text" data-testid="settings-changed">
                {SETTINGS_CHANGED_NOTE}
              </p>
              {recheck.recheck && !recheck.recheck.ok && <ErrorList errors={recheck.recheck.errors} title="The re-check could not run" />}
              {recheck.recheck?.ok && recheck.recheck.result.blockers.length > 0 && (
                <ul data-testid="recheck-blockers">
                  {recheck.recheck.result.blockers.map((b, i) => (
                    <li key={i}>{blockerText(b, currency)}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** R-ALL-12.1–12.5 */
export function FeePayerPanel({ state, dispatch, pending, recheck }: { state: AppState; dispatch: Dispatch<Action>; pending: boolean; recheck: Recheck }) {
  const cur = state.deal.currency
  const m = (x: number) => formatMoney(x, cur)
  // only percentage fees can change payer (PRD §2: fixed fees are changed by hand)
  const percentFees = state.allocation.fees.filter((f) => f.kind === 'percent')
  const [pick, setPick] = useState<{ feeId: string; to: FeePayer | '' }>({ feeId: '', to: '' })
  // the tick belongs to one transition — this fee, from this payer, to this payer, at this rate — and to nothing else:
  // an edit in the fee table that changes any of them leaves the box unticked (Codex M6 #1)
  const [consentFor, setConsentFor] = useState<string | null>(null)
  // keyboard focus follows the change: to Reverse once applied; once reversed, to the panel heading, since the choices
  // stay disabled until the allocation is handed off again (M6 self-test B#1)
  const reverseBtn = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const moveFocus = useRef<'reverse' | 'heading' | null>(null)
  useEffect(() => {
    const to = moveFocus.current
    if (to === 'reverse' && reverseBtn.current) reverseBtn.current.focus()
    else if (to === 'heading' && heading.current) heading.current.focus()
    else return
    moveFocus.current = null
  })
  const fee = percentFees.find((f) => f.id === pick.feeId) ?? percentFees[0]
  const others = fee ? PAYERS.filter((p) => p !== fee.payer) : []
  const to: FeePayer | undefined = others.includes(pick.to as FeePayer) ? (pick.to as FeePayer) : others[0]
  const block = recheck ? null : feePayerChangeBlock(state)
  const derived = recheck || block || !fee || !to ? null : deriveFeePayerInput(state, fee.id, to)
  // the allocation's own input errors are listed under Result; the panel only says it waits for them
  const preview = derived?.input ? previewFeePayerChange(derived.input) : null
  const p = preview?.ok ? preview.result : null
  const consentKey = fee && to ? JSON.stringify([fee.id, fee.payer, to, fee.value]) : null
  const consent = consentKey !== null && consentFor === consentKey
  const setConsent = (on: boolean) => setConsentFor(on ? consentKey : null)
  const consentNeeded = to ? needsConsent(to) : true
  const canApply = Boolean(p?.canApply) && !pending && (!consentNeeded || consent)

  return (
    <section className="fee-payer" aria-labelledby="fee-payer-h">
      <h3 id="fee-payer-h" ref={heading} tabIndex={-1}>
        Change who pays a fee
      </h3>
      <p className="hint">
        Move a percentage fee to investors, the company or the lead before closing. Each investor’s amount due changes so their investment stays the same.
      </p>
      {/* one banner for both states, so its live regions stay in place when the change is applied, voided or reversed */}
      <FeeChangeBanner
        state={state}
        dispatch={dispatch}
        recheck={recheck}
        currency={cur}
        reverseRef={reverseBtn}
        onReversed={() => (moveFocus.current = 'heading')}
      />
      {recheck ? (
        <p className="hint">One fee payer change at a time: reverse this one to make another.</p>
      ) : (
        <>
          {block && (
            // while the choices are disabled, the end card's "Take me to it" lands here (Codex M6 r2 #1)
            <p className="hint" data-testid="fee-payer-block" data-tour="fee-payer" tabIndex={-1}>
              Not available: {block}
            </p>
          )}
          {percentFees.length === 0 ? (
            <p className="hint">Add a percentage fee first.</p>
          ) : (
            // the end card's "Take me to it" lands on the first choice here, not on the term's "?" (guide v0.3 §3.2)
            <div className="form-grid" data-tour={block ? undefined : 'fee-payer'}>
              <label>
                Fee
                <select
                  className="field"
                  disabled={block !== null}
                  value={fee?.id ?? ''}
                  onChange={(e) => {
                    setPick({ feeId: e.target.value, to: '' })
                    setConsent(false)
                  }}
                >
                  {percentFees.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label || '(no name)'} — paid by {f.payer}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>
                  <Term term="fee payer">New payer</Term>
                </span>
                <select
                  className="field"
                  aria-label="New payer"
                  disabled={block !== null}
                  value={to ?? ''}
                  onChange={(e) => {
                    setPick({ feeId: fee?.id ?? '', to: e.target.value as FeePayer })
                    setConsent(false)
                  }}
                >
                  {others.map((x) => (
                    <option key={x} value={x}>
                      {PAYER_LABEL[x]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {derived && !derived.input && <p className="hint">No preview until the input errors below are fixed.</p>}
          {preview && !preview.ok && <ErrorList errors={preview.errors} title="This change cannot be previewed" />}
          {p && to && (
            <div className={pending ? 'figures pending' : 'figures'} aria-busy={pending} data-testid="fee-payer-preview">
              {p.blockers.length > 0 && (
                <div className="notice bad" role="alert" data-testid="fee-payer-blockers">
                  <p>
                    <strong>Can&apos;t apply this change</strong>
                  </p>
                  <ul>
                    {p.blockers.map((b, i) => (
                      <li key={i}>{blockerText(b, cur)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {p.computed && (
                <>
                  <div className="table-wrap">
                    <table className="grid read" aria-label="Fee payer change preview">
                      <thead>
                        <tr>
                          <th>Investor</th>
                          <th className="num">Cash due now</th>
                          <th className="num">Investment kept</th>
                          <th className="num">New cash due</th>
                          <th className="num">Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.rows.map((r) => (
                          <tr key={r.id}>
                            <td className="nowrap">{r.name}</td>
                            <td className="num">{m(r.currentDue)}</td>
                            {r.unchanged ? (
                              <td colSpan={3}>Not participating — unchanged</td>
                            ) : (
                              <>
                                <td className="num">{m(r.target!)}</td>
                                <td className="num">{m(r.newDue)}</td>
                                <td className="num">
                                  {r.difference > 0 ? '+' : ''}
                                  {m(r.difference)}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th>Total</th>
                          <td className="num">{m(p.totals.currentDue)}</td>
                          <td />
                          <td className="num">{m(p.totals.newDue)}</td>
                          <td className="num">
                            {p.totals.difference > 0 ? '+' : ''}
                            {m(p.totals.difference)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="hint" data-testid="fee-before-after">
                    {p.feeLabel}: {m(p.feeBefore ?? 0)} paid by {p.from} now; {m(p.feeAfter ?? 0)} paid by {p.to} after the change.
                  </p>
                </>
              )}
              <p data-testid="consent-text">
                <strong>{CONSENT_TEXT[to]}</strong>
              </p>
              {consentNeeded && (
                <label className="check">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={!p.canApply} /> Consent evidence received
                </label>
              )}
              <div className="row-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!canApply}
                  onClick={() => {
                    dispatch({ type: 'applyFeePayerChange', feeId: fee!.id, to, consent: consentNeeded ? consent : false })
                    moveFocus.current = 'reverse'
                    setConsent(false)
                  }}
                >
                  {applyLabel(p, cur)}
                </button>
              </div>
              {p.canApply && consentNeeded && !consent && <p className="hint">Tick “Consent evidence received” to apply.</p>}
            </div>
          )}
        </>
      )}
    </section>
  )
}
