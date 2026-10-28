English snapshot of docs/03_RULES_AND_REVIEW.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20, updated on 2026-10-23.

# Deal Ops Toolkit — Product rules, development rules and review process

Version v0.7.3 (last revised 2026-10-23) · 2026-10-17 · Status: **Approved (2026-10-17)**; v0.7.1 adds the "progress record" Definition of Done item at the owner's request (a process change; it does not affect requirements or calculation rules)

- v0.1 → v0.2: changed in response to Codex review items #19 #20 #22 (you cannot approve your own PR, release timing, anonymised feedback, scope freeze).
- v0.7.1 → v0.7.2 (2026-10-20, clarification): D2 now says the hurdle is exact too, as in PRD C-01.
- v0.7.2 → v0.7.3 (2026-10-23, process): adds the G2a small-fix track (owner: "as suggested").

---

## 1. Product rules

| # | Rule | How to check |
|---|---|---|
| P1 | **A person decides anything uncertain.** Only certain matches are handled automatically; everything else is only a suggestion | At review, ask: did anything move money automatically while uncertain? |
| P2 | **Every number can be explained.** The calculation steps are visible next to the result | In a demo, point at any number and say where it comes from |
| P3 | **Every calculation checks itself**, handled by the five categories in PRD C-03: input errors and arithmetic failures give no result; blockers and review items show the result but block finalising; warnings have no effect | The invalid-input and blocker cases in the test plan |
| P4 | **Errors are loud.** Invalid input is reported with its location, and is never silently treated as 0 | As above |
| P5 | **Entered deal data is processed only locally in the browser**; the wording follows PRD R-X-02 and does not overstate | CSP + smoke test + code review |
| P6 | **All sample data is fictional.** Visual and interaction style is an owner decision: open-licensed fonts and the project's own design tokens; no third-party names, marks, trademarks, brand assets or page text; the page keeps a 'not affiliated with any platform' notice (PRD decision 8, 2026-10-20) | Check before release |
| P7 | **Scope discipline.** New ideas go to the backlog; to build one, change the PRD first and get it signed off again | The PR description must list requirement IDs |
| P8 | **Plain wording**; the UI is in English; each term has a one-sentence explanation the first time it appears | In user testing, watch who gets stuck |
| P9 | **Only claim what is done.** Externally, talk only about what is implemented, tested and live | Release notes are checked item by item against the tests |

## 2. Development rules

| # | Rule |
|---|---|
| D1 | Calculations live only in pure functions in `src/lib/`; components do no money maths |
| D2 | Money is integers; intermediate multiplication and division use `mulDiv` (BigInt); hurdle compounding is exact too, with no floating-point exception (PRD C-01) |
| D3 | Rounding and splitting follow PRD §5 only; to change the basis, change the PRD first |
| D4 | **Every acceptance point has a test**; test names start with the case ID (e.g. `TC-ALL-09 …`). CI reads the test report and checks that every case with "due milestone ≤ current milestone" actually ran and passed; cases not yet due are not required to exist. The ID only provides traceability; whether a requirement is really covered is judged by Codex review and owner acceptance |
| D5 | TypeScript strict mode; zero lint warnings; build passes |
| D6 | One PR covers one group of requirements; the PR title lists requirement IDs; commit messages say "what changed and why" |
| D7 | Every change goes through a PR, and can merge only when CI is fully green |
| D8 | A new dependency needs a one-line reason in the technical design |
| D9 | When behaviour changes, docs and tests change in the same PR |
| D10 | No secrets, real names or real deal data are committed to the repository |
| D11 | No inline `style` attributes and no inline scripts (CSP blocks them) |

## 3. Review process

```
G0 requirements review → G1 design review → [freeze lifted] → G2 every PR → G3 release → G4 user feedback loop
```

**Freeze**: until both G0 and G1 are signed off, **no implementation code is written** (not just UI), apart from the existing spike.

### G0 requirements review (PRD + test plan) / G1 design review (technical design + this document)
1. Claude writes the draft and self-checks it (do rules contradict each other, is every acceptance point testable, have hand calculations been rechecked).
2. Codex cross-review (prompts kept in the private development repository).
3. Claude handles each item and records it in the review record: accepted / not accepted, with reasons.
4. If any blocker or major is accepted → revise, then ask Codex to review again; repeat until the verdict is READY or READY AFTER FIXES and the fixes are done.
5. Owner sign-off: write "Approved" in the PRD change log, and record the date in the review record.

