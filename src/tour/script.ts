// Guided tour script (PRD R-X-01, docs/en/05_GUIDED_TOUR.md v0.3; v0.2 approved 2026-10-20, v0.3 with PRD v0.8).
// Pure: every step reads figures from the engines' results and acts only through the reducer, so the tour can
// never book, move or show money differently from the rest of the interface.
import { decide, handoffToAllocation, reconcile, type ReconcileResult } from '../lib/reconcile'
import { allocate, type AllocationInput, type AllocationResult } from '../lib/allocation'
import { carryIsFullShare, distribute, type WaterfallInput, type WaterfallResult } from '../lib/waterfall'
import { holdingsFromAllocation } from '../lib/snapshot'
import { blocked } from '../lib/outcome'
import { formatMicroShares, formatMoney, formatPercent, parseMoney, plainMoney } from '../lib/money'
import { SAMPLE_CAP, SAMPLE_FEES } from '../lib/sample'
import { previewFeePayerChange } from '../lib/feePayer'
import { deriveAllocation, deriveDistribution, deriveFeePayerInput, deriveReconcile } from '../derive'
import { activeChange } from '../lib/adjust'
import { allocationStale, exitStale, initialState, reducer, sampleState, type AppState } from '../state'

/** Shown in place of a figure the engines could not provide (a test asserts it never appears on the sample). */
export const MISSING = '(unavailable)'

export type Chapter = 'Reconciliation' | 'Allocation' | 'Exit'
export type TourTab = 'rec' | 'alloc' | 'exit'
export const CHAPTERS: Chapter[] = ['Reconciliation', 'Allocation', 'Exit']

/** What the engines say about the current state; the cards quote these figures. */
export interface Ctx {
  state: AppState
  rec: ReconcileResult | null
  alloc: AllocationResult | null
  exit: WaterfallResult | null
  allocInput: AllocationInput | null
  exitInput: WaterfallInput | null
  /** the cap as it was before the step-10 demo, which is what the tour puts back (review M3 R1 #2) */
  demoFrom: string | null
}

export function context(state: AppState, demoFrom: string | null = null): Ctx {
  const r = deriveReconcile(state)
  const ro = r.input ? reconcile(r.input) : null
  const a = deriveAllocation(state)
  const ao = a.input ? allocate(a.input) : null
  const e = deriveDistribution(state)
  const eo = e.input ? distribute(e.input) : null
  return {
    state,
    rec: ro?.ok ? ro.result : null,
    alloc: ao?.ok ? ao.result : null,
    exit: eo?.ok ? eo.result : null,
    allocInput: a.input,
    exitInput: e.input,
    demoFrom,
  }
}

const money = (c: Ctx, v: number | undefined) => (v === undefined ? MISSING : formatMoney(v, c.state.deal.currency))
const lineOf = (c: Ctx, txn: string) => c.rec?.lines.find((l) => l.line.txnId === txn)
const nameOf = (c: Ctx, id: string | null) => c.rec?.commitments.find((x) => x.commitment.id === id)?.commitment.name ?? 'someone else'
const recRow = (c: Ctx, id: string) => c.rec?.commitments.find((x) => x.commitment.id === id)
const allocRow = (c: Ctx, id: string) => c.alloc?.rows.find((x) => x.id === id)

export interface Action {
  /** what the person is asked to do, shown as the card's instruction */
  ask: string
  done(c: Ctx): boolean
  /** "Do this for me": only what the person could do themselves (never past a blocker) */
  perform(s: AppState): AppState
  /** shown once done, so the person sees the effect before moving on */
  result(c: Ctx): string
  /** a different decision was made on this step's data: what happened, and a way back */
  wrong?(c: Ctx): string | null
  fix?(s: AppState): AppState
}

export interface Step {
  id: string
  chapter: Chapter
  tab: TourTab
  /** data-tour anchors to highlight; the first one is scrolled into view */
  targets(c: Ctx, demo: boolean): string[]
  text(c: Ctx, demo: boolean): string
  action?: Action
}

// ---------- reducer-driven actions ----------

