// Deal settings, reconciliation, closing allocation, exit distribution, the hand-offs between them, and the guided tour.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { reconcile, handoffToAllocation } from './lib/reconcile'
import { allocate } from './lib/allocation'
import { distribute } from './lib/waterfall'
import { holdingsFromAllocation } from './lib/snapshot'
import { blocked } from './lib/outcome'
import {
  allocationStale,
  amountsEntered,
  currencyLocked,
  trimAction,
  exitStale,
  clearSaved,
  initialState,
  loadState,
  reducer,
  saveState,
  type AppState,
  type SaveResult,
} from './state'
import { deriveAllocation, deriveChangeRecheck, deriveDistribution, deriveReconcile } from './derive'
import { DealSettings } from './components/DealSettings'
import { Reconciliation } from './components/Reconciliation'
import { Allocation } from './components/Allocation'
import { Distribution } from './components/Distribution'
import { Footer } from './components/Footer'
import { ActivityLog } from './components/ActivityLog'
import { logStatus, NEAR_FULL_TEXT, removedText } from './lib/activity'
import { PendingContext } from './components/pending'
import { DISCLAIMER_TEXT, PRIVACY_TEXT } from './config'
import { TourCard, TourNote } from './components/Tour'
import { byTour } from './tour/anchor'
import {
  DEMO_CAP_TEXT,
  STEPS,
  context,
  firstStepOf,
  nothingToLose,
  prerequisitesMet,
  stateAt,
  tourIntact,
  tryNext,
  type Chapter,
  type TryNext,
} from './tour/script'
import { loadTourProgress, saveTourProgress, type TourProgress } from './tour/progress'
import { applyTheme, loadTheme, saveTheme, type Theme } from './theme'

type Tab = 'deal' | 'rec' | 'alloc' | 'exit' | 'log'
const TAB_LABEL: Record<Tab, string> = {
  deal: 'Deal settings',
  rec: 'Reconciliation',
  alloc: 'Allocation',
  exit: 'Exit distribution',
  log: 'Activity log',
}

const THEMES: [Theme, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]

