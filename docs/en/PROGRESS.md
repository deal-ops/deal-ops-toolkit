English snapshot of docs/PROGRESS.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20, updated at v1.1.0 on 2026-10-21, for v1.1.1 on 2026-10-26 for v1.2.0 on 2026-10-27 and for v1.2.1 on 2026-10-28.

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
| Post-release improvements (PR #11) | ✅ Live as v1.1.0 | 2026-10-20 → 10-21 |
| v1.1.1 save failures reported truthfully (PR #18) | ✅ Live as v1.1.1 | 2026-10-23 |
| v0.8 chasing payments and changes before closing (documents stage) | ✅ Approved by the owner (PR #23) | 2026-10-23 → 10-25 |
| M5 chase and query messages, activity log (PR #24) | ✅ Accepted and merged | 2026-10-25 → 10-26 |
| M6 withdrawal, changing who pays a fee (PR #27) | ✅ Accepted and merged | 2026-10-26 → 10-27 |
| G3 release v1.2.0 (M5 + M6) | ✅ Live https://deal-ops-toolkit.vercel.app | 2026-10-27 |
| v0.8.2 generic wording in the chase message, release v1.2.1 | ✅ Live https://deal-ops-toolkit.vercel.app | 2026-10-28 |

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

---

## Post-release improvements: interface polish, theme switch, currency handling (PR #11)

**Status:** ✅ Live as v1.1.0 · 2026-10-21 · after the owner replied "accept, merge", Claude recorded it and merged; after the G3 check the owner replied "accept, merge, OK to release", and Claude merged into `release` (`d588b56`) and tagged `v1.1.0`.

**What was done**
- **Interface problems the owner found on the live site:** the sidebar "Clear all data" confirmation was pushed out of the sidebar and cut in half; it now sits under its button, and focus moves into and out of it. Glossary explanations used to be inserted mid-sentence; they now float under the "?" (pinned to the bottom of the window in tables and on phones), close with Esc, a click elsewhere or focus leaving, and the target is 26px. Every select has the same arrow, and the two fee columns have the same width. Fee placeholders read "e.g. 3" so they no longer look like entered values. Fields in a row are bottom-aligned.
- **Theme switch (PRD v0.7.4, R-X-04, decision 9):** System / Light / Dark on the page, following the device by default; the choice is kept only in this browser, and "Clear all data" returns it to System. Printing from dark mode stays black on white.
- **Currency handling (PRD v0.7.5, decision 10):** the owner asked for professional practice to be assessed first; a research agent looked at GOV.UK, Stripe and Wise exports, Microsoft's localisation guidance and HMRC's currency input, then the owner chose. Money labels name the currency (screen readers hear it too); USD is shown as US$; changing the currency converts nothing and asks first when amounts exist, giving how many; every CSV export ends with a `currency` column; imports check a `currency` column when there is one; the confirmation's second line names the currency code; import messages say which currency amounts were read in; share prices accept thousands commas.
- No calculation rule or figure changed.

**How it was verified**
- **Automated tests:** 284 unit tests pass; due cases 149/149 (new: TC-X-03, TC-IO-44, TC-IO-45, TC-IO-46, TC-DEAL-03, TC-ALL-30); 27 end-to-end tests (due 9/9), including 3 new for printing in dark mode and 1 each for the sidebar confirmation and an explanation inside a label; mutation check 131/131.
- **Simulated acceptance (authorised by the owner):** 16 items on the Vercel preview with fresh browser storage, all passed: M-01 to M-04 and M-06 to M-08 match test plan §3; the currency-change confirmation (59 amounts, checked one by one), theme saving and clearing, explanations, the sidebar confirmation, and 375px width.

**Reviews**

| Round | Reviewer | Verdict | Findings |
|---|---|---|---|
| Self-test | Independent reviewer agent | READY AFTER FIXES | 1 major: printing from dark mode gave light text; 5 minor: focus, keyboard, clicks inside labels, the confirmation count, high-contrast mode |
| 1 | Codex | READY AFTER FIXES | 3 minor: Esc in Safari, currency not heard by screen readers, focus in the currency confirmation |
| Simulated acceptance (authorised by the owner) | Claude | All 16 items passed | — |

One mutant can only be seen in a real browser (jsdom does not model label clicks); it is covered by an end-to-end test and was checked by hand. Another survived because its code had become redundant; the redundant code was removed. Prettier once rewrapped untouched lines in the calculation engines; that was reverted and the edits redone by hand.

**Decisions (owner)**
- Interface problems: "change all as you suggest, add the switch".
- Currency: first "what is professional practice, review and assess", then after the research "as suggested".
- PR #11: "simulate my acceptance", then after the results "accept, merge".

**Open items / next steps**
- **G3 release check (2026-10-21):** M-01 to M-11 on the `main` preview; M-11 ran a self-made 5-investor EUR deal from scratch and matched the hand calculation. The check found a test with its date pinned to 2026-10-20 that failed after midnight (the app was fine); a follow-up pull request (#13, in the private development repository) fixed it. Production smoke test: sample figures match test plan §3, 12 requests, all same-origin GETs, no console errors, security headers match technical design §4.
- Next (owner agreed): refresh the public repository after a new pre-public check; replace the wiki's old screenshots with production ones.
- The explanation placement (opening to the left, pinned to the bottom) has no automated test; it is checked by hand in manual items M-09 and M-10.

**Links:** PR #11 in the private development repository · release notes `docs/RELEASE_NOTES.md` · review records: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`

---

## v1.1.1 save failures reported truthfully (PR #18)

**Status:** ✅ Live as v1.1.1 · 2026-10-23 · after Claude's simulated acceptance the owner replied "accept, merge", and Claude recorded it and merged; after the G3 check the owner replied "merge, release now", and Claude merged into `release` (`8734580`) and tagged `v1.1.1`.

**What was done**
- Found while preparing the next version, and present in the live v1.1.0: when browser storage was full, the page wrongly said "storage is blocked"; when the browser refused storage as soon as it was read (the usual case when site data is blocked), the page said nothing, so people would think their data was saved and lose it on closing the page.
- **PRD v0.7.6, R-X-02:** a full store shows "This browser's storage for this page is full, so your latest changes are not being saved. Export what you need before you close the page."; any other save failure, or no storage at all, shows the existing "storage is blocked" sentence. The message sits in a status region that screen readers announce.
- No calculation rule or figure changed; nothing under `src/lib/` changed. Test plan v0.7.2 adds TC-X-04; English docs synced.

**How it was checked**
- **Automated tests:** 287 unit tests pass; due cases 150/150; 27 end-to-end tests (9/9 due); mutation 141/141 (10 new mutants; the first run missed 3, all from tests that were not precise enough, and all are caught after the tests were tightened).
- **Simulated acceptance (authorised by the owner):** 8 checks on the preview, all passed: with storage filled on purpose the page says it is full, and the saved data really lacks the new change; after freeing space the message goes and the changes are saved; figures are right after a reload.
- **G3 release check (2026-10-23):** production build `index-CZaWFdNy.js`; security headers and a smoke test on the live site passed.

**Reviews**

| Round | Reviewer | Verdict | Findings |
|---|---|---|---|
| Self-test | Independent reviewer agent | Ready after fixes | 1 major: no message when the browser refuses storage on read; 1 minor: screen readers do not hear the message |
| 1 | Codex | Ready | None; suggested 3 more tests, added |
| Simulated acceptance (authorised by the owner) | Claude | All 8 checks passed | — |

**Decisions (owner)**
- Fix this on its own first: "as suggested".
- PR #18: "simulate my acceptance", then after the results "accept, merge"; release: "merge, release now".

**Open items**
- Blocking site data in Chrome's settings was not tried in the browser (browser settings were left alone); the automated tests cover it.

**Links:** PR #18 in the private development repository · release notes `docs/RELEASE_NOTES.md` · review records: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`
---

## v0.8 chasing payments and changes before closing (documents stage)

**Status:** ✅ Documents approved · 2026-10-25 · scope and the 3 recommendations approved on 2026-10-23; the v0.8 PRD, technical design, test plan and tour design went through a fresh-context review (14 findings) and 3 Codex rounds (10 / 7 / 2), all fixed, and the independent oracle self-check passed 178/178; the owner replied "approved"; PR #23 merged into `main` (`fd48c9e`), English copies synced.

**What was done**
- The PRD v0.8 draft adds the parts of chasing payments and changes before closing that need no operator-held data: chase and payment-query text for investors (copied by the person, never sent by the tool), a local activity log, withdrawal before closing, and changing who pays a percentage fee before closing. Existing calculation rules are unchanged.
- The owner asked for industry research on the 3 open points: 3 research agents in parallel looked at SPV platforms, Stripe, Modern Treasury, FCA CASS, NIST, OWASP, tour completion data and more. Outcome: a fee payer change is recorded as an adjustment that leaves the original cash due untouched and can be reversed in one step; the activity log holds 5,000 entries, warns at 80% to export, then removes the oldest, and never blocks work; the tour gains no steps, only one sentence in step 6 and a changed end card.

**Decisions (owner)**
- Scope: "as recommended" (no automatic email, no withdrawal after closing, no rolling close, conversion or two valuations, no payer change for fixed fees).
- The 3 points: first "research the industry's solutions in depth", then "give a professional recommendation", then "as recommended" after the recommendation. Also: v0.8 as two PRs (chasing payments first, then changes before closing).

**Links:** PR #23 in the private development repository · research record: kept in the private development repository

---

## M5 chase and query messages, activity log (PR #24)

**Status:** ✅ Accepted and merged · 2026-10-26 · PR #24 (merge commit `1f6a700`).

**What was done**
- **Chase message (R-REC-10.1):** investors who are short or have not paid get "Copy message", which copies a fixed English chase email (template A, with the MT103 / UETR explanation); the chase list CSV gains a `message` column.
- **Payment query (R-REC-10.2):** every candidate of a receipt in review gets "Copy query"; the text gives only the date, amount and currency, never the payer, bank reference or transaction ID (template B).
- **Copy only, never sent (R-REC-10.3):** no `mailto:`, no request; without a clipboard the text is shown selected for the person to copy.
- **Activity log (R-X-08):** a new "Activity log" page, newest first, read-only, CSV export; it records imports, every decision by a person, voided decisions, hand-offs, copies, exports and loading the sample, with the tour's own decisions marked `guided tour`. It holds 5,000 entries, asks for an export from 4,000, then removes the oldest into one `truncated` line; when the browser's storage is full the oldest entries go first and the deal data is saved. Initials can be set in Deal settings.
- **Tour v0.3, M5 part:** one sentence in step 6 about "Copy message"; the end card gains "Every decision you just made is in the Activity log." and "Try next" item 3 (undo a confirmed payment to see Copy query); "Take me to it" only takes you to the control, it never acts.
- **Saved data schema 2:** storage and checks for withdrawals and fee payer changes are in place (their interface comes in M6); v1.1.x saves load as before. No calculation rule or figure changed.

**How it was checked**
- **Automated tests:** 349 unit tests pass; due cases 168/168 (18 new for M5); 28 end-to-end tests (10/10 due, new E2E-08); mutation check 197/197 (more than 50 new; a few survived along the way, each fixed with a test or by removing redundant code).
- **Hostile input:** names with quotes, line breaks and emoji; `__proto__` as an investor ID; crafted logs (empty entries, wrong types, oversized, huge numbers); the largest save in a browser that counts 5 MiB in bytes.
- **Simulated acceptance (local preview):** M-01, M-02, M-03 match Test Plan §3; M-12: David's chase text and Chloe's query copied and read back from the system clipboard in full; every step is in the activity log, and the exported CSV has the right header, escaping and currency column (no file was downloaded; the export was captured in the page).

**Reviews**

| Round | Reviewer | Verdict | Findings |
|---|---|---|---|
| Self-test | Independent reviewer agent | Ready after fixes | 1 major, 4 minor: clearing a voided decision logged as an undo; an ID change logged as a deletion; damaged-log numbering; fee payer change save checks; screen-reader message |
| 1 | Codex | Ready after fixes | 1 major, 3 minor: one empty log entry lost the whole deal on reload; a recovered log not readable again; a failed copy logged wrongly; the `truncated` line hidden by paging |
| 2 | Codex | Ready after fixes | 1 major, 3 minor: a copy finishing after a clear wrote the name back; coercion on read; enum fields accepted as arrays; trimming lost newer entries |
| 3 | Codex | Ready after fixes | 1 major, 4 minor: a quote in a transaction ID crashed the page; overlapping copies logged once; one damaged `truncated` field lost the line; export mark ahead of the log; number precision |
| 4 | Codex | Ready after fixes | 1 major, 3 minor, all in earlier patches, so three simpler designs replaced them (trim by the last dropped entry, note the data generation at the click, no artificial number ceiling) |
| 5 | Independent reviewer agent (Codex usage limit reached) | Ready after fixes | 1 minor: technical design §9.3 behind the round-4 designs; documents corrected |
| 5 (re-run) | Codex | Ready after fixes | 2 minor, both only with a hand-damaged save: a line id `__proto__` logged a voided decision on deletion; log recovery could reuse number 91 |

No finding touched a money calculation; they were about the activity log staying correct with damaged saves and overlapping timing.

While re-running round 5: CI on the PR had failed since the round-3 changes because of one lint warning (the earlier "CI green" was based on local test runs and was wrong). Fixed, and the CI result was checked on GitHub.

**Simulated acceptance (2026-10-26, local preview of `55fc2a9`):** M-08, M-01, M-02, M-12 and M-03 all pass, figures match §3; clipboard contents read back with `pbpaste`; the activity log has all 9 steps with correct times, and the export was captured in the page. 375px (headless browser): no horizontal page scroll on Reconciliation or Activity log; the log table scrolls inside its box. One observation: when the clipboard is unavailable the manual-copy box sits inside the investors table, so at 375px you scroll the table to see all of it; it works but is cramped.

**Decisions (owner)**
- "Codex has usage again": round 5 re-run.
- "Simulate acceptance; if it passes, accept and merge": simulated acceptance passed; Claude recorded Accepted on the PR and merged.

**Open / next**
- 375px: the activity log page was checked in a headless browser; the end card and a real phone have not been checked. The manual-copy box is cramped on narrow screens; a candidate for a later small fix.
- Next, M6: withdrawal before closing, changing who pays a fee, the confirmation's withdrawal section, "Try next" items 1 and 2.

**Links:** PR #24 in the private development repository · review records: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`

## M6 Withdrawal before closing, changing who pays a fee (PR #27)

**Status:** ✅ Accepted and merged · 2026-10-27 · PR #27 (merge commit `7cdb065`).

**What was built**
- **Withdrawal before closing (R-REC-11, C-REC-7):** each row of the reconciliation investor table can be "Mark withdrawn", which needs ticked written consent and a date (default: the as-of date) and can be undone. A withdrawn investor shows Withdrawn, is not chased, is not handed off, and everything received is listed to refund (reason Withdrawn); the summary says "Withdrawn: n investor(s), £x to refund"; the closing confirmation adds "Withdrawn before closing (refund in full)" after the over-payments. Money arriving after the withdrawal still books to the investor and adds to the refund.
- **Changing who pays a fee (R-ALL-12, C-ALL-10/11):** an allocation panel "Change who pays a fee": pick a percentage fee and a new payer; the preview shows each investor's current cash due, the investment kept, the new cash due and the difference; moving to investors or the company needs ticked consent, to the lead only informing; the button states "Apply: n top-ups … · m refunds …". Applied, the investor list keeps its values and an adjustment record is saved beside it; reconciliation uses the adjusted amount (e.g. Amelia "was £10,000.00 · −£300.00 fee payer change"), over-payments go to refunds and top-ups to the chase list; "Reverse" restores it in one step. Edits to the list or the fee void it for good; changed allocation settings bring a reminder and a re-check.
- **Sample figures:** platform fee to the company with a £970 minimum: 12 investors £124,000.00 → £120,280.00 (12 refunds, £3,720.00), company-paid platform fee £3,608.40 — as the PRD hand calculation and the test plan say.
- **Exports:** the ledger gains `withdrawn_on`; the chase list's `committed` is the adjusted amount, plus `committed_original` and `committed_adjustment`.
- **Tour:** end card "Try next" items 1 and 2 (withdraw Lucas; platform fee to the company with the minimum at £970), one sentence on each new panel; terms withdrawal and fee payer.
- **New owner decision 12 (PRD v0.8.1):** the currency is locked while a fee payer change is active — reverse first (research: QuickBooks and Stripe official docs).

**How it was checked**
- **Automated:** 420 unit tests pass; M6 due cases 199/199; 31 end-to-end tests (11/11 due, new E2E-09 and a visibility check of the end card's "Try next" targets, incl. 375px); the independent Python oracle agrees on all fixed cases and 1,800 generated ones (new: 300 reconciliations with withdrawals / adjustments, 400 fee payer changes); mutation check below.
- **Hostile input:** `__proto__` and `constructor` as investor IDs; duplicate investor and fee IDs; hand-edited saves whose marks, adjustments, fees or consent no longer fit.
- **Full mutation check:** 264/265; the one survivor was an equivalent mutant on redundant code (since round 6 "not covered" is decided by the effective-cash-due check); the redundant code was removed, the mutant pointed at the check that matters, and the re-run passed.
- **Simulated acceptance (local production build, 1280px and 375px):** M-01, M-02, M-03, M-13 all pass, figures matching the PRD hand calculations and the test plan (e.g. 11 refunds totalling £3,630.00, company-paid platform fee £3,521.10, David's chase text £2,425.00); the decision-12 currency lock works; Reverse restores everything; no sideways page scroll at 375px on the three pages.
- **CI:** the last commit before merging, `b1c412a`, passed (attempt 3; the first 2 failed while the CI machine installed the Playwright browser — a system update held the package lock, unrelated to the code).

**Reviews**

| Round | Reviewer | Verdict | Findings |
|---|---|---|---|
| Self-test | Two fresh-context reviewers (same prompt, half the checklist each) | A ready; B ready after fixes | B: 3 minor (keyboard focus, 375px form, a guide mismatch), plus test gaps |
| 1 | Codex | Ready after fixes | 1 major: consent ticked for one payer carried over when a fee-table edit switched the payer; 1 minor: screen reader |
| 2 | Codex | Ready after fixes | 1 minor: "Try next" item 2 focused nothing on a disabled panel; the new browser check then found the end card covering a target |
| 3 | Codex | Ready after fixes | 1 major: the settings re-check skipped an investor withdrawn and reinstated |
| 4 | Codex | Ready after fixes | 1 major: a ticked withdrawal consent carried over to a different person imported under the same ID |
| 5 | Codex | Ready after fixes | 2 major: a row given a withdrawn investor's ID left the refund unflagged; Reverse picked the wrong record in a crafted save |
| 6 | Codex (asked to report every defect of the kind at once) | Ready after fixes | 3 major, one cause: duplicate IDs, and saved marks / adjustments / changes that no longer fit their data were trusted. Fixed at the cause: duplicate IDs void, the same void checks run on load, a second check at calculation time |
| 7 | Codex | Ready after fixes | 1 major: a void on load did not make the allocation out of date |
| 8 | Codex | Ready after fixes | 1 minor: "not covered" not announced |
| 9 | Codex | Ready after fixes | 2 minor: a withdrawn investor's voided adjustment, and a whole-change void on the allocation page, not shown or announced |
| 10 | Codex | **READY** | none |

Every finding is fixed with a test and a mutant. The major ones are of one kind: a consent, adjustment, withdrawal mark or refund staying attached after the person or fee it was given for changed. Claude's self-test did not hunt for that kind on purpose in the early rounds, so Codex found them round by round; from round 6 every path of the kind was checked at once.

**Mistakes in the process (Claude):** the first self-test reviewer had no time limit and ran 1 h 43 min with no result; Codex round 1 finished at 10:34 but was picked up only at 13:45, as no timer had been set. Since then every review is time-boxed and a monitor watches for its report.

**Decisions (owner)**
- Decision 12: lock the currency while a fee payer change is active; reverse first.
- Guided tour v0.3 §8 item 7: item 2 still shows when the allocation is out of date; the "lower the minimum" text only when exactly one investor is blocked (a clarification while building; no change on the sample).
- "Accept, merge" (2026-10-27), in reply to the simulated acceptance report and to "is the new interface wording (listed in the PR #27 description) OK?"; Claude recorded Accepted on the PR and merged.

**Links:** PR #27 in the private development repository · review records: kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`

**Open / next**
- Release: M5 and M6 are merged, not released. After G3 (full checklist M-01 to M-13, every P0 case, G3 record) and the owner's explicit OK.
- At 375px, the withdraw form opened from the table's far-right column takes about half a second of smooth scrolling to come into view (it does end in view with focus, tested); not yet checked on a real phone.

## G3 release v1.2.0 (M5 + M6)

**Status:** ✅ Live since 2026-10-27 at https://deal-ops-toolkit.vercel.app (build `index-fWQP9R2X.js`, `release` @ `69f211a`, tag `v1.2.0`). Owner: "merge; OK to release".

**G3 check (`main` @ `96ba252`):** every automated check passed (420 unit, 199/199 due cases, 31 end-to-end, oracle self-check 178/178, mutation 264/265 then cleaned up); the full manual checklist M-01 to M-13 passed, figures matching Test Plan §3 and hand calculations; M-11 walked a made-up 5-investor EUR deal from scratch (incl. a withdrawal, a fee payer preview and a 1.80x exit). The G3 record is kept in the private development repository.

**After release:** production serves the checked build; security headers match `vercel.json`; smoke test (a separate headless browser, the owner's own browser data untouched): sample reconciliation, allocation and exit figures match; copying a chase message, a withdrawal, a fee payer change and its reversal work; 12 requests, all same-origin GETs without bodies or query strings; no console errors.

**Note:** this version saves in a new format (schema 2). Rolling back to v1.1.1 (`release` @ `8734580`) means a browser that used the new version starts empty, as v1.1.x cannot read it.

**Next:** CI failed three times that day installing the browser on the GitHub runner's system-update lock (not the code; re-runs passed); the workflow now waits for the lock. The public repository was refreshed for v1.2.0 on 2026-10-27.

## v0.8.2 Generic wording in the chase message, release v1.2.1

**Status:** ✅ Live since 2026-10-28 (build `index-bxRVcwES.js`, tag `v1.2.1`). Owner: "accept, merge, OK to release".

**What changed:** the paragraph of the chase message (template A) for investors who have already paid now reads: "If you have already sent this payment, please ask your bank for the MT103 (or equivalent) for the transfer, showing its UETR, and send it to us so we can trace the payment." The reconciliation hint and the chasing row of the PRD §1.1 evidence table changed to match. Text only: no calculation, money decision, export format or saved data changed.

**How it was checked:** full review track because it touches `src/lib/messages.ts`. 420 unit tests pass, due cases 199/199, end-to-end 31 (11/11), full mutation 267/267 (2 new); CI success. Self-test reviewer and Codex round 1 both READY AFTER FIXES; all items fixed. G3: automated checks and M-01 to M-03 and M-12 passed; after release the production smoke test and security headers passed. Rollback: v1.2.0 (same saved-data format).