function decideOn(s: AppState, txn: string, investorId: string | null): AppState {
  const c = context(s)
  const line = lineOf(c, txn)?.line
  const who = investorId ? (recRow(c, investorId)?.commitment ?? null) : null
  if (!line || (investorId && !who)) return s
  // logged like the person's own decision, marked as the tour's (C-X-1)
  return reducer(s, { type: 'decide', lineId: line.id, decision: decide(line, who), via: 'candidate', prevStatus: lineOf(c, txn)?.status, tour: true })
}

function undoOn(s: AppState, txn: string): AppState {
  const l = lineOf(context(s), txn)
  return l ? reducer(s, { type: 'undoDecision', lineId: l.line.id, prevStatus: l.status, tour: true }) : s
}

function handOffToAllocation(s: AppState): AppState {
  const c = context(s)
  if (!c.rec) return s
  const h = handoffToAllocation(c.rec)
  return h.ok ? reducer(s, { type: 'handoff', handoff: h.value, tour: true }) : s
}

function handOffToExit(s: AppState): AppState {
  const d = deriveAllocation(s)
  const o = d.input ? allocate(d.input) : null
  if (!d.input || !o?.ok || blocked(o.checks)) return s
  const snap = holdingsFromAllocation(o.result, d.input.priceMicros, s.allocVersion)
  return reducer(s, { type: 'handoffToExit', holdings: snap.data.rows, sharePriceMicros: snap.data.sharePriceMicros!, tour: true })
}

/** Confirm one suggested line for the expected investor (steps 2–4). */
function confirmStep(txn: string, investorId: string, first: string): Action {
  return {
    ask: `Confirm ${first}.`,
    done: (c) => {
      const l = lineOf(c, txn)
      return l?.status === 'confirmed' && l.assignedTo === investorId
    },
    perform: (s) => decideOn(s, txn, investorId),
    result: (c) => `Booked. Booked to investors is now ${money(c, c.rec?.totals.booked)}.`,
    wrong: (c) => {
      const l = lineOf(c, txn)
      if (l?.status === 'confirmed' && l.assignedTo !== investorId)
        return `That booked ${money(c, l.line.amount)} to ${nameOf(c, l.assignedTo)}. In this sample it's ${first}'s — undo it, then confirm ${first}.`
      if (l?.status === 'rejected') return `That marked it as not part of this deal. In this sample it's ${first}'s — undo it, then confirm ${first}.`
      return null
    },
    fix: (s) => decideOn(undoOn(s, txn), txn, investorId),
  }
}

const rejected = (c: Ctx, txn: string) => lineOf(c, txn)?.status === 'rejected'

// ---------- the 12 steps ----------

