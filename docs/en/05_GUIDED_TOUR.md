English snapshot of docs/05_GUIDED_TOUR.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20, updated for guided tour v0.3 (PRD v0.8) on 2026-10-25.

# Deal Ops Toolkit — Sample tour (R-X-01) design

Version v0.3 · 2026-10-23 · Status: **Confirmed by the owner (v0.2: 2026-10-20, "Build v0.2; add a confirmation to Clear all data"; v0.3: 2026-10-23, "as recommended", PRD v0.8 decision 11)** · Based on: PRD v0.7.2 R-X-01 "Load a fictional sample deal in one click; a tour mode highlights and explains the typical problems in the three modules, step by step"; PRD v0.8 R-X-01.2

- v0.1 → v0.2: the owner asked for a professional design from an industry and user-experience point of view. A separate expert agent (onboarding design for B2B finance tools + UK SPV operations) reviewed the draft, the PRD, the test plan and the current UI (including 375px screenshots); this version adopts its design. **No calculation rule changes.**
- v0.2 → v0.3: per PRD v0.8 R-X-01.2 (approved by the owner on 2026-10-23, "as recommended"; based on the v0.8 research note, kept in the private development repository): still 12 steps and the sample data is unchanged; step 6 gets one sentence introducing "Copy message" (step 2 gets none); the end card gets an Activity log sentence and 3 "Try next" items (each with "Take me to it"); each new panel gets a one-line hint. See §3.1–§3.3. **No calculation rule changes.**

## 1. Principles