// Browsers that block site data throw when localStorage is read (Firefox can also return null; saveState treats
// a missing store as blocked): the app still works, it just does not remember, and says so (PRD R-X-02, v0.7.6).
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export default function App({ storage = browserStorage() }: { storage?: Storage }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadState(storage) ?? initialState())
  const [tab, setTab] = useState<Tab>('rec')
  const [saveResult, setSaveResult] = useState<SaveResult>('saved')
  const skipSave = useRef(false)
  // remounting on clear also drops text held inside components (pasted CSV, import messages)
  const [generation, setGeneration] = useState(0)
  // cells with typed text not yet calculated: figures are marked as updating and actions wait (Codex M2 #4)
  const [pendingCells, setPendingCells] = useState<ReadonlySet<string>>(() => new Set())
  const reportPending = useCallback((cellId: string, pending: boolean) => {
    setPendingCells((prev) => {
      if (prev.has(cellId) === pending) return prev
      const next = new Set(prev)
      if (pending) next.add(cellId)
      else next.delete(cellId)
      return next
    })
  }, [])
  const pending = pendingCells.size > 0

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    const saved = saveState(storage, state)
    setSaveResult(saved.result)
    // the save had to drop the oldest log entries to fit: keep the log in memory the same as the one saved (R-X-08.5)
    const trim = trimAction(state.log, saved.log)
    if (trim) dispatch(trim)
  }, [state, storage])
  const logInfo = logStatus(state.log)
  // the data generation a finished copy is checked against: a clear, a tour replay or a replaced list changes it (Codex M5 r4 #2)
  const copyGate = useRef('')
  useEffect(() => {
    copyGate.current = `${generation}:${state.tables.commitments}:${state.tables.bank}`
  }, [generation, state.tables])

  const { deal, commitments, bank, decisions, allocation, exit, withdrawals, feePayerChanges } = state
  // re-derive only when that module's inputs change (state.ts replaces what it edits)
  const recDerived = useMemo(
    () => deriveReconcile({ deal, commitments, bank, decisions, withdrawals, feePayerChanges }),
    [deal, commitments, bank, decisions, withdrawals, feePayerChanges],
  )
  // C-ALL-11: the active fee payer change and, when the settings changed since, its re-check
  const recheck = useMemo(
    () => deriveChangeRecheck({ deal, commitments, allocation, withdrawals, feePayerChanges }),
    [deal, commitments, allocation, withdrawals, feePayerChanges],
  )
  const recOutcome = useMemo(() => (recDerived.input ? reconcile(recDerived.input) : null), [recDerived])
  const allocDerived = useMemo(() => deriveAllocation({ deal, allocation }), [deal, allocation])
  const allocOutcome = useMemo(() => (allocDerived.input ? allocate(allocDerived.input) : null), [allocDerived])
  const exitDerived = useMemo(() => deriveDistribution({ deal, exit }), [deal, exit])
  const exitOutcome = useMemo(() => (exitDerived.input ? distribute(exitDerived.input) : null), [exitDerived])
  const handoff = recOutcome?.ok ? handoffToAllocation(recOutcome.result) : null
  // R-ALL-11: only a finished allocation can become holdings (C-03: a blocker or an edit in progress holds it back)
  const holdings =
    allocOutcome?.ok && !blocked(allocOutcome.checks) && allocDerived.input && !pending
      ? holdingsFromAllocation(allocOutcome.result, allocDerived.input.priceMicros, state.allocVersion)
      : null
  const onHandoffToExit = () => {
    if (!holdings) return
    dispatch({
      type: 'handoffToExit',
      holdings: holdings.data.rows,
      sharePriceMicros: holdings.data.sharePriceMicros!,
    })
    setTab('exit')
  }
  // on a phone the module tabs scroll sideways: bring the open one into view, moving only the tab bar (G3 M-11)
  const tabsRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = tabsRef.current
    const open = nav?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!nav || !open || nav.scrollWidth <= nav.clientWidth) return
    const n = nav.getBoundingClientRect()
    const o = open.getBoundingClientRect()
    if (o.left < n.left) nav.scrollLeft -= n.left - o.left + 8
    else if (o.right > n.right) nav.scrollLeft += o.right - n.right + 8
  }, [tab])
  const stale = allocationStale(state)
  const holdingsStale = exitStale(state)

  const onHandoff = () => {
    if (!handoff?.ok) return
    dispatch({ type: 'handoff', handoff: handoff.value })
    setTab('alloc')
  }
  // ---------- guided tour (R-X-01, docs/en/05_GUIDED_TOUR.md v0.2) ----------
  const [tour, setTour] = useState<{
    step: number
    demoFrom: string | null
    forYou: boolean
  } | null>(null)
  const [tourNote, setTourNote] = useState<{
    kind: 'start' | 'end' | 'stale' | 'jump'
    step?: number
  } | null>(null)
  const [tourClosed, setTourClosed] = useState(false)
  const [saved, setSaved] = useState<TourProgress | null>(() => loadTourProgress(storage, STEPS.length))
  const savedStep = saved?.step ?? null
  const [confirmClear, setConfirmClear] = useState(false)
  // keyboard users land on Cancel when the confirmation opens and back on its button when it closes (UI polish self-test #2)
  const clearBtn = useRef<HTMLButtonElement>(null)
  const cancelClearBtn = useRef<HTMLButtonElement>(null)
  const clearWasOpen = useRef(false)
  useEffect(() => {
    if (confirmClear) cancelClearBtn.current?.focus()
    else if (clearWasOpen.current) clearBtn.current?.focus()
    clearWasOpen.current = confirmClear
  }, [confirmClear])
  // R-X-04: the theme is a browser preference, kept apart from the deal (decision 9)
  const [theme, setTheme] = useState<Theme>(() => loadTheme(storage))
  useEffect(() => applyTheme(theme), [theme])
  const chooseTheme = (t: Theme) => {
    setTheme(t)
    saveTheme(storage, t)
  }
  const tourCtx = useMemo(() => (tour ? context(state, tour.demoFrom) : null), [tour, state])
  useEffect(() => {
    document.documentElement.classList.toggle('touring', tour !== null || tourNote !== null)
  }, [tour, tourNote])

  const restore = (s: AppState) => {
    dispatch({ type: 'restore', state: s })
    setGeneration((g) => g + 1)
  }
  /** Put back the cap that was there before the step-10 demo — only if the demo's value is still on screen (§1, Codex M3 R1 #2). */
  const undoDemo = () => {
    if (tour?.demoFrom != null && state.allocation.cap === DEMO_CAP_TEXT) dispatch({ type: 'setAllocation', patch: { cap: tour.demoFrom } })
  }
  const remember = (n: number | null, demoFrom: string | null = null) => {
    const p = n === null ? null : { step: n, demoFrom }
    saveTourProgress(storage, p)
    setSaved(p)
  }
  const goTo = (n: number) => {
    undoDemo()
    setTour({ step: n, demoFrom: null, forYou: false })
    setTab(STEPS[n].tab)
    setTourClosed(false)
    remember(n)
  }
  const beginAt = (n: number) => {
    restore(stateAt(n, state))
    setTourNote(null)
    setTour({ step: n, demoFrom: null, forYou: false })
    setTab(STEPS[n].tab)
    setTourClosed(false)
    remember(n)
  }
  const startTour = () => setTourNote({ kind: 'start' })
  const resumeTour = () => {
    if (saved === null) return startTour()
    // back in the middle of the step-10 demo: the cap on screen is still the tour's, so it will be put back
    const demoFrom = saved.demoFrom !== null && state.allocation.cap === DEMO_CAP_TEXT ? saved.demoFrom : null
    // anything changed since leaving the tour means a restart from this step, with a warning (Codex M3 R1 #3)
    if (!prerequisitesMet(saved.step, state) || !tourIntact(saved.step, state, demoFrom)) return setTourNote({ kind: 'stale', step: saved.step })
    setTour({ step: saved.step, demoFrom, forYou: false })
    setTab(STEPS[saved.step].tab)
    setTourClosed(false)
  }
  const tourNext = () => {
    if (!tour) return
    if (tour.step === STEPS.length - 1) {
      undoDemo()
      setTour(null)
      remember(null)
      setTourNote({ kind: 'end' })
    } else goTo(tour.step + 1)
  }
  const tourDo = (fn: ((s: AppState) => AppState) | undefined) => {
    if (!tour || !fn) return
    dispatch({ type: 'restore', state: fn(state) })
    setTour({ ...tour, forYou: true })
  }
  const exitTour = () => {
    undoDemo()
    if (tour) remember(tour.step) // the demo is over: nothing on the page is the tour's any more (Codex M3 R1 #2)
    setTour(null)
    setTourClosed(true)
  }
  /** Restarting or replaying loses nothing when the page is a fresh one, the untouched sample, or exactly where the tour left it. */
  const tourAt = tour?.step ?? saved?.step ?? null
  const wouldLoseEdits =
    !nothingToLose(state) && !(tourAt !== null && tourIntact(tourAt, state, tour?.demoFrom ?? saved?.demoFrom ?? null)) && !tourIntact(STEPS.length, state)
  /**
   * A cap the person sets ends the demo's claim on the cap for good — in memory and in the saved progress — so typing the
   * demo's value again later is never mistaken for the tour's own (Codex M3 R3 #9).
   */
  const allocationDispatch = (a: Parameters<typeof dispatch>[0]) => {
    if (a.type === 'setAllocation' && 'cap' in a.patch) {
      if (tour?.demoFrom != null) setTour({ ...tour, demoFrom: null })
      if (saved?.demoFrom != null) remember(saved.step)
    }
    dispatch(a)
  }
  /** A chapter jump replays the sample; if the person has changed anything, ask first (Codex M3 R1 #1). */
  const jumpTo = (ch: Chapter) => {
    const n = firstStepOf(ch)
    if (tour && tourIntact(tour.step, state, tour.demoFrom)) beginAt(n)
    else setTourNote({ kind: 'jump', step: n })
  }

  /** End card "Try next": open the page and focus the control — never act on it (guide v0.3 §3.2). The card stays open. */
  const focusTarget = useRef<string | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const [endTop, setEndTop] = useState(false)
  const takeMeTo = (t: TryNext) => {
    focusTarget.current = t.target
    setTab(t.tab)
    setFocusTick((n) => n + 1) // after the page has rendered, even when it is the page already open
  }
  useEffect(() => {
    const target = focusTarget.current
    if (!target) return
    focusTarget.current = null
    const el = byTour(target)
    // a disabled control cannot take focus: then the target itself, when it is made focusable (tabindex -1), e.g. the
    // reason a panel is unavailable (Codex M6 r2 #1)
    const focusable = el?.matches('button, input, select, a')
      ? el
      : (el?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a') ?? (el?.hasAttribute('tabindex') ? el : null))
    // immediate, as for the step cards, so the card's position is decided on where the target really ends up
    el?.scrollIntoView?.({ block: 'center', behavior: 'auto' })
    focusable?.focus({ preventScroll: true })
    // the end card moves to the top when it would cover the target (guide v0.3 §3.2, the step cards' rule; Codex M6 r2)
    const c = document.querySelector('[data-testid="tour-end"]')?.getBoundingClientRect()
    const t = (focusable ?? el)?.getBoundingClientRect()
    if (!c || !t) return
    const W = window.innerWidth
    const H = window.innerHeight
    const across = t.left < W - 16 && t.right > W - 16 - c.width
    const underBottom = across && t.bottom > H - 16 - c.height && t.top < H - 16
    const underTop = across && t.top < 16 + c.height && t.bottom > 16
    if (underBottom && underTop) {
      const lift = t.bottom - (H - 32 - c.height)
      window.scrollBy?.(0, t.top - lift >= 8 ? lift : t.top - 16)
      setEndTop(false)
    } else setEndTop(underBottom)
  }, [focusTick])

  const clearAll = () => {
    clearSaved(storage)
    skipSave.current = true
    dispatch({ type: 'clearAll' })
    setGeneration((g) => g + 1)
    setConfirmClear(false)
    setTour(null)
    setTourNote(null)
    setTourClosed(false)
    remember(null)
    chooseTheme('system')
  }

  return (
    <div className="app">
      {/* sidebar from 1024px (the M4 visual plan (not published)); stacked above the page on narrower screens */}
      <aside className="side" aria-label="Deal and modules">
        <div className="brand">
          <h1 className="wordmark">Deal Ops Toolkit</h1>
          <div className="deal-card">
            <p className="eyebrow">Deal</p>
            <p className="deal-name" data-testid="deal-name">
              {deal.name}
            </p>
          </div>
        </div>
        <p className="eyebrow side-label">Workflow</p>
        <nav className="tabs" role="tablist" aria-label="Modules" ref={tabsRef}>
          <TabButton id="deal" tab={tab} setTab={setTab}>
            Deal settings
          </TabButton>
          <TabButton id="rec" tab={tab} setTab={setTab}>
            1. Reconciliation
            {recOutcome?.ok && recOutcome.result.pendingSuggestions > 0 && <span className="pill">{recOutcome.result.pendingSuggestions}</span>}
          </TabButton>
          <TabButton id="alloc" tab={tab} setTab={setTab}>
            2. Allocation
            {stale && <span className="pill warn">out of date</span>}
          </TabButton>
          <TabButton id="exit" tab={tab} setTab={setTab}>
            3. Exit distribution
            {holdingsStale && <span className="pill warn">out of date</span>}
          </TabButton>
          <TabButton id="log" tab={tab} setTab={setTab}>
            Activity log
          </TabButton>
        </nav>
        <div className="side-actions">
          <button type="button" className="tour-btn" onClick={tour ? undefined : savedStep !== null ? resumeTour : startTour} disabled={tour !== null}>
            {tour ? 'Tour in progress' : savedStep !== null ? `Resume tour (step ${savedStep + 1} of ${STEPS.length})` : 'Take the tour'}
          </button>
          {!tour && savedStep !== null && (
            <button type="button" className="link" onClick={startTour}>
              Restart
            </button>
          )}
          <button type="button" className="danger" ref={clearBtn} onClick={() => setConfirmClear(true)} disabled={confirmClear}>
            Clear all data
          </button>
          {confirmClear && (
            <div className="notice bad confirm-clear" role="alertdialog" aria-labelledby="clear-q">
              <span id="clear-q">Clear all data in this browser? This cannot be undone.</span>{' '}
              <button type="button" className="danger" onClick={clearAll}>
                Clear everything
              </button>{' '}
              <button type="button" ref={cancelClearBtn} onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="main-col">
        <header className="top">
          <p className="crumb">
            Deal Ops Toolkit / <span className="crumb-here">{TAB_LABEL[tab]}</span>
          </p>
          <div className="top-actions">
            {/* during the tour, reloading the sample is a restart of the tour (§4) */}
            <button type="button" onClick={tour ? startTour : () => dispatch({ type: 'loadSample' })}>
              Load sample deal
            </button>
            <div className="theme-switch" role="group" aria-label="Theme">
              {THEMES.map(([t, name]) => (
                <button key={t} type="button" aria-pressed={theme === t} onClick={() => chooseTheme(t)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          {tourClosed && savedStep !== null && <p className="privacy">Tour paused. Pick it up any time with Resume tour.</p>}
          <p className="privacy">{PRIVACY_TEXT}</p>
          <div role="status" aria-label="Save status" className="save-status">
            {saveResult === 'blocked' && (
              <p className="privacy">This browser is not saving your data (storage is blocked), so it will be gone when you close the page.</p>
            )}
            {saveResult === 'full' && (
              <p className="privacy">
                This browser's storage for this page is full, so your latest changes are not being saved. Export what you need before you close the page.
              </p>
            )}
          </div>
          {/* R-X-08.4: never blocks anything; a removal before export is the louder of the two. A live region, since a
              full store can remove entries at any moment (M5 self-test) */}
          <div role="status" aria-label="Activity log status">
            {logInfo.removedUnexported > 0 ? (
              <p className="notice bad" data-testid="log-removed">
                {removedText(logInfo.removedUnexported)}
              </p>
            ) : (
              logInfo.nearFull && (
                <p className="notice warn" data-testid="log-near-full">
                  {NEAR_FULL_TEXT}
                </p>
              )
            )}
          </div>
        </header>

        {!state.disclaimerAccepted && (
          <section className="disclaimer" role="dialog" aria-labelledby="disc-h" aria-modal="false">
            <h2 id="disc-h">Before you start</h2>
            <p>{DISCLAIMER_TEXT}</p>
            <p>{PRIVACY_TEXT}</p>
            <p>The sample deal is fictional. Load it to try every step without your own data.</p>
            <div className="row-actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  dispatch({ type: 'acceptDisclaimer' })
                  // the page can be edited before the disclaimer is accepted, so this entry is checked like the others (Codex M3 R3 #10)
                  if (nothingToLose(state)) beginAt(0)
                  else setTourNote({ kind: 'start' })
                }}
              >
                I understand — take the 3-minute tour
              </button>
              <button type="button" onClick={() => dispatch({ type: 'acceptDisclaimer' })}>
                I understand
              </button>
            </div>
          </section>
        )}

        <PendingContext value={reportPending}>
          <main key={generation}>
            {tab === 'deal' && <DealSettings deal={deal} dispatch={dispatch} amounts={amountsEntered(state)} currencyLocked={currencyLocked(state)} />}
            {tab === 'rec' && (
              <Reconciliation
                state={state}
                dispatch={dispatch}
                derivedErrors={recDerived.errors}
                outcome={recOutcome}
                onHandoff={onHandoff}
                pending={pending}
                onStartTour={startTour}
                copyGate={copyGate}
                recheck={recheck}
              />
            )}
            {tab === 'alloc' && (
              <Allocation
                pending={pending}
                state={state}
                dispatch={allocationDispatch}
                derivedErrors={allocDerived.errors}
                outcome={allocOutcome}
                stale={stale}
                priceMicros={allocDerived.input?.priceMicros ?? null}
                canHandoff={Boolean(handoff?.ok)}
                onHandoff={onHandoff}
                canHandoffToExit={holdings !== null}
                onHandoffToExit={onHandoffToExit}
                recheck={recheck}
              />
            )}
            {tab === 'log' && <ActivityLog log={state.log} dispatch={dispatch} currency={deal.currency} />}
            {tab === 'exit' && (
              <Distribution
                state={state}
                dispatch={dispatch}
                derivedErrors={exitDerived.errors}
                outcome={exitOutcome}
                stale={holdingsStale}
                canHandoff={holdings !== null}
                onHandoff={onHandoffToExit}
                pending={pending}
              />
            )}
          </main>
        </PendingContext>

        <Footer />
      </div>

      {tour && tourCtx && !tourNote && (
        <TourCard
          index={tour.step}
          ctx={tourCtx}
          demo={tour.demoFrom !== null}
          doneForYou={tour.forYou}
          onBack={() => goTo(Math.max(0, tour.step - 1))}
          onNext={tourNext}
          onDoIt={() => tourDo(STEPS[tour.step].action?.perform)}
          onFix={() => tourDo(STEPS[tour.step].action?.fix)}
          onDemo={() => {
            const from = state.allocation.cap
            dispatch({ type: 'setAllocation', patch: { cap: DEMO_CAP_TEXT } })
            setTour({ ...tour, demoFrom: from })
            remember(tour.step, from)
          }}
          onJump={jumpTo}
          onExit={exitTour}
        />
      )}
      {tourNote && (
        <TourNote
          kind={tourNote.kind}
          step={tourNote.step}
          replaces={wouldLoseEdits}
          onStart={() => beginAt(tourNote.kind === 'stale' || tourNote.kind === 'jump' ? (tourNote.step ?? 0) : 0)}
          onCancel={() => setTourNote(null)}
          onReplay={() => {
            // replay only starts silently on the finished tour's own data; anything changed since gets the warning (Codex M3 R2 #7)
            if (tourIntact(STEPS.length, state)) beginAt(0)
            else setTourNote({ kind: 'start' })
          }}
          onClearOwn={() => {
            setTourNote(null)
            setConfirmClear(true)
          }}
          tryNext={tourNote.kind === 'end' ? tryNext(context(state)) : []}
          top={tourNote.kind === 'end' && endTop}
          onTakeMeTo={takeMeTo}
        />
      )}
    </div>
  )
}

function TabButton({ id, tab, setTab, children }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
      {children}
    </button>
  )
}