export const STEPS: Step[] = [
  {
    id: 'auto',
    chapter: 'Reconciliation',
    tab: 'rec',
    targets: () => ['rec-summary', 'rec-rule'],
    text: (c) => {
      const auto = c.rec?.lines.filter((l) => l.status === 'auto').length ?? 0
      return `Northwind Robotics is a fictional seed round: ${c.state.commitments.length} investors, ${c.state.bank.length} bank lines. ${auto} receipts were booked automatically because their reference names exactly one investor. Everything else waits for you — nothing is booked on a guess.`
    },
  },
  {
    id: 'no-reference',
    chapter: 'Reconciliation',
    tab: 'rec',
    targets: (c) => [reviewOrLine(c, 't03')],
    text: (c) =>
      booked(c, 't03') ?? `No reference at all. The payer name and amount match Chloe Martin, so she's suggested${score(c, 't03', 'c03')} — but not booked.`,
    action: confirmStep('t03', 'c03', 'Chloe'),
  },
  {
    id: 'family-office',
    chapter: 'Reconciliation',
    tab: 'rec',
    targets: (c) => [reviewOrLine(c, 't05')],
    text: (c) =>
      booked(c, 't05') ??
      `A family office paid ${money(c, lineOf(c, 't05')?.line.amount)} — Elena's amount, but not her name${score(c, 't05', 'c05')}. In a real deal, check it's her investing entity before you confirm. Here it is.`,
    action: confirmStep('t05', 'c05', 'Elena'),
  },
  {
    id: 'typo',
    chapter: 'Reconciliation',
    tab: 'rec',
    targets: (c) => [reviewOrLine(c, 't12')],
    text: (c) => booked(c, 't12') ?? `Typo: 'NW 11' instead of NW-011. The score is high${score(c, 't12', 'c11')}, but it is still your decision.`,
    action: confirmStep('t12', 'c11', 'Kavya'),
  },
  {
    id: 'not-ours',
    chapter: 'Reconciliation',
    tab: 'rec',
    targets: () => ['line-t14', 'line-t11'],
    text: (c) =>
      `t14's reference NW-0019 contains NW-001, but it is a different reference — so it was never booked to Amelia. t11 is a supplier invoice, flagged after ${lineOf(c, 't11')?.ageDays ?? MISSING} days unmatched. Sending money back is your call, outside this tool.`,
    action: {
      ask: "Mark both 'Not part of this deal'.",
      done: (c) => rejected(c, 't14') && rejected(c, 't11'),
      perform: (s) => {
        let next = s
        for (const t of ['t14', 't11']) if (!rejected(context(next), t)) next = decideOn(next, t, null)
        return next
      },
      result: (c) => `Done. Not booked is now ${money(c, c.rec?.totals.unbooked)}, and neither line counts for anyone.`,
      wrong: (c) => {
        const l = ['t14', 't11'].map((t) => lineOf(c, t)).find((x) => x?.status === 'confirmed')
        return l
          ? `That booked ${money(c, l.line.amount)} to ${nameOf(c, l.assignedTo)}. In this sample it isn't part of the deal — undo it, then mark it.`
          : null
      },
      fix: (s) => {
        let next = s
        for (const t of ['t14', 't11']) if (!rejected(context(next), t)) next = decideOn(undoOn(next, t), t, null)
        return next
      },
    },
  },
  {
    id: 'short-and-over',
    chapter: 'Reconciliation',
    tab: 'rec',
    // v0.3: David's "Copy message" is last, so the first target still decides the scroll position
    targets: () => ['status-c04', 'status-c08', 'chase-export', 'copy-message-c04'],
    text: (c) => {
      // only while someone is on the chase list, so the card never points at a button that is not there (guide v0.3 §3.1)
      const chase = c.rec?.commitments.some((x) => x.status === 'partial' || x.status === 'outstanding')
      const copy = chase ? " 'Copy message' next to each name gives you the chase email to send yourself." : ''
      return `${paymentStory(c, 'c04', 'David')} ${paymentStory(c, 'c08', 'Hugo')}${copy}`
    },
  },
  {
    id: 'hand-off',
    chapter: 'Reconciliation',
    tab: 'rec',
    targets: () => ['rec-checks', 'handoff'],
    text: () =>
      "Every suggestion is decided, so hand-off unlocks — and every figure has passed its self-checks. Hand-off takes a snapshot: if you change reconciliation later, Allocation says 'out of date' instead of changing silently.",
    action: {
      ask: 'Hand off to allocation.',
      done: (c) => c.state.allocation.handoffVersion !== null && !allocationStale(c.state),
      perform: handOffToAllocation,
      result: (c) => `Handed off: ${c.state.allocation.investors.length} investors are now in Allocation.`,
    },
  },
  {
    id: 'allocated',
    chapter: 'Allocation',
    tab: 'alloc',
    targets: () => ['alloc-totals', 'alloc-c04', 'alloc-c10'],
    text: (c) => {
      const fee = c.allocInput?.fees.find((f) => f.payer === 'investors' && f.kind === 'percent')
      return `Each investor is allocated on what actually arrived, less the ${fee ? formatPercent(fee.value) : ''} platform fee: ${money(c, allocRow(c, 'c01')?.received)} buys ${money(c, allocRow(c, 'c01')?.invested)} of shares. David is in on ${money(c, allocRow(c, 'c04')?.received)}, not ${money(c, recRow(c, 'c04')?.commitment.cashDue)}. James's ${money(c, lineOf(c, 't16')?.line.amount)} arrived after the as-of date, so he is not in this close.`
    },
  },
  {
    id: 'whole-shares',
    chapter: 'Allocation',
    tab: 'alloc',
    targets: () => ['seis-c01'],
    text: (c) => {
      const a = allocRow(c, 'c01')
      return `Investors hold fractional shares through the nominee, but S/EIS relief needs whole shares. Amelia holds ${a ? formatMicroShares(a.microShares) : MISSING} shares: ${a?.claimableShares.toLocaleString('en-GB') ?? MISSING} can be claimed, ${money(c, a?.nonClaimable)} can't. The tool flags it; it doesn't judge eligibility.`
    },
  },
  {
    id: 'scale-back',
    chapter: 'Allocation',
    tab: 'alloc',
    targets: (_c, demo) => (demo ? ['blockers'] : ['cap']),
    text: (c, demo) => {
      if (!demo) return 'When a round is oversubscribed, everyone is scaled back pro rata. See what happens with a smaller cap.'
      const names = c.alloc?.blockers.find((b) => b.code === 'scale-back-below-minimum')?.names ?? []
      return `${names.join(', ') || 'Nobody'} would fall below the ${money(c, c.allocInput?.minimum)} minimum, so the allocation is blocked and named — the tool won't fix it quietly. Next puts the cap back to ${capWords(c)}.`
    },
  },
  {
    id: 'confirmation',
    chapter: 'Allocation',
    tab: 'alloc',
    targets: () => ['confirmation', 'handoff-exit'],
    text: () =>
      'This is the summary the lead confirms before money goes to the company: totals, fees, refunds, every investor. Copy it into your email. Then carry the holdings into the exit.',
    action: {
      ask: 'Hand off to exit distribution.',
      done: (c) => c.state.exit.handoffVersion !== null && !exitStale(c.state),
      perform: handOffToExit,
      result: (c) => `Handed off: ${c.state.exit.holdings.length} holdings are now in Exit distribution.`,
    },
  },
  {
    id: 'exit',
    chapter: 'Exit',
    tab: 'exit',
    targets: () => ['exit-steps'],
    text: (c) => {
      const x = c.exitInput
      const terms = x?.carry.mode === 'fixed' ? x.carry : null
      const r = c.exit
      const head = `Exit: ${money(c, x?.proceeds)} back, ${money(c, x?.exitCosts)} costs, after ${x ? x.years100 / 100 : MISSING} years.`
      // every clause is read off the engine's result, so the card stays true if the terms are changed (review M3 #4, R1 #4)
      if (r && r.shortfall > 0) return `${head} The costs are more than the proceeds by ${money(c, r.shortfall)}, so nothing can be paid out.`
      if (r && r.returnOfCapital < r.capital)
        return `${head} Investors get back ${money(c, r.returnOfCapital)} of the ${money(c, r.capital)} they put in. There is no profit, so no carry.`
      const hurdle =
        terms && terms.h > 0 && r?.steps.some((st) => st.label === 'Preferred return (hurdle)') ? `, then a hurdle of ${formatPercent(terms.h)} a year` : ''
      const catchUp = r?.steps.some((st) => st.label === 'Lead catch-up') ? ', then the lead catches up' : ''
      const ending =
        r && terms && carryIsFullShare(r, terms.k)
          ? `Carry ends at exactly ${formatPercent(terms.k)} of the profit: ${money(c, r.carry)}.`
          : `Carry to the lead: ${money(c, r?.carry)}.`
      return `${head} Investors get their ${money(c, r?.returnOfCapital)} back first${hurdle}${catchUp}. ${ending}`
    },
  },
]

