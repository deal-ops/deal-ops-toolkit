English snapshot of docs/05_GUIDED_TOUR.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20.

# Deal Ops Toolkit — Sample tour (R-X-01) design

Version v0.2 · 2026-10-20 · Status: **Confirmed by the owner (2026-10-20, "Build v0.2; add a confirmation to Clear all data")** · Based on: PRD v0.7.2 R-X-01 "Load a fictional sample deal in one click; a tour mode highlights and explains the typical problems in the three modules, step by step"

- v0.1 → v0.2: the owner asked for a professional design from an industry and user-experience point of view. A separate expert agent (onboarding design for B2B finance tools + UK SPV operations) reviewed the draft, the PRD, the test plan and the current UI (including 375px screenshots); this version adopts its design. **No calculation rule changes.**

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
| 6 | Reconciliation | Rows for David and Hugo + export chase list | "David is £500 short — he's on the chase list you can export. Hugo paid twice: the extra £5,000 will be listed as a refund, not invested." | Next | Underpayments need chasing, duplicate payments need refunding |
| 7 | Reconciliation | Checks panel + hand-off button | "Every suggestion is decided, so hand-off unlocks — and every figure has passed its self-checks. Hand-off takes a snapshot: if you change reconciliation later, Allocation says 'out of date' instead of changing silently." | Hand off (switches to the allocation page) | Self-checks give confidence to send things out; upstream changes do not quietly change downstream |
| 8 | Allocation | Summary + rows for David and James | "Each investor is allocated on what actually arrived, less the 3% platform fee: £10,000 buys £9,700.00 of shares. David is in on £2,000, not £2,500. James's £3,000 arrived after the as-of date, so he is not in this close." | Next | Allocate on money received; fees come out of the payment; arrivals after the cut-off date |
| 9 | Allocation | Amelia's S/EIS cell | "Investors hold fractional shares through the nominee, but S/EIS relief needs whole shares. Amelia holds 4018.726436 shares: 4,018 can be claimed, £1.76 can't. The tool flags it; it doesn't judge eligibility." | Next | The contrast between fractional and whole shares explains the nominee structure well |
| 10 | Allocation | Cap input → blocker panel | Before clicking: "When a round is oversubscribed, everyone is scaled back pro rata. See what happens with a smaller cap." After clicking: "Isla would fall below the £1,000 minimum, so the allocation is blocked and she is named — the tool won't fix it quietly. Next puts the cap back to £150,000." | Card button "Try a £80,000 cap" (can be skipped) | Oversubscription scale-back; falling below the minimum after scale-back is for the lead to handle |
| 11 | Allocation | Confirmation summary + copy + hand off to exit | "This is the summary the lead confirms before money goes to the company: totals, fees, refunds, every investor. Copy it into your email. Then carry the holdings into the exit." | Hand off to exit (switches to the exit page) | The lead's confirmation step |
| 12 | Exit | Distribution steps table, carry total emphasised | "Exit: £390,000 back, £4,500 costs, after 6 years. Investors get their £100,395.00 first, then an 8% a-year hurdle, then the lead catches up. Carry ends at exactly 20% of the profit: £57,021.00." | Finish | Shows how a hurdle and a catch-up change the distribution |

**End card**: "That's the whole flow: receipts → closing → exit. Each investor's exit share follows the amount invested, fees excluded. Tiered carry is under the carry type switch. To try your own deal, clear the sample and import your investor list and bank statement." Buttons: Clear and start my own deal (confirms first) / Keep exploring the sample / Replay tour. Small print: "Your deal data never left this browser."

About 2–2.5 minutes in total (6 action steps, 5 read-only steps, 1 demonstration step).

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

## 6. Owner confirmation (2026-10-20)

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
