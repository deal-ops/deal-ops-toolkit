// Deal settings, reconciliation, closing allocation, exit distribution, the hand-offs between them, and the guided tour.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { reconcile, handoffToAllocation } from './lib/reconcile'
import { allocate } from './lib/allocation'
import { distribute } from './lib/waterfall'
import { holdingsFromAllocation } from './lib/snapshot'
import { blocked } from './lib/outcome'
import { allocationStale, exitStale, clearSaved, initialState, loadState, reducer, saveState, type AppState } from './state'
import { deriveAllocation, deriveDistribution, deriveReconcile } from './derive'
import { DealSettings } from './components/DealSettings'
import { Reconciliation } from './components/Reconciliation'
import { Allocation } from './components/Allocation'
import { Distribution } from './components/Distribution'
import { Footer } from './components/Footer'
import { PendingContext } from './components/pending'
import { DISCLAIMER_TEXT, PRIVACY_TEXT } from './config'
import { TourCard, TourNote } from './components/Tour'
import { DEMO_CAP_TEXT, STEPS, context, firstStepOf, nothingToLose, prerequisitesMet, stateAt, tourIntact, type Chapter } from './tour/script'
import { loadTourProgress, saveTourProgress, type TourProgress } from './tour/progress'

type Tab = 'deal' | 'rec' | 'alloc' | 'exit'
const TAB_LABEL: Record<Tab, string> = {
  deal: 'Deal settings',
  rec: 'Reconciliation',
  alloc: 'Allocation',
  exit: 'Exit distribution',
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined // blocked storage: the app still works, it just does not remember
  }
}

export default function App({ storage = browserStorage() }: { storage?: Storage }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadState(storage) ?? initialState())
  const [tab, setTab] = useState<Tab>('rec')
  const [saveOk, setSaveOk] = useState(true)
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
    setSaveOk(saveState(storage, state))
  }, [state, storage])

  const { deal, commitments, bank, decisions, allocation, exit } = state
  // re-derive only when that module's inputs change (state.ts replaces what it edits)
  const recDerived = useMemo(() => deriveReconcile({ deal, commitments, bank, decisions }), [deal, commitments, bank, decisions])
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
          <button type="button" className="danger" onClick={() => setConfirmClear(true)}>
            Clear all data
          </button>
          {confirmClear && (
            <div className="notice bad confirm-clear" role="alertdialog" aria-labelledby="clear-q">
              <span id="clear-q">Clear all data in this browser? This cannot be undone.</span>{' '}
              <button type="button" className="danger" onClick={clearAll}>
                Clear everything
              </button>{' '}
              <button type="button" onClick={() => setConfirmClear(false)}>
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
          </div>
          {tourClosed && savedStep !== null && <p className="privacy">Tour paused. Pick it up any time with Resume tour.</p>}
          <p className="privacy">{PRIVACY_TEXT}</p>
          {!saveOk && <p className="privacy">This browser is not saving your data (storage is blocked), so it will be gone when you close the page.</p>}
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
            {tab === 'deal' && <DealSettings deal={deal} dispatch={dispatch} />}
            {tab === 'rec' && (
              <Reconciliation
                state={state}
                dispatch={dispatch}
                derivedErrors={recDerived.errors}
                outcome={recOutcome}
                onHandoff={onHandoff}
                pending={pending}
                onStartTour={startTour}
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
              />
            )}
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