function capWords(c: Ctx): string {
  const from = c.demoFrom ?? SAMPLE_CAP_TEXT
  if (from.trim() === '') return 'no cap'
  const p = parseMoney(from, c.state.deal.currency)
  return p.ok ? money(c, p.value) : `"${from}"`
}

/** The sample's round cap, as the tour restores it after the step-10 demo. */
export const SAMPLE_CAP_TEXT = plainMoney(SAMPLE_CAP)
export const DEMO_CAP_TEXT = '80000'

/** " (score 0.55)", or nothing once the line is no longer a suggestion (review M3 R1 #5). */
function score(c: Ctx, txn: string, investorId: string): string {
  const s = lineOf(c, txn)?.candidates.find((x) => x.commitmentId === investorId)?.score
  return s === undefined ? '' : ` (score ${s.toFixed(2)})`
}

/** While a line waits in the review queue the card points there; once decided, at its row in the bank lines table. */
const reviewOrLine = (c: Ctx, txn: string) => (lineOf(c, txn)?.status === 'suggested' ? `review-${txn}` : `line-${txn}`)

/** Card text once the line has been booked by hand, so the card never says "not booked" next to "Booked". */
function booked(c: Ctx, txn: string): string | null {
  const l = lineOf(c, txn)
  return l?.status === 'confirmed'
    ? `${money(c, l.line.amount)} from ${l.line.payer} is now booked to ${nameOf(c, l.assignedTo)} — by you, not by a guess.`
    : null
}