### G2 every PR
0. **Self-test gate (before handing to Codex; must be completed and recorded in the review record)** — required by the owner on 2026-10-17: "You need to test and verify, then hand it to Codex for a cross check":
   - Rule-by-rule check: every rule in PRD §5 and every row of the field tables, checked against the code, with results recorded.
   - Boundary and hostile input: 0 / 1 / limit / limit + 1, exactly half a penny, empty values and invalid dates, special IDs such as `__proto__`, CSV with uneven columns and blank lines, text starting with a formula or tab, very large numbers — at least one test for each type.
   - Test effectiveness: run `scripts/mutation-check.mjs`; every deliberate break must be caught by a test; anything not caught either gets a new test or is shown to be an equivalent change, with the reason written down.
   - Fresh-context review: start a separate reviewer agent that cannot see the development process, and have it review first using the same prompt as Codex; fix the problems it finds first.
   - Codex's role is to cross-confirm, not to be the first to find problems.
1. Before opening the PR: the PR description lists the requirement IDs and test case IDs covered, and which Definition of Done items do not apply (with reasons).
2. CI: type check → lint → unit tests → due-case execution check → Python recalculation → build (+ end-to-end from M2). CI runs "all implemented regression tests + the cases due in the current milestone"; G3 requires every P0 case to have run and passed.
3. Codex code review: against PRD §5 and the test plan, looking specifically for paths that get money wrong; comments and their handling are recorded (kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`).
4. Vercel preview link: the owner accepts only the checklist items **this PR touches**.
5. The owner comments "Accepted" on the PR and **clicks merge himself** (GitHub does not let you approve your own PR, so a comment + merging himself is used instead).

### G2a small-fix track (v0.7.3, owner 2026-10-23: "as suggested")
In the owner's words: an hour from request to delivery for this is too slow. The v1.1.1 fix, which only changed a save message, took over an hour through every gate, most of it on two full mutation runs and the full release checklist.
- **When it applies (all must hold):** no change under `src/lib/` or to any calculation, rounding or money decision; no change to import or export formats; at most about 5 source files changed (tests and docs not counted). Otherwise the full G2 / G3 applies.
- **G2 step 0 becomes:** rule check and hostile inputs as usual; mutation runs only the mutants in the changed files (`node scripts/mutation-check.mjs --files=<file,file>`), and every new mutant must be caught; the fresh-context review as usual. Once the reviewer's findings are fixed, Codex and the local re-check may run at the same time.
- **G3 becomes:** all automated tests (including end-to-end); **one full mutation run**; from the manual checklist only the items this change touches, plus M-01 to M-03 as a smoke test; the production smoke test and security headers as usual.
- **Waiting time:** while mutation, Codex or CI runs, move the next piece of work forward; if CI shows no progress for 3 minutes, find out why and cancel and re-run a stuck job.
- The PR description says "small-fix track" and which conditions hold.

### G3 release
1. Run the **full** manual acceptance checklist and all automated tests on the `main` preview link.
2. After the owner confirms, merge `main` into `release`, and production goes live.
3. Run the smoke test on the production address; tag; write release notes (listing only tested features).

### G4 user feedback loop
1. Record every piece of feedback in `docs/feedback_log.md`: **pseudonyms only** and anonymised content; contact details and original material do not go into the repository.
2. Classify: calculation error (**stop promoting immediately**, fix it first and add tests) / usability problem / new requirement (goes to the backlog, assessed in the next PRD version).

## 4. Definition of Done

Before a PR merges it must meet the following (for items that do not apply, say why in the PR):
- [ ] Self-test gate done and recorded (rule check, hostile input, mutation check, fresh-context review)
- [ ] Implementation matches the relevant rules in PRD §5
- [ ] Every acceptance point involved has a test, with the ID in the test name; every hand-worked case in the test plan matches
- [ ] Invalid-input cases exist and pass
- [ ] CI fully green (including the TC coverage check and Python recalculation)
- [ ] Codex review comments handled and recorded
- [ ] The owner has accepted the checklist items this PR touches on the preview link, and commented Accepted
- [ ] Docs updated to match
- [ ] This stage's section in the progress record (`docs/PROGRESS.md`; English snapshot `docs/en/PROGRESS.md`) updated (goal / what was done / how it was verified / reviews / decisions / open items / links), and synced to the shared Google Doc

## 5. Review records
`docs/PROGRESS.md` (English snapshot `docs/en/PROGRESS.md`) is the progress record for the team (one section per stage, fixed template, can be shared externally as is); below is the process record for reviews.

One file per review, with Codex's raw output saved separately; kept in the private development repository; summarised in `docs/en/REVIEW_SUMMARY.md`.
