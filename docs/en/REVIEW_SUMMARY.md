# Review summary

How each stage of Deal Ops Toolkit was reviewed before it was accepted, written on 2026-10-20 at release v1.0.0, updated on 2026-10-21 at release v1.1.0 and on 2026-10-26 for release v1.1.1. The raw review output and the item-by-item triage notes stay in the private development repository; this summary replaces them in the public one.

## How a review works

- **Docs first.** The requirements (`docs/en/01_PRD.md`), technical design, rules and test plan were reviewed and signed off before the build began.
- **One pull request per milestone**, with automated checks: type check, lint, unit tests, a check that every test-plan case due at that milestone ran and passed, the independent Python oracle, a production build and, from M2, end-to-end browser tests.
- **Self-test gate.** After the first code review (M1, round 1), a self-test gate runs before the first Codex review of each pull request, and before every M1 round from round 2: rule-by-rule comparison with the code, hostile inputs, mutation testing (each deliberate breakage must be caught by a test), and a fresh-context reviewer agent that uses the same prompt as Codex. Its findings are fixed first. Later rounds re-run the tests and the mutation check on the fixes.
- **Codex cross-review** until it returns `READY`, or `READY AFTER FIXES` with the fixes applied. Verdicts: `REWORK` (fix and review again), `READY AFTER FIXES` (fix; a further round is optional, and was run when the fixes were substantial), `READY`.
- **Owner acceptance** before merge; production deploys only from the `release` branch after the release gate (G3) and the owner's explicit OK.

## Stages

| Stage | Codex rounds | Verdicts, in order | Self-test reviews |
|---|---|---|---|
| G0/G1 requirements and design | 6 | REWORK, REWORK, REWORK, REWORK, READY AFTER FIXES, READY AFTER FIXES | — (the gate was introduced in M1) |
| M1 calculation engines | 4 | REWORK, REWORK, REWORK, READY AFTER FIXES | 3 (from round 2 on) |
| M2 reconciliation and allocation screens | 6 | REWORK ×5, READY | 1 |
| M3 exit distribution screen and guided tour | 4 | READY AFTER FIXES ×3, READY | 1 |
| M4 release preparation and visual refresh | 1 | READY AFTER FIXES | 1 |
| G3 release fixes | 1 | READY AFTER FIXES | 1 |
| Post-release improvements (v1.1.0) | 1 | READY AFTER FIXES | 1 |
| Save-failure message fix (v1.1.1) | 1 | READY | 1 |
| **Total** | **24** | | |

One further M4 Codex run stopped at the review service's usage limit without output. It is not counted; the review was run again.

## What the reviews found and what changed

**G0/G1 requirements and design (6 rounds).** Round 1 found 6 must-fix, 14 important and 4 minor issues; by round 5 only 2 minor remained, and round 6 checked the v0.7 scope reduction. Examples: a payment reference matched as a substring could book money to the wrong investor; several fixed fees merged and then split could no longer be traced line by line; invalid input could still produce a result; "no result when a check fails" contradicted "a review queue needs the result"; using nominee share counts truncated to six decimal places as distribution weights misallocated money; CSV headers did not check the currency. All were fixed in the documents before the build.

**M1 calculation engines (4 rounds).** Examples: a hurdle of exactly half a penny was rounded away (in both the app and the oracle); a fee whose ID was `__proto__` disappeared; a decision made on a line that later changed came back as an automatic booking; CSV rows with extra cells were silently truncated, so a malformed amount could become a different valid amount; a transaction ID with spaces could book the same payment twice; a non-breaking space at the end of a reference was trimmed and caused a wrong booking; results depended on the runtime's Unicode version. After round 1 the owner added the self-test gate, so that Codex confirms rather than finds problems first. Every finding has a regression test.