/** Describe one investor's payment as reconciliation sees it now (review M3 R1 #3: live edits keep the card true). */
function paymentStory(c: Ctx, id: string, first: string): string {
  const r = recRow(c, id)
  if (!r) return ''
  if (r.status === 'partial') return `${first} is ${money(c, -r.difference)} short — on the chase list you can export.`
  if (r.status === 'outstanding') return `${first} has not paid — on the chase list you can export.`
  if (r.status === 'overpaid') return `${first} paid ${money(c, r.difference)} more than due — listed as a refund, not invested.`
  return `${first} has paid in full.`
}

export const firstStepOf = (ch: Chapter) => STEPS.findIndex((s) => s.chapter === ch)

/**
 * Deterministic replay: the sample plus the actions of every step before `n` (resume, chapter jumps, E2E-05). It loads
 * the sample through the reducer, so the log starts again at sample_loaded and the replayed decisions are not doubled (C-X-1).
 */
export function stateAt(n: number, base: AppState): AppState {
  let s: AppState = { ...reducer(base, { type: 'loadSample' }), disclaimerAccepted: true }
  for (const step of STEPS.slice(0, n)) if (step.action && !step.action.done(context(s))) s = step.action.perform(s)
  return s
}

/** Can the tour continue at step `n` on this data? Every earlier action must still hold, and the sample must be intact. */
export function prerequisitesMet(n: number, s: AppState): boolean {
  const c = context(s)
  if (!c.rec || s.commitments.length !== 12) return false
  // past the scale-back demo the sample's cap must be back, or later steps would sit on a blocked allocation (review M3 #2)
  if (n > STEPS.findIndex((st) => st.id === 'scale-back') && c.state.allocation.handoffVersion !== null && c.alloc?.blockers.length) return false
  return STEPS.slice(0, n).every((step) => !step.action || step.action.done(c))
}

