// Self-test gate (Rules §3, step "测试有效性"): break the code on purpose; a test must fail every time.
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const MUTANTS = [
  ['src/lib/money.ts', "return 2n * r >= D ? q + 1n : q", "return 2n * r > D ? q + 1n : q", 'half-up becomes half-down'],
  // Not listed: `if (W[i] > 0n)` → `>= 0n` in splitProRata is an equivalent mutant. While pennies remain,
  // some positive weight always has a larger remainder than any zero weight, so the result cannot change.
  ['src/lib/money.ts', "(rem[i] === rem[j] ? i - j :", "(rem[i] === rem[j] ? j - i :", 'ties go to the later row'],
  ['src/lib/money.ts', "return 2n * r >= den ? q + 1n : q\n}", "return q\n}", 'hurdle truncates'],
  ['src/lib/allocation.ts', "mulDivN(v.received - F, 10_000 - p, 10_000, 'floor')", "mulDivN(v.received - F, 10_000 - p, 10_000, 'halfUp')", 'M rounded instead of floored'],
  ['src/lib/allocation.ts', "return commitment < minimum ? 'below-minimum' : null", "return commitment <= minimum ? 'below-minimum' : null", 'minimum becomes strict'],
  ['src/lib/allocation.ts', "        I -= 1\n", "        I -= 2\n", 'refund retry steps 2p'],
  ['src/lib/allocation.ts', "if (exclusion[i]) return // every participant", "if (exclusion[i] || T[i] >= inM[i]) return // every participant", 'scale-back check skips unchanged targets'],
  ['src/lib/allocation.ts', "Object.create(null) // fee ids", "{} // fee ids", 'fee map with prototype'],
  ['src/lib/waterfall.ts', "const roc = Math.min(D, C)", "const roc = Math.min(G, C)", 'capital returned before exit costs'],
  ['src/lib/waterfall.ts', "const Y = mulDivN(hurdlePaid, k, c - k, 'halfUp')", "const Y = mulDivN(hurdlePaid, k, c, 'halfUp')", 'catch-up formula wrong'],
  ['src/lib/waterfall.ts', "if ('h' in c || 'c' in c || 'k' in c)", "if ((c.h ?? 0) !== 0 || (c.c ?? 0) !== 0)", 'tiered accepts h=0 and k'],
  ['src/lib/reconcile.ts', "for (let n = 1; n <= 3 && i + n <= t.length; n++)", "for (let n = 1; n <= 2 && i + n <= t.length; n++)", 'only 1–2 token runs'],
  ['src/lib/reconcile.ts', "!suspectedDuplicate && !staleDecision", "!suspectedDuplicate", 'stale decisions auto-book'],
  ['src/lib/reconcile.ts', ".filter((x) => x.num * 20 >= 6 * x.den)", ".filter((x) => x.num * 20 > 6 * x.den)", 'threshold 0.3 becomes exclusive'],
  ['src/lib/reconcile.ts', "return mode === 'replace' ? {} : pruneDecisions(decisions, lines)", "return pruneDecisions(decisions, lines)", 'replace keeps decisions'],
  ['src/lib/reconcile.ts', "if (line.date > asOf) return", "if (line.date >= asOf) return", 'as-of day treated as future'],
  ['src/lib/reconcile.ts', "aged: d.ageDays > thresholdDays", "aged: d.ageDays >= thresholdDays", 'aged at exactly the threshold'],
  ['src/lib/csv.ts', "return /^[=+\\-@\\t\\r']/.test(v) ? `'${v}` : v", "return /^[=+\\-@']/.test(v) ? `'${v}` : v", 'tab-prefixed formulas not escaped'],
  ['src/lib/csv.ts', "if (r.cells.length !== header.length)", "if (r.cells.length < header.length)", 'extra cells allowed'],
  ['src/lib/exports.ts', "filter((c) => c.status === 'partial' || c.status === 'outstanding')", "filter((c) => c.status !== 'paid')", 'chase list includes overpaid'],
  ['src/lib/allocation.ts', "feeBasis === 'deducted' ? mulDivN(I, rate, 10_000 - p, 'halfUp')", "feeBasis === 'deducted' ? mulDivN(I, 2 * rate, 10_000 - p, 'halfUp')", 'percentage fee doubled (caught by the fee-rate invariant)'],
  ['src/lib/reconcile.ts', "Object.hasOwn(decisions, line.id) ? decisions[line.id] : undefined", "decisions[line.id]", 'decisions read inherited members'],
  ['src/lib/waterfall.ts', "hurdlePaid = P < BigInt(rem) ? toNum(P) : rem", "hurdlePaid = Math.min(rem, toNum(P))", 'hurdle converted before clamping'],
  ['src/lib/csv.ts', "return /^[=+\\-@\\t\\r']/.test(v) ? `'${v}` : v", "return /^[=+\\-@\\t\\r]/.test(v) ? `'${v}` : v", 'literal apostrophe not doubled on export'],
  ['src/lib/reconcile.ts', "return a === b || (A.length === 1 && B[0] === A[0]) || (B.length === 1 && A[0] === B[0])", "return a === b || (a.length === 1 && b[0] === a) || (b.length === 1 && a[0] === b)", 'initials compared by UTF-16 unit'],
  ['src/lib/allocation.ts', "  e.count(input.fees.length, MAX_FEES, 'fees')\n", "", 'fee count limit removed'],
  ['src/lib/reconcile.ts', "  const a = Array.from(x)\n  const b = Array.from(y)", "  const a = x\n  const b = y", 'edit distance by UTF-16 unit'],
  ['src/lib/reconcile.ts', "LIMITS.txnId + 2, true)", "LIMITS.txnId, true)", 'line key limit ignores the t: prefix'],
  ['src/lib/reconcile.ts', "if (!/^[A-Za-z0-9]+(?:[ \\-/_.][A-Za-z0-9]+){0,2}$/.test(ref))", "if (!/^[A-Za-z0-9 \\-/_.]+$/.test(ref))", 'loose investor reference format'],
  ['src/lib/csv.ts', "return [k, ids.has(k) ? trimAscii(v) : v]", "return [k, v.trim()]", 'free text trimmed on import (R3-1)'],
  ['src/lib/csv.ts', "return [k, ids.has(k) ? trimAscii(v) : v]", "return [k, v]", 'identifier fields not trimmed'],
  ['src/lib/csv.ts', "    if (!quoted && ch === '\\r') {", "    if (false) {", 'mixed line endings not normalised (R4-1)'],
  ['src/lib/money.ts', "export const trimAscii = (s: string) => s.replace(/^[ \\t\\r\\n]+|[ \\t\\r\\n]+$/g, '')", "export const trimAscii = (s: string) => s.trim()", 'parsers trim non-ASCII whitespace (R4-2)'],
  ['src/lib/allocation.ts', "'This estimate uses whole shares in the final allocation.", "'This estimate uses whole shares.", 'S/EIS hint wording changed'],
  // ---- M2: state, derive and interface (killed by src/state.test.ts and src/ui.test.tsx) ----
  ['src/state.ts', "return bump(s, { bank, decisions: pruneDecisions(s.decisions, bank) })", "return bump(s, { bank })", 'deleted bank line keeps its decision (R-REC-04.4)'],
  ['src/state.ts', "handoffVersion: s.recVersion,", "handoffVersion: s.recVersion - 1,", 'hand-off recorded against an older version'],
  ['src/state.ts', "return bump(s, { decisions: { ...s.decisions, [a.lineId]: a.decision } })", "return { ...s, decisions: { ...s.decisions, [a.lineId]: a.decision } }", 'a decision does not mark the allocation stale'],
  ['src/state.ts', "{ investors: a.rows, excess: [], handoffVersion: null })", "{ investors: a.rows })", 'direct import keeps the old hand-off link'],
  ['src/state.ts', "return 'asOf' in a.patch || 'currency' in a.patch ? bump(next, {}) : next", "return next", 'as-of date change does not mark the allocation stale'],
  ['src/state.ts', "const decisions: Decisions = Object.create(null)\n  for (const [k, x] of Object.entries(v.decisions))", "const decisions: Decisions = {}\n  for (const [k, x] of Object.entries(v.decisions))", 'saved "__proto__" decision becomes a prototype'],
  ['src/state.ts', "if (f.payer === 'investors' && f.kind === 'fixed') f.kind = 'perInvestor'", "", 'fee kind not corrected when payer changes'],
  ['src/state.ts', "const value = a.field === 'id' ? idOrNew(a.value, 'inv') : a.value", "const value = a.value", 'blank investor ID not regenerated'],
  ['src/derive.ts', "const errors = [...c.errors, ...validateReconcile(input).map(friendly)]", "const errors = [...validateReconcile(input).map(friendly)]", 'unparseable text silently replaced by a placeholder (I-07)'],
  ['src/derive.ts', "return trimAscii(d.minimum) === '' ? 0 :", "return 0; trimAscii(d.minimum) === '' ? 0 :", 'minimum commitment ignored'],
  ['src/components/Allocation.tsx', "disabled={!result || pending || isBlocked || refundsToCheck.length > 0} onClick={copy}", "disabled={!result || pending || refundsToCheck.length > 0} onClick={copy}", 'copy allowed while the close is blocked'],
  ['src/components/Reconciliation.tsx', "disabled={handoffBlock !== null || !result}", "disabled={!result}", 'hand-off allowed with suggestions pending (R-REC-08)'],
  ['src/derive.ts', "const cap = trimAscii(a.cap) === '' ? null :", "const cap = a.cap.trim() === '' ? null :", 'NBSP cap read as "no cap" (I-09)'],
  ['src/App.tsx', "<main key={generation}>", "<main>", 'clear leaves pasted text on screen'],
  // ---- M2 Codex round 1 fixes ----
  ['src/state.ts', "return UPSTREAM_DATA.has(a.type) ? voidChangedDecisions(next) : next", "return next", 'voided decision revives when data is changed back (Codex M2 #1)'],
  ['src/state.ts', "if (field === 'name') return { ...x, name: value }", "", 'rename flags or loses the refund (Codex M2 #2)'],
  ['src/state.ts', "return { ...x, needsCheck: true }", "return x", 'amount edit leaves refund unflagged (Codex M2 #2)'],
  ['src/components/Allocation.tsx', "disabled={!result || pending || isBlocked || refundsToCheck.length > 0} onClick={copy}", "disabled={!result || pending || isBlocked} onClick={copy}", 'copy allowed with a flagged refund'],
  ['src/state.ts', "((x as Record<string, unknown>).amount as number) > 0 &&", "", 'negative saved refund accepted (Codex M2 #5)'],
  ['src/components/common.tsx', "if (alive.current) latestImport.current(content)", "latestImport.current(content)", 'late file read restores data after clear (Codex M2 #3)'],
  ['src/components/common.tsx', "holdBlank && v.trim() === '' ? null : setTimeout(() => commit(v), COMMIT_DELAY_MS)", "null", 'typed value only counts after blur (Codex M2 #4)'],
  ['src/components/common.tsx', "holdBlank && v.trim() === '' ? null :", "false ? null :", 'blank ID regenerated mid-typing'],
  ['src/components/common.tsx', "<ErrorItems errors={errors.slice(50)} />", "", 'errors after the first 50 unreachable (Codex M2 #6)'],
  // ---- M2 Codex round 2 fixes ----
  ['src/components/Allocation.tsx', "disabled={!result || pending || isBlocked || refundsToCheck.length > 0} onClick={copy}", "disabled={!result || isBlocked || refundsToCheck.length > 0} onClick={copy}", 'copy allowed while a typed value is not yet calculated'],
  ['src/components/Reconciliation.tsx', "? 'Finish your edit first.'", "? null", 'hand-off allowed during a pending edit'],
  ['src/state.ts', "if (targetMoved(s, a)) return s", "", 'edit lands on the row that replaced its target (Codex R2 #7)'],
  // Not listed: dropping `[value]` from the Cell timer-cancel effect (common.tsx) is now an equivalent mutant.
  // Every asynchronous list replacement also bumps `tables.*`, which remounts the rows and clears their timers
  // (killed by the round-3 mutant below), and every other value change starts with a click, whose blur commits
  // the draft first. The effect stays as a second guard for any future asynchronous path.
  // ---- M2 Codex round 3 fix ----
  ['src/components/Allocation.tsx', "const listKey = state.tables.investors", "const listKey = 0", 'draft survives a same-amount replacement by another investor (Codex R3 #7)'],
  // ---- M2 Codex round 4 fixes ----
  ['src/components/common.tsx', "if (alive.current) latestImport.current(content)", "if (alive.current) onImport(content)", 'late import merges against stale data (Codex R4 #9)'],
  ['src/state.ts', "tables: a.mode === 'replace' ? renew(s, 'bank') : s.tables,", "tables: renew(s, 'bank'),", 'append resets rows being edited (Codex R4 #9)'],
  ['src/components/Allocation.tsx', "<FeeEditor key={`${state.tables.fees}:${f.id}`}", "<FeeEditor key={`${state.tables.investors}:${f.id}`}", 'investor import resets fee rows (Codex R4 #8)'],
  // ---- M2 Codex round 5 fix ----
  ['src/components/Reconciliation.tsx', "rows: bankMode === 'append' ? [...state.bank, ...added] : added", "rows: r.value.lines.map(bankRow)", 'append re-formats existing rows and resets an edit in progress (Codex R5 #9)'],
  // ---- M3: exit distribution, allocation-to-exit hand-off, guided tour, Clear all data confirmation ----
  ['src/state.ts', "  allocation: { ...s.allocation, ...patch },\n  allocVersion: s.allocVersion + 1,\n", "  allocation: { ...s.allocation, ...patch },\n", 'allocation edits do not mark the exit stale (R-X-07)'],
  ['src/state.ts', "if ('feeBasis' in a.patch || 'minimum' in a.patch || 'currency' in a.patch)", "if ('currency' in a.patch)", 'fee basis / minimum changes do not mark the exit stale'],
  ['src/state.ts', "handoffVersion: s.allocVersion }", "handoffVersion: s.allocVersion - 1 }", 'exit hand-off recorded against an older allocation'],
  ['src/state.ts', "? { mode: 'tiered', carry: '', hurdle: '', catchUp: '',", "? { mode: 'tiered',", 'switching to tiered keeps fixed-mode fields (C-DIS)'],
  ['src/state.ts', "[...t.slice(0, -1), fresh, t[t.length - 1]]", "[...t, fresh]", 'new tier added after the open-ended last one'],
  ['src/derive.ts', "trimAscii(x.exitCosts) === '' ? 0 :", "true ? 0 :", 'exit costs ignored'],
  ['src/derive.ts', "c: pct(x.catchUp, 'Exit, catch-up', true)", "c: pct(x.catchUp, 'Exit, catch-up', true) * 0", 'catch-up ignored'],
  ['src/App.tsx', "allocOutcome?.ok && !blocked(allocOutcome.checks) && allocDerived.input && !pending", "allocOutcome?.ok && allocDerived.input && !pending", 'blocked allocation can be handed off to exit (C-03)'],
  ['src/components/Distribution.tsx', "disabled={!result || pending || isBlocked}", "disabled={!result || pending}", 'distribution exported despite a shortfall (R-DIS-07)'],
  ['src/tour/script.ts', "return l?.status === 'confirmed' && l.assignedTo === investorId", "return l?.status === 'confirmed'", 'tour accepts a line booked to the wrong investor'],
  ['src/tour/script.ts', "if (step.action && !step.action.done(context(s))) s = step.action.perform(s)", "if (false) s = step.action!.perform(s)", 'tour replay skips the actions'],
  ['src/App.tsx', "if (tour?.demoFrom != null && state.allocation.cap === DEMO_CAP_TEXT)", "if (false)", 'tour leaves the demo cap in place'],
  ['src/App.tsx', "onClick={() => setConfirmClear(true)}", "onClick={clearAll}", 'Clear all data without confirmation'],
  // ---- M3 self-test review fixes ----
  ['src/tour/script.ts', "{ ...x.exit, handoffVersion: null },", "", 'typed exit terms not counted as something to lose (review M3 #1)'],
  ['src/tour/script.ts', "c.state.allocation.handoffVersion !== null && c.alloc?.blockers.length) return false", "false) return false", 'resume past the demo on a blocked allocation (review M3 #2)'],
  ['src/App.tsx', "const demoFrom = saved.demoFrom !== null && state.allocation.cap === DEMO_CAP_TEXT ? saved.demoFrom : null", "const demoFrom = null", 'demo cap not put back after a reload (review M3 #2)'],
  ['src/state.ts', "tiers: openEnded(removeAt(s.exit.tiers, a.index))", "tiers: removeAt(s.exit.tiers, a.index)", 'new last tier keeps a hidden ceiling (review M3 #3)'],
  ['src/derive.ts', "upTo100: i === x.tiers.length - 1 || trimAscii(t.upTo) === ''", "upTo100: trimAscii(t.upTo) === ''", 'hidden ceiling on the last tier is parsed'],
  ['src/tour/script.ts', "r && terms && carryIsFullShare(r, terms.k)", "r && terms", 'exit card claims "exactly" whatever the result (review M3 #4)'],
  ['src/components/Distribution.tsx', "disabled={!holdingList || pending}", "disabled={true}", 'holdings export waits for the exit terms (review M3 #6)'],
  // ---- M3 Codex round 1 fixes ----
  ['src/App.tsx', "if (tour && tourIntact(tour.step, state, tour.demoFrom)) beginAt(n)", "if (tour) beginAt(n)", 'chapter jump replaces edits without asking (Codex M3 R1 #1)'],
  ['src/App.tsx', "|| !tourIntact(saved.step, state, demoFrom)", "", 'resume ignores edits to the sample (Codex M3 R1 #3)'],
  ['src/App.tsx', "patch: { cap: tour.demoFrom } })", "patch: { cap: '150000.00' } })", 'demo puts back the sample cap, not the previous one (Codex M3 R1 #2)'],
  ['src/App.tsx', "if (tour) remember(tour.step)", "if (false) remember(tour.step)", 'demo ownership survives Exit tour (Codex M3 R1 #2)'],
  ['src/tour/script.ts', "(lineOf(c, txn)?.status === 'suggested' ? `review-${txn}` : `line-${txn}`)", "`review-${txn}`", 'completed confirmation points at a vanished row (Codex M3 R1 #5)'],
  ['src/tour/script.ts', "if (r && r.returnOfCapital < r.capital)", "if (false)", 'exit card claims capital back on a loss (Codex M3 R1 #4)'],
  ['src/tour/script.ts', "if (r.status === 'overpaid') return", "if (false) return", 'step 6 misdescribes an overpayment (Codex M3 R1 #3)'],
  ['src/tour/script.ts', ".sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))", "", 'tour data check depends on decision order'],
  ['src/components/Distribution.tsx', "const holdingList = deriveHoldings(state).input", "const holdingList = capitals.every((v) => v !== null) ? x.holdings.map((h, i) => ({ id: h.id, name: h.name, capital: capitals[i]! })) : null", 'holdings export skips the full validation (Codex M3 R1 #6)'],
  // ---- M3 Codex round 2 fixes ----
  ['src/App.tsx', "if (tourIntact(STEPS.length, state)) beginAt(0)", "if (true) beginAt(0)", 'Replay discards edits made after the tour (Codex M3 R2 #7)'],
  ['src/tour/script.ts', "? demoFrom : s.allocation.cap", "? SAMPLE_CAP_TEXT : s.allocation.cap", 'demo hides the cap it replaced from the edit check (Codex M3 R2 #8)'],
  ['src/tour/script.ts', "|| (n < STEPS.length && mine === tourData(stateAt(n + 1, s)))", "", 'tour warns about its own completed action'],
  ['src/App.tsx', "replaces={wouldLoseEdits}", "replaces={false}", 'start card never warns'],
  // ---- M3 Codex round 3 fixes ----
  ['src/App.tsx', "if (tour?.demoFrom != null) setTour({ ...tour, demoFrom: null })", "", "person's cap during the demo still treated as the tour's (Codex M3 R3 #9)"],
  ['src/App.tsx', "if (saved?.demoFrom != null) remember(saved.step)", "", 'saved demo ownership survives a person editing the cap (Codex M3 R3 #9)'],
  ['src/App.tsx', "if (nothingToLose(state)) beginAt(0)", "if (true) beginAt(0)", 'first-visit tour button replaces typed data (Codex M3 R3 #10)'],
  // ---- G3 fixes (M-11) ----
  ['src/components/common.tsx', "if (state.resetKey !== resetKey) setState({ resetKey, open: startOpen || keepOpen })", "if (state.resetKey !== resetKey) setState({ resetKey, open: startOpen })", 'import message hidden in a folded section (G3 M-11)'],
  ['src/components/Reconciliation.tsx', "startOpen={state.commitments.length === 0}", "startOpen={false}", 'empty investor list starts folded (G3 M-11)'],
  ['src/components/Reconciliation.tsx', "<Section resetKey={state.tables.commitments} ", "<Section resetKey={0} ", 'a whole new list keeps the old open state (G3 M-11)'],
  ['src/components/common.tsx', "if (state.resetKey !== resetKey) setState({ resetKey, open: startOpen || keepOpen })", "", 'a whole new list keeps the old open state, inside Section (G3 M-11)'],
  ['src/components/Allocation.tsx', "{a.price.trim() === '' && (", "{false && (", 'no starting hint on an empty allocation (G3 M-11)'],
  ['src/components/listMessage.ts', "msg !== null && msg.list === listKey ? msg.value : null", "msg !== null ? msg.value : null", 'an import message outlives its list (G3 acceptance)'],
]

let survived = 0
for (const [file, find, repl, label] of MUTANTS) {
  const orig = readFileSync(file, 'utf8')
  if (!orig.includes(find)) {
    console.log(`MISSING  ${label}: pattern not found in ${file}`)
    survived++
    continue
  }
  writeFileSync(file, orig.replace(find, repl))
  let killed = false
  try {
    execSync('npx vitest run --exclude src/lib/perf.test.ts', { stdio: 'ignore' })
  } catch {
    killed = true
  } finally {
    writeFileSync(file, orig)
  }
  console.log(`${killed ? 'killed  ' : 'SURVIVED'} ${label}`)
  if (!killed) survived++
}
console.log(`${MUTANTS.length - survived}/${MUTANTS.length} mutants killed`)
process.exit(survived ? 1 : 0)
