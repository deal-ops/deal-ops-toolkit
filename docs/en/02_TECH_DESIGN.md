English snapshot of docs/02_TECH_DESIGN.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20, updated at v1.1.0 on 2026-10-21, updated for v0.8 on 2026-10-25.

# Deal Ops Toolkit — Technical design

Version **v0.8** (drafted 2026-10-23; passed 3 rounds of Codex review; approved by the owner 2026-10-25) · Previous approved version v0.7.1 (2026-10-20) · 2026-10-17 · Based on: `docs/en/01_PRD.md` v0.8 (decision 11)

- v0.1 → v0.2: changed in response to Codex review items #4 #6 #8 #15 #18 #19 #20.
- v0.2 → v0.3: changed in response to round-two items R2-02 R2-06 R2-10 (result type categories, holding units, running tests by milestone).
- v0.7 → v0.7.1 (2026-10-20, clarified against the code after release; no rule changed): no floating-point exception for the hurdle (as in PRD C-01), and the matching risk removed; the engine interface written as in `src/lib/outcome.ts`.
- v0.7.1 → v0.8 (2026-10-23, approved 2026-10-25): new §9 "v0.8 design": data structures, pure-function placement, log writing, storage-full handling, snapshot versions, exports, test hooks (M5 / M6) and risks for chase and query messages, the activity log, withdrawal before closing and fee payer change before closing; one sentence added to each of §1, §2, §5, §7. No existing calculation rule changes.

---

## 1. Key decisions

