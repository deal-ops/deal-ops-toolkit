// PRD §4.3 exit distribution: holdings, exit terms, step-by-step waterfall, per-investor results, exports.
import type { Dispatch } from 'react'
import { formatMoney, formatPrice } from '../lib/money'
import type { InputError, Outcome } from '../lib/outcome'
import { blocked } from '../lib/outcome'
import type { WaterfallResult } from '../lib/waterfall'
import { importHoldings } from '../lib/csv'
import { distributionCsv, holdingsCsv, sharesDisplay } from '../lib/exports'
import { holdingRow, type Action, type AppState } from '../state'
import { Cell, Checks, ErrorList, ImportBox, Notice, Section, Term, UpdatingNotice } from './common'
import { useListMessage } from './listMessage'
import { deriveHoldings, holdingCapitals } from '../derive'
import { download } from './download'

export function Distribution({
  state,
  dispatch,
  derivedErrors,
  outcome,
  stale,
  canHandoff,
  onHandoff,
  pending,
}: {
  state: AppState
  dispatch: Dispatch<Action>
  derivedErrors: InputError[]
  outcome: Outcome<WaterfallResult> | null
  stale: boolean
  canHandoff: boolean
  onHandoff: () => void
  pending: boolean
}) {
  const cur = state.deal.currency
  const x = state.exit
  const m = (v: number) => formatMoney(v, cur)
  const [importMsg, setImportMsg] = useListMessage<{ ok: true; text: string } | { ok: false; errors: InputError[] }>(state.tables.holdings)
  const result = outcome?.ok ? outcome.result : null
  const internal = outcome !== null && !outcome.ok && Boolean(outcome.internal)
  const isBlocked = outcome?.ok ? blocked(outcome.checks) : true
  const set = (patch: Parameters<typeof setExit>[0]) => dispatch(setExit(patch))
  // the holdings table stands on its own: shares and its export do not wait for the exit terms (review M3 #6),
  // but the export uses the same validation as the engine and the importer (review M3 R1 #6)
  const capitals = holdingCapitals(state)
  const holdingList = deriveHoldings(state).input

  const doImport = (text: string) => {
    const r = importHoldings(text, cur)
    if (!r.ok) return setImportMsg({ ok: false, errors: r.errors }, false)
    dispatch({ type: 'replaceHoldings', rows: r.rows.map(holdingRow), sharePriceMicros: r.sharePriceMicros })
    setImportMsg(
      { ok: true, text: `Imported ${r.rows.length} holdings.${r.ignoredColumns.length ? ` Ignored columns: ${r.ignoredColumns.join(', ')}.` : ''}` },
      true,
    )
  }

  return (
    <section className="panel" aria-labelledby="dis-h">
      <p className="eyebrow">Step 3 of 3</p>
      <h2 id="dis-h">
        Exit distribution (<Term term="waterfall" />)
      </h2>
      <p className="hint">One investment, one exit, the same terms for every investor. Each investor’s share follows the amount they invested.</p>
      {stale && (
        <Notice kind="warn">
          <span data-testid="exit-stale">Out of date: the allocation has changed since these holdings were handed off.</span>{' '}
          {canHandoff ? (
            <button type="button" onClick={onHandoff}>
              Hand off again (replaces the holdings)
            </button>
          ) : (
            'Resolve the allocation first, then hand off again.'
          )}
        </Notice>
      )}
      {x.handoffVersion !== null && !stale && (
        <p className="hint">Holdings were carried in from the allocation. Editing them here does not change the allocation.</p>
      )}

      <Section resetKey={state.tables.holdings} startOpen={x.holdings.length === 0} keepOpen={importMsg !== null}>
        <summary>
          <h3>Holdings ({x.holdings.length})</h3>
        </summary>
        <ImportBox
          title="Import holdings (replaces the list)"
          help={
            <>
              Columns: <code>investor_id</code> (optional), <code>name</code>, <code>capital</code> — the amount invested, <strong>excluding fees</strong> — and{' '}
              <code>share_price</code> (optional, the same on every row; only used to show shares).
            </>
          }
          onImport={doImport}
        />
        {importMsg && (importMsg.ok ? <Notice kind="ok">{importMsg.text}</Notice> : <ErrorList errors={importMsg.errors} title="Nothing was imported" />)}
        <p className="hint" data-testid="exit-price">
          Share price for display: {x.sharePriceMicros === null ? 'not set (shares shown as —)' : formatPrice(x.sharePriceMicros, cur)}
        </p>
        <div className="table-wrap">
          <table className="grid" aria-label="Holdings">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Amount invested (excluding fees)</th>
                <th className="num">Shares</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {x.holdings.map((h, i) => (
                <tr key={`${state.tables.holdings}:${i}`}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <Cell
                      label={`Holding ${i + 1} name`}
                      value={h.name}
                      onCommit={(value) => dispatch({ type: 'editHolding', index: i, rowId: h.id, field: 'name', value })}
                    />
                  </td>
                  <td>
                    <Cell
                      className="cell num"
                      label={`Holding ${i + 1} amount invested`}
                      value={h.capital}
                      onCommit={(value) => dispatch({ type: 'editHolding', index: i, rowId: h.id, field: 'capital', value })}
                    />
                  </td>
                  <td className="num">{capitals[i] === null ? '—' : sharesDisplay(capitals[i]!, x.sharePriceMicros)}</td>
                  <td>
                    <button
                      type="button"
                      className="link danger"
                      aria-label={`Delete holding ${i + 1}`}
                      onClick={() => dispatch({ type: 'deleteHolding', index: i })}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-actions">
          <button type="button" onClick={() => dispatch({ type: 'addHolding' })}>
            Add holding
          </button>
          <button
            type="button"
            disabled={!holdingList || pending}
            onClick={() => holdingList && download(`holdings_${cur}.csv`, holdingsCsv(holdingList, x.sharePriceMicros))}
          >
            Export holdings CSV
          </button>
        </div>
      </Section>

      <h3>Exit</h3>
      <div className="form-grid">
        <label>
          Exit proceeds
          <Cell className="field" label="Exit proceeds" value={x.proceeds} onCommit={(v) => set({ proceeds: v })} />
        </label>
        <label>
          Exit costs (blank = none)
          <Cell className="field" label="Exit costs" value={x.exitCosts} onCommit={(v) => set({ exitCosts: v })} />
        </label>
        <label>
          Years held (up to 2 decimals)
          <Cell className="field" label="Years held" value={x.years} onCommit={(v) => set({ years: v })} />
        </label>
      </div>

      <fieldset className="choice">
        <legend>
          <Term term="carry">Carry</Term>
        </legend>
        <label>
          <input type="radio" name="carryMode" checked={x.mode === 'fixed'} onChange={() => dispatch({ type: 'setCarryMode', mode: 'fixed' })} /> Fixed rate,
          with an optional <Term term="hurdle" /> and <Term term="catch-up" />
        </label>
        <label>
          <input type="radio" name="carryMode" checked={x.mode === 'tiered'} onChange={() => dispatch({ type: 'setCarryMode', mode: 'tiered' })} />{' '}
          <Term term="tiered carry">Tiered</Term> by return multiple (no hurdle or catch-up)
        </label>
      </fieldset>
      {x.mode === 'fixed' ? (
        <div className="form-grid">
          <label>
            Carry %
            <Cell className="field" label="Carry rate" value={x.carry} placeholder="20" onCommit={(v) => set({ carry: v })} />
          </label>
          <label>
            Hurdle % a year, compounding (blank = none)
            <Cell className="field" label="Hurdle rate" value={x.hurdle} onCommit={(v) => set({ hurdle: v })} />
          </label>
          <label>
            Catch-up % (blank = none; needs a hurdle and must be above the carry rate)
            <Cell className="field" label="Catch-up rate" value={x.catchUp} onCommit={(v) => set({ catchUp: v })} />
          </label>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="grid" aria-label="Carry tiers">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Up to multiple (before carry, after exit costs)</th>
                  <th>Carry % in this band</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {x.tiers.map((t, i) => {
                  const last = i === x.tiers.length - 1
                  return (
                    <tr key={`${state.tables.tiers}:${t.id}`}>
                      <td className="num">{i + 1}</td>
                      <td>
                        {last ? (
                          <span className="hint">no ceiling</span>
                        ) : (
                          <Cell
                            className="cell num"
                            label={`Tier ${i + 1} up to multiple`}
                            value={t.upTo}
                            placeholder="3"
                            onCommit={(value) => dispatch({ type: 'editTier', index: i, rowId: t.id, field: 'upTo', value })}
                          />
                        )}
                      </td>
                      <td>
                        <Cell
                          className="cell num"
                          label={`Tier ${i + 1} carry rate`}
                          value={t.rate}
                          placeholder="20"
                          onCommit={(value) => dispatch({ type: 'editTier', index: i, rowId: t.id, field: 'rate', value })}
                        />
                      </td>
                      <td>
                        {x.tiers.length > 1 && (
                          <button
                            type="button"
                            className="link danger"
                            aria-label={`Delete tier ${i + 1}`}
                            onClick={() => dispatch({ type: 'deleteTier', index: i })}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => dispatch({ type: 'addTier' })}>
            Add tier
          </button>
          <p className="hint">Each rate applies only to the profit inside its band, measured as a multiple of the amount invested.</p>
        </>
      )}

      <h3>Result</h3>
      <ErrorList errors={derivedErrors} title="Input errors — no results until these are fixed" />
      {pending && <UpdatingNotice />}
      {result && (
        <div className={pending ? 'figures pending' : 'figures'} aria-busy={pending}>
          <ExitResult r={result} m={m} sharePriceMicros={x.sharePriceMicros} />
        </div>
      )}
      <Checks checks={outcome?.ok ? outcome.checks : []} unavailable={derivedErrors.length > 0} internal={internal} pending={pending} />
      <div className="row-actions">
        <button
          type="button"
          disabled={!result || pending || isBlocked}
          onClick={() => result && download(`distribution_${cur}.csv`, distributionCsv(result, x.sharePriceMicros))}
        >
          Export distribution CSV
        </button>
      </div>
      {result && isBlocked && <p className="hint">Export is disabled until the shortfall is resolved.</p>}
    </section>
  )
}

const setExit = (patch: Extract<Action, { type: 'setExit' }>['patch']): Action => ({ type: 'setExit', patch })

function ExitResult({ r, m, sharePriceMicros }: { r: WaterfallResult; m: (v: number) => string; sharePriceMicros: number | null }) {
  if (r.shortfall > 0)
    return (
      <div className="notice bad" role="alert" data-testid="shortfall">
        <p>
          <strong>Cannot distribute.</strong> Exit costs are more than the proceeds by {m(r.shortfall)}. Nothing goes to investors or the lead until this is
          resolved.
        </p>
      </div>
    )
  return (
    <>
      <dl className="totals" data-testid="exit-totals">
        <div>
          <dt>Exit costs paid</dt>
          <dd>{m(r.costsPaid)}</dd>
        </div>
        <div>
          <dt>Amount invested</dt>
          <dd>{m(r.capital)}</dd>
        </div>
        <div>
          <dt>Carry to the lead</dt>
          <dd>{m(r.carry)}</dd>
        </div>
        <div>
          <dt>To investors</dt>
          <dd>{m(r.investorsTotal)}</dd>
        </div>
      </dl>

      <h4>Step by step</h4>
      <div className="table-wrap" data-tour="exit-steps">
        <table className="grid read" aria-label="Waterfall steps">
          <thead>
            <tr>
              <th>Step</th>
              <th className="num">To investors</th>
              <th className="num">To the lead</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {r.costsPaid > 0 && (
              <tr>
                <td>Exit costs</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td>{m(r.costsPaid)} is paid first, before anyone else.</td>
              </tr>
            )}
            {r.steps.map((s) => (
              <tr key={s.label}>
                <td>{s.label}</td>
                <td className="num">{m(s.toInvestors)}</td>
                <td className="num">{m(s.toLead)}</td>
                <td>{s.explain}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>Total</td>
              <td className="num">{m(r.investorsTotal)}</td>
              <td className="num">{m(r.carry)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <h4>Per investor</h4>
      <div className="table-wrap">
        <table className="grid read" aria-label="Distribution per investor">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Amount invested</th>
              <th className="num">Shares</th>
              <th className="num">Distribution</th>
              <th className="num">Profit or loss</th>
              <th className="num">Multiple</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.id} data-holder={row.name}>
                <td className="nowrap">{row.name}</td>
                <td className="num">{m(row.capital)}</td>
                <td className="num">{sharesDisplay(row.capital, sharePriceMicros)}</td>
                <td className="num">{m(row.distribution)}</td>
                <td className="num">{m(row.profit)}</td>
                <td className="num">{(row.multiple100 / 100).toFixed(2)}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Investors share their total in proportion to the amount each invested. The multiple is distribution ÷ amount invested and does not count entry fees.
      </p>
    </>
  )
}
