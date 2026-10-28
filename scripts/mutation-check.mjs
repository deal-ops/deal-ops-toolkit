// Self-test gate (Rules §3, step "测试有效性"): break the code on purpose; a test must fail every time.
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const MUTANTS = [
  ['src/lib/money.ts', 'return 2n * r >= D ? q + 1n : q', 'return 2n * r > D ? q + 1n : q', 'half-up becomes half-down'],
  // Not listed: `if (W[i] > 0n)` → `>= 0n` in splitProRata is an equivalent mutant. While pennies remain,
  // some positive weight always has a larger remainder than any zero weight, so the result cannot change.
  ['src/lib/money.ts', '(rem[i] === rem[j] ? i - j :', '(rem[i] === rem[j] ? j - i :', 'ties go to the later row'],
  ['src/lib/money.ts', 'return 2n * r >= den ? q + 1n : q\n}', 'return q\n}', 'hurdle truncates'],
  [
    'src/lib/allocation.ts',
    "mulDivN(v.received - F, 10_000 - p, 10_000, 'floor')",
    "mulDivN(v.received - F, 10_000 - p, 10_000, 'halfUp')",
    'M rounded instead of floored',
  ],
  [
    'src/lib/allocation.ts',
    "return commitment < minimum ? 'below-minimum' : null",
    "return commitment <= minimum ? 'below-minimum' : null",
    'minimum becomes strict',
  ],
  ['src/lib/allocation.ts', '        I -= 1\n', '        I -= 2\n', 'refund retry steps 2p'],
  [
    'src/lib/allocation.ts',
    'if (exclusion[i]) return // every participant',
    'if (exclusion[i] || T[i] >= inM[i]) return // every participant',
    'scale-back check skips unchanged targets',
  ],
  ['src/lib/allocation.ts', 'Object.create(null) // fee ids', '{} // fee ids', 'fee map with prototype'],
  ['src/lib/waterfall.ts', 'const roc = Math.min(D, C)', 'const roc = Math.min(G, C)', 'capital returned before exit costs'],
  ['src/lib/waterfall.ts', "const Y = mulDivN(hurdlePaid, k, c - k, 'halfUp')", "const Y = mulDivN(hurdlePaid, k, c, 'halfUp')", 'catch-up formula wrong'],
  ['src/lib/waterfall.ts', "if ('h' in c || 'c' in c || 'k' in c)", 'if ((c.h ?? 0) !== 0 || (c.c ?? 0) !== 0)', 'tiered accepts h=0 and k'],
  ['src/lib/reconcile.ts', 'for (let n = 1; n <= 3 && i + n <= t.length; n++)', 'for (let n = 1; n <= 2 && i + n <= t.length; n++)', 'only 1–2 token runs'],
  ['src/lib/reconcile.ts', '!suspectedDuplicate && !staleDecision', '!suspectedDuplicate', 'stale decisions auto-book'],
  ['src/lib/reconcile.ts', '.filter((x) => x.num * 20 >= 6 * x.den)', '.filter((x) => x.num * 20 > 6 * x.den)', 'threshold 0.3 becomes exclusive'],
  [
    'src/lib/reconcile.ts',
    "return mode === 'replace' ? {} : pruneDecisions(decisions, lines)",
    'return pruneDecisions(decisions, lines)',
    'replace keeps decisions',
  ],
  ['src/lib/reconcile.ts', 'if (line.date > asOf) return', 'if (line.date >= asOf) return', 'as-of day treated as future'],
  ['src/lib/reconcile.ts', 'aged: d.ageDays > thresholdDays', 'aged: d.ageDays >= thresholdDays', 'aged at exactly the threshold'],
  ['src/lib/csv.ts', "return /^[=+\\-@\\t\\r']/.test(v) ? `'${v}` : v", "return /^[=+\\-@']/.test(v) ? `'${v}` : v", 'tab-prefixed formulas not escaped'],
  ['src/lib/csv.ts', 'if (r.cells.length !== header.length)', 'if (r.cells.length < header.length)', 'extra cells allowed'],
  [
    'src/lib/exports.ts',
    "filter((c) => c.status === 'partial' || c.status === 'outstanding')",
    "filter((c) => c.status !== 'paid')",
    'chase list includes overpaid',
  ],
  [
    'src/lib/allocation.ts',
    "feeBasis === 'deducted' ? mulDivN(I, rate, 10_000 - p, 'halfUp')",
    "feeBasis === 'deducted' ? mulDivN(I, 2 * rate, 10_000 - p, 'halfUp')",
    'percentage fee doubled (caught by the fee-rate invariant)',
  ],
  ['src/lib/reconcile.ts', 'Object.hasOwn(decisions, line.id) ? decisions[line.id] : undefined', 'decisions[line.id]', 'decisions read inherited members'],
  ['src/lib/waterfall.ts', 'hurdlePaid = P < BigInt(rem) ? toNum(P) : rem', 'hurdlePaid = Math.min(rem, toNum(P))', 'hurdle converted before clamping'],
  [
    'src/lib/csv.ts',
    "return /^[=+\\-@\\t\\r']/.test(v) ? `'${v}` : v",
    "return /^[=+\\-@\\t\\r]/.test(v) ? `'${v}` : v",
    'literal apostrophe not doubled on export',
  ],
  [
    'src/lib/reconcile.ts',
    'return a === b || (A.length === 1 && B[0] === A[0]) || (B.length === 1 && A[0] === B[0])',
    'return a === b || (a.length === 1 && b[0] === a) || (b.length === 1 && a[0] === b)',
    'initials compared by UTF-16 unit',
  ],
  ['src/lib/allocation.ts', "  e.count(input.fees.length, MAX_FEES, 'fees')\n", '', 'fee count limit removed'],
  ['src/lib/reconcile.ts', '  const a = Array.from(x)\n  const b = Array.from(y)', '  const a = x\n  const b = y', 'edit distance by UTF-16 unit'],
  ['src/lib/reconcile.ts', 'LIMITS.txnId + 2, true)', 'LIMITS.txnId, true)', 'line key limit ignores the t: prefix'],
  [
    'src/lib/reconcile.ts',
    'if (!/^[A-Za-z0-9]+(?:[ \\-/_.][A-Za-z0-9]+){0,2}$/.test(ref))',
    'if (!/^[A-Za-z0-9 \\-/_.]+$/.test(ref))',
    'loose investor reference format',
  ],
  ['src/lib/csv.ts', 'return [k, ids.has(k) ? trimAscii(v) : v]', 'return [k, v.trim()]', 'free text trimmed on import (R3-1)'],
  ['src/lib/csv.ts', 'return [k, ids.has(k) ? trimAscii(v) : v]', 'return [k, v]', 'identifier fields not trimmed'],
  ['src/lib/csv.ts', "    if (!quoted && ch === '\\r') {", '    if (false) {', 'mixed line endings not normalised (R4-1)'],
  [
    'src/lib/money.ts',
    "export const trimAscii = (s: string) => s.replace(/^[ \\t\\r\\n]+|[ \\t\\r\\n]+$/g, '')",
    'export const trimAscii = (s: string) => s.trim()',
    'parsers trim non-ASCII whitespace (R4-2)',
  ],
  ['src/lib/allocation.ts', "'This estimate uses whole shares in the final allocation.", "'This estimate uses whole shares.", 'S/EIS hint wording changed'],
  // ---- M2: state, derive and interface (killed by src/state.test.ts and src/ui.test.tsx) ----
  [
    'src/state.ts',
    'return bump(s, { bank, decisions: pruneDecisions(s.decisions, bank) })',
    'return bump(s, { bank })',
    'deleted bank line keeps its decision (R-REC-04.4)',
  ],
  ['src/state.ts', 'handoffVersion: s.recVersion,', 'handoffVersion: s.recVersion - 1,', 'hand-off recorded against an older version'],
  [
    'src/state.ts',
    'return bump(s, { decisions: { ...s.decisions, [a.lineId]: a.decision } })',
    'return { ...s, decisions: { ...s.decisions, [a.lineId]: a.decision } }',
    'a decision does not mark the allocation stale',
  ],
  [
    'src/state.ts',
    '{ investors: a.rows, excess: [], handoffVersion: null, editedSinceHandoff: false })',
    '{ investors: a.rows })',
    'direct import keeps the old hand-off link',
  ],
  [
    'src/state.ts',
    "return 'asOf' in a.patch || 'currency' in a.patch ? bump(next, {}) : next",
    'return next',
    'as-of date change does not mark the allocation stale',
  ],
  [
    'src/state.ts',
    'const decisions: Decisions = Object.create(null)\n  for (const [k, x] of Object.entries(v.decisions))',
    'const decisions: Decisions = {}\n  for (const [k, x] of Object.entries(v.decisions))',
    'saved "__proto__" decision becomes a prototype',
  ],
  ['src/state.ts', "if (f.payer === 'investors' && f.kind === 'fixed') f.kind = 'perInvestor'", '', 'fee kind not corrected when payer changes'],
  ['src/state.ts', "const value = a.field === 'id' ? idOrNew(a.value, 'inv') : a.value", 'const value = a.value', 'blank investor ID not regenerated'],
  [
    'src/derive.ts',
    'const errors = [...c.errors, ...validateReconcile(input).map(friendly)]',
    'const errors = [...validateReconcile(input).map(friendly)]',
    'unparseable text silently replaced by a placeholder (I-07)',
  ],
  ['src/derive.ts', "return trimAscii(d.minimum) === '' ? 0 :", "return 0; trimAscii(d.minimum) === '' ? 0 :", 'minimum commitment ignored'],
  [
    'src/components/Allocation.tsx',
    'disabled={!result || pending || isBlocked || refundsToCheck.length > 0} onClick={copy}',
    'disabled={!result || pending || refundsToCheck.length > 0} onClick={copy}',
    'copy allowed while the close is blocked',
  ],
  [
    'src/components/Reconciliation.tsx',
    'disabled={handoffBlock !== null || !result}',
    'disabled={!result}',
    'hand-off allowed with suggestions pending (R-REC-08)',
  ],
  ['src/derive.ts', "const cap = trimAscii(a.cap) === '' ? null :", "const cap = a.cap.trim() === '' ? null :", 'NBSP cap read as "no cap" (I-09)'],
  ['src/App.tsx', '<main key={generation}>', '<main>', 'clear leaves pasted text on screen'],
  // ---- M2 Codex round 1 fixes ----
  // pattern updated in M5: the void check now also returns what it voided, for the log
  [
    'src/state.ts',
    "UPSTREAM_DATA.has(a.type)\n      ? voidChangedDecisions(applied, a.type === 'editCommitment' && a.field === 'id')\n      : { state: applied, voided: [] }",
    '{ state: applied, voided: [] as Voided[] }',
    'voided decision revives when data is changed back (Codex M2 #1)',
  ],
  ['src/state.ts', "if (field === 'name') return { ...x, name: value }", '', 'rename flags or loses the refund (Codex M2 #2)'],
  ['src/state.ts', 'return { ...x, needsCheck: true }', 'return x', 'amount edit leaves refund unflagged (Codex M2 #2)'],
  [
    'src/components/Allocation.tsx',
    'disabled={!result || pending || isBlocked || refundsToCheck.length > 0} onClick={copy}',
    'disabled={!result || pending || isBlocked} onClick={copy}',
    'copy allowed with a flagged refund',
  ],
  ['src/state.ts', '((x as Record<string, unknown>).amount as number) > 0 &&', '', 'negative saved refund accepted (Codex M2 #5)'],
  [
    'src/components/common.tsx',
    'if (alive.current) latestImport.current(content)',
    'latestImport.current(content)',
    'late file read restores data after clear (Codex M2 #3)',
  ],
  [
    'src/components/common.tsx',
    "holdBlank && v.trim() === '' ? null : setTimeout(() => commit(v), COMMIT_DELAY_MS)",
    'null',
    'typed value only counts after blur (Codex M2 #4)',
  ],
  ['src/components/common.tsx', "holdBlank && v.trim() === '' ? null :", 'false ? null :', 'blank ID regenerated mid-typing'],
  ['src/components/common.tsx', '<ErrorItems errors={errors.slice(50)} />', '', 'errors after the first 50 unreachable (Codex M2 #6)'],
  // ---- M2 Codex round 2 fixes ----
  [
    'src/components/Allocation.tsx',
    'disabled={!result || pending || isBlocked || refundsToCheck.length > 0} onClick={copy}',
    'disabled={!result || isBlocked || refundsToCheck.length > 0} onClick={copy}',
    'copy allowed while a typed value is not yet calculated',
  ],
  ['src/components/Reconciliation.tsx', "? 'Finish your edit first.'", '? null', 'hand-off allowed during a pending edit'],
  ['src/state.ts', 'if (targetMoved(s, a)) return s', '', 'edit lands on the row that replaced its target (Codex R2 #7)'],
  // Not listed: dropping `[value]` from the Cell timer-cancel effect (common.tsx) is now an equivalent mutant.
  // Every asynchronous list replacement also bumps `tables.*`, which remounts the rows and clears their timers
  // (killed by the round-3 mutant below), and every other value change starts with a click, whose blur commits
  // the draft first. The effect stays as a second guard for any future asynchronous path.
  // ---- M2 Codex round 3 fix ----
  [
    'src/components/Allocation.tsx',
    'const listKey = state.tables.investors',
    'const listKey = 0',
    'draft survives a same-amount replacement by another investor (Codex R3 #7)',
  ],
  // ---- M2 Codex round 4 fixes ----
  [
    'src/components/common.tsx',
    'if (alive.current) latestImport.current(content)',
    'if (alive.current) onImport(content)',
    'late import merges against stale data (Codex R4 #9)',
  ],
  ['src/state.ts', "tables: a.mode === 'replace' ? renew(s, 'bank') : s.tables,", "tables: renew(s, 'bank'),", 'append resets rows being edited (Codex R4 #9)'],
  [
    'src/components/Allocation.tsx',
    '<FeeEditor key={`${state.tables.fees}:${f.id}`}',
    '<FeeEditor key={`${state.tables.investors}:${f.id}`}',
    'investor import resets fee rows (Codex R4 #8)',
  ],
  // ---- M2 Codex round 5 fix ----
  [
    'src/components/Reconciliation.tsx',
    "rows: bankMode === 'append' ? [...state.bank, ...added] : added",
    'rows: r.value.lines.map(bankRow)',
    'append re-formats existing rows and resets an edit in progress (Codex R5 #9)',
  ],
  // ---- M3: exit distribution, allocation-to-exit hand-off, guided tour, Clear all data confirmation ----
  [
    'src/state.ts',
    '  allocation: { ...s.allocation, ...patch },\n  allocVersion: s.allocVersion + 1,\n',
    '  allocation: { ...s.allocation, ...patch },\n',
    'allocation edits do not mark the exit stale (R-X-07)',
  ],
  [
    'src/state.ts',
    "if ('feeBasis' in a.patch || 'minimum' in a.patch || 'currency' in a.patch)",
    "if ('currency' in a.patch)",
    'fee basis / minimum changes do not mark the exit stale',
  ],
  ['src/state.ts', 'handoffVersion: s.allocVersion }', 'handoffVersion: s.allocVersion - 1 }', 'exit hand-off recorded against an older allocation'],
  ['src/state.ts', "? { mode: 'tiered', carry: '', hurdle: '', catchUp: '',", "? { mode: 'tiered',", 'switching to tiered keeps fixed-mode fields (C-DIS)'],
  ['src/state.ts', '[...t.slice(0, -1), fresh, t[t.length - 1]]', '[...t, fresh]', 'new tier added after the open-ended last one'],
  ['src/derive.ts', "trimAscii(x.exitCosts) === '' ? 0 :", 'true ? 0 :', 'exit costs ignored'],
  ['src/derive.ts', "c: pct(x.catchUp, 'Exit, catch-up', true)", "c: pct(x.catchUp, 'Exit, catch-up', true) * 0", 'catch-up ignored'],
  [
    'src/App.tsx',
    'allocOutcome?.ok && !blocked(allocOutcome.checks) && allocDerived.input && !pending',
    'allocOutcome?.ok && allocDerived.input && !pending',
    'blocked allocation can be handed off to exit (C-03)',
  ],
  [
    'src/components/Distribution.tsx',
    'disabled={!result || pending || isBlocked}',
    'disabled={!result || pending}',
    'distribution exported despite a shortfall (R-DIS-07)',
  ],
  [
    'src/tour/script.ts',
    "return l?.status === 'confirmed' && l.assignedTo === investorId",
    "return l?.status === 'confirmed'",
    'tour accepts a line booked to the wrong investor',
  ],
  [
    'src/tour/script.ts',
    'if (step.action && !step.action.done(context(s))) s = step.action.perform(s)',
    'if (false) s = step.action!.perform(s)',
    'tour replay skips the actions',
  ],
  ['src/App.tsx', 'if (tour?.demoFrom != null && state.allocation.cap === DEMO_CAP_TEXT)', 'if (false)', 'tour leaves the demo cap in place'],
  ['src/App.tsx', 'onClick={() => setConfirmClear(true)}', 'onClick={clearAll}', 'Clear all data without confirmation'],
  // ---- M3 self-test review fixes ----
  ['src/tour/script.ts', '{ ...x.exit, handoffVersion: null },', '', 'typed exit terms not counted as something to lose (review M3 #1)'],
  [
    'src/tour/script.ts',
    'c.state.allocation.handoffVersion !== null && c.alloc?.blockers.length) return false',
    'false) return false',
    'resume past the demo on a blocked allocation (review M3 #2)',
  ],
  [
    'src/App.tsx',
    'const demoFrom = saved.demoFrom !== null && state.allocation.cap === DEMO_CAP_TEXT ? saved.demoFrom : null',
    'const demoFrom = null',
    'demo cap not put back after a reload (review M3 #2)',
  ],
  [
    'src/state.ts',
    'tiers: openEnded(removeAt(s.exit.tiers, a.index))',
    'tiers: removeAt(s.exit.tiers, a.index)',
    'new last tier keeps a hidden ceiling (review M3 #3)',
  ],
  [
    'src/derive.ts',
    "upTo100: i === x.tiers.length - 1 || trimAscii(t.upTo) === ''",
    "upTo100: trimAscii(t.upTo) === ''",
    'hidden ceiling on the last tier is parsed',
  ],
  ['src/tour/script.ts', 'r && terms && carryIsFullShare(r, terms.k)', 'r && terms', 'exit card claims "exactly" whatever the result (review M3 #4)'],
  ['src/components/Distribution.tsx', 'disabled={!holdingList || pending}', 'disabled={true}', 'holdings export waits for the exit terms (review M3 #6)'],
  // ---- M3 Codex round 1 fixes ----
  [
    'src/App.tsx',
    'if (tour && tourIntact(tour.step, state, tour.demoFrom)) beginAt(n)',
    'if (tour) beginAt(n)',
    'chapter jump replaces edits without asking (Codex M3 R1 #1)',
  ],
  ['src/App.tsx', '|| !tourIntact(saved.step, state, demoFrom)', '', 'resume ignores edits to the sample (Codex M3 R1 #3)'],
  ['src/App.tsx', 'patch: { cap: tour.demoFrom } })', "patch: { cap: '150000.00' } })", 'demo puts back the sample cap, not the previous one (Codex M3 R1 #2)'],
  ['src/App.tsx', 'if (tour) remember(tour.step)', 'if (false) remember(tour.step)', 'demo ownership survives Exit tour (Codex M3 R1 #2)'],
  [
    'src/tour/script.ts',
    "(lineOf(c, txn)?.status === 'suggested' ? `review-${txn}` : `line-${txn}`)",
    '`review-${txn}`',
    'completed confirmation points at a vanished row (Codex M3 R1 #5)',
  ],
  ['src/tour/script.ts', 'if (r && r.returnOfCapital < r.capital)', 'if (false)', 'exit card claims capital back on a loss (Codex M3 R1 #4)'],
  ['src/tour/script.ts', "if (r.status === 'overpaid') return", 'if (false) return', 'step 6 misdescribes an overpayment (Codex M3 R1 #3)'],
  ['src/tour/script.ts', '.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))', '', 'tour data check depends on decision order'],
  [
    'src/components/Distribution.tsx',
    'const holdingList = deriveHoldings(state).input',
    'const holdingList = capitals.every((v) => v !== null) ? x.holdings.map((h, i) => ({ id: h.id, name: h.name, capital: capitals[i]! })) : null',
    'holdings export skips the full validation (Codex M3 R1 #6)',
  ],
  // ---- M3 Codex round 2 fixes ----
  ['src/App.tsx', 'if (tourIntact(STEPS.length, state)) beginAt(0)', 'if (true) beginAt(0)', 'Replay discards edits made after the tour (Codex M3 R2 #7)'],
  [
    'src/tour/script.ts',
    '? demoFrom : s.allocation.cap',
    '? SAMPLE_CAP_TEXT : s.allocation.cap',
    'demo hides the cap it replaced from the edit check (Codex M3 R2 #8)',
  ],
  ['src/tour/script.ts', '|| (n < STEPS.length && mine === tourData(stateAt(n + 1, s)))', '', 'tour warns about its own completed action'],
  ['src/App.tsx', 'replaces={wouldLoseEdits}', 'replaces={false}', 'start card never warns'],
  // ---- M3 Codex round 3 fixes ----
  [
    'src/App.tsx',
    'if (tour?.demoFrom != null) setTour({ ...tour, demoFrom: null })',
    '',
    "person's cap during the demo still treated as the tour's (Codex M3 R3 #9)",
  ],
  ['src/App.tsx', 'if (saved?.demoFrom != null) remember(saved.step)', '', 'saved demo ownership survives a person editing the cap (Codex M3 R3 #9)'],
  ['src/App.tsx', 'if (nothingToLose(state)) beginAt(0)', 'if (true) beginAt(0)', 'first-visit tour button replaces typed data (Codex M3 R3 #10)'],
  // ---- G3 fixes (M-11) ----
  [
    'src/components/common.tsx',
    'if (state.resetKey !== resetKey) setState({ resetKey, open: startOpen || keepOpen })',
    'if (state.resetKey !== resetKey) setState({ resetKey, open: startOpen })',
    'import message hidden in a folded section (G3 M-11)',
  ],
  ['src/components/Reconciliation.tsx', 'startOpen={state.commitments.length === 0}', 'startOpen={false}', 'empty investor list starts folded (G3 M-11)'],
  [
    'src/components/Reconciliation.tsx',
    '<Section resetKey={state.tables.commitments} ',
    '<Section resetKey={0} ',
    'a whole new list keeps the old open state (G3 M-11)',
  ],
  [
    'src/components/common.tsx',
    'if (state.resetKey !== resetKey) setState({ resetKey, open: startOpen || keepOpen })',
    '',
    'a whole new list keeps the old open state, inside Section (G3 M-11)',
  ],
  ['src/components/Allocation.tsx', "{a.price.trim() === '' && (", '{false && (', 'no starting hint on an empty allocation (G3 M-11)'],
  [
    'src/components/listMessage.ts',
    'msg !== null && msg.list === listKey ? msg.value : null',
    'msg !== null ? msg.value : null',
    'an import message outlives its list (G3 acceptance)',
  ],
  // ---- UI polish (owner review 2026-10-20; PRD v0.7.4 decision 9) ----
  ['src/theme.ts', "return v === 'light' || v === 'dark' ? v : 'system'", "return (v as Theme) ?? 'system'", 'any stored text is taken as a theme'],
  [
    'src/theme.ts',
    "if (theme === 'system') storage?.removeItem(THEME_KEY)",
    'if (false) storage?.removeItem(THEME_KEY)',
    'System is stored instead of removed',
  ],
  [
    'src/theme.ts',
    "if (theme === 'system') root.removeAttribute('data-theme')",
    "if (false) root.removeAttribute('data-theme')",
    'System leaves the old theme mark on the page',
  ],
  ['src/App.tsx', "    remember(null)\n    chooseTheme('system')\n", '    remember(null)\n', 'Clear all data keeps the theme choice'],
  ['src/components/common.tsx', 'if (!root.current?.contains(e.target as Node)) setOpen(false)', '', 'a click elsewhere leaves the explanation open'],
  [
    'src/components/common.tsx',
    '        e.stopPropagation() // closes the explanation, not the tour\n        setOpen(false)',
    '        e.stopPropagation() // closes the explanation, not the tour',
    'Esc does not close the explanation',
  ],
  ['src/components/common.tsx', '        e.stopPropagation() // closes the explanation, not the tour\n', '', 'Esc on an explanation also ends the tour'],
  // ---- currency (PRD v0.7.5 decision 10) ----
  ['src/lib/money.ts', "sym === SYMBOL[currency] || (currency === 'USD' && sym === '$')", 'sym === SYMBOL[currency]', 'a bare $ refused in a USD deal'],
  [
    'src/lib/money.ts',
    "sym === SYMBOL[currency] || (currency === 'USD' && sym === '$')",
    "sym === SYMBOL[currency] || sym === '$'",
    'a bare $ accepted in any deal',
  ],
  ['src/lib/money.ts', "Number(m[2].replace(/,/g, '')) * 1_000_000", 'Number(m[2]) * 1_000_000', 'share price commas not removed'],
  ['src/lib/csv.ts', "if (c !== '' && c.toUpperCase() !== currency)", "if (c !== '' && c !== currency)", 'lower-case currency code refused'],
  ['src/lib/csv.ts', "if (c !== '' && c.toUpperCase() !== currency)", 'if (false)', 'a wrong currency column is accepted'],
  ['src/lib/csv.ts', '      currencyCol = idx\n      return\n', '      currencyCol = idx\n', 'the currency column is also listed as ignored'],
  ['src/lib/exports.ts', '    `Currency: ${currency}`,\n', '', 'closing confirmation without the currency code'],
  [
    'src/lib/exports.ts',
    "sharePriceMicros === null ? '' : plainPrice(sharePriceMicros), currency]),",
    "sharePriceMicros === null ? '' : plainPrice(sharePriceMicros), '']),",
    'holdings export without the currency',
  ],
  ['src/components/DealSettings.tsx', 'if (amounts > 0) return setAskCurrency(c)', '', 'currency changes over amounts without asking'],
  ['src/state.ts', '...s.commitments.map((c) => c.cashDue),', '', 'investor amounts not counted before a currency change'],
  // ---- UI polish self-test fixes ----
  [
    'src/components/common.tsx',
    'if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false)',
    '',
    'moving focus away leaves the explanation open (#3)',
  ],
  // Not listed: removing `onClick={(e) => e.preventDefault()}` from the explanation (#4). jsdom does not run a <label>'s
  // activation for clicks on its descendants, so no unit test can see it; the E2E case "E2E-01b a click on the hurdle
  // explanation …" in e2e/m4.spec.ts does, and was checked on 2026-10-20 to fail without the line and pass with it.
  [
    'src/state.ts',
    '    a.excess.length + // over-payments listed for refund at hand-off (UI polish self-test #5)\n',
    '',
    'refunds not counted before a currency change (#5)',
  ],
  ['src/App.tsx', 'if (confirmClear) cancelClearBtn.current?.focus()', 'if (confirmClear) void 0', 'focus left behind when the clear confirmation opens (#2)'],
  // ---- Codex UI polish review ----
  [
    'src/components/common.tsx',
    '    setOpen(!open)\n    // Safari does not focus a clicked button: without this, Esc would reach the tour instead of the explanation (Codex UI polish #1)\n    button.current?.focus()\n',
    '    setOpen(!open)\n',
    'opening an explanation leaves focus outside it (#1)',
  ],
  ['src/components/common.tsx', '      aria-describedby={describedBy}\n', '', 'money fields lose their currency for screen readers (#2)'],
  [
    'src/components/DealSettings.tsx',
    'if (askCurrency) cancelCurrency.current?.focus()',
    'if (askCurrency) void 0',
    'focus left on the select when the currency confirmation opens (#3)',
  ],
  [
    'src/App.tsx',
    'onClick={() => setConfirmClear(true)} disabled={confirmClear}',
    'onClick={() => setConfirmClear(true)}',
    'Clear all data stays active under its own confirmation',
  ],
  // v1.1.1 (PRD v0.7.6 R-X-02): a failed save names the right cause
  [
    'src/state.ts',
    "if (!isQuotaError(e)) return { result: 'blocked', log: null }",
    "return { result: 'blocked', log: null }",
    'full storage reported as blocked',
  ],
  ['src/state.ts', "name === 'QuotaExceededError' || ", '', 'standard quota error not recognised'],
  ['src/state.ts', "name === 'NS_ERROR_DOM_QUOTA_REACHED' || ", '', 'Firefox quota error not recognised'],
  ['src/state.ts', 'code === 22 || ', '', 'legacy quota code 22 not recognised'],
  ['src/state.ts', ' || code === 1014', '', 'legacy quota code 1014 not recognised'],
  ['src/state.ts', "if (typeof e !== 'object' || e === null) return false", 'if (e === null) return false', 'non-object errors inspected'],
  [
    'src/state.ts',
    "  if (!storage) return { result: 'blocked', log: null }\n",
    "  if (!storage) return { result: 'saved', log: null }\n",
    'no storage at all counted as saved (self-test #1)',
  ],
  [
    'src/App.tsx',
    '<div role="status" aria-label="Save status" className="save-status">',
    '<div className="save-status">',
    'save failure not announced (self-test #2)',
  ],
  ['src/App.tsx', "{saveResult === 'full' && (", "{saveResult !== 'saved' && (", 'full-storage message shown for blocked storage'],
  ['src/App.tsx', "{saveResult === 'blocked' && (", "{saveResult !== 'saved' && (", 'blocked-storage message shown for full storage'],
  // ---- M5 (PRD v0.8): messages to investors and the activity log ----
  ['src/lib/messages.ts', 'r.received === 0', 'r.received < 0', 'unpaid investor told they paid £0.00'],
  // pattern updated in M6: the template uses the effective cash due (C-ALL-11)
  ['src/lib/messages.ts', 'so ${a(r.due - r.received)} is still outstanding', 'so ${a(r.received)} is still outstanding', 'outstanding amount wrong'],
  ['src/lib/messages.ts', 'of the ${a(r.due)} due from you', 'of the ${a(r.commitment.cashDue)} due from you', 'chase text uses the list cash due, not the adjusted one'],
  ['src/lib/messages.ts', 'MONTHS[m - 1]', 'MONTHS[m]', 'month name off by one'],
  // PRD v0.8.2: generic MT103 wording
  ['src/lib/messages.ts', 'showing its UETR, and send it to us', 'showing its UETR. A screenshot is not enough, and send it to us', 'platform-specific MT103 wording back in template A'],
  ['src/components/Reconciliation.tsx', 'anyone who has already paid to send the', 'anyone who paid some time ago to send the', 'a waiting period back in the reconciliation hint'],
  ['src/lib/messages.ts', 'on ${longDate(payment.date)} that', 'on ${payment.date} that', 'query date not written out'],
  ['src/lib/exports.ts', '        chaseMessage(dealName, currency, c),\n', "        '',\n", 'chase list CSV without the message'],
  ['src/lib/activity.ts', 'const over = next.entries.length - LOG_CAP', 'const over = next.entries.length - LOG_CAP - 1', 'log holds 5,001 entries'],
  [
    'src/lib/activity.ts',
    'gone.filter((e) => e.seq > log.lastExportedSeq)',
    'gone.filter((e) => e.seq >= log.lastExportedSeq)',
    'last exported entry counted as unexported',
  ],
  ['src/lib/activity.ts', 'nearFull: log.entries.length >= LOG_WARN_AT', 'nearFull: log.entries.length > LOG_WARN_AT', '80% warning one entry late'],
  ['src/lib/activity.ts', 'appendEvents({ ...log, lastExportedSeq: last }', 'appendEvents({ ...log }', 'export not remembered'],
  ['src/lib/activity.ts', 'fromSeq: t ? t.fromSeq : gone[0].seq', 'fromSeq: gone[0].seq', 'truncated range forgets earlier removals'],
  ['src/lib/activity.ts', "const sign = offsetMinutes < 0 ? '-' : '+'", "const sign = '+'", 'negative time-zone offset written as positive'],
  ['src/lib/activity.ts', 'return v.length <= 10 &&', 'return v.length <= 11 &&', 'initials allow 11 characters'],
  ['src/lib/activity.ts', "if (t) rows.push(['', '', '', 'truncated'", "if (false) rows.push(['', '', '', 'truncated'", 'CSV hides removed entries'],
  [
    'src/state.ts',
    '      log = dropOldest(log, TRIM_STEP)\n',
    "      return { result: 'full', log: null }\n",
    'full store not trimmed before giving up (R-X-08.5)',
  ],
  [
    'src/state.ts',
    "return { result: 'saved', log: log === s.log ? null : log }",
    "return { result: 'saved', log: null }",
    'trimmed log not handed back to memory',
  ],
  ['src/App.tsx', '    if (trim) dispatch(trim)\n', '', 'memory keeps entries the save dropped'],
  [
    'src/state.ts',
    "const tourNote = (a: { tour?: boolean }) => (a.tour ? ' · guided tour' : '')",
    "const tourNote = (a: { tour?: boolean }) => (a.tour ? '' : '')",
    "tour's decisions not marked",
  ],
  [
    'src/state.ts',
    "if (a.type === 'importBank' || a.type === 'replaceCommitments' || a.type === 'setDeal') {",
    'if (false) {',
    'a replacing import logs every voided decision',
  ],
  ['src/state.ts', "a.type === 'importBank' && a.mode === 'replace'\n", 'false\n', 'replacing statement voids decisions silently'],
  ['src/state.ts', "gone && d && d.lineFp !== VOID ? [{ lineId: gone.id, reason: 'line deleted', decision: d }] : []", '[]', 'deleted decided line not logged'],
  ['src/state.ts', "const assign = a.via === 'any'", 'const assign = false', 'assign logged as confirm'],
  [
    'src/state.ts',
    'deal: { ...dealText(SAMPLE_SETTINGS), initials: prev.deal.initials },',
    'deal: dealText(SAMPLE_SETTINGS),',
    'loading the sample clears the initials',
  ],
  ['src/state.ts', 'if (withdrawals === null || feePayerChanges === null) return null', '', 'damaged money fields read anyway (Codex v0.8 #4)'],
  ['src/state.ts', 'nextSeq: Math.min(top + 1, Number.MAX_SAFE_INTEGER),', 'nextSeq: 1,', 'damaged log restarts the numbering'],
  ['src/state.ts', 'editedSinceHandoff: old ? true :', 'editedSinceHandoff: old ? false :', 'old save allows a fee payer change without a new hand-off'],
  ['src/state.ts', '    } catch {\n      return next\n    }', '    } catch (e) {\n      throw e\n    }', 'a log failure stops the action'],
  ['src/state.ts', "initials: parseInitials(next.deal.initials) ?? ''", 'initials: next.deal.initials', 'invalid initials written to the log'],
  ['src/state.ts', '.filter((id) => !before.has(id)).length} auto-booked', '.length} auto-booked', 'investor import counts receipts booked before it'],
  ['src/tour/script.ts', 'const copy = chase ?', 'const copy = true ?', 'step 6 points at Copy message when nobody is chased'],
  [
    'src/tour/script.ts',
    "let s: AppState = { ...reducer(base, { type: 'loadSample' }), disclaimerAccepted: true }",
    'let s: AppState = { ...sampleState(base), disclaimerAccepted: true }',
    'tour replay does not restart the log',
  ],
  ['src/tour/script.ts', "{ ...x.deal, initials: '' },", 'x.deal,', 'initials count as a change to the sample'],
  [
    'src/tour/script.ts',
    "c.rec?.lines.find((l) => l.status === 'confirmed')",
    "c.rec?.lines.find((l) => l.status === 'auto')",
    'Try next points at a line with no Undo',
  ],
  ['src/components/CopyMessage.tsx', '      state.report(true)\n', '', 'manual copy not logged'],
  ['src/components/CopyMessage.tsx', '      box.current.focus({ preventScroll: true })\n', '', 'manual-copy text not focused'],
  [
    'src/components/Reconciliation.tsx',
    "{(c.status === 'partial' || c.status === 'outstanding') && (",
    "{c.status !== 'paid' && (",
    'overpaid investor offered a chase message',
  ],
  ['src/App.tsx', '{logInfo.removedUnexported > 0 ? (', '{false ? (', 'removed-before-export count not shown'],
  // M5 self-test fixes
  [
    'src/state.ts',
    "reason = row || idEdited ? 'investor changed' : 'investor deleted'",
    "reason = row ? 'investor changed' : 'investor deleted'",
    'an edited investor ID logged as a deletion (self-test #2)',
  ],
  [
    'src/state.ts',
    "detail: `${void_ ? 'old decision cleared · ' : ''}${was} → ${after}${tourNote(a)}`",
    'detail: `${was} → back to review${tourNote(a)}`',
    'clearing a void decision logged as an undo (self-test #1)',
  ],
  ['src/state.ts', 'next > trunc.toSeq', 'true', 'removed seq numbers reused (self-test #3)'],
  [
    'src/state.ts',
    'next === null ? 0 : next - 1, tt ?? 0, tf ?? 0, count, maxSeq',
    'tt ?? 0, tf ?? 0, count, maxSeq',
    'damaged log forgets the saved numbering (self-test #3)',
  ],
  ['src/state.ts', 'targets: Object.assign(Object.create(null), c.targets)', 'targets: c.targets', 'saved targets keep a prototype (self-test #4)'],
  ['src/state.ts', '!arrOf(st.fees, feeOk)', '!Array.isArray(st.fees)', 'saved fee list not checked (self-test #4)'],
  // M5 Codex round 1 fixes
  ['src/state.ts', 'const lastSeq = allOk && entries.length ?', 'const lastSeq = entries.length ?', 'a null log entry throws and loses the deal (Codex M5 #1)'],
  [
    'src/state.ts',
    'next === null ? 0 : next - 1, tt ?? 0, tf ?? 0, count, maxSeq',
    'next === null ? 0 : next - 1, tt ?? 0, tf ?? 0, maxSeq',
    'recovered log rejected again on reload (Codex M5 #2)',
  ],
  ['src/components/ActivityLog.tsx', '{log.truncated && (', '{false && (', 'truncated line hidden (Codex M5 #4)'],
  // M5 Codex round 2 fixes
  ['src/components/CopyMessage.tsx', '      report(false)\n', '', 'successful copy not logged'],
  [
    'src/state.ts',
    "const oneOf = (v: unknown, list: readonly string[]) => typeof v === 'string' && list.includes(v)",
    'const oneOf = (v: unknown, list: readonly string[]) => list.includes(String(v))',
    'saved enums coerced (Codex M5 r2 #3)',
  ],
  [
    'src/state.ts',
    'return at === -1 ? now : dropOldest(now, at + 1)',
    'return at === -1 ? now : dropOldest(now, now.entries.length)',
    'trim acknowledgement drops newer entries (Codex M5 r2 #4)',
  ],
  // M5 Codex round 3 fixes
  [
    'src/tour/anchor.ts',
    "for (const el of document.querySelectorAll<HTMLElement>('[data-tour]')) if (el.dataset.tour === anchor) return el\n  return null",
    'return document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)',
    'tour anchor put into a CSS selector (Codex M5 r3 #1)',
  ],
  ['src/state.ts', '    exported < next &&\n', '', 'export mark ahead of the log trusted (Codex M5 r3 #4)'],
  ['src/state.ts', 'tu <= tc ? tu : (tc ?? 0)', 'tu <= tc ? tu : 0', 'damaged unexported count taken as none (Codex M5 r3 #3)'],
  [
    'src/state.ts',
    'next === null ? 0 : next - 1, tt ?? 0, tf ?? 0, count, maxSeq',
    'next === null ? 0 : next - 1, tf ?? 0, count, maxSeq',
    'removed range forgotten when one field is damaged (Codex M5 r3 #3)',
  ],
  ['src/lib/activity.ts', ' || log.nextSeq + events.length >= Number.MAX_SAFE_INTEGER', '', 'sequence numbers near the float limit accepted (Codex M5 r3 #5)'],
  // M5 Codex round 5 fixes
  [
    'src/state.ts',
    'const d = gone && Object.hasOwn(prev.decisions, gone.id) ? prev.decisions[gone.id] : undefined',
    'const d = gone ? prev.decisions[gone.id] : undefined',
    'inherited value read as a decision on delete (Codex M5 r5 #1)',
  ],
  ['src/state.ts', 'tt ?? 0, tf ?? 0, count, maxSeq', 'tt ?? 0, count, maxSeq', 'readable fromSeq ignored in recovery (Codex M5 r5 #2)'],
  // M5 Codex round 4 (redesign: trim by the last dropped entry, copy gate in App, no artificial seq ceiling)
  [
    'src/components/Reconciliation.tsx',
    'if (copyGate.current === gen) dispatch(',
    'if (true) dispatch(',
    'copy logged after the data was cleared (Codex M5 r2 #1, r4 #2)',
  ],
  // ---- M6 (PRD v0.8): withdrawal before closing and changing who pays a fee ----
  [
    'src/lib/reconcile.ts',
    '(withdrawnOn(c.commitment) !== null ? c.received : Math.max(0, c.received - due(c.commitment)))',
    'Math.max(0, c.received - due(c.commitment))',
    'refunds-tie leaves out withdrawn investors',
  ],
  ['src/lib/reconcile.ts', "on !== null ? 'withdrawn' : received === 0", "received === 0", 'withdrawn investor keeps a payment status'],
  ['src/lib/reconcile.ts', 'const refund = on !== null ? received : Math.max(0, difference)', 'const refund = Math.max(0, difference)', 'withdrawn investor not refunded in full'],
  ['src/lib/reconcile.ts', 'cashDue: sum(commitments.filter((c) => withdrawnOn(c) === null).map(due)),', 'cashDue: sum(commitments.map(due)),', 'receivable counts withdrawn investors'],
  ['src/lib/reconcile.ts', '.filter((c) => c.withdrawnOn === null)', '.filter(() => true)', 'withdrawn investor handed off'],
  ['src/lib/reconcile.ts', 'if (r.notCovered.length > 0) return', 'if (false) return', 'hand-off allowed with investors not covered'],
  ['src/lib/reconcile.ts', 'if (d.line.amount === due(c) ||', 'if (d.line.amount === c.cashDue ||', 'candidate amount match uses the list cash due'],
  ['src/lib/reconcile.ts', 'const difference = received - due(c)', 'const difference = received - c.cashDue', 'status uses the list cash due'],
  ['src/lib/feePayer.ts', "mulDivN(T, 10_000, 10_000 - p, 'ceil')", "mulDivN(T, 10_000, 10_000 - p, 'floor')", 'lower bound floored (deducted)'],
  ['src/lib/feePayer.ts', "mulDivN(T, 10_000 + p, 10_000, 'ceil')", "mulDivN(T, 10_000 + p, 10_000, 'floor')", 'lower bound floored (on top)'],
  // Not listed: starting the search one penny below the bound is equivalent — below R_lo, M < T, so I < T (PRD C-ALL-10 step 2)
  ['src/lib/feePayer.ts', 'const hi = lo + Math.ceil(pct.length / 2)', 'const hi = lo', 'search window shrunk to the bound'],
  ['src/lib/feePayer.ts', 'if (I >= T) return I === T ?', 'if (I >= T - 1) return I === T ?', 'search stops a penny short'],
  ['src/lib/feePayer.ts', 'if (r1.scaledBack) blockers.push', 'if (false) blockers.push', 'over-cap commitment allocation not blocked'],
  ['src/lib/feePayer.ts', "if (row.participating) blockers.push({ code: 'would-join'", "if (false) blockers.push({ code: 'would-join'", 'joining investor not blocked'],
  ['src/lib/feePayer.ts', '} else if (row.invested !== T) {', '} else if (false) {', 'investment below T_i not blocked'],
  ['src/lib/feePayer.ts', "row.exclusion === 'below-minimum'\n", "row.exclusion === 'no-funds'\n", 'below-minimum reason lost'],
  ['src/lib/feePayer.ts', 'if (after.length) return', 'if (false) return', "Fees' not validated"],
  ['src/lib/adjust.ts', 'line.baseCashDue === listCashDue && ', '', 'effective due ignores a changed list amount'],
  ['src/lib/adjust.ts', ' && line.reference === normRef(listReference)', '', 'effective due ignores a changed reference'],
  // retired in M6 round 10: notCovered now asks effectiveDue only, which already refuses a voided line (the separate filter
  // was redundant, so its mutant was equivalent); the voided case is still killed through effectiveDue below
  ['src/lib/adjust.ts', 'if (line && !line.voided && line.baseCashDue', 'if (line && line.baseCashDue', 'voided line still counts as covered'],
  // pattern updated in round 6: notCovered takes the investors themselves
  ['src/lib/adjust.ts', '!Object.hasOwn(withdrawals, v.id) && ', '', 'withdrawn investor flagged as not covered'],
  ['src/state.ts', 'if (l.voided) return l', 'if (l.voided) return { ...l, voided: false, voidReason: null }', 'voided adjustment revives when changed back'],
  [
    'src/state.ts',
    'return alloc(bump(s, { feePayerChanges: [...s.feePayerChanges, change] }), { fees })',
    'return alloc({ ...s, feePayerChanges: [...s.feePayerChanges, change] }, { fees })',
    'applying a fee payer change does not make the allocation stale',
  ],
  ['src/state.ts', '(needsConsent(a.to) && a.consent !== true)', 'false', 'applied without consent'],
  ['src/state.ts', 'if (!o.ok || !o.result.canApply) return s', 'if (!o.ok) return s', 'blocked change applied'],
  ['src/state.ts', 'if (!canReverse(s, a.changeId)) return s', 'if (!canReverse(s, a.changeId) || feePayerChangeBlock(s) !== null) return s', 'reverse needs a fresh hand-off (Codex v0.8 #1)'],
  ['src/state.ts', ': s.deal.feeBasis !== c.feeAtApply.basis', ': false', 'fee basis change does not void the change'],
  ['src/state.ts', '!rate?.ok || rate.value !== c.feeAtApply.rateBps', 'f.value !== String(c.feeAtApply.rateBps / 100)', 'rate compared as text, not by value'],
  ['src/state.ts', 'normRef(people.get(id)!.reference) !== w.reference', 'people.get(id)!.reference !== w.reference', 'withdrawal voided by a reformatted reference'],
  ['src/state.ts', 'if (a.consent !== true || ', 'if (', 'withdrawal marked without consent'],
  ['src/state.ts', '      return bump(s, { withdrawals })\n', '      return { ...s, withdrawals }\n', 'withdrawal does not make the allocation stale'],
  ['src/state.ts', "const fee = FEE_DATA.has(a.type) ? voidChangedFeeChange(marked.state)", "const fee = false ? voidChangedFeeChange(marked.state)", 'fee edits never void the change'],
  ['src/derive.ts', 'if (e.due !== x.cashDue) due[x.id] = e.due', '', 'adjusted cash due not passed to reconciliation'],
  ['src/derive.ts', 'if (Object.hasOwn(withdrawals, x.id)) withdrawn[x.id] = withdrawals[x.id].on', '', 'withdrawals not passed to reconciliation'],
  ['src/lib/exports.ts', "l.assignedTo ? (withdrawnOn.get(l.assignedTo) ?? '') : ''", "''", 'ledger without withdrawn_on'],
  ['src/lib/exports.ts', '        plainMoney(c.due),\n', '        plainMoney(c.commitment.cashDue),\n', 'chase list committed is the list cash due'],
  ['src/lib/exports.ts', "const over = excess.filter((x) => x.reason !== 'Withdrawn')", 'const over = excess', 'withdrawn refund listed as an over-payment'],
  ['src/components/Reconciliation.tsx', ': result && result.notCovered.length > 0', ': false && result.notCovered.length > 0', 'hand-off button not held for investors not covered'],
  ['src/tour/script.ts', 'if (!lowered.ok || !lowered.result.canApply) return null', 'if (!lowered.ok) return null', 'Try next item 2 offered when lowering the minimum still fails'],
  ['src/tour/script.ts', 'lucas && lucas.withdrawnOn === null && lucas.received > 0', 'lucas && lucas.received > 0', 'Try next item 1 offered after Lucas withdrew'],
  // M6 self-test review fixes
  ['src/components/Reconciliation.tsx', '    refocus.current = withdrawing\n', '', 'focus lost when the withdraw form closes (self-test B#1)'],
  ['src/components/Reconciliation.tsx', '    box.current?.focus({ preventScroll: true })\n', '', 'withdraw form opens without focus (self-test B#1, B#2)'],
  ['src/components/FeeChange.tsx', "                    moveFocus.current = 'reverse'\n", '', 'focus lost after Apply (self-test B#1)'],
  ['src/components/FeeChange.tsx', "onReversed={() => (moveFocus.current = 'heading')}", 'onReversed={() => undefined}', 'focus lost after Reverse (self-test B#1)'],
  ['src/tour/script.ts', ' || s.allocation.editedSinceHandoff) return null', ') return null', 'Try next item 2 offered after the investor table was edited'],
  // M6 Codex round 1
  ['src/components/FeeChange.tsx', 'consentKey !== null && consentFor === consentKey', 'consentFor !== null', 'consent carries over to another payer (Codex M6 #1)'],
  ['src/components/FeeChange.tsx', '<div role="status" aria-label="Fee payer change re-check">', '<div aria-label="Fee payer change re-check">', 're-check not announced (Codex M6 #2)'],
  // M6 Codex round 2. Not listed: the end card moving to the top when it covers a target needs real layout (jsdom has
  // no boxes); E2E-05 "end card Try next" checks it at the default size and at 375px.
  ['src/App.tsx', "(el?.hasAttribute('tabindex') ? el : null)", 'null', 'Try next item 2 focuses nothing on an unavailable panel (Codex M6 r2 #1)'],
  // M6 Codex round 3
  ['src/derive.ts', 'change.to, (id) => lines.has(id))', 'change.to)', 're-check limited to the allocation table (Codex M6 r3 #1)'],
  // M6 Codex round 4
  ['src/state.ts', '(a.name !== undefined && a.name !== row.name) || ', '', 'withdrawal consent accepted for a different name (Codex M6 r4 #1)'],
  ['src/state.ts', ' || (a.reference !== undefined && normRef(a.reference) !== normRef(row.reference))) return s', ') return s', 'withdrawal consent accepted for a different reference (Codex M6 r4 #1)'],
  ['src/components/Reconciliation.tsx', 'const withdrawing = open?.gen === gen ? open.id : null', 'const withdrawing = open?.id ?? null', 'withdraw form survives a replaced list (Codex M6 r4 #1)'],
  ['src/components/Reconciliation.tsx', '    setConsent(false)\n    setProblem(', '    setProblem(', 'tick kept after a rename (Codex M6 r4 #1)'],
  // M6 Codex round 5
  ['src/state.ts', "    if (field === 'id' && x.id === value && x.id !== id) return { ...x, needsCheck: true }\n", '', 'a row taking a refunded investor’s ID leaves the refund unflagged (Codex M6 r5 #1)'],
  ['src/state.ts', 'x.id === a.changeId && x.status === \'active\')!', 'x.id === a.changeId)!', 'Reverse picks a historical record (Codex M6 r5 #2)'],
  ['src/state.ts', '  if (new Set(x.map((c) => (c as FeePayerChange).id)).size !== x.length) return null\n', '', 'saved changes with the same ID accepted (Codex M6 r5 #2)'],
  // M6 Codex round 6 and decision 12
  ['src/state.ts', "    if ((count.get(id) ?? 0) > 1) return 'ID duplicated'\n", '', 'a duplicate investor ID stands in for the original (Codex M6 r6 #1)'],
  ['src/state.ts', 'const f = same.length === 1 ? same[0] : undefined', 'const f = same[0]', 'a duplicate fee hides the applied one (Codex M6 r6 #2)'],
  ['src/state.ts', 'needsConsent(c.to) && c.consent !== true', 'false', 'a saved change without the consent it needs stays active (Codex M6 r6 #2)'],
  // pattern updated in round 7
  ['src/state.ts', '  const marks = voidChangedMarks(loaded, loaded, false)\n', '  const marks = { state: loaded, voided: [] }\n', 'saved records that no longer fit are trusted (Codex M6 r6 #2 #3)'],
  ['src/state.ts', 'marks.voided.length ? bump(marks.state, {}) : marks.state', 'marks.state', 'a void found on load leaves the allocation current (Codex M6 r7 #1)'],
  // M6 Codex round 8
  ['src/components/Reconciliation.tsx', '<div role="status" aria-label="Fee payer change coverage">', '<div aria-label="Fee payer change coverage">', 'investors not covered are not announced (Codex M6 r8 #1)'],
  // M6 Codex round 9
  ['src/components/Reconciliation.tsx', '.filter((l) => l.voided && byId.has(l.investorId))', '.filter(() => false)', 'voided lines of withdrawn investors not announced (Codex M6 r9 #1)'],
  ['src/components/FeeChange.tsx', '<div role="status" aria-label="Fee payer change status">', '<div aria-label="Fee payer change status">', 'whole-change void not announced (Codex M6 r9 #2)'],
  ['src/lib/adjust.ts', 'effectiveDue(change, v.id, v.cashDue, v.reference).line === null)', 'false)', 'coverage and effective due disagree (Codex M6 r6 #3)'],
  ['src/derive.ts', ' && withdrawalStands(saved[x.id], x.reference)', '', 'a withdrawal counts after its reference changed (Codex M6 r6 #3)'],
  ['src/state.ts', ' && currencyLocked(s)) return s', ' && false) return s', 'currency changes while a fee payer change is active (decision 12)'],
]

// Small-fix track (Rules G2 step 0): `--files a.ts,b.tsx` runs only the mutants in those files; the full run is due before release (G3)
const filesArg =
  process.argv.find((a) => a.startsWith('--files='))?.slice('--files='.length) ??
  (process.argv.includes('--files') ? process.argv[process.argv.indexOf('--files') + 1] : null)
const only = filesArg
  ? new Set(
      filesArg
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
    )
  : null
const RUN = only ? MUTANTS.filter(([file]) => only.has(file)) : MUTANTS
if (only && RUN.length === 0) {
  console.log(`no mutants in ${[...only].join(', ')}`)
  process.exit(1)
}

let survived = 0
for (const [file, find, repl, label] of RUN) {
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
console.log(`${RUN.length - survived}/${RUN.length} mutants killed${only ? ` (only ${[...only].join(', ')}; full run: ${MUTANTS.length})` : ''}`)
process.exit(survived ? 1 : 0)