| Decision | Choice | Reason | Rejected option |
|---|---|---|---|
| Backend | **None**; a pure front-end static site | Deal data does not need to leave the browser. With no server there is no server-side storage and no account problem. Note: the host still receives ordinary page requests (the wording of PRD R-X-02 is based on this) | A backend with a database |
| Framework | React 19 + TypeScript (strict mode) + Vite | Mainstream, fast builds, native Vercel support | Next.js (no server-side need) |
| Calculation engine | Pure functions in `src/lib/`, no React dependency; each entry point validates its own input | Can be tested on its own; a UI error cannot make the engine produce a wrong result | Calculations inside components |
| Exact arithmetic | Money, basis points, share prices and multiples are all integers; **all intermediate multiplication and division uses BigInt**, always through `mulDiv(a, b, d, rounding)` in `money.ts`; before converting back to Number, check the value is within the safe integer range | PRD C-01; the v0.1 spike was 1 penny out on large amounts (Codex #8) | Floating point; decimal.js |
| Hurdle compounding is exact too | Hurdle compounding `(1+h)^n` also uses BigInt: rational arithmetic for whole years, a high-precision integer root for fractional years, rounded half-up to pence once at the end | PRD C-01 (v0.7.2 removed the floating-point exception); separate tests | Floating point |
| Result type | Every engine returns `{ ok: true, result, checks } \| { ok: false, errors, internal? }` | PRD C-03: invalid input gives no result, so a check can never be mistaken for a pass | Throwing exceptions; returning partial results |
| CSV | papaparse; **parse errors are not dropped**, they are reported with row number and column name; imports are atomic | Codex #14 | Writing our own parser |
| Data between modules | **Snapshot model**: "Hand off" copies the data and records the source version number; after an upstream change, the downstream module compares version numbers and shows "out of date" | PRD R-X-07; Codex #15 | Live linking |
| Local storage | localStorage, key `deal-ops-toolkit:v1`; reads and writes wrapped in try/catch; the structure carries a schema version. The theme choice is stored on its own under key `deal-ops-toolkit:theme` (`light` / `dark`; nothing stored when following the device) and applied through `<html data-theme>`, not inline styles. v0.8: schema version 2; the activity log is stored in the same key as the deal data; when storage is full, the oldest entries are removed first and the save is retried (§9.3) | Keeps working normally when storage fails in private browsing | IndexedDB |
| Tests | Vitest (unit + invariants); independent Python recalculation (standard library `fractions`/`decimal` only); Playwright (added when the first UI path appears, i.e. M2) | See the test plan | Jest |
| UI unit tests (new dependency in M2) | `@testing-library/react` + `@testing-library/dom` + `jsdom`; test files declare `@vitest-environment jsdom` at the top | User-action cases (TC-IO-20, TC-DEAL-02, TC-ALL-24, TC-X-01/02) run directly in Vitest and count towards the TC coverage check; development dependency only, not shipped in the page | Putting everything in Playwright (slow, and not in the TC coverage report) |
| End-to-end (new dependency in M2) | `@playwright/test`, Chromium only; runs against the **production build**; `vite preview` reads `vercel.json` and adds the same security response headers, so a CSP violation fails the test; `scripts/check-e2e.mjs` reads the report and checks that every due E2E case ran and passed | Test plan §4 | Cypress |
| Hosting | Private GitHub repository + Vercel. **Vercel production is bound to the `release` branch**; `main` and PR branches only get preview links | Merging to main does not go live directly; it goes live only when main is merged into release after G3 passes (Codex #20) | main deploys to production automatically |
| CI | GitHub Actions: type check → lint → unit tests → Python recalculation → build; Playwright added from M2. The coverage check reads the test runner's JSON report and checks that every "due case ID" was **actually run and passed** (not a string search in the source); each case's due milestone is marked in the test plan, and the current milestone is recorded in `docs/milestone.txt` | — | — |

## 2. Structure

```
src/
  lib/                 calculation engine (pure functions, no UI dependency)
    money.ts           parsing (I-01~06), formatting, mulDiv (BigInt + specified rounding), largest remainder method
    validate.ts        single implementation of input rules I-01~I-09, returns errors with locations
    reconcile.ts       reconciliation ← PRD 4.1 / C-REC
    allocation.ts      closing allocation ← PRD 4.2 / C-ALL
    waterfall.ts       exit distribution ← PRD 4.3 / C-DIS
    csv.ts             import (header synonyms, atomic), export (formula-injection safe)
    sample.ts          fictional sample deal
    messages.ts        (v0.8) messages to investors ← C-REC-8
    adjust.ts          (v0.8) withdrawal marks, effective cash due, fee payer change records ← C-REC-7, C-ALL-11
    feePayer.ts        (v0.8) fee payer change preview ← C-ALL-10
    activity.ts        (v0.8) activity log: append, numbering, drop oldest, export ← C-X-1
    *.test.ts
  state.ts             UI state (user input stored as text), snapshots and version numbers, local saving
  derive.ts            text → engine input; collects error locations
  components/          three module screens, deal settings, tour, shared components
scripts/
  oracle/              independent Python recalculation (does not reuse TS code) + comparison script
e2e/                   Playwright (from M2)
docs/
```

Data flow:

```
User input (text) → state → derive (parse + locate errors) → engine (validate → calculate → self-check) → UI
                                                    ok:false → show errors only, no results and no export
Reconciliation result ─"Hand off to allocation" (snapshot v)→ allocation input ─"Hand off to exit" (snapshot v)→ exit distribution
```

## 3. Engine interface

```ts
type CheckKind = 'invariant' | 'blocker' | 'review' | 'warning'   // the other four kinds of PRD C-03; input errors are kept apart in errors
type Outcome<T> =
  | { ok: true; result: T; checks: Check[] }                     // may contain blocker / review / warning
  | { ok: false; errors: InputError[]; internal?: Check[] }      // input errors; internal non-empty = an arithmetic self-check failed (implementation bug)
reconcile(input: ReconcileInput): Outcome<ReconcileResult>
allocate(input: AllocationInput): Outcome<AllocationResult>     // non-empty blockers = cannot close (PRD R-ALL-08)
distribute(input: WaterfallInput): Outcome<WaterfallResult>     // exit costs above proceeds = blocker
```

- The engine first runs input validation (failure → `errors`), then calculates, then runs the arithmetic checks (failure → `ok: false`, with one message in `errors` and the failed checks in `internal`; the UI asks the user to report it). The other three categories are returned with the result, and the UI uses the table in PRD C-03 to decide whether export / hand-off is allowed.
- The holdings table (HoldingsTable) carries `sharePriceMicros: number | null` (saved at snapshot time; on import it comes from the `share_price` column, which may be empty) and a per-row `capital` (capital, in pence). The exit distribution splits by `capital` (PRD C-DIS-7); an edit changes only the edited row. Display share counts are calculated and truncated in the UI layer only.
- `fixtures/`: one sample CSV for each import file type (PRD §5.5), which is also the input for the import tests.

## 4. Security and privacy

- No third-party script that sends network requests; no analytics in v1.
- `vercel.json` security response headers:
  - `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; manifest-src 'self'`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera, microphone, geolocation and similar turned off)
  - Fonts are self-hosted; no Google Fonts.
- Deal data exists only in memory and localStorage, and is never written into the URL (no data in query or hash).
- The smoke test uses Playwright to record **all** requests (including same-origin): only GET requests for static assets are allowed, with an empty body and no deal data in the URL.
- No secrets in the repository; all sample data is fictional.

## 5. Capacity and performance

- v1 limits: 500 investors, 2,000 bank lines (PRD I-08).
- Reconciliation algorithm: normalise in advance and build a "reference → investor" index, so an exact match is a lookup; candidate scoring runs only on lines without an exact match; received amounts are totalled in a single pass.
- Targets at the limit size: reconciliation < 200ms, allocation < 50ms, exit < 10ms (Chrome stable, Apple Silicon Mac); recalculate after a 300ms debounce when input changes. M1 adds a benchmark script and records the results.
- v0.8: the fee payer change preview < 100ms at the limit size (§9.2.3); the local storage size estimate is in §9.6.

## 6. Deployment and versions

- `main`: the development line; every merged PR gets a preview; it does not go live directly.
- `release`: Vercel production. After G3 passes, the owner merges `main` into `release`.
- A private repository on the free plan cannot enforce branch protection, so process discipline and CI status do the gatekeeping; the owner merges himself (see rule G2).
- Tags: M2 `v0.1.0`, M3 `v0.2.0`, M4 `v1.0.0`.

## 7. Known risks

| Risk | Response |
|---|---|
| The calculation basis differs from the contract basis of a particular deal | The basis is written in PRD §5 and shown in the UI; two fee bases to choose from; the holding structure is fixed as an SPV nominee; user testing asks about this specifically |
| Users put real investor data into the browser | Stored on this device only; a clear button; a privacy note; the feedback channel asks people not to send real data |
| Rule complexity makes both implementations wrong in the same place | The Python recalculation is implemented independently from the PRD text, without looking at the TS code; hand-worked cases are checked by a person |
| New risks in v0.8 | See §9.7 |

## 8. Current state

The three engines and tests written before v0.1 are an unreviewed spike. Codex has pointed out specific defects in them (reference substring matching, merged split of fixed fees, results produced from invalid input, weights calculated in pence, floating-point intermediate values, and others). M1 rewrites them to the v0.2 rules; the spike is not reused directly.

## 9. v0.8 design (PRD v0.8, decision 11)

Scope: R-REC-10 (chase and query messages), R-REC-11 (withdrawal before closing), R-REC-12 (showing adjustments), R-ALL-12 (changing who pays a percentage fee before closing), R-X-01.2 (tour text), R-X-08 (activity log, including 08.3 initials, 08.4 capacity warnings, 08.5 storage full); rules C-REC-7, C-REC-8, C-ALL-10, C-ALL-11, C-X-1. Principles unchanged: money is integers and intermediate multiplication and division goes through `mulDiv`; calculations only in `src/lib/` pure functions; components only render the numbers and text lib gives them; no network requests, no `mailto:`; no inline styles or scripts.

Two PRs (decision 11):

| Milestone | PR | Content |
|---|---|---|
| **M5** | First (chasing payments) | R-REC-10, R-X-08 (all), the MT103 / UETR explanation in R-X-05, from R-X-01.2 the step 6 sentence + the end-card Activity log sentence + "Try next" item 3 + the Activity log empty-state note (tour design v0.3 §8 item 1); C-X-1 logging for tour actions and replay; `activity.ts`, `messages.ts`; every schema 2 field (withdrawals and change records exist in M5 as empty structures, with reading, writing and validation in place but no UI) |
| **M6** | Second (changes before closing) | R-REC-11, R-REC-12, R-ALL-12, the withdrawal section of R-ALL-10, "Try next" items 1, 2 and the two panel notes of R-X-01.2, withdrawal / fee payer in R-X-05; `adjust.ts`, `feePayer.ts`; the reconciliation engine takes effective cash due and withdrawals |

### 9.1 Data structures (`src/state.ts`)

`SCHEMA` goes from 1 to **2**; the storage key stays `deal-ops-toolkit:v1` (the key name is not a version number). `AppState` adds:

```ts
interface DealText { ...; initials: string }            // R-X-08.3, stored as typed; validated in derive
interface AllocationState { ...; editedSinceHandoff: boolean }  // R-ALL-12.1: investor table edited in allocation after hand-off
interface AppState {
  ...
  withdrawals: Record<string, Withdrawal>    // key = investor ID; Object.create(null), so IDs like "__proto__" stay data
  feePayerChanges: FeePayerChange[]          // full history in order applied; at most one with status === 'active'
  log: ActivityLog
}

/** C-REC-7: a mark on the investor, not a decision on a bank line */
interface Withdrawal {
  on: string            // withdrawal date, ISO; shown and logged only, not used in calculations
  consent: true         // "Written consent from the investor received" ticked; a false mark is never saved
  reference: string     // payment reference at marking time, normalised per C-REC-1, to detect "reference changed" (PRD v0.8 clarification)
}

/** C-ALL-11: original left untouched, adjustment recorded separately, reversible */
interface FeePayerChange {
  id: string
  feeId: string; feeLabel: string
  from: FeePayer; to: FeePayer
  consent: boolean                  // "Consent evidence received" ticked (may be false when changing to lead-paid)
  appliedAt: string                 // local time, same format as the activity log
  status: 'active' | 'reversed' | 'voided'
  voidReason: string | null
  /** fee and basis values at apply time, to detect manual edits of rate, kind or basis (compared by value, §9.4) */
  feeAtApply: { rateBps: number; basis: FeeBasis }
  /** allocation settings at apply time, for the C-ALL-11 warning and the step 3 recalculation (Codex v0.8 #3) */
  settingsAtApply: { minimum: number; cap: number | null; priceMicros: number; basis: FeeBasis; fees: Fee[] }
  targets: Record<string, number>   // T_i per participant (minor units)
  lines: AdjustmentLine[]           // one line per investor in scope, including unchanged amounts (`newCashDue === baseCashDue`) and "Not participating — unchanged"; covered = has a line that is not voided (Codex v0.8 r2 #1 #2)
}
interface AdjustmentLine {
  investorId: string
  reference: string                 // payment reference at apply time, normalised per C-REC-1 (as for withdrawal marks)
  baseCashDue: number               // cash due in the list at apply time (minor units)
  newCashDue: number                // N_i
  voided: boolean
  voidReason: string | null
}

/** C-X-1 */
interface ActivityLog {
  entries: LogEntry[]               // seq ascending; UI shows newest first
  nextSeq: number                   // starts at 1, only increases, never goes back when entries are removed
  lastExportedSeq: number           // 0 = never exported
  truncated: { count: number; fromSeq: number; toSeq: number; unexported: number } | null
}
interface LogEntry {
  seq: number; time: string; initials: string; event: LogEvent
  investorId: string; investorName: string; transactionId: string
  amount: number | null             // minor units; formatted only on export
  currency: Currency                // deal currency when the event happened (later currency edits do not touch old entries; exported from this column, PRD §5.5)
  detail: string
}
```

- The difference (N_i − original cash due) is not stored; `adjust.ts` computes it when needed, so storage never holds two contradicting numbers.
- `truncated` is not an ordinary entry: removed entries collapse into this one count, shown first in the UI and the export as a `truncated` row (empty `seq`), so `seq` never repeats and gaps are visible. The 5,000 limit counts ordinary entries only.
- "Clear all data": `initialState()` has the three new fields empty and clears `initials`. "Load sample": withdrawals and change records cleared; the log is cleared and then holds one `sample_loaded` (C-X-1); `initials` kept (clarified in the PRD field table).

**How `parseSaved` reads:**

| Case | Handling |
|---|---|
| `schema` 1 (saved by v1.1.x) | Validated as before; new fields empty: `withdrawals = {}`, `feePayerChanges = []`, empty log (`nextSeq = 1`), `initials = ''`; `editedSinceHandoff` = `true` (unknown whether edited after hand-off, so block fee payer change until a fresh hand-off) |
| `schema` 2 | Existing fields validated as before; the new money-affecting fields (`withdrawals`, `feePayerChanges`) **missing counts as wrong shape** and nothing is read (Codex v0.8 #4: must not silently compute money without withdrawals and adjustments); only `log` and `initials` default to empty when missing; any other `schema` → not read (as now) |
| `withdrawals` wrong shape (not a plain object; `on` not a valid ISO date; `consent !== true`; `reference` not a string) | Whole save not read: it affects money, no guessing |
| `feePayerChanges` wrong shape (status not one of the three; more than one `active`; an amount not a safe integer from 1 to `MAX_MONEY`; a duplicate investor ID in one change; more lines than `MAX_INVESTORS`) | Whole save not read, same reason |
| `log` wrong shape (`seq` not strictly increasing, `nextSeq` not above the last `seq`, unknown event name, more than 5,000 entries, wrong field types) | **Only the log is dropped**; deal data read as normal with a fresh log: `nextSeq` = largest valid `seq` read + 1 (1 if none), `truncated` records the dropped count (`unexported` counts all as unexported). Reason: R-X-08.5 puts deal data first; a bad log must not cost a whole deal |
| `withdrawals` rebuilt with `Object.create(null)` like `decisions` | The existing `__proto__` guard carried over |
| (M6 Codex round 6) A loaded withdrawal, adjustment line or active change that no longer fits the data saved with it (reference, cash due, the fee's payer / type / rate / basis, duplicate fee or investor IDs, missing required consent) | The same void checks as after an edit run on load: voided before anything is calculated, never trusted; nothing is logged (no action, no clock). Calculation keeps a second check (effective cash due, coverage and withdrawal marks all require the reference and amount to match) |
| (v0.8.1, decision 12) Changing the currency while a fee payer change is active | The reducer refuses it; the Deal settings currency select is disabled and says "Reverse the fee payer change before changing the currency" |

### 9.2 Where the calculations live (all `src/lib/` pure functions)

#### 9.2.1 Effective cash due and withdrawal (`adjust.ts`, wired into `reconcile.ts`)

- `effectiveDue(change: FeePayerChange | undefined, investorId, listCashDue, listReference): { due, original, adjustment: AdjustmentLine | null }`: `newCashDue` when the change is `active`, the investor's line is not voided, `listCashDue === baseCashDue` and `normalize(listReference) === line.reference` (C-REC-1 normalisation); otherwise the list value. The last two comparisons are a second safeguard: even if the reducer missed a void, the wrong amount is never used.
- `notCovered(change, commitments, withdrawals): string[]`: while a change is `active`, IDs of investors in the list who are not withdrawn but have no line or a voided line (PRD C-REC-7); if non-empty, reconciliation adds a "review" check and hand-off to allocation is disabled. Unchanged investors also have a line, so they are not flagged by mistake (Codex v0.8 round 2 #1 #2). Void checks run on every line (not only changed amounts); voiding is permanent.
- `deriveReconcile` in `derive.ts` passes them to the engine: `ReconcileInput` adds `withdrawn: Record<id, string>` (withdrawal date) and `due: Record<id, number>` (only effective dues that differ from the list). **`Commitment.cashDue` stays the list value**: the manual-decision fingerprint `commitmentFingerprint` uses the list value, so applying or reversing a fee payer change does not void confirmed matches (R-REC-04.4 looks only at list data).
- Changes to `reconcile()` (M1 engine, add-only so existing mutation patterns stay valid):
  - Status, difference, chase and candidate scoring use the effective due `due(c)` wherever they compare with cash due / amount outstanding (C-ALL-11).
  - `CommitmentResult` adds `due` (effective), `withdrawnOn: string | null`, `refund` (withdrawn = everything received; others = max(0, received − due)); `CommitmentStatus` adds `'withdrawn'` (takes priority over other statuses). Matching and booking rules unchanged (C-REC-7, R-REC-11.3): a withdrawn investor's reference still matches exactly.
  - `ReconcileResult` adds `refunds: { id, name, amount, reason: 'Withdrawn' | 'Over-paid' }[]` (withdrawn investors with nothing received are left out) and `totals.withdrawn: { count, toRefund }`; `totals.cashDue` sums only non-withdrawn investors (R-REC-11.2).
  - New arithmetic check `refunds-tie` (invariant): Σ `refunds.amount` = Σ received by withdrawn investors + Σ others' max(0, received − due). Left side summed from the `refunds` list, right side recomputed from `commitments`; the two paths share no intermediate result. Existing `ledger-ties` unchanged.
- `handoffToAllocation()`: withdrawn investors are not handed off; `excess` comes straight from `refunds` (with `reason`). The `Refund` type in `state.ts` gains `reason`; old saves default to `'Over-paid'`.

#### 9.2.2 Messages to investors (`messages.ts`, C-REC-8)

- `chaseMessage(dealName, currency, r: CommitmentResult): string`: template A; `{outstanding}` = `r.due − r.received`; the first sentence switches when received = 0. Called only for `partial` / `outstanding` (withdrawn investors have status `withdrawn`, so excluded by construction).
- `queryMessage(dealName, currency, investorName, payment: { amount: number; date: string }): string`: template B; the caller builds an object with only amount and date (never passes a `BankLine`), and the function reads only those two fields, so payer, bank reference and transaction ID cannot get in (TypeScript accepts a wider object, so the guarantee is the function itself, tested by passing a whole bank line; R-REC-10.2, Codex v0.8 #9).
- `amountWithCode(minor, currency)` = `formatMoney(minor, currency) + ' ' + currency` (`£1,250.00 GBP`, `US$500.00 USD`).
- `longDate(iso)`: splits `YYYY-MM-DD` into integers and looks up 12 English month names, giving `14 October 2026`; no `Date` or `Intl`, so time zone and browser language have no effect.
- Full template text is a constant in `messages.ts`, word for word as in the PRD (tests compare exactly); names and deal name inserted as is, not escaped; line breaks are `\n`.

#### 9.2.3 Changing the fee payer (`feePayer.ts`, C-ALL-10)

```ts
previewFeePayerChange(input: {
  feeBasis; minimum; cap; priceMicros; fees: Fee[]       // current allocation input (Fees)
  feeId: string; to: FeePayer
  investors: { id; name; cashDue; scheme }[]             // scope: not withdrawn and in the current allocation snapshot; cashDue = list value
}): Outcome<FeePayerPreview>
```

- Scope check: the chosen fee must be `kind === 'percent'` and `to !== payer`; Fees' = Fees with only this item's `payer` changed; Fees' first runs `validateAllocation`, failure → input error.
- **Step 1**: the existing `allocate()` with each investor's `received` set to their cash due, other inputs unchanged ("commitment allocation"). Non-empty `blockers` → the preview shows only the blocking reasons and cannot be applied. Participant T_i = `row.invested`; non-participants marked "Not participating — unchanged".
- **Step 2** (each participant separately): `minimalCashDue(T, FeesPrime, basis, priceMicros)`:
  - Lower bound: deducted from the payment `R_lo = F' + mulDiv(T, 10_000, 10_000 − p', 'ceil')`; added on top `R_lo = F' + mulDiv(T, 10_000 + p', 10_000, 'ceil')` (p' in bps).
  - Try penny by penny from `R_lo`: each try calls the existing `allocate()` with **one investor, `minimum = 0`, `cap = null`**, Fees', and checks `rows[0].invested ≥ T`. The whole engine is reused rather than splitting the single-investor logic out of `compute()`: the M1 engine is untouched and existing mutation patterns stay valid (reformatting would break the mutation patterns).
  - **Search upper bound** `R_lo + ⌈k / 2⌉` (k = number of percentage fee items the investor pays under Fees', ≤ 20, so at most 11 tries). Reason: for R ≥ R_lo, M ≥ T; at I = T each fee is at most half a penny over the exact value, so for R ≥ R_lo + k/2 the refund at I = T is already ≥ 0 and the C-ALL-7 penny-by-penny reduction stops at T at the latest. Nothing found in the window = implementation bug → arithmetic check failure (`ok: false` with `internal`).
  - For R < R_lo, M < T, so it cannot be met. The self-test review proved I(R) is monotonic, rises at most 1 penny per step, and M = T at R_lo, so the first match gives exactly I = T (PRD C-ALL-10 step 2 note); the implementation still searches linearly from the lower bound with an upper bound, and a found I ≠ T or nothing in the window both count as arithmetic check failures.
  - `N_i > MAX_MONEY` → input error naming the investor.
- **Step 3**: `allocate()` once more with Fees', participants `received = N_i`, non-participants `received` = original cash due, cap and minimum unchanged. The participant sets of steps 1 and 3 must match (differences are blockers: "would join the allocation" / "would leave the allocation"); each participant's `invested` must equal T_i, otherwise a blocker; step 3's own `allocate()` `blockers` (such as `company-fees-exceed`) are merged into the preview blockers as they are (Codex v0.8 r2 #4), with name and reason: `exclusion === 'below-minimum'` → "would fall below the minimum commitment"; `scaledBack` → "would be scaled back by the round cap"; otherwise → "would invest {I} instead of {T}"; if the step 1 commitment allocation is scaled back by the cap, it blocks at once ("The round is over the cap — resolve the scale-back first") without step 2.
- `FeePayerPreview` output: per investor `{ id, name, currentDue, target, newDue, difference }`; totals (top-up count and amount, refund count and amount); this fee's amount in the step 1 and step 3 results (`feeTotals`, before and after, see §9.8 item 8); the consent text required (the three R-ALL-12.2 sentences, constants); the confirm button text (`applyLabel()`, format in PRD R-ALL-12.3; for the sample deal `Apply: 0 top-ups totalling £0.00 · 12 refunds totalling £3,720.00`); `blockers`.
- `buildChange(preview, meta) → FeePayerChange`: called by the reducer on apply to create the change record.
- Display text lives in lib too: `adjustmentNote(line, change, currency)` → "was £1,000.00 · +£30.93 fee payer change (Platform fee: company → investors)"; banner text `changeBanner(change)`; void notice constant `ADJUSTMENT_VOID_NOTE` = "This fee payer change no longer applies — redo it" (R-REC-12).
- Where it runs: `Allocation.tsx` uses `useMemo` to call `deriveFeePayerChange(state, feeId, to)` (`derive.ts`: parse text, take scope), then `previewFeePayerChange`; the component only displays the result.
- Availability (R-ALL-12.1): `feePayerChangeBlock(s): string | null` in `state.ts` gives the reason: not handed off from reconciliation (`handoffVersion === null`) / snapshot out of date (`allocationStale`) / investor table edited after hand-off (`editedSinceHandoff`) / a change already active (R-ALL-12.5).

#### 9.2.4 Activity log (`activity.ts`, C-X-1)

- `appendEvents(log, events: NewEvent[], meta: { time, initials }): ActivityLog`: assigns `seq` in turn; above 5,000 entries calls `dropOldest`. Never throws.
- `dropOldest(log, n): ActivityLog`: removes the oldest n entries and merges them into `truncated` (counts added, `seq` range widened, `unexported` increased by those with `seq > lastExportedSeq`). Both the over-limit drop and the storage-full drop use it.
- `logStatus(log)`: `{ count, nearFull: count ≥ 4,000, removedUnexported: truncated?.unexported ?? 0 }`; App shows the two R-X-08.4 warnings at the top from it.
- `activityCsv(log): string`: see §9.5.
- `localIsoTime(epochMs, offsetMinutes)`: `2026-10-23T14:05:09+01:00`; built with integer arithmetic only; the caller passes the offset, so tests use fixed inputs.
- `logAmount(minor)`: I-01 display format without currency symbol (`1,250.00`, `-30.93`), in `money.ts`, sharing grouping logic with `formatMoney`.
- `parseInitials(raw)`: after trimAscii, ≤ 10 characters of English letters, digits, space, `.`, `-` → returns the text; otherwise `null` (error shown in deal settings, logged as empty, see §9.8 item 11).

### 9.3 How entries are written

**From the reducer, never from components.** `state.ts` becomes:

```ts
export type Clock = () => { epochMs: number; offsetMinutes: number }
export const systemClock: Clock = () => { const d = new Date(); return { epochMs: d.getTime(), offsetMinutes: -d.getTimezoneOffset() } }
export function makeReducer(clock: Clock) { return (s: AppState, a: Action): AppState => { ... } }
export const reducer = makeReducer(systemClock)   // used by App and the tour; tests use makeReducer(fixed clock)
```

Order inside the reducer: `targetMoved` → `apply` (change data) → void checks (return new state and "what was voided") → `eventsFor(prev, next, a, voided)` → `appendEvents`. The last two steps sit in `try/catch`: **if logging fails in any way, the action still takes effect**; it is just not logged (the OWASP principle C-X-1 cites). No `Date.now()` or `new Date()` in `src/lib/`; time comes only from `clock`. React strict mode calls the reducer twice and discards one result; no effect.

| Action | Event | Notes |
|---|---|---|
| `replaceCommitments`, `importBank` | `import` | detail: file type, replace / append, rows added, lines auto-booked by this import. Auto-booked count per PRD C-X-1 (Codex v0.8 #6): for a bank import, the accepted lines of this batch that are `auto` after import (replace = all new lines, append = added lines, ignored duplicates not counted); for a commitment import, `autoBookedDelta(prev, next)` (lines `auto` after but not before), running `deriveReconcile` + `reconcile` once on each state (only on import, < 200ms × 2 at the limit size); with input errors, "not calculated (input errors)". only imports dispatch these two actions, so no extra field is needed (simplified in implementation); manual row adds and deletes in the table are not logged (C-X-1: no cell edits) |
| `decide` | `confirm` / `assign` / `not_in_deal` | Actions gain `via: 'candidate' \| 'any'` and `prevStatus: LineStatus` (taken by the component from the current result; text, not money); `assign` detail names the assigned investor; amount = line amount |
| `undoDecision` | `undo` | previous status → the line's actual status after the undo (worked out from the new state, e.g. Needs review or Matched automatically); clearing a decision that was already void is prefixed `old decision cleared ·` (M5 self-test #1) |
| void checks | `decision_voided` | `voidChangedDecisions` also returns `{ lineId, reason }[]`, four reasons: line changed / line deleted / investor changed / investor deleted; one entry each for one-by-one manual edits or deletes; one entry for an operation voiding many (`deleteBank` on several lines, decisions cleared by a replace import), with the count in detail (PRD C-X-1) |
| `markWithdrawn` / `undoWithdrawal` / void checks | `withdrawn` / `withdrawal_undone` / `withdrawal_voided` | detail: withdrawal date; void reason (investor deleted / ID changed / reference changed). `markWithdrawn` does nothing when `consent !== true` or the date is invalid |
| `handoff` / `handoffToExit` | `handoff_allocation` / `handoff_exit` | detail: snapshot version, investor count; amount = total (summed with lib `sumExact`) |
| `applyFeePayerChange` | `fee_payer_changed` | one summary (fee, from → to, consent ticked or not) + one per affected investor (detail: original cash due → new cash due, amount = difference) |
| `reverseFeePayerChange` / void checks | `fee_payer_change_reversed` / `fee_payer_change_voided` / `adjustment_voided` | detail: scope (whole change / one investor) and reason |
| `logExported` | `log_exported` | first sets `lastExportedSeq` to the last `seq` at export, then appends this entry (detail: exported up to which entry) |
| `messageCopied` | `message_copied` | the entry is prepared at the click (the name as clicked); dispatched as soon as the copy succeeds, even after moving to another page; App's `copyGate` (page generation + list generations) is noted at the click and checked on completion, so nothing is written after a clear, replay or replaced list; without a clipboard, `selected for manual copy` is written only once the read-only text box is shown and selected (Codex M5 rounds 2–4). Detail only "template A" / "template B", never the text; B carries transaction_id |
| `loadSample` | `sample_loaded` | log cleared first; this is the first entry |
| `setDeal({ initials })`, cell edits, `restore` | not logged | `restore` (tour) swaps in the state the tour computed; each tour step itself goes through the reducer, so what should be logged already is; a replay's `stateAt` first runs `loadSample` through the reducer, so the log starts again at `sample_loaded` |

Tour: `tourData()` (`src/tour/script.ts`) leaves `log` and `initials` out of the comparison, otherwise "changed" would always be true; `withdrawals` and `feePayerChanges` are included (they are data).

**Storage full (R-X-08.5)**: handled in `saveState`; App only handles the result.

```ts
export function saveState(storage, s): { result: SaveResult; log: ActivityLog | null }
```

1. Write the whole state as before; success → `{ result: 'saved', log: null }`.
2. A quota error (`isQuotaError` unchanged) with a non-empty log: `dropOldest(log, 500)` and retry, until the log is empty (at most 10 times for 5,000 entries). A success → `{ result: 'saved', log: the trimmed log }`.
3. Still failing with the log empty → `{ result: 'full', log: null }`: the in-memory log is **left untouched** (still exportable, matching "Export what you need"), and the R-X-02 "storage full" notice is shown. Not a quota error → `'blocked'`, no entries removed.

`log` is non-empty only when a save **succeeded** after removing entries; the App save effect then dispatches `{ type: 'logTrimmed', last }` via `trimAction` (`last` = the last entry that save dropped; no event, no version change), and the reducer drops through that entry from the **current** log with `dropOldest`: entries written after the save stay, the cap holds, and both removal counts merge into `truncated`; if the log was replaced meanwhile (sample, clear) the entry is not there and nothing happens (Codex M5 rounds 2 and 4); `truncated` already says how many were removed and whether they were exported, so R-X-08.4's "N entries were removed before export." appears. Why not a separate key for the log: two keys cannot be written together atomically, the log read back could be older than the deal data and `seq` could repeat, breaking C-X-1.

### 9.4 Snapshots and "out of date" (R-X-07)

| Action | `recVersion` +1 | `allocVersion` +1 | Other |
|---|---|---|---|
| `markWithdrawn`, `undoWithdrawal` | yes | — | — |
| withdrawal mark voided | yes (together with the list change that caused it, which already does +1) | — | — |
| `applyFeePayerChange` | yes | yes (the fee's payer changed) | sets this fee's `payer` in `allocation.fees`; stores the change record |
| `reverseFeePayerChange` | yes | yes | payer back to `from`; status `reversed`, record kept |
| whole change voided (`editFee` changed the fee's payer / rate / kind, `deleteFee` removed it, `setDeal` changed `feeBasis`) | **yes** (these are allocation actions that did not touch `recVersion` before; voiding changes effective cash due, so it is added) | yes (already) | status `voided`; judged by value: the edited fee is compared with `feeAtApply` and `to`, an edit that leaves the value the same does not count |
| one investor's adjustment line voided (investor deleted, ID / reference changed, parsed cash due ≠ `baseCashDue`, or any of these after a replace import) | yes (with the list change) | — | voiding is permanent: changing back does not revive it, as with voided decisions |
| `editInvestor`, `addInvestor`, `deleteInvestor` | — | yes (already) | `editedSinceHandoff = true`; reset to `false` on `handoff` |
| `messageCopied`, `logExported`, `logTrimmed`, `setDeal({ initials })` | — | — | no effect on any result |

- Void checks extend to `UPSTREAM_DATA` and `editFee` / `deleteFee` / `setDeal`: new functions `voidChangedMarks(s)` (withdrawal marks + adjustment lines) and `voidChangedFeeChange(s)` (whole change), both returning `{ state, voided }` for logging.
- **Apply** re-checks availability (`feePayerChangeBlock`) and the consent tick in the reducer and does nothing if not met: a second safeguard beyond the disabled button. **Reverse** has its own check `canReverse(s, changeId)`: only that the change exists and is `active`; no fresh snapshot, no "already active change" check, no new consent tick (Codex v0.8 #1: allocation goes out of date right after apply, so a shared check would make reversing impossible).
- An investor marked withdrawn after a change was applied: the adjustment line is kept; after undoing the withdrawal the adjustment applies again (not in the PRD, see §9.8 item 9).

### 9.5 Copy and export

- **Copy only**: `navigator.clipboard.writeText(text)`; on success show "Copied. Send it yourself from your usual email." (R-REC-10.3) and dispatch `messageCopied` (through the `copyGate` check of §9.3). On failure (not a secure context, browser refused, API missing) → as with the confirmation copy in `Allocation.tsx`: show the full text in a read-only text box, selected (`ref.select()`, not an inline script), with "Could not copy. Select the text and copy it yourself.", and, once the text is selected, still dispatch `messageCopied` (detail `selected for manual copy`, PRD C-X-1 clarification). No `mailto:`; the text never goes into a URL. CSP unchanged (the clipboard is not governed by `connect-src`); the `Permissions-Policy` in `vercel.json` does not turn the clipboard off, and must not.
- **CSV** (all through the existing `toCsv`, text columns pass through `safeText` against formulas; program-generated amount columns go in `numeric`, unescaped, minus sign kept):

| Export | v0.8 change |
|---|---|
| Chase list `chaseListCsv` | `committed` takes the effective cash due, and `committed_original, committed_adjustment, message` are added before `currency` (first two empty with no adjustment; `message` generated by the same `chaseMessage` as the copied text; text columns escaped; multi-line quoted by papaparse); withdrawn investors are not in it |
| Reconciliation ledger `ledgerCsv` | one row per bank line; only `withdrawn_on` added before `currency`: the withdrawal date when the line is booked to a withdrawn investor, otherwise empty (PRD v0.8 clarification; investor-level effective cash due is in the chase list) |
| Activity log `activityCsv` (new) | columns `seq, time, initials, event, investor_id, investor_name, transaction_id, amount, detail, currency` (`currency` last, the deal currency when the event happened, PRD v0.8 clarification + decision 10); `truncated` row first with empty `seq`; `amount` via `logAmount` (such as `1,250.00`; cells with commas quoted by papaparse), listed in `numeric`; text columns such as `initials`, `investor_name`, `detail` escaped; file name `activity_log_{currency}.csv` |

### 9.6 Test hooks

- **Milestones**: `order` in `scripts/check-coverage.mjs` and `scripts/check-e2e.mjs` becomes `['M1', 'M2', 'M3', 'M4', 'M5', 'M6']`; the test plan tags v0.8 cases 〔M5〕/〔M6〕; the first PR sets `docs/milestone.txt` to `M5`, the second to `M6`. The regex `〔(M\d)〕` needs no change.
- **Unit tests** (names start with the TC ID): `messages.test.ts` (both templates word for word, the unpaid first sentence, three currencies, `longDate` month start and end and leap day, no payer / bank reference / transaction ID in the text); `activity.test.ts` (`seq` continuous, at 5,000 entries the 5,001st drops the oldest, `truncated` merging, `unexported` count, the 80% warning boundary 3,999 / 4,000, CSV escaping); `state.test.ts` (events from each action, `time` to the second with offset under a fixed clock, action still applies when logging fails, entries removed and retried when storage is full, schema 1 saves read, a bad log drops only the log); `adjust.test.ts` / `reconcile.test.ts` (refunds due for withdrawals, receivable totals, `refunds-tie`, void rules, effective cash due not voiding confirmed decisions); `feePayer.test.ts` (the three PRD hand-worked examples, lower bound, window upper bound, step 3 blockers, `N_i` over the limit).
- **Mutation** (`scripts/mutation-check.mjs`, M5 / M6 sections added): for example `refunds-tie` missing withdrawn investors, chase list including withdrawn investors, lower bound with `floor`, search starting at lower bound − 1, window set to 0, no drop above 5,000, `unexported` not counted, no retry when storage is full, revival after void, fee payer change not bumping `recVersion`, payer added to a template. Changing `voidChangedDecisions` and the reducer structure invalidates the match text of some existing M2 mutants (`return UPSTREAM_DATA.has(a.type) ? voidChangedDecisions(next) : next` and others); update them in the same PR, no MISSING left.
- **Python recalculation** (`scripts/oracle/oracle.py`, written by an independent subagent from the PRD, test plan and `SCHEMA.md`, without reading `src/`; done 2026-10-25, selfcheck 178/178). The interface is **as in `scripts/oracle/SCHEMA.md`** (Codex v0.8 round 3 #2); the TS side adapts in `src/lib/oracle.test.ts`:
  - `reconcile` cases: optional `withdrawn: [investor ID]` and `adjustedCashDue: { id: amount }` (converted from the engine's withdrawal marks and `effectiveDue`); with neither, output is identical to v1.1. Extended output: per investor `cashDue` (effective) and `withdrawn`; top level `refunds` (`{id, amount, reason: withdrawn|overpayment}`), `refundTotal`, `receivable`, `withdrawnSummary`, `chase`, `handoff`, `checks.refundIdentity`.
  - `feePayerChange` cases: allocation fields + `feeId`, `newPayer`, investors `{id, cashDue, scheme}`, optional `applied: { targets, newCashDue }` for the recalculation after apply (C-ALL-11). Output `ok, canApply, blockers: [{code, investor}], feeBefore, feeAfter, totals`, per investor `{cashDue, participatingBefore, unchanged, target, newCashDue, difference, participatingAfter, investedAfter}`; blocker codes in SCHEMA.md. The adapter maps TS blocker reasons to these codes.
  - Random cases in `scripts/oracle/batch.py` add both kinds (several fees, both bases, with cap, with minimum).
- **E2E** (Playwright, Chromium): one for M5 (sample → copy David's chase message → clipboard matches template A; the context needs `clipboard-read` / `clipboard-write`); one for M6 (withdraw → refund appears, allocation out of date → change fee payer → top-up investors appear in the chase list → Reverse → restored).
- **Storage size estimate** (characters, measured on synthetic limit-size data: 500 investors, 2,000 bank lines, a manual decision on every line, names and payers 40–60 characters long):

| Part | Estimate |
|---|---|
| Deal data (PRD estimates 0.9M; measured about 1.5M in the extreme case of long names and one decision per line, the two decision fingerprints about a third of it) | 0.9M – 1.5M characters |
| 5,000 log entries (PRD about 320 characters each; about 400 measured with long names and long detail) | 1.6M – 2.0M characters |
| Total | about 2.5M – 3.5M characters |

The localStorage limit is usually quoted as about 5 MiB per origin, but browsers count differently (some by characters, some by UTF-16 bytes, i.e. 2 bytes per character). Counted in bytes, 5 MiB is only about 2.6M characters, so **the extreme size goes over**. Behaviour is unchanged (R-X-08.5: drop log entries first, deal data first), but the PRD wording "within the limit" is loosened (§9.8 item 12). M5 adds a test: limit-size data and a fake storage limited to 5 MiB counted in bytes, checking log entries are dropped first and the deal data is saved; the manual checklist tries it once in Safari.

### 9.7 Risks

| Risk | Response |
|---|---|
| Penny-by-penny search for the new cash due | Proved that I(R) is monotonic and rises at most 1 penny per step (self-test review); still searches linearly up from a provable lower bound with upper bound ⌈k/2⌉; a found I ≠ T or nothing found is an arithmetic check failure; the Python recalculation finds it independently by a different method |
| Log growth: one fee payer change writes up to 501 entries (one summary + one per investor); a full replace import that voids decisions writes 1 | Above the 5,000 limit the oldest are dropped, 80% warning; when storage is full log entries are dropped first; the UI shows only the latest 200 at first, "Show more" loads more, to avoid rendering 5,000 rows at once |
| Every save serialises 2–3.5M characters | Saving already happens after the 300ms debounce; `perf.test.ts` adds a limit-size `JSON.stringify` timing; above 50ms, consider saving only when idle |
| Safari clears script-written storage for sites with no interaction for 7 days (ITP) | Logged as known, not handled: the R-X-08.2 note already tells people to export the CSV; one line in the release notes |
| Clipboard API unavailable (not https, permission refused, old browser) | Fall back to selected text for manual copy (§9.5); `message_copied` still logged, detail `selected for manual copy` |
| Rolling back to v1.1.x: the old version knows only schema 1, cannot read a schema 2 save and overwrites it with empty state | Stated in the release notes; for a real rollback, first ship a small version that reads schema 2, or ask users to export first. "Keep schema 1, add optional fields" is rejected: the old version would ignore withdrawals and adjustments and silently compute different money, worse than not reading |
| The tour state comparison includes the log, so "changed" is always true | `tourData()` excludes `log` and `initials` (§9.3) |
| Changing the M1 engine (`reconcile.ts`) breaks existing mutation patterns | Only add fields and checks, never reorder existing code; prettier only on changed files (with the project flags); `npm run mutation` all killed or marked equivalent |

### 9.8 PRD issues and how they were handled

Drafting this section against the code found 17 gaps or contradictions in the PRD. Claude clarified each one in the PRD v0.8 draft on 2026-10-23 (no change to scope or approved numbers), and this section already reflects them:

1. The reconciliation ledger is one row per bank line: only `withdrawn_on` added; investor-level effective cash due goes in the chase list.
2. Chase list `committed` takes the effective cash due, with `committed_original`, `committed_adjustment` added.
3. The activity log CSV's `currency` is the last column, the deal currency when the event happened (Codex v0.8 #5).
4. An operation voiding many decisions (such as a full replace import) logs one `decision_voided` with the count; one-by-one manual edits or deletes log one each.
5. "Lines auto-booked by this import": for a bank import, counted over the accepted lines of the batch; for a commitment import, the difference between the states before and after (§9.3, Codex v0.8 #6).
6. "Payment reference changed" is compared after C-REC-1 normalisation.
7. The self-test review proved the smallest N_i always gives exactly I = T_i; I ≠ T_i is an arithmetic check failure (no more "1 penny over" case).
8. Fee amounts "before and after apply": the step 1 commitment allocation against the step 3 allocation.
9. Withdrawal and fee payer change: change first, then withdrawal, keeps the adjustment line; while a change is active, non-withdrawn investors outside its coverage (no valid line) are marked "Not covered…" and hand-off is disabled (self-test review #4, Codex v0.8 #2).
10. The closing confirmation gains a section "Withdrawn before closing (refund in full):" (R-ALL-10; a change to the confirmation text, reported to the owner).
11. Invalid initials: field error, logged as empty; kept by "Load sample"; editing them is not logged.
12. The capacity estimate wording is loosened; going over is handled per R-X-08.5.
13. The `truncated` row does not count towards the 5,000 entries and has no `seq` of its own.
14. When the clipboard fails and the text is copied by hand, `message_copied` is still logged, with a note in detail.
15. The per-investor `fee_payer_changed` `amount` is the signed difference.
16. Voiding of a whole change and of a single line is judged by submitted values (submitting the same value as before is not a change); once voided it is permanent, changing back does not restore it (Codex v0.8 r2 #3).
17. Tour: M5 does the step 6 sentence, the Activity log sentence and "Try next" item 3; M6 does items 1, 2 and the panel notes (tour design v0.3 §8).

Added after the self-test review: the in-memory log is not trimmed when storage is full (#1); normalised reference comparison for adjustment lines (#2); the participant sets of the first and third steps must match (#5); blocked when the commitment allocation is scaled back by the cap (#6); a warning and recalculation when other allocation settings change after apply (#8).