**M2 reconciliation and allocation screens (6 rounds).** None of the findings was a wrong calculation. All were cases where the figure on screen could differ from what was saved, handed on or exported. Examples: pasted text survived "Clear all data"; a set-aside decision came back when the data was changed back; renaming an investor removed an over-payment refund; a file read finishing after "Clear all data" restored the data; an edit still being typed was ignored by copy and export; a pending edit was written into another investor's row after the table was replaced; an edit made while a slow file loaded was overwritten. Each has a regression test and a mutant.

**M3 exit distribution and guided tour (4 rounds).** None was a calculation error. Most concerned the tour; others concerned holdings export validation and tier editing. Some tour entry points (start, restart, chapter jump, resume, replay, the first-visit button) could replace a person's own data with the sample without a warning, and the step-10 demonstration cap was not always put back after a reload, an exit or the person's own edit. Card texts that disagreed with the screen were also corrected. Each has a regression test and a mutant. A guided-tour design review cut the tour from 16 to 12 steps before it was built.

**M4 release preparation and visual refresh (1 round).** The visual refresh followed a design proposal approved by the owner. The self-test reviewer found one important issue (the "Clear everything" confirmation button was nearly invisible on wide screens) and four minor ones. Codex found one minor issue: some guided-tour buttons were under 44 px tall on phones. A walk through the manual checklist on the preview then found summary figures overflowing their cards and dates and names wrapping in tables. All were fixed. Four layout fixes were verified by restoring the defect and seeing an end-to-end test fail; the other changes were checked through code or visual inspection.

**G3 release fixes (1 round).** The release check's manual case M-11 (a five-investor deal built from scratch) found three usability problems: an import message hidden by a section that folded itself, the open module tab cut off on phones, and no starting hint on an empty allocation. The self-test reviewer found that adding the first row by hand still folded the section; Codex found that the first fix moved keyboard focus away from the import button. A second walk through the checklist found an import message that stayed on screen after the sample replaced the list. All were fixed with tests.

**Post-release improvements, v1.1.0 (1 round).** The owner reviewed the live site and asked for interface fixes, a light/dark switch and, after a review of common practice, professional currency handling (no conversion on a change of currency, the currency named in labels, exports and the closing confirmation). The self-test reviewer found one important issue (printing from dark mode gave light text on white) and five minor ones (keyboard focus around two confirmations, explanations opened from the keyboard, a click on an explanation inside a label changing a radio choice, an incomplete count in the currency confirmation, high-contrast mode). Codex found three minor ones (Esc in Safari, the currency not heard by screen readers, focus in the currency confirmation). All were fixed with tests; the label-click fix is proven by an end-to-end test because the unit-test environment does not model label clicks. No calculation rule or figure changed.

**Save-failure message fix, v1.1.1 (1 round).** While preparing the next version, the save message was found to name the wrong cause: a full browser store said "storage is blocked", and a browser that refused storage outright showed nothing. The fix tells the two apart and puts the message where screen readers announce it. The self-test reviewer found the silent case (storage refused as soon as it is read) and the missing announcement; Codex returned READY and suggested three more tests, which were added.

## Counts at release

From the release commit on 2026-10-20: 271 unit tests pass; all 143 test-plan cases due at release ran and passed (the other 5 IDs were removed in PRD v0.7); 22 end-to-end tests pass, covering all 9 planned end-to-end cases; 107 of 107 deliberate breakages are caught; the Python oracle passes its own 139 checks and agrees with the app field by field on the hand-calculated cases and on 1,100 generated cases.

From `main` on 2026-10-21, released as v1.1.0: 284 unit tests pass; all 149 test-plan cases due ran and passed; 27 end-to-end tests pass, covering all 9 planned end-to-end cases; 131 of 131 deliberate breakages are caught; the oracle's self-check passes 139 of 139.

From `main` on 2026-10-23, released as v1.1.1: 287 unit tests pass; all 150 test-plan cases due ran and passed; 27 end-to-end tests pass, covering all 9 planned end-to-end cases; 141 of 141 deliberate breakages are caught; the oracle's self-check passes 139 of 139.