/** The data a person can change, in a form that does not depend on the order decisions were made in. */
function tourData(x: AppState): string {
  const decisions = Object.entries(x.decisions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  // the log and the initials are not deal data: counting them, the page would never look unchanged (Tech Design §9.3)
  return JSON.stringify([
    { ...x.deal, initials: '' },
    x.commitments,
    x.bank,
    decisions,
    x.allocation.price,
    x.allocation.cap,
    x.allocation.fees,
    x.allocation.investors,
    x.allocation.excess,
    { ...x.exit, handoffVersion: null },
    Object.entries(x.withdrawals).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    x.feePayerChanges,
  ])
}

/**
 * Is the page exactly where the tour would have it at step `n` (the sample plus the tour's actions)? Resume, chapter
 * jumps and Replay only go ahead silently when it is; otherwise the person's edits would be replaced (Codex M3 R1 #1, #3).
 */
export function tourIntact(n: number, s: AppState, demoFrom: string | null = null): boolean {
  // while the demo's value is still on screen, the person's cap is the one the demo replaced; otherwise what is on screen
  // (Codex M3 R2 #8: a cap set before or during the demo is a person's edit, not the tour's)
  const cap = demoFrom !== null && s.allocation.cap === DEMO_CAP_TEXT ? demoFrom : s.allocation.cap
  const mine = tourData({ ...s, allocation: { ...s.allocation, cap } })
  // the current step's own action may already be done, so the page can be one action ahead of the replay point
  return mine === tourData(stateAt(n, s)) || (n < STEPS.length && mine === tourData(stateAt(n + 1, s)))
}

/** True when the page holds nothing a person would lose by starting the tour. */
export function nothingToLose(s: AppState): boolean {
  // everything a person can type counts: settings, terms and fees as well as the tables (review M3 #1)
  // a fresh page (its as-of date is just "today"), or the untouched sample
  // the as-of date counts too: an edited date is data, and an old untouched page errs on the side of asking (Codex M3 R3 #11)
  return tourData(s) === tourData(initialState()) || tourData(s) === tourData(sampleState(s))
}

// ---------- end card "Try next" (guide v0.3 §3.2) ----------

export interface TryNext {
  text: string
  tab: TourTab
  /** data-tour anchor that "Take me to it" brings into view and focuses; it never acts (§1: the person decides) */
  target: string
}

/** The sample's investor for item 1 and its platform fee for item 2 (guide v0.3 §3.2). */
const LUCAS = 'c12'
const PLATFORM_FEE = SAMPLE_FEES[0].id

/**
 * Item 2: preview the platform fee moving to the company. If it is blocked only by one investor falling below the
 * minimum, preview again with the minimum lowered to that investor's new cash due, and offer that only if it passes.
 */
function feePayerItem(c: Ctx): TryNext | null {
  const s = c.state
  const fee = s.allocation.fees.find((f) => f.id === PLATFORM_FEE)
  if (!fee || fee.payer !== 'investors' || fee.kind !== 'percent' || !c.allocInput) return null
  // the panel must be usable — except that an out-of-date allocation still counts: after item 1 the item stays and the
  // panel says to hand off again (guide v0.3 §8 item 2)
  if (activeChange(s.feePayerChanges) || s.allocation.handoffVersion === null || s.allocation.editedSinceHandoff) return null
  const d = deriveFeePayerInput(s, fee.id, 'company')
  const o = d.input ? previewFeePayerChange(d.input) : null
  if (!d.input || !o?.ok) return null
  const tail = "then apply and see each investor's new amount due."
  if (o.result.canApply) return { text: `Change who pays the platform fee to the company, ${tail}`, tab: 'alloc', target: 'fee-payer' }
  const b = o.result.blockers
  if (b.length !== 1 || b[0].code !== 'would-fall-below-minimum') return null
  const who = o.result.rows.find((r) => r.id === b[0].investorId)
  if (!who) return null
  const lowered = previewFeePayerChange({ ...d.input, minimum: who.newDue })
  if (!lowered.ok || !lowered.result.canApply) return null
  return {
    text: `Change who pays the platform fee to the company. ${who.name.split(' ')[0]}'s ${money(c, c.allocInput.minimum)} minimum blocks it: lower the minimum commitment (Deal settings) to ${money(c, who.newDue)}, ${tail}`,
    tab: 'alloc',
    target: 'fee-payer',
  }
}

/** Items whose premise does not hold on the current data are left out, never shown as unavailable. */
export function tryNext(c: Ctx): TryNext[] {
  const items: TryNext[] = []
  const lucas = recRow(c, LUCAS)
  if (lucas && lucas.withdrawnOn === null && lucas.received > 0)
    items.push({
      text: `Mark ${lucas.commitment.name} withdrawn. You'll need his written consent. His ${money(c, lucas.received)} moves to refunds.`,
      tab: 'rec',
      target: `withdraw-${LUCAS}`,
    })
  const fp = feePayerItem(c)
  if (fp) items.push(fp)
  const confirmed = c.rec?.lines.find((l) => l.status === 'confirmed')
  if (confirmed) items.push({ text: "Undo a confirmed payment to see 'Copy query'.", tab: 'rec', target: `undo-${confirmed.line.txnId ?? confirmed.line.id}` })
  return items
}