- **One card covers one problem, in at most 3 sentences.** Numbers are read from the current calculation result and then displayed, not hard-coded in the copy (display only; no money maths).
- **Learn by doing, but "doing" is used only for decisive actions** (confirm, reject, hand off); everything else is just viewing. When an action is done, the card shows the result in place (for example "Booked. Booked to investors is now £86,000.00."), and **does not move to the next step automatically**.
- **A person decides.** Every action step has "Do this for me"; after doing it, the card says "Done for you — in a real deal, this is your decision.". No blocker is bypassed.
- **Pressing Enter all the way through finishes the tour** (focus always stays on the card's main button).
- **Leave, resume or restart at any time**; never interrupt the user's own work; never quietly change a value the user entered.
- No requests sent and no third-party tour library (to avoid conflicts with the CSP); a self-written component of about 200 lines.

## 2. Entry points

- **First visit**: the disclaimer card gets two buttons, both of which include an explicit acknowledgement: main button "I understand — take the 3-minute tour" (acknowledge + load the sample + start); secondary button "I understand" (go to a blank deal).
- **Always available**: the sidebar has "Take the tour" (M4 copy change 6, originally "Guided tour"; see the M4 visual plan (not published)); after leaving part-way, it shows "Resume tour (step 6 of 12)" and "Restart".
- **Empty state**: when the reconciliation page has no data, a one-line hint "New here? Take the guided tour on a fictional deal."
- No pop-ups, and no automatic start on every visit.
- When the current data is not the "unchanged sample", confirm once before starting: "This replaces the deal currently on this page. It is stored only in this browser."

## 3. Steps (12 steps, plus a start card and an end card)

**Start card**: "Walk through a fictional seed round: you'll book receipts, close the round and split an exit. About 3 minutes — leave any time with Esc." (Start / Not now)

| # | Module | Highlight | Card text (English) | Action | Real pain point |
|---|---|---|---|---|---|
| 1 | Reconciliation | Summary figures + rule note | "Northwind Robotics is a fictional seed round: 12 investors, 16 bank lines. 9 receipts were booked automatically because their reference names exactly one investor. Everything else waits for you — nothing is booked on a guess." | Next | The worst thing in automatic reconciliation is booking to the wrong person, so the "conservative" rule comes first |
| 2 | Reconciliation | t03 suggestion | "No reference at all. The payer name and amount match Chloe Martin, so she's suggested (score 0.55) — but not booked. Confirm Chloe." | Confirm | Investors do not write a reference |
| 3 | Reconciliation | t05 suggestion | "A family office paid £15,000 — Elena's amount, but not her name (score 0.35). In a real deal, check it's her investing entity before you confirm. Here it is: confirm Elena." | Confirm | Payment from an entity or family office needs human judgement most |
| 4 | Reconciliation | t12 suggestion | "Typo: 'NW 11' instead of NW-011. The score is high (0.80), but it is still your decision. Confirm Kavya." | Confirm | Mistyped reference; a high score still does not book automatically |
| 5 | Reconciliation | Rows t14 and t11 | "t14's reference NW-0019 contains NW-001, but it is a different reference — so it was never booked to Amelia. t11 is a supplier invoice, flagged after 13 days unmatched. Mark both 'Not part of this deal'; sending money back is your call, outside this tool." | Reject both | A reference embedded in a longer reference; money that does not belong to this deal; long-unmatched is only a warning |
| 6 | Reconciliation | Rows for David and Hugo + export chase list + David's "Copy message" (v0.3) | "David is £500.00 short — on the chase list you can export. Hugo paid £5,000.00 more than due — listed as a refund, not invested. 'Copy message' next to each name gives you the chase email to send yourself." (v0.3 adds the last sentence, see §3.1) | Next | Underpayments need chasing, duplicate payments need refunding; the chase email is sent by a person |
| 7 | Reconciliation | Checks panel + hand-off button | "Every suggestion is decided, so hand-off unlocks — and every figure has passed its self-checks. Hand-off takes a snapshot: if you change reconciliation later, Allocation says 'out of date' instead of changing silently." | Hand off (switches to the allocation page) | Self-checks give confidence to send things out; upstream changes do not quietly change downstream |
| 8 | Allocation | Summary + rows for David and James | "Each investor is allocated on what actually arrived, less the 3% platform fee: £10,000 buys £9,700.00 of shares. David is in on £2,000, not £2,500. James's £3,000 arrived after the as-of date, so he is not in this close." | Next | Allocate on money received; fees come out of the payment; arrivals after the cut-off date |
| 9 | Allocation | Amelia's S/EIS cell | "Investors hold fractional shares through the nominee, but S/EIS relief needs whole shares. Amelia holds 4018.726436 shares: 4,018 can be claimed, £1.76 can't. The tool flags it; it doesn't judge eligibility." | Next | The contrast between fractional and whole shares explains the nominee structure well |
| 10 | Allocation | Cap input → blocker panel | Before clicking: "When a round is oversubscribed, everyone is scaled back pro rata. See what happens with a smaller cap." After clicking: "Isla would fall below the £1,000 minimum, so the allocation is blocked and she is named — the tool won't fix it quietly. Next puts the cap back to £150,000." | Card button "Try a £80,000 cap" (can be skipped) | Oversubscription scale-back; falling below the minimum after scale-back is for the lead to handle |
| 11 | Allocation | Confirmation summary + copy + hand off to exit | "This is the summary the lead confirms before money goes to the company: totals, fees, refunds, every investor. Copy it into your email. Then carry the holdings into the exit." | Hand off to exit (switches to the exit page) | The lead's confirmation step |
| 12 | Exit | Distribution steps table, carry total emphasised | "Exit: £390,000 back, £4,500 costs, after 6 years. Investors get their £100,395.00 first, then an 8% a-year hurdle, then the lead catches up. Carry ends at exactly 20% of the profit: £57,021.00." | Finish | Shows how a hurdle and a catch-up change the distribution |

**End card** (redesigned in v0.3, full layout in §3.2): the existing text, buttons and small print stay; it adds "Every decision you just made is in the Activity log." and 3 "Try next" items. v0.2 text: "That's the whole flow: receipts → closing → exit. Each investor's exit share follows the amount invested, fees excluded. Tiered carry is under the carry type switch. To try your own deal, clear the sample and import your investor list and bank statement." Buttons: Clear and start my own deal (confirms first) / Keep exploring the sample / Replay tour. Small print: "Your deal data never left this browser."

About 2–2.5 minutes in total (6 action steps, 5 read-only steps, 1 demonstration step); v0.3 adds one sentence to read at step 6 and the end card, about +10–15 seconds (the research estimate for options D+E), with no new actions.

### 3.1 Step 6 (v0.3)

Note: the English in the table and below is **how it reads on the sample deal**; in the code the numbers are read from the calculation result (`paymentStory`), and the copy follows the state (Codex M3 R1 #3). The older v0.2 wording "Hugo paid twice: the extra £5,000…" was already changed in M3 to describe the state; it is corrected here too.

| | English | Sentences / words |
|---|---|---|
| Before (v0.2, current code) | "David is £500.00 short — on the chase list you can export. Hugo paid £5,000.00 more than due — listed as a refund, not invested." | 2 sentences / 23 words |
| After (v0.3) | "David is £500.00 short — on the chase list you can export. Hugo paid £5,000.00 more than due — listed as a refund, not invested. 'Copy message' next to each name gives you the chase email to send yourself." | 3 sentences / 37 words |

- The new sentence matches the approved draft in the research note word for word, and contains no numbers. It is shown only when the chase list is not empty (on the sample the list holds David and James: James's t16 is after the as-of date, £0 received); when the list is empty it is not shown, so it never points to a button that does not exist.
- One highlight target is added after the existing three: the "Copy message" button on David's row (new anchor `copy-message-c04`, placed as in the R-REC-10.1 UI). It goes **last**, so the scroll position is still set by the first target and the existing layout checks are unaffected.
- Still a read-only step (Next); clicking Copy message is not required; "Take me to it" still focuses the first target's control (unchanged).
- Step 2 is unchanged (a change the owner approved: that step asks the reviewer to confirm a match, and inserting the query text would distract).
- The "at most 3 sentences" principle still holds; 37 words is above the 25–30 words per box from Navattic in the research (this design has no word limit; step 5 was already about 50 words). The approved text is kept as is.

### 3.2 End card (v0.3)

Layout (top to bottom; `tour-end` is still a TourNote, not a step 13):

1. Title: "That's the whole flow" (unchanged)
2. Body: "Receipts → closing → exit. Each investor's exit share follows the amount invested, fees excluded. Tiered carry is under the carry type switch." (unchanged; only the "your own deal" sentence moves to after the list)
3. New line: "Every decision you just made is in the Activity log."
4. New subheading "Try next", with 3 items below it, each one or more sentences plus a "Take me to it" link (link-style button, touch target ≥ 44px):

| # | English (as shown on the sample) | Where the numbers come from (display only, no calculation) | Where "Take me to it" goes |
|---|---|---|---|
| 1 | "Mark Lucas Meyer withdrawn. You'll need his written consent. His £3,000.00 moves to refunds." | Lucas's (c12) received amount in the reconciliation result | Switches to the reconciliation page and focuses the withdraw control on Lucas's row (new anchor `withdraw-c12`) |
| 2 | "Change who pays the platform fee to the company. Isla's £1,000.00 minimum blocks it: lower the minimum commitment (Deal settings) to £970.00, then apply and see each investor's new amount due." | The blocked person's name and her new amount due N: one run of the C-ALL-10 preview function (a pure function in `src/lib/`) for "platform fee → company"; £1,000.00 is `allocInput.minimum` | Switches to the allocation page and focuses the first control of the "Change who pays a fee" panel (new anchor `fee-payer`) |
| 3 | "Undo a confirmed payment to see 'Copy query'." | No numbers | Switches to the reconciliation page and focuses Undo on the first manually confirmed bank line (t03 Chloe on the sample; new anchor `undo-<txn>`) |

5. "To try your own deal, clear the sample and import your investor list and bank statement." (original text, moved here)
6. Small print "Your deal data never left this browser." (unchanged)
7. Buttons: Keep exploring the sample (main button; focus stays on it, so pressing Enter all the way still ends with it) / Clear and start my own deal (confirms first) / Replay tour (unchanged)

Notes on the text:
- The only difference from the research draft is the money format: the draft wrote "£3,000", "£1,000", "970"; under the §1 principle "numbers are read from the current calculation result and then displayed", they are shown in the UI's standard money format as £3,000.00, £1,000.00, £970.00 (I-01 accepts the input `£970.00` or `970`).
- When an item's precondition does not hold on the current data, **the item is not shown** (no `(unavailable)`): item 1 needs Lucas on the list, not withdrawn, with received > 0; item 3 needs at least one manually confirmed bank line; item 2 needs the platform fee to be a percentage fee paid by investors, and the panel to be available (R-ALL-12.1); when the preview has no blocker, the "Isla's … to £970.00, then" part is dropped and it reads only "Change who pays the platform fee to the company, then apply and see each investor's new amount due.". On a normal run through the tour all 3 items are shown (covered by tests).
- Item 2 (Codex v0.8 rounds 2 and 3): first preview with the current settings; with no blocker, show the text without the minimum part. With a blocker, run a second preview with "minimum £970.00": **only if that preview has no blocker** is "Isla's £1,000.00 minimum blocks it: lower the minimum commitment (Deal settings) to £970.00, then apply …" shown; otherwise item 2 is not shown (for example if the cap is changed to £80,000, or James's amount due is changed to £980 so that lowering the minimum brings him in and the third step then excludes him again).
- Word counts: 7–25 words per item; the whole card is about 50 words longer than in v0.2; at 375px the card scrolls inside (the bottom drawer stays at most 40vh high).

How "Take me to it" works on the end card — existing mechanisms only, no new feature:
- Switch tab (`setTab`, as the tour steps do); after the page renders, find the element by its `data-tour` anchor, scroll it to the centre (no smooth scrolling under `prefers-reduced-motion`), and focus it or the first enabled button / input / select / a inside it — the same logic as the existing "Take me to it" on step cards.
- **Takes you there, does not do it**: does not tick consent, fill a date, change the minimum, or click Apply / Undo; there is no "Do this for me" (these are all money decisions, §1 "A person decides").
- The end card stays open (non-modal), so the three items can be tried one after another; it moves to the top right when it overlaps the target (the step card's two CSS classes); Esc or "Keep exploring the sample" closes it.
- The minimum for item 2 is changed on the **Deal** page (field "Minimum commitment", `deal.minimum`), not on the allocation page; the link only goes to the fee-payer panel, the blocker message names Isla, and the text tells the person to lower the minimum. See §8 question 3.

Check (sample deal, data after finishing the tour; based on PRD C-ALL-1, C-ALL-2, C-ALL-10 and test plan TC-ALL-35, TC-REC-47):
- **Lucas Meyer**: amount due £3,000; t13 (10-15, £3,000, reference NW-012) is an exact match booked automatically, before the as-of date 2026-10-16 → paid in full. After withdrawal, refund due £3,000.00, reason Withdrawn (TC-REC-47). ✓
- **Isla Campbell**: amount due £1,000, t10 £1,000 paid in full; sample minimum £1,000 (`SAMPLE_SETTINGS.minimum = 100_000` pence), fee basis "taken out of the payment", 3% platform fee paid by investors.
  - Platform fee → company, minimum £1,000: first step, committed allocation R = £1,000 ≥ £1,000, participates, T = ⌊1,000 × 0.97⌋ = £970.00; second step, no investor fees under the new fee table, N = £970.00; third step, per C-ALL-2 "when fees come out of the payment, R is compared": R = N = £970.00 < £1,000 → does not participate → blocked (exactly the third worked example of C-ALL-10). ✓ The blocker is the expected result.
  - Minimum changed to £970: first step R = £1,000 ≥ £970, T = £970.00; third step R = £970.00, **not below** £970 (C-ALL-2 is "below the minimum → does not participate"; equal participates), M = £970.00 = T → passes. ✓ 970 is exactly the boundary: £970.01 still blocks.
  - Everyone else: the smallest N is David's £2,425.00 (amount due £2,500 × 97%), all above £970; the 12 investors' N total £120,280.00 < cap £150,000, so no scale-back (TC-ALL-35: total £124,000.00 → £120,280.00, difference −£3,720.00; the company pays a platform fee of £3,608.40). ✓
  - "see each investor's new amount due" (the approved draft said "see each refund", see §8 item 4): after applying, the 9 investors who paid in full have each paid 3% too much (e.g. Isla £30.00), and Hugo's refund due goes from £5,000.00 to £5,150.00; David and James have not paid in full, so for them the difference shows as a smaller chase (David short £500.00 → £425.00, James £20,000.00 → £19,400.00), not a refund. See §8 question 4.
  - Changing the minimum is a deal setting; it does not count as "the investor table was edited by hand in allocation" (R-ALL-12.1) and does not void the fee-payer change (C-ALL-11); but it makes an exit already handed off show "out of date" (`allocVersion` + 1, existing behaviour).
- **Undoing a confirmation**: after Undo on t03 it goes back to awaiting review, and "Copy query" appears next to the candidate Chloe (0.55) (R-REC-10.2). Reconciliation changed → allocation shows "out of date, hand off again" (R-X-07).

Relation to "Resume tour" and the step count: the end card is shown after Finish on step 12, when tour progress has already been cleared (`remember(null)`) and the sidebar is back to "Take the tour"; STEPS is still 12, and "Step N of 12", "Resume tour (step N of 12)", chapter jumps and `stateAt` are unaffected. After "Try next" has changed the data, clicking Replay / Take the tour goes through the existing "this replaces the current deal" confirmation (`nothingToLose` / `tourIntact(12)` no longer hold), which is the intended behaviour.

### 3.3 One-line hints on the new panels (v0.3)

Each new panel has a one-line light hint under its title (`hint` style), not part of the tour steps:

| Panel | Hint (English) | When shown |
|---|---|---|
| Activity log (R-X-08.1) | "Decisions you make appear here." | When the log is empty (empty state). Note: loading the sample itself writes a `sample_loaded` entry (C-X-1), so on the sample the log is never empty; this hint is seen only on a blank deal |
| Withdrawal before closing (R-REC-11.1) | "Mark an investor withdrawn before closing: everything they paid moves to refunds." (13 words) | Always |
| Change who pays a fee (R-ALL-12.1) | "Move a percentage fee to investors, the company or the lead before closing. Each investor's amount due changes so their investment stays the same." (24 words, 2 sentences) | Always; when the panel is disabled, the reason is on a separate line |

The last two are new wording drafted here (the PRD only asks for "one sentence each"), consistent with C-REC-7 and C-ALL-10.

## 4. Interaction details

- **Card**: non-modal `role="dialog"`; on desktop fixed to the bottom right (about 360px wide), moving to the top right when it overlaps the highlighted target (just two CSS classes, no floating positioning, so it fits the CSP). At the top, a three-part progress bar (Reconciliation / Allocation / Exit, clickable) and "Step 3 of 12"; at the bottom, Back, the main button, "Take me to it" (moves focus to the highlighted control) and Exit tour.
- **Highlight**: the target gets a 3px solid outline and a light outer ring (one set for light mode, one for dark); table rows use a cell background plus a left border; **no full-screen overlay**; scroll to the centre, with no smooth scrolling under `prefers-reduced-motion`; horizontally scrolling tables also scroll to the target column.
- **Keyboard**: Esc leaves (data kept, with a hint that Resume tour picks it up again); ← → previous / next step (ignored inside input fields; cannot move forward while an action is not done); Enter triggers the main button.
- **Screen readers**: `aria-live` inside the card reads out the step and the result; the highlighted element's `aria-describedby` points to the card body.
- **375px**: the card becomes a bottom drawer (at most 40vh high, collapsible to a single bar "Step 3/12 · Show"); the tour switches tabs for the user and says "Now in: 2. Allocation"; touch targets ≥ 44px.
- **Resume and chapter jumps**: one deterministic function "sample + actions of the first N steps → state at step N" implements resuming, jumping by chapter and E2E-05. Tour progress is stored as a UI preference, **not together with deal data**, and "Clear all data" clears it too. If the data has changed when resuming → offer to reload the sample from step N.
- **When the user does the "wrong" thing**: judge by state, not by clicks. For example, if t05 is assigned to someone else, the card explains and offers "Fix it for me" (undo, then confirm Elena); if a later action was done early, that step shows as already done when reached; going Back to a completed action step shows "Done ✓", and **money decisions are never undone automatically**.
- **Header buttons**: during the tour, clicking "Load sample deal" means "restart the tour?"; clicking "Clear all data" ends the tour.

## 5. Out of scope

No off-the-shelf tour library; no full-screen overlay, focus trap or timed autoplay; no hard-coded numbers in the copy; no quiet reverting of the user's values (only what the tour itself changed is restored, and it says so); no bypassing blockers; **no switching to tiered carry in the tour** (switching clears the hurdle and catch-up, and the sample has no tier data; the end card only points to where it is); tour state does not go into the URL or exports; no separate quick version (chapter jumps replace it).

## 6. Owner confirmation

**v0.3 (2026-10-23)**: the owner replied "as recommended" to PRD v0.8 decision 11: no new tour steps; one sentence added to step 6, none to step 2 (a change the owner approved); the end card gets the Activity log sentence and 3 Try next items. The two panel hints in §3.3 are new wording drafted here and go to the owner with this design.

**v0.2 (2026-10-20)**

The owner replied "Build v0.2; add a confirmation to Clear all data": items 1–4 below are done as in this design; item 5 is adopted, and "Clear all data" gets one confirmation.

Original questions:

1. Adopt the 12 steps above + start card + end card?
2. Interaction: the user clicks themselves + "Do this for me"; after completion it stays on the result and does not move on automatically; pressing Enter all the way through finishes it?
3. Entry points: two buttons in the disclaimer card + an always-available header button + the empty-state hint?
4. No quick version; use the three-chapter progress bar for jumping instead? (If scope is tight, cut chapter jumps first and keep resume and "do it for me".)
5. One extra suggestion (not part of the tour, but related): "Clear all data" currently clears immediately, with no confirmation. The tour will bring more people near it, so add one confirmation ("Clear all data in this browser? This cannot be undone."). This is a behaviour change and needs your agreement.

## 7. Tests

- E2E-05: press Enter all the way through the 12 steps; at every step the highlighted target exists, is visible and is not covered by the card; at the end the exit figures equal test plan §3.
- Also tested: after step 10 the cap is back to 150000; after leaving with Esc the data is kept and Resume returns to the same step; at 375px the target of step 9 is visible; clicking "Exit" on the progress bar goes straight to step 12 and the figures are still correct; after a "wrong" action, "Fix it for me" restores the correct state.

Tests to change or add for v0.3 (TC-X-11, E2E-05):
- **Tour script tests** `src/tour/script.test.ts`: "12 approved steps" unchanged (still 12 steps, three chapters); in "every card quotes real figures" the step 6 expectation adds the Copy message sentence; new `TC-X-11`: step 2 text is the same as v0.2; step 6 has the sentence when the chase list is not empty and not when it is empty (e.g. David and James both pay up); the pure function for the end card's Try next items (in `script.ts`, returning each item's text, tab and anchor) returns 3 items on the sample after the tour, with the §3.2 text and no `(unavailable)`; an item disappears when its precondition fails; item 2 drops the blocker part after the minimum is changed to £970.
- **E2E-05** `e2e/tour.spec.ts`: the step 6 card contains the new sentence, and the `copy-message-c04` target exists and is visible; the end card (`tour-end`) contains "Every decision you just made is in the Activity log." and 3 "Take me to it"; clicking each one: the tab switches to reconciliation / allocation / reconciliation and focus lands on the `withdraw-c12`, `fee-payer`, `undo-t03` anchors (or the first control in them), with the target visible and not covered by the card; clicking changes no data (reconciliation and allocation summary figures unchanged). Pressing Enter all the way still ends with "Keep exploring the sample", and the exit figure is still £57,021.00.
- **ui.test.tsx**: the existing step-count cases ("Step 10 of 12", "Resume tour (step 11 of 12)") are unchanged, as a regression check that the step count is not broken.
- **mutation**: add mutants for the step 6 display condition, the Try next preconditions and the anchors, so that the tests are shown to kill them.
- Time: about 10–15 seconds more for a reviewer (one more sentence and the end card); E2E-05 runs a few seconds longer because it clicks 3 links.

## 8. Questions and how they were handled (Claude 2026-10-23; no figure or approved scope changed)

1. **Milestones**: split. 〔M5〕 does the step 6 sentence, the Activity log sentence, Try next item 3 and the Activity log empty-state hint (test plan TC-X-11); items 1 and 2 and the hints on the withdrawal / fee-payer panels come with 〔M6〕 (TC-X-12). In M5 the end card shows only item 3.
2. **Order**: the approved order is kept (withdrawal first, then fee payer). After item 1 is done, item 2's panel says "out of date, hand off again", which itself shows the snapshot rule.
3. **Where the minimum is changed**: item 2's text now says where: "lower the minimum commitment (Deal settings) to £970.00". This only makes the text accurate; no feature change.
4. **"see each refund"**: changed to "see each investor's new amount due". The original is not true for David and James (they owe less; they get no refund).
5. **Recording what the tour does, jumps and replays**: a rule was added to PRD C-X-1: decisions the tour makes for the user are recorded as the same events as human decisions, with detail "guided tour"; a chapter jump or replay rebuilds the sample and is treated as "load sample" (the log is cleared and starts from `sample_loaded`, then each decision the tour makes is recorded), so nothing is recorded twice and the end card sentence holds.
6. **37 words at step 6**: accepted; no words removed.
7. **(Added while building M6, 2026-10-27) Two clarifications of item 2**; the result on the sample does not change:
   - "The panel is available" counts an **out-of-date** allocation as available: after item 1 the allocation is out of date, item 2 still shows, and "Take me to it" lands on a panel saying to hand off again (as item 2 of this section says). It is still left out when the investor table was edited after the hand-off, a change is already active, or the investors did not come from reconciliation.
   - The second preview "at a lowered minimum" is run only when **exactly one** investor is blocked for falling below the minimum; the minimum used is that investor's new cash due N (Isla's £970.00 on the sample). With two or more blocked, or any other blocker, item 2 is left out, because the text can name only one person.

Questions 3 and 4 only correct the text so it matches the calculation results; if the owner disagrees on seeing them, they will be changed again.
