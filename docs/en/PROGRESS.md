English snapshot of docs/PROGRESS.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20.

# Deal Ops Toolkit — progress record

An SPV deal-operations tool that runs in the browser: **payment reconciliation → closing allocation → exit distribution**. Deal data you enter is processed only in your browser.

This file records each stage: what was done, how it was verified, who reviewed it and which decisions were made. It must be updated at the end of every stage (Rules §4, Definition of Done). See each section's links for details.

| Stage | Status | Dates |
|---|---|---|
| G0/G1 requirements and design review | ✅ Done, approved by the owner | 2026-10-16 → 10-17 |
| M1 calculation engine | ✅ Accepted and merged (PR #1) | 2026-10-17 → 10-19 |
| M2 reconciliation + allocation UI | ✅ Accepted and merged (PR #2) | 2026-10-20 |
| M3 exit distribution UI + guided tour | ✅ Accepted and merged (PR #3) | 2026-10-20 |
| M4 release preparation + visual refresh | ✅ Accepted and merged (PR #4) | 2026-10-20 |
| G3 release v1.0.0 | ✅ Live at https://deal-ops-toolkit.vercel.app | 2026-10-20 |

---

## G0/G1 requirements and design review

**Status:** ✅ Done · 2026-10-16 to 2026-10-17 · approved by the owner on 2026-10-17

**Goal:** Write down the problem, requirements, calculation rules, technical design, development rules, review process and test plan first. Write code only after review passes.

**What was done**
- Four documents: requirements (PRD), technical design, product and development rules with the review process, and the test plan (`docs/en/01_PRD.md`, `docs/en/02_TECH_DESIGN.md`, `docs/en/03_RULES_AND_REVIEW.md`, `docs/en/04_TEST_PLAN.md`).
- Final v0.7: 47 requirement acceptance points; calculation rules (input formats, reconciliation matching, fees, minimums, oversubscription scale-back, S/EIS estimates, exit waterfall, hurdle, catch-up, tiered carry); 103 test cases, with a derivation for every hand-calculated number.
- A built-in fictional sample deal with expected results that can be frozen. It also serves as onboarding and training for new users.

**How it was verified**
- Every hand-calculated number was rechecked with Python `decimal`. Codex recalculated independently in each of six review rounds and found no calculation errors.

**Reviews**

| Round | Version | Verdict | Must fix | Important | Minor |
|---|---|---|---|---|---|
| 1 | v0.1 | REWORK | 6 | 14 | 4 |
| 2 | v0.2 | REWORK | 2 | 8 | 4 |
| 3 | v0.3 | REWORK | 0 | 4 | 2 |
| 4 | v0.4 | REWORK | 0 | 1 | 1 |
| 5 | v0.5 | READY AFTER FIXES | 0 | 0 | 2 |
| 6 | v0.7 (scope reduction check) | READY AFTER FIXES | 0 | 0 | 2 |

Main findings: a reference-number substring false match would book money to the wrong person; merging several fixed fees and then splitting them made single fee amounts not add up; invalid input still produced results; "validation failure gives no result" contradicted "items pending review need to see results"; nominee holdings truncated share counts and then split money wrongly; the currency in the CSV header was not checked. All were fixed as the reviews advised. For item-by-item handling, kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`.

**Decisions (owner)**
- The holding structure **supports only the SPV nominee** (nominee / bare trust, fractional shares allowed). Direct holding was removed.
- Investor percentage fees support two bases; the default deducts the fee from the payment.
- Three currencies (GBP / EUR / USD) and appending bank-statement imports are kept. All three modules ship together.
- No analytics. Feedback only through an email link.

**Open items / next steps:** Move to M1.

**Links:** Sign-off record and scope change: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`

---

## M1 calculation engine

**Status:** ✅ Accepted and merged · 2026-10-17 to 2026-10-19 · the owner asked Claude to record "Accepted" and merge PR #1 (2026-10-19)

**Goal:** Implement the three calculation engines to the signed-off rules; pass every test-plan case due at M1; cross-check with an independent implementation; freeze the sample deal's results.

**What was done**
- Engines: payment reconciliation, closing allocation and exit distribution, plus input validation, CSV import and export, and snapshots between modules. All money is calculated exactly in integers (pence), the hurdle included; only match scores and displayed values use ordinary decimals.
- Every calculation carries its own checks, handled in five classes: input error, arithmetic failure, blocker, pending review and notice.
- Prototype code from before the review was deleted and the engines were rewritten.

**How it was verified**
- **Tests:** all 137 cases due at M1 pass (143 tests in total). The coverage check reads the test report and confirms each case really ran and passed.
- **Independent recalculation:** a Python implementation was written by a separate subagent from the PRD only, and it never saw the TypeScript code. The two implementations agree field by field on more than 1,100 random cases and on all hand-calculated, sample, invalid-input and non-ASCII cases. Where reviews found "both implementations make the same mistake", the oracle's author fixed it independently from the PRD.
- **Mutation check:** key code was deliberately broken in 35 places (rounding direction, boundaries, fees, review, escaping, line breaks and so on). Each one made at least one test fail.
- **Sample deal:** every number in test plan §3 was checked (for example carry £57,021.00). All results are frozen.
- **Performance:** at the maximum size (500 investors × 2,000 statement lines), reconciliation takes 100 ms, allocation 0.8 ms and exit 0.3 ms, all within target.

**Reviews**

| Round | Reviewer | Verdict | Findings |
|---|---|---|---|
| 1 | Codex | REWORK | 13 important + 6 minor |
| Self-test | Independent reviewer agent | READY AFTER FIXES | 1 important + 7 minor + 3 ambiguities |
| 2 | Codex | REWORK | 3 important + 4 minor |
| Self-test | Independent reviewer agent (incl. 18,000-case fuzz test) | READY AFTER FIXES | 1 important + 4 minor |
| 3 | Codex | REWORK | 1 important |
| Self-test | Independent reviewer agent (CSV text handling) | READY AFTER FIXES | 2 high + 5 medium/low |
| 4 | Codex | **READY AFTER FIXES (passed)** | 2 minor (fixed) |

Main findings and fixes: a hurdle of exactly half a penny was dropped (shared by both implementations); a fee was lost when its fee ID was `__proto__`; a stale manual decision fell back to automatic booking; CSV rows with uneven column counts were silently truncated; a transaction ID with spaces made the same payment book twice; deleting a trailing non-breaking space in a reference caused a wrong booking; results depended on the runtime's Unicode version. Each has a regression test.

**Process improvement (proposed by the owner):** every hand-off to Codex must first pass the self-test gate: rule-by-rule check, hostile-input tests, mutation check and a first review by an independent reviewer agent. Codex confirms; it should not be the first to find problems.

**Decisions**
- PRD v0.7.2 clarifications (calculation rules unchanged): the hurdle is exact; digits in reference numbers are compared by segment; investor payment references use only English letters and digits; at most 20 fees per deal; only ASCII separators are recognised, and results do not depend on the Unicode version; CSV identifier fields have leading and trailing ASCII whitespace trimmed, while free text is kept as is; export formula-injection protection is reversible.
- Known limitation (written into the PRD): non-English letters are not upper-cased, so `JOSÉ` and `José` count as different words. This only affects candidate scores and never causes automatic booking.

**Open items / next steps**
- The owner comments "Accepted" on PR #1 and merges it.
- M2 to-dos: when a statement line is deleted by hand, delete the manual decisions on it too; save the deal name after it is changed (TC-DEAL-02).
- Operational lesson: the Codex CLI needs its input closed and a watchdog aimed at the process itself, or it hangs.

**Links:** PR #1 in the private development repository · review records: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md` · performance `docs/perf.md`

---

## M2 reconciliation + allocation UI

**Status:** ✅ Accepted and merged · 2026-10-20 · manual checklist M-01 to M-06 and M-08 all passed on the preview; the owner replied "accept, merge", and Claude recorded Accepted on PR #2 and merged it

**Goal:** Turn the M1 reconciliation and allocation engines into a usable interface, passing data between the two modules with "carry forward"; add deal settings, local saving, a disclaimer, glossary explanations and a feedback link; make it acceptable on a Vercel preview.

**What was done**
- **Reconciliation:** the investor list and bank statement can be pasted, uploaded as CSV or edited directly in the table. Statement imports can replace or append. Suggestions pending review can be confirmed, assigned to any investor, marked as not belonging to this deal, or undone. It shows each investor's payment status and the validation results, and can export the ledger and the chase list. Carry forward is blocked while suggestions are still unresolved.
- **Allocation:** share price, cap, fees and investors. Results show totals, each fee, the payment to the company, each investor's breakdown, S/EIS estimates and groupings, and "cannot close" with the list of names. The confirmation can be copied and exported as CSV, and lists overpayments pending refund found during reconciliation.
- **Carry forward:** after reconciliation changes, the allocation page shows "out of date". Carrying forward again replaces everything; it does not merge.
- **General:** deal settings (name, currency, cut-off date, fee basis, minimum), a disclaimer on first open, a privacy note and feedback email link in the footer, one-sentence explanations of 11 terms, data stored only in this browser, and a "Clear all data" button.
- **Security:** the content security policy forbids the page from making any network request. End-to-end tests run under the same policy.

**How it was verified**
- **Tests:** all 207 unit tests pass; all 142 cases due at M2 ran and passed; 5 end-to-end tests (full sample-deal flow, stale and re-carry, privacy, refresh and clear, disclaimer) pass on the production build, with zero browser console errors.
- **Sample deal:** reconciliation and allocation numbers in the interface match test plan §3 (for example total invested £100,395.00, paid to the company £98,895.00).
- **Privacy:** the end-to-end tests record every request throughout: only same-origin GETs for static files, no request bodies, and no names, amounts or references in any URL.
- **Mutation check:** 65 deliberate breakages (34 from M1 + 31 from M2), each caught by the tests; 1 was proven to be an equivalent change, with the reason written in the script.
- **Mobile and dark mode:** no horizontal overflow at 375px width; dark mode is readable (formal acceptance is in M-09/M-10, P1).

**Reviews**

| Round | Reviewer | Verdict | Findings |
|---|---|---|---|
| Self-test | Independent reviewer agent | READY AFTER FIXES | 1 important + 3 minor + 7 test gaps |
| 1 | Codex | REWORK | 5 important + 1 minor |
| 2 | Codex | REWORK | 5 of 6 closed; 1 partly closed + 1 new important |
| 3 | Codex | REWORK | 1 partly closed |
| 4 | Codex | REWORK | Closed; 2 new important |
| 5 | Codex | REWORK | 1 closed, 1 partly closed |
| 6 | Codex | **READY** | None |

Main findings and fixes: after "Clear all data", data was still left in the paste box; a voided manual decision came back into force when the data was changed back; overpayments pending refund were wrongly deleted on a rename; clearing straight after choosing a file let the data come back when reading finished; when an input had changed but was not yet committed, results still showed the old values and could be copied; when a whole table was replaced, an old pending edit was written into someone else's row; with a slow file read, edits made during the read were overwritten by the import. None was a calculation error. All were cases where "the numbers on screen" and "the numbers actually saved, carried forward or exported" could differ. Each has a regression test and a matching mutation check.

**Decisions**
- The feedback email uses a placeholder address for now (owner, 2026-10-20); it must be replaced before release.
- The confirmation gets a column for overpayments pending refund (R-REC-08 requires listing them; no calculation changes).
- After an investor's amount is changed by hand or the investor is deleted, their overpayment pending refund is not deleted automatically. A person confirms whether to keep or delete it, and the confirmation cannot be copied or exported until that is done.
- Calculation runs automatically 300ms after typing stops (technical design §5). Before it runs, results are marked "updating" and the related buttons are disabled.
- Appending a statement adds only new lines; existing lines stay as they were (including the format the user typed).
- TypeScript strict mode had not been switched on (Rules D5 requires it). It is now on, with zero errors.

**Open items / next steps**
- Before release (G3): replace the feedback email; check the security response headers directly on the production URL (the preview is behind Vercel login, so the command line cannot read them).
- M3: exit distribution UI, guided tour, end-to-end tests E2E-01b/02b/05.

**Links:** PR #2 in the private development repository · review records: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`

---

## M3 exit distribution UI + guided tour

**Status:** ✅ Accepted and merged · 2026-10-20 · M-07 and the tour all passed on the preview; the owner replied "accept, merge", and Claude recorded Accepted on PR #3 and merged it

**Goal:** Turn the exit distribution engine into an interface that carries holdings forward from closing allocation; build a guided tour that takes a new user through the three modules in three minutes; add a confirmation to "Clear all data".

**What was done**
- **Exit distribution:** holdings are carried forward from allocation (together with the share price at that time), or can be imported or edited by hand; proceeds, exit costs and number of years; fixed carry (optional hurdle and catch-up) or tiered carry, with fields that no longer apply cleared on switching; a step-by-step view of how much goes to investors and to the lead at each step, and why; each investor's proceeds, gain or loss, and multiple (excluding entry fees); a shortfall shown when exit costs exceed proceeds; export of the distribution and holdings CSV. When allocation changes, the exit page shows "out of date", and carrying forward again replaces everything.
- **Guided tour:** the design draft was first reviewed by an expert agent from industry and user-experience angles, and was built after the owner confirmed v0.2. 12 steps plus a start card and an end card, about 2–2.5 minutes. The user clicks themselves or uses "Do this for me", and sees the result before moving on. Pressing Enter all the way completes it. Jump by chapter, and resume after leaving midway. Every number on a card comes from the calculation results. If the user clicks the wrong thing there is "Fix it for me". Any action that would overwrite the user's own data warns first. On mobile it is a bottom drawer. No full-screen overlay and no third-party tour library.
- **"Clear all data"** asks for confirmation before clearing, and clears tour progress too.

**How it was verified**
- **Tests:** all 259 unit tests pass; all 143 cases due at M3 ran and passed; 9 due end-to-end cases (14 tests in total) pass, including completing the tour by pressing Enter all the way, checking that every step's highlighted element exists and is not covered by the card, and completing all M-01 to M-07 actions at 375px width.
- **Sample deal:** exit numbers match test plan §3: hurdle £58,919.25, catch-up £14,729.81, total carry £57,021.00, investors' total £328,479.00. The numbers on all 12 tour cards were checked one by one against §3.
- **Mutation check:** 101 deliberate breakages, all caught by the tests (39 new in M3).
- **Privacy:** the end-to-end tests run the full tour and the exit exports; every request is for same-origin static files only, and no URL contains deal data or tour state.

**Reviews**

| Round | Reviewer | Verdict | Findings |
|---|---|---|---|
| Design | Expert agent (tour design + UK SPV operations) | Recommended cutting 16 steps to 12, among others | Adopted as v0.2, confirmed by the owner |
| Self-test | Independent reviewer agent | READY AFTER FIXES | 3 important + 4 minor + test gaps |
| 1 | Codex | READY AFTER FIXES | 4 important + 2 minor |
| 2 | Codex | READY AFTER FIXES | 4 closed, 2 each with one gap left |
| 3 | Codex | READY AFTER FIXES | 2 closed; 3 new (2 important + 1 minor) |
| 4 | Codex | **READY** | None |

Main findings: all in the tour, none a calculation error. They fell into two groups. First, at some entry points (start, restart, chapter jump, resume, Replay, the first-open button) the tour overwrote the user's own data with the sample without warning. Second, the cap demonstrated in step 10 was not restored correctly after a refresh, an exit or the user's own change. There were also card wording that did not match the screen (still saying capital is returned first when there is a loss; saying both "not booked" and "booked" after confirmation) and a freeze after deleting a tier. Each has a regression test and a matching mutation check.

**Decisions (owner)**
- Build the tour to the expert's plan v0.2 (12 steps, click yourself + do it for me, three entry points, no quick version, chapter jumps).
- Add a confirmation to "Clear all data".

**Open items / next steps**
- Before release (G3): replace the feedback email; check the security response headers on the production URL.
- M4: full acceptance → production release → smoke test → invite users.

**Links:** PR #3 in the private development repository · tour design `docs/en/05_GUIDED_TOUR.md` · review records: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`

---

## M4 release preparation + visual refresh

**Status:** ✅ Accepted and merged · 2026-10-20 · after Claude ran a simulated acceptance on the preview (M-01 to M-10 and the tour all passed), the owner replied "accept, merge", and Claude recorded Accepted on PR #4 and merged it.

**Goal:** Prepare for release (feedback email, release notes), and apply a visual refresh (owner decision 8): open-licensed fonts and the project's own design tokens; no third-party names, marks, assets or text.

**What was done**
- **Feedback email** replaced with the owner's own address (owner decision).
- **PRD v0.7.3 / Rules P6 (decision 8):** visual refresh (owner decision): open-licensed fonts and the project's own design tokens; no third-party names, marks, assets or text. The footer keeps "Not affiliated with any platform".
- **Visual refresh:** a design proposal by a design-review agent, approved by the owner, written up as the M4 visual plan (not published). The owner approved every recommendation.
  - Dark: near-black background with a single peach primary button. Light: warm off-white background with an ink primary button.
  - Open-source fonts Inter and IBM Plex Mono, bundled with the site, with their licences published too.
  - Left navigation on wide screens, pill segments on narrow screens; breadcrumb page header; summary figures placed in cards and scaled to card width; pill badges; tour cards restyled as panels.
  - Motion (respecting the "reduce motion" setting), print styles, a neutral favicon.
  - 7 copy changes. Item 3 was not changed (the proposed sentence "All receipts are matched." is not true after rejecting two receipts). Item 8 was changed to point to the "Resume tour" button that actually shows.
- **Zero changes to calculation code.**

**How it was verified**
- **Tests:** 263 unit tests pass; all 143 cases due at M4 pass; 21 end-to-end tests (9 due cases) pass. New ones: the "Clear everything" button is readable on wide screens in dark and light; fonts load from the site itself; the tour completes at 1024×640; tour buttons on mobile are ≥44px; summary figures do not overflow their cards (including £9,999,999.99).
- **Contrast:** every colour pair was calculated with the WCAG formula: text ≥4.5:1, input borders ≥3:1.
- **Mutation check:** 101/101. jsdom cannot test layout problems, so instead we "put the bug back and confirm the end-to-end test fails"; all 4 were verified.
- **Simulated acceptance:** ran M-01 to M-10 and the tour on the preview; the numbers match test plan §3 (kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`).

**Reviews**

| Round | Reviewer | Verdict | Findings |
|---|---|---|---|
| Design | Design-review agent | Plan P0/P1/P2 | The owner approved every recommendation |
| Self-test | Independent reviewer agent | READY AFTER FIXES | 1 important (the "Clear everything" button invisible on wide screens) + 4 minor |
| 1 | Codex | READY AFTER FIXES | 1 minor (tour buttons on mobile under 44px) |
| Simulated acceptance | Claude | Recommend acceptance | Summary figures pushed out of cards; table dates and names wrapping — fixed |

Codex's first run hit the account usage limit midway with no verdict. The owner reset it and it was run again.

**Decisions (owner)**
- Decision 8: visual refresh (owner decision): open-licensed fonts and the project's own design tokens; no third-party names, marks, assets or text (boundaries written into the PRD).
- Feedback email uses the owner's own address.
- Visual plan A–G all as recommended; no manual dark/light toggle.
- Add the missing version tags v0.1.0 (M2) and v0.2.0 (M3).

**Open items / next steps**
- G3: run the full manual checklist M-01 to M-11 and all automated tests on the `main` preview → after the owner agrees, merge to `release` for production → smoke test on the production URL and check the security response headers → tag `v1.0.0` → finalise the release notes. Print output and keyboard focus in the sidebar are checked by hand at G3.
- After release: Publish the code and English docs in a public repository.

**Links:** PR #4 in the private development repository · visual plan: the M4 visual plan (not published) · review records: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`

---

## G3 release v1.0.0

**Status:** ✅ Live · 2026-10-20 · after the owner replied "OK to release", Claude merged `main` into `release` (`d54c903`) and tagged `v1.0.0`. Production URL https://deal-ops-toolkit.vercel.app

**What was done**
- **Pre-release check (Rules G3 step 1):** ran the full manual checklist M-01 to M-11, keyboard focus, print, dark mode and narrow screens on the `main` preview, and ran all automated tests (kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`).
- **M-11 (a self-made 5-investor deal run from scratch) found 3 friction points; the owner asked for them to be fixed, PR #5:**
  - After import the section collapsed automatically, so "Imported N …" could not be seen. Now the section stays open after an import or after adding the first row by hand; once the list is replaced by the sample or a hand-off, the old import message no longer shows.
  - On mobile the selected module tab was cut off at the edge. Now only the tab bar scrolls sideways to bring it into view; the page does not move.
  - The allocation page of a new deal had no starting hint. A hint now shows when the share price is empty.
- **Release:** merged to `release`, smoke-tested on the production URL, tagged `v1.0.0`, finalised the release notes.

**How it was verified**
- **Automated tests on the release commit (2026-10-20):** 271 unit tests pass; due cases 143/143 (the test plan has 148 IDs; another 5 were removed in v0.7); Python oracle self-check 139/139; TS and the oracle agree field by field on the hand-calculated cases and on 1,100 generated cases; 22 end-to-end tests (due 9/9); mutation check 107/107.
- **Production smoke test:** sample-deal numbers match test plan §3; data persists after refresh; fonts load from the site itself; no console errors; every request is a same-origin GET for static files (the page, one script, one stylesheet, three font files); the security response headers match technical design §4 word for word.

**Reviews**

| Round | Reviewer | Verdict | Findings |
|---|---|---|---|
| Self-test | Independent reviewer agent | READY AFTER FIXES | 1 minor: the section still collapsed when adding the first row by hand |
| 1 | Codex | READY AFTER FIXES | 1 minor: on a full replacement the section remounted and keyboard focus was lost |
| Simulated acceptance (authorised by the owner) | Claude | Round 1 found the import message still showing after loading the sample; round 2 passed after the fix | — |

During the mutation check, one old mutant became equivalent because of the new section key; it was retargeted at the shared `listKey`. Another survived because of a redundant fallback; once the redundancy was removed it was caught.

**Decisions (owner)**
- M-11's 3 friction points: "fix them".
- PR #5: "please simulate my acceptance, and if there are no problems, 'accept, merge'" — Claude's acceptance passed, and Claude recorded it and merged.
- "OK to release".

**Open items / next steps**
- Publish the code and English docs in a public repository. Done 2026-10-20: https://github.com/yuannh/deal-ops-toolkit

**Links:** PR #5 in the private development repository · release notes `docs/RELEASE_NOTES.md` · review records: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`
