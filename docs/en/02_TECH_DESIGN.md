English snapshot of docs/02_TECH_DESIGN.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20.

# Deal Ops Toolkit — Technical design

Version v0.7.1 (last revised 2026-10-20) · 2026-10-17 · Status: **Approved (2026-10-17)** · Based on: `docs/en/01_PRD.md` v0.7

- v0.1 → v0.2: changed in response to Codex review items #4 #6 #8 #15 #18 #19 #20.
- v0.2 → v0.3: changed in response to round-two items R2-02 R2-06 R2-10 (result type categories, holding units, running tests by milestone).
- v0.7 → v0.7.1 (2026-10-20, clarified against the code after release; no rule changed): no floating-point exception for the hurdle (as in PRD C-01), and the matching risk removed; the engine interface written as in `src/lib/outcome.ts`.

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
| Local storage | localStorage, key `deal-ops-toolkit:v1`; reads and writes wrapped in try/catch; the structure carries a schema version | Keeps working normally when storage fails in private browsing | IndexedDB |
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

## 8. Current state

The three engines and tests written before v0.1 are an unreviewed spike. Codex has pointed out specific defects in them (reference substring matching, merged split of fixed fees, results produced from invalid input, weights calculated in pence, floating-point intermediate values, and others). M1 rewrites them to the v0.2 rules; the spike is not reused directly.
