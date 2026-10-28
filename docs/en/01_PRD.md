English snapshot of docs/01_PRD.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20, updated at v1.1.0 on 2026-10-21, for v1.1.1 on 2026-10-23, for PRD v0.8 on 2026-10-25 and for v0.8.2 on 2026-10-27.

# Deal Ops Toolkit — Product Requirements Document (PRD)

Version **v0.8** (**approved 2026-10-25**; scope and the 3 recommendations approved 2026-10-23, the full text approved by the owner on 2026-10-25 after the document review) · previous approved version v0.7.6 (2026-10-23) · 2026-10-17 · Status: v0.7.6 **approved (2026-10-17)**, G0/G1 gates passed
v0.8.1 → v0.8.2 (2026-10-27, owner decision): the MT103 paragraph of C-REC-8 template A in generic wording.
v0.8 → v0.8.1 (2026-10-27, owner decision): R-DEAL-01 adds that the currency is locked while a fee payer change is active; reverse first, then change (decision 12).
v0.7.6 → v0.8 (approved 2026-10-25): adds two areas that need no operator-held data, chasing payments and changes before closing: chase and payment-query messages to investors, an activity log, withdrawal before closing, and changing who pays a fee before closing. New: R-REC-10, R-REC-11, R-REC-12, R-ALL-12, R-X-01.2, R-X-08, rules C-REC-7, C-REC-8, C-ALL-10, C-ALL-11, C-X-1; no existing calculation rule changes. See §8 decision 11.

- Owner: Haixiang Yuan (product) · Development: Claude Code (following this document and the Technical Design)
- v0.1 → v0.2: revised after Codex review round 1 (REWORK, 24 items) and the owner's decisions of 2026-10-16 (see the review summary).
- v0.2 → v0.3: revised after Codex review round 2 (REWORK, 14 items; all hand calculations correct) (see the review summary).
- v0.3 → v0.4: revised after Codex review round 3 (REWORK, 4 major + 2 minor; all hand calculations correct) (see the review summary).
- v0.4 → v0.5: after Codex round 4 (REWORK, 1 major + 1 minor), revised the editing and import/export rules for holding weights (see the review summary).
- v0.5 → v0.6: after Codex round 5 (READY AFTER FIXES, 2 minor), added the holdings export format and the share price source (see the review summary).
- v0.6 → v0.7: owner decision (2026-10-17): the product follows common UK syndicate practice. **Only the SPV nominee structure is supported**; direct holding is removed. Holdings are weighted by capital only. Basis: §8 decision 6.

Review records are kept in the private development repository and summarised in `docs/en/REVIEW_SUMMARY.md`.

---

## 1. Problem

### 1.1 Background
An SPV (several angels co-investing in one company through a special purpose vehicle) goes from "investor commitment" to "exit payout". In syndicate deals, three steps on that path are often handled with manual checking, spreadsheets and email (how widely is a hypothesis; see the evidence below). Each one is a module of this tool:

| Step | How it is commonly done | Where it goes wrong | What this tool does |
|---|---|---|---|
| **Payment reconciliation** | Bank receipts are matched to investors by hand, often from a spreadsheet; anything that does not match is chased by email | Missing or mistyped references, payments from a company or family-office account, underpayments and duplicates. The work grows with the number of investors, and a receipt booked to the wrong investor misstates two balances | Books a receipt automatically only when its reference names exactly one investor; suggests the rest, with reasons, for a person to decide; lists who to chase |
| **Closing allocation** | Closing needs a consistent breakdown of the cash received into each investor's investment, fees and refund, often kept by hand in a spreadsheet | A fee charged on the wrong base or to the wrong payer; fees still charged to an investor who falls below the minimum; scale-back amounts that do not add up to the cap; an S/EIS estimate that counts part of a share. The fee and allocation errors misstate the payment to the company or an investor's refund; the share error overstates what is shown as claimable | Calculates each investor's investment, fees, shares and refund with self-checks, blocks closing when a rule is broken, flags the part of a share that cannot be claimed under S/EIS, and writes the confirmation for the lead |
| **Exit distribution** | Carry is usually a fixed percentage. Non-standard terms (a hurdle, a catch-up, tiers) are often worked out by hand from the deal documents and confirmed with the lead | Applying carry before capital is returned, compounding the hurdle incorrectly, or applying a tier rate to all profit instead of its band can misstate the waterfall and overpay one party at the other's expense | Calculates the waterfall step by step with the reason for each step, and checks that investors, carry and exit costs add up to the proceeds |

Why these three first: they recur on every deal (reconciliation, closing) or every exit, they decide where money goes, and a mistake is hard to undo once money has moved. They also form one chain: the closing allocation uses the receipts that were reconciled, and the exit uses the holdings from the closing, so an early error carries through to the payout. Whether they are the "most" manual steps, and how often errors happen, **we do not know**; this is a hypothesis to test with users (see section 6).

v0.8 adds two kinds of work that are commonly done by email and by hand: chasing payments, and changes to a deal before closing.

| Step | Common practice | What v0.8 does |
|---|---|---|
| **Chasing and payment queries** | Receipts that do not match are queried by email; for an international payment the investor says was sent but has not arrived, the bank's standard evidence is the MT103 with its UETR | Writes the message to the investor for a person to copy and send; the tool sends nothing |
| **Record of manual actions** | Client money records must reconcile exactly (UK CASS) | An activity log in this browser: who did what, when, to which receipt |
| **Withdrawal before closing** | The investor's written consent is needed; money received is refunded | Marks the investor as withdrawn: not carried to the allocation, everything received listed as a pending refund |
| **Changing the fee payer before closing** | Moving a fee onto investors needs their consent; they top up, or the excess is refunded | Works out each investor's new cash due: how much to top up, how much to refund |

### 1.2 Evidence (all from public sources)
- Public material informed the prototype's scope. How often each step happens, how much manual effort it takes and what errors cost remain **hypotheses** to validate with users.

### 1.3 One-line definition
**A browser tool for SPV leads and operations staff. It turns payment reconciliation, closing allocation and exit distribution from spreadsheets and email into calculations where "inputs follow rules, every step is explained, and results check themselves". Deal data entered is processed only locally in the browser.**

---

## 2. Goals and non-goals

### 2.1 Goals
- **G1 Complete, verifiable build**: a product that is live, tested, documented and has review records, showing the full process "from problem to production with Claude Code". It covers payment reconciliation, the closing allocation (including fees) and the exit distribution (including carry), with their boundary cases.
- **G2 Usable by real users**: syndicate leads, angels and small-fund operations staff can import their own investor lists and bank statements. People without data can try the built-in sample deal. The sample is also the onboarding and training for new users.
- **G3 Verifiable**: every number can explain where it came from; every calculation checks itself; every requirement has a matching test; key calculations are cross-checked against a second, independent implementation.

### 2.2 Non-goals (explicitly out of scope for v1)
- No moving money, no bank connections, no legal documents, no KYC/AML, no regulatory or tax filings of any kind.
- No accounts; no deal data stored on any server.
- No multi-currency conversion: one deal uses one currency (one of GBP / EUR / USD).
- No judgement of S/EIS eligibility; no tax, legal or investment advice.
- No direct holding (investors registered directly on the investee company's register of members). The product supports only an SPV nominee: the nominee is on the register of members, and investors hold beneficial interests (which can be fractional shares).
- Exit distribution supports only: one capital contribution, one exit, the same terms for all investors. Not supported: staged contributions, past distributions, special carry for individual investors, management fees.
- No VAT calculation; fixed fees are taken as the total the user enters (the user decides whether it includes VAT).
- No real platform's name, logo, trademarks or brand assets, and no copied page text; all sample data is fictional. The visual design is the project's own (open-licensed fonts and its own design tokens), and the page keeps a "not affiliated with any platform" notice (decision 8).
- No analytics of any kind.
- (v0.8) No sending email and no opening an email program: messages to investors are for copying only, and a person sends them (`mailto:` would put investor details in the URL, breaking R-X-02).
- (v0.8) The activity log is only a working record in this browser, not a regulatory ledger, and is not tamper-proof; it is cleared with the rest of the data.
- (v0.8) Withdrawal is supported only before closing (leaving after closing is a transfer of the beneficial interest, a secondary transfer, not supported); no rolling close, share conversion, or two valuations in one deal.
- (v0.8) Changing the fee payer supports **percentage** fees only; per-investor and deal-level fixed fees are changed by the user by hand.

---

## 3. Users and scenarios

| User | Scenario | What they need |
|---|---|---|
| U1 Syndicate lead / deal lead | Closing a round quickly, with an investor list and a bank export | Know who has paid in full and who has not; how much each person finally invests and how much to refund |
| U2 Platform or fund operations | Handles several closings a week | Spend less time reconciling; get the allocation right first time; checks that make it safe to send |
| U3 Angel investor | Wants to know what they get at exit and how carry works | Enter the terms and see the distribution step by step |
| U4 First-time visitor | Has no data and wants to see what the tool does | Load the sample in one click and follow the guided tour |

---

## 4. Functional requirements

Each requirement is split into separately verifiable acceptance points (numbered like R-REC-04.2). Each acceptance point has a matching test in the Test Plan. Priority: P0 = must have in v1; P1 = should have in v1; P2 = backlog. **The three modules ship together in v1.**

### 4.0 Deal setup (DEAL)

| ID | Acceptance point | Priority |
|---|---|---|
| R-DEAL-01 | Deal name, currency (GBP/EUR/USD), cut-off date (default today). The currency is the unit of every amount and nothing is converted: money input labels show the currency symbol; the currency select says nothing is converted; when amounts exist, changing the currency asks first and says how many amounts will be recorded in the new currency with unchanged values; USD is shown as `US$`; a successful import says which currency the amounts were read in (v0.7.5, decision 10). (v0.8.1) While a fee payer change is active the currency is locked: the select is disabled and says "Reverse the fee payer change before changing the currency"; reverse it, change the currency, then redo the change (decision 12) | P0 |
| R-DEAL-02 | **The holding structure is fixed as SPV nominee** (nominee / bare trust): the UI shows "Holding structure: nominee (bare trust) — investors hold beneficial interests; fractional shares allowed" and offers no other option. Rules in C-ALL-5 | P0 |
| R-DEAL-03 | **Basis for investor percentage fees**: deducted from the payment (default) / added on top of the investment. Rules in C-ALL-1 | P0 |
| R-DEAL-04 | Minimum commitment (default 0; sample deal £1,000) | P0 |

### 4.1 Module 1: Payment reconciliation (REC)

| ID | Acceptance point | Priority |
|---|---|---|
| R-REC-01.1 | Import the commitment list (paste / upload CSV / edit as a table): investor ID (may be blank, then generated; must be unique when not blank), name, email, payment reference, **cash due** (all the cash the investor must pay in; under both fee bases it includes fees the investor pays), tax scheme (none/SEIS/EIS). The UI labels it "Cash due (including any fees charged to the investor)" | P0 |
| R-REC-01.2 | References must be unique after normalisation, and the original text may have at most 3 alphanumeric segments (e.g. `NW-001`, `NW 001 A`; `UK-NW-A-001` is not accepted); invalid or duplicate references give an error with the row number | P0 |
| R-REC-02.1 | Import the bank statement: transaction ID (may be blank), date, amount, payer, reference | P0 |
| R-REC-02.2 | Two import modes: replace / append. On append: same transaction ID and same content → ignored (not counted twice); same transaction ID but different content → import conflict, the whole batch is not imported; rows with no ID whose four fields are all identical are marked "possible duplicate import", and are neither auto-matched nor auto-deleted | P0 |
| R-REC-02.3 | Rows with amount ≤ 0 (outgoing or 0) are skipped and listed, not counted as import errors; rows dated after the cut-off are left out of this reconciliation and listed | P0 |
| R-REC-02.4 | Import is atomic: if any row has an error, the whole batch is not imported and all errors are listed (row number + column name + reason) | P0 |
| R-REC-03.1 | A payment is matched automatically only when "the statement reference contains, in full, the reference of exactly one investor" (rule C-REC-2) | P0 |
| R-REC-03.2 | A reference embedded in a longer code (e.g. NW-0019 for NW-001) is not a match | P0 |
| R-REC-04.1 | Other statement lines show up to 3 candidate investors, sorted by confidence, with reasons; candidates with confidence below 0.3 are not shown | P0 |
| R-REC-04.2 | Manual actions: confirm a candidate / assign any investor / mark "not part of this deal" / undo | P0 |
| R-REC-04.3 | Unconfirmed suggestions do not count towards any amount | P0 |
| R-REC-04.4 | After a manual decision, if the data of that statement line or that investor is changed or deleted, the decision is void and goes back to pending review | P0 |
| R-REC-05 | Status of each investor (compared with cash due): paid in full / underpaid / overpaid / unpaid, with the difference shown | P0 |
| R-REC-06 | Unmatched statement lines older than a threshold (default **more than 10 calendar days**, configurable) are marked "Needs review: long unmatched". The UI says this is an operations reminder, not a regulatory deadline and not an automatic refund instruction | P0 |
| R-REC-07 | Checks: matched + unmatched = statement total (arithmetic check); all suggestions dealt with (pending review status, see C-03) | P0 |
| R-REC-08 | "Carry to allocation": takes each investor's received amount as an input snapshot for the allocation; any amount above cash due is not carried over and is listed as a pending refund. Not possible while suggestions are still unresolved | P0 |
| R-REC-09 | Export: reconciliation ledger CSV; chase list CSV (unpaid/underpaid investors, difference) | P0 |
| R-REC-10.1 | **Chase message** (v0.8): every unpaid / underpaid investor in the chase list (except withdrawn ones) has "Copy message", which copies an English message to that investor (C-REC-8 template A); the chase list CSV gets a `message` column with the same text as the copied message | P0 |
| R-REC-10.2 | **Payment query message** (v0.8): for a receipt awaiting review, each candidate investor has "Copy query", which copies a message asking that investor "did you send this payment?" (C-REC-8 template B). The message gives only the date, amount and currency, **not the payer, the statement reference or the transaction ID** (they may be someone else's information) | P0 |
| R-REC-10.3 | The tool sends no message and opens no email program; after copying, the UI says "Copied. Send it yourself from your usual email." | P0 |
| R-REC-11.1 | **Withdrawal before closing** (v0.8): an investor row can be marked "Withdrawn". Marking requires ticking "Written consent from the investor received" and entering the withdrawal date (default the cut-off date); it can be undone. Rules in C-REC-7 | P0 |
| R-REC-11.2 | A withdrawn investor: status shows "Withdrawn"; not in the chase list; not carried to the allocation; everything received goes to pending refunds with reason "Withdrawn"; their cash due is left out of the summary's total due, and the summary shows the number withdrawn and the amount to refund separately | P0 |
| R-REC-11.3 | Payments arriving after the withdrawal are still matched to that investor as usual (it is the investor's own money) and counted in the pending refund | P0 |
| R-REC-12 | For an investor with an adjustment, reconciliation shows the adjusted cash due, with a small line below giving the source, e.g. "was £1,000.00 · +£30.93 fee payer change (Platform fee: company → investors)"; above the summary a banner "Fee payer change active: Platform fee → investors · consent recorded · Reverse". When the adjustment is voided the row shows "This fee payer change no longer applies — redo it" | P0 |

### 4.2 Module 2: Closing allocation (ALL)

| ID | Acceptance point | Priority |
|---|---|---|
| R-ALL-01 | Inputs: price per share, round cap (may be blank), fee list, investors (name, received, tax scheme); any invalid input → no result and no export | P0 |
| R-ALL-02 | Fee types: investor-paid "percentage" or "fixed amount per investor"; company-paid / lead-paid "percentage" or "fixed total amount". "Investor-paid fixed total amount" is not allowed | P0 |
| R-ALL-03 | Investors whose commitment is below the minimum: full refund, no fees | P0 |
| R-ALL-04.1 | When oversubscribed, everyone is scaled back pro rata to the cap | P0 |
| R-ALL-04.2 | If anyone falls below the minimum after scale-back → the allocation is marked "cannot close", those investors are listed, and the lead deals with it | P0 |
| R-ALL-05 | Investment amount and shares held are calculated per C-ALL-5; no one's refund may be negative | P0 |
| R-ALL-06 | S/EIS: for each S/EIS investor, show the estimated claimable whole shares and matching amount based on the final allocation; where part cannot be claimed, show the amount and the notice text in C-ALL-8. The group is only a user-entered label; eligibility is not judged | P0 |
| R-ALL-07 | Company-paid fees are deducted from the money sent to the company; lead-paid fees are listed as an invoice | P0 |
| R-ALL-08 | Cases where the deal cannot close (all reasons listed): no investors to allocate; company-paid fees exceed total investment; below minimum after scale-back; any check fails | P0 |
| R-ALL-09 | Totals by SEIS / EIS / none (count, amount, shares), with the notice: SEIS shares must be issued **on a day before** the EIS shares; the same day is not allowed | P0 |
| R-ALL-10 | Closing confirmation: a summary for the lead to confirm (currency code, totals, each fee, payment to company, refunds, per-investor detail), can be copied; CSV export. (v0.8) When withdrawn investors were carried over, the confirmation adds a section "Withdrawn before closing (refund in full):" after the overpayment refunds section, one line per investor "- name: amount" | P0 |
| R-ALL-11 | "Carry to exit distribution as holdings" | P0 |
| R-ALL-12.1 | **Changing who pays a fee before closing** (v0.8): a "Change who pays a fee" panel; pick one **percentage** fee and the new payer (investors / company / lead; only the two that differ from the current payer are listed). Available only when the allocation's investors were carried over from reconciliation, the snapshot is not out of date, and the investor table has not been edited by hand in the allocation since the carry-over; otherwise the reason is shown and the panel is disabled | P0 |
| R-ALL-12.2 | Preview (rule C-ALL-10): each investor's current cash due, target investment, new cash due and difference (positive = top-up, negative = refund); totals; and the consent the new payer needs: moving to investors "Investors' consent needed — keep the evidence"; moving to the company "The company's consent needed — it pays by invoice or from the wire"; moving to the lead "Inform only — no consent needed" | P0 |
| R-ALL-12.3 | "Apply change": when moving to investors or the company, "Consent evidence received" must be ticked first. The confirm button states the result in the fixed form "Apply: {n} top-ups totalling {amount} · {m} refunds totalling {amount}" (in the sample deal, moving the platform fee to the company with a £970 minimum gives "Apply: 0 top-ups totalling £0.00 · 12 refunds totalling £3,720.00"). After applying: the fee's payer becomes the new payer; **a separate "fee payer change" adjustment record is saved, and the original cash due in reconciliation is not overwritten** (rule C-ALL-11); reconciliation calculates with the adjusted cash due; the activity log gets an entry; the allocation shows "Out of date, carry over again" (R-X-07). Afterwards, investors who need to top up appear in the chase list automatically (with the R-REC-10.1 message), and those who paid too much appear in pending refunds | P0 |
| R-ALL-12.4 | If anyone's new result in the preview differs from their target investment (for example the cash due falls below the minimum), it is listed as a blocker with the name and reason, and the change cannot be applied | P0 |
| R-ALL-12.5 | At most one active fee payer change at a time: while one is active the panel shows only it and "Reverse"; to change again, reverse first. "Reverse" restores the original payer and everyone's original cash due in one step; the change record is marked "reversed", not deleted | P0 |

### 4.3 Module 3: Exit distribution (DIS)

| ID | Acceptance point | Priority |
|---|---|---|
| R-DIS-01 | Holdings: each investor's capital (= investment amount, **excluding all fees**; also the distribution weight) and a display share count; UI column name "Amount invested (excluding fees)"; comes from the allocation snapshot, or from manual editing of capital / CSV import (format in §5.5) | P0 |
| R-DIS-02 | Inputs: total exit proceeds, exit costs, years held (up to 2 decimal places) | P0 |
| R-DIS-03 | Fixed carry, with an optional annually compounded hurdle and catch-up (rules C-DIS). Hurdle and catch-up belong only to fixed carry mode | P0 |
| R-DIS-04 | Tiered carry: bands by the return multiple "after exit costs, before carry"; each band at its own rate (marginal calculation); no hurdle or catch-up | P0 |
| R-DIS-05 | Show the distribution step by step; each step states how much goes to investors, how much to the lead, and why | P0 |
| R-DIS-06 | Each investor's distribution, profit or loss, and return multiple (noted: the multiple excludes entry fees); CSV export | P0 |
| R-DIS-07 | Invalid terms or inputs → error, no result; exit costs above proceeds → show the shortfall, no final distribution | P0 |

### 4.4 General (X)

| ID | Acceptance point | Priority |
|---|---|---|
| R-X-01 | Load a fictional sample deal in one click; a guided mode highlights and explains typical problems in the three modules step by step | P0 |
| R-X-01.2 | (v0.8) The tour **adds no steps**; it stays at 12 steps. Changes: step 6 gets one sentence introducing "Copy message" (not step 2: that step asks the reviewer to confirm a match, and a query message there would distract); the end card adds "Every decision you just made is in the Activity log." and a "Try next" list (withdrawal, changing the fee payer, undoing a decision to see Copy query), each with "Take me to it"; each new panel has a one-line explanation. Exact wording in the Guided tour v0.3; the sample data does not change | P0 |
| R-X-02 | Privacy: deal data entered or imported is processed only locally in the browser, and the code never sends it anywhere; the page wording is "Your deal data is processed in your browser and never sent by this app. The hosting provider still receives normal page requests."; data is kept in this browser on this device, with a "Clear all data" button; deal data never appears in the URL. When saving fails, the message names the cause (v0.7.6): storage blocked → "This browser is not saving your data (storage is blocked), so it will be gone when you close the page."; storage full → "This browser's storage for this page is full, so your latest changes are not being saved. Export what you need before you close the page." | P0 |
| R-X-03 | On first open and in the footer: not investment, tax or legal advice; results need human checking; not affiliated with any platform | P0 |
| R-X-04 | At mobile width (375px) all steps of manual acceptance checklist M-01 to M-07 can be completed; light and dark themes supported. The theme can be switched on the page: System (follows the device, default) / Light / Dark; the choice is kept only in this browser and "Clear all data" removes it too (v0.7.4, decision 9) | P1 |
| R-X-05 | UI in English, in plain words; these terms have a one-line explanation in the UI (hover or expand): SPV, nominee / bare trust, beneficial interest, minimum commitment, scale-back, S/EIS, carry, hurdle, catch-up, tiered carry, waterfall; v0.8 adds withdrawal, MT103 / UETR, fee payer | P0 |
| R-X-06 | Feedback: one email link on the page, with the note "please do not send real investor information" | P0 |
| R-X-07 | Modules pass snapshots: downstream data is replaced only when "Carry to …" is clicked; after an upstream change, downstream shows "Out of date, carry over again" | P0 |
| R-X-08.1 | **Activity log** (v0.8, rule C-X-1): an "Activity log" page listing the events defined in C-X-1, newest first; append-only, no single entry can be edited or deleted in the UI | P0 |
| R-X-08.2 | The activity log exports to CSV; the page says "Kept in this browser only. A working record, not a regulatory ledger. Anyone using this browser can clear it, and once it holds 5,000 entries the oldest are removed. Export the CSV to keep a full copy." | P0 |
| R-X-08.4 | Capacity warning (C-X-1): from 4,000 entries every page shows "Activity log is 80% full. Export it now; after 5,000 entries the oldest are removed."; once entries have been removed without being exported, the warning becomes a prominent "N entries were removed before export." Being full never blocks an action or stops logging | P0 |
| R-X-08.5 | When browser storage is full (the message has been live since v0.7.6, R-X-02), the oldest activity log entries are removed first per C-X-1 and the save is retried, deal data first; only if it still cannot be saved after removing entries is the R-X-02 "storage full" message shown | P0 |
| R-X-08.3 | Deal setup has an optional "Your initials" field; every later entry carries it; left blank, it is recorded as empty | P0 |

---

## 5. Rules (product definitions; development implements them exactly)

### 5.0 Input rules (all modules)

General formats:
- **I-01 Amount**: a number, optionally with one symbol matching the deal currency (GBP `£`, EUR `€`, USD `$` or `US$`) and one minus sign (only fields that allow negatives accept a minus sign; see the field table); thousands commas must group in threes (`1,234.56` valid, `1,23` invalid); at most 2 decimal places; absolute value at most 1,000,000,000.
- **I-02 Percentage**: 0–100, at most 2 decimal places, `%` optional.
- **I-03 Share price**: greater than 0, at most 6 decimal places, at most 1,000,000; optionally with the deal currency symbol; thousands commas follow I-01 (v0.7.5, decision 10).
- **I-04 Date**: `YYYY-MM-DD` or `DD/MM/YYYY` (UK format); dates that do not exist are errors.
- **I-05 Multiple** (for tiers): greater than 1, at most 2 decimal places.
- **I-06 Years**: 0–50, at most 2 decimal places.
- **I-07 A required field that is blank or badly formatted is always an error, never treated as 0.** Errors state the location (module, row number, column name).
- **I-08 Size limits**: per deal at most 500 investors, 2,000 statement lines, 500 holdings rows, 20 fees; anything larger is rejected at import with an explanation. (v0.7.2: the fee count limit came from M1 code review round 2 R2-5 — with it, no total can exceed the exactly representable range.)
- **I-09 CSV**: UTF-8; the first row is the header; headers are case-insensitive and leading/trailing spaces are ignored; only the column names and aliases listed in §5.5 are accepted; a missing required column is an error naming the column; unknown columns are ignored with a notice. On export, a text-column cell starting with `= + - @`, a tab or a carriage return gets a leading `'`, and is treated as text even if it looks like a number; only the amount and quantity columns the program generates itself are left without it (v0.7.2 clarification, M1 code review #12). On import there are two kinds of field: **identifier and parsed fields** (investor ID, transaction ID, investor payment reference, email, share price, amount, date, tax scheme) have leading and trailing ASCII whitespace (space, tab, carriage return, line feed) removed, and a cell containing only such whitespace counts as blank; **free text** (name, payer, statement reference) is kept as is, without trimming (leading or trailing no-break spaces and similar characters matter for reference matching, and are needed for lossless export and re-import — M1 review round 3 R3-1; the handling of identifier fields was added by the self-test review before Codex, so that "T1" and "T1 " are not treated as two transactions). One file may mix CRLF, LF and CR line endings, whichever comes first; line breaks inside quotes are part of the cell content and kept as is (M1 review round 4 R4-1). "Trimming whitespace" in all parsed fields (amount, date, share price, percentage, tax scheme) removes only ASCII whitespace; no-break spaces and similar characters are format errors, not whitespace (R4-2). For lossless export and re-import, a text-column cell whose original text starts with `'` also gets an extra `'` on export; on import, a cell starting with `'` followed directly by `= + - @`, a tab, a carriage return or another `'` has that one leading `'` removed (self-test review #9; M1 review round 2 R2-3 changed this to a reversible rule).

Field table:

| Field | Required | Format | Range | Other |
|---|---|---|---|---|
| Investor ID | No (generated if blank) | Text ≤ 40 characters | — | Unique across the list when not blank |
| Name | Yes | Text ≤ 120 characters | — | — |
| Email | No | Text containing `@` | — | — |
| Payment reference | Yes | Original text is 1–3 segments of **English letters (A–Z, a–z) and digits**, separated by space, `-`, `/`, `_` or `.` (the lead gives the reference to investors; limiting it to English letters helps bank transmission; v0.7.2, review R2-1) | 3–20 characters after normalisation | Unique after normalisation |
| Cash due | Yes | I-01 | > 0 | Under both fee bases, all the cash the investor must pay in |
| Tax scheme | No (blank = none) | `none` / `SEIS` / `EIS`, case-insensitive | — | — |
| Statement transaction ID | No | Text ≤ 80 characters | — | See R-REC-02.2 |
| Statement date | Yes | I-04 | — | — |
| Statement amount | Yes | I-01, negatives and 0 allowed | — | ≤ 0 skipped and listed (R-REC-02.3) |
| Payer, statement reference | No | Text ≤ 200 characters | — | — |
| Received (allocation) | Yes | I-01 | ≥ 0 | — |
| Round cap | No | I-01 | > 0 | Blank = no cap |
| Minimum commitment | No (blank = 0) | I-01 | ≥ 0 | — |
| Fee value | Yes | Percentage I-02 / amount I-01 | Amount > 0 | Under "deducted from the payment", the investor-paid percentages must total < 100% |
| Holding capital | Yes | I-01 | > 0 | = investment amount, excluding all fees (not the amount paid). This is what makes "distribute by capital only" valid (C-DIS-7) |
| Holding share price | No | I-03 | — | One value for the whole holdings table; saved with the snapshot on carry-over; used only to display shares |
| Exit proceeds | Yes | I-01 | ≥ 0 | — |
| Exit costs | No (blank = 0) | I-01 | ≥ 0 | — |
| Cut-off date, threshold days | Yes / No (default 10) | I-04 / integer | Threshold 1–365 | — |
| Withdrawal date (v0.8) | Yes (when marking a withdrawal; default the cut-off date) | I-04 | — | Used only for display and the activity log, not in any calculation |
| Your initials (v0.8) | No | Text ≤ 10 characters; only English letters, digits, spaces, `.` and `-` | — | Stored in this browser; it identifies the user, not the deal, so it is kept on "Load sample" and cleared on "Clear all data". When invalid the field shows an error and entries record it as empty until it is valid; changing the initials is not itself logged |

### 5.1 General calculation
- **C-01** Amounts are always integers in minor units (pence/cents); percentages in basis points (1% = 100); share prices in millionths; shares in millionths of a share (integer); multiples in hundredths. **Intermediate multiplication and division use exact integer arithmetic**; rounding happens only where a rule says so. The hurdle's compounding is also exact (rationals for whole years; high-precision roots for fractional years), with a single round-half-up at the end (C-DIS-3). v0.7.2: the former "only allowed floating-point" exception is removed, because floating point gets exact half-penny cases wrong (M1 code review #1); the definition is unchanged.
- **C-02** Rounding is always "round half up" unless stated otherwise. Pro-rata splits use the "largest remainder method": the parts add up **exactly** to the total; ties on the remainder go to the person earlier in the list.
- **C-03 Checks fall into five classes**; each check in the implementation must state its class:

| Class | Examples | Result | Export / carry-over |
|---|---|---|---|
| Input error | Bad amount format, required field blank, fee rates total ≥ 100% | **No result**; checks show "unavailable" | Disabled |
| Arithmetic check failure | Money does not balance, fee shares do not add up to the fee amount | **No result**; shows "Internal error, please report" (means the implementation has a bug) | Disabled |
| Blocker | Cannot close (R-ALL-08), exit funding shortfall | Show the result and the reasons, for investigation | Disabled |
| Pending review | Reconciliation still has unresolved suggestions | Show the result and the to-do list | "Carry over" disabled; ledger can be exported |
| Reminder | Long unmatched, part of S/EIS not claimable | Show the result | No effect |

### 5.2 Payment reconciliation (C-REC)
- **C-REC-1 Normalisation**: the reference is converted to upper case and only letters and digits are kept (`NW-001` → `NW001`). Only a–z are converted to A–Z; no other case or accent conversion is done. **Only ASCII characters other than A–Z, a–z, 0–9 count as separators** (English punctuation, spaces, control characters); every non-ASCII character (such as É, ß, –) counts as part of a segment. This way the result does not depend on any Unicode version and is the same in every browser (v0.7.2 clarification, self-test review #10, round-3 self-test #3). Digit comparison recognises only ASCII 0–9.
- **C-REC-2 Exact match**: split the statement reference into segments at non-alphanumeric characters (non-ASCII characters belong to segments, so `SS001É` is one segment and does not match `SS001`); if any 1–3 **adjacent** segments joined together are **exactly equal** to an investor's normalised reference, that is an exact match. Examples: `NW001 SPV`, `nw 001`, `NW-001` all match `NW001`; `NW-0019` does not. Because the original reference has at most 3 segments (field table), every valid reference's original text matches itself. A payment is matched automatically only when exactly one investor matches exactly and the line is not a possible duplicate import.
- **C-REC-3 Confidence** (for suggestions, capped at 1):
  - Exact match +0.6; otherwise partial match +0.25 (added once only). Partial match = some combination of 1–3 adjacent segments is at edit distance 1 from the reference (insert, delete or change one character), or the digits of some combination of 1–3 adjacent segments, joined and read as an integer, equal the reference's digits read as an integer (the segment `11` in `NW 11` and `NW-011` are both 11; only segment combinations are compared, not the digits of the whole reference line — v0.7.2 clarification, M1 code review #11).
  - Name similarity × 0.3. First convert a–z to upper case on both sides, then treat ASCII characters other than English letters (punctuation, hyphens, digits, spaces) as spaces and split into words; non-ASCII characters count as letters (`J.A. SMITH` → J A SMITH; `SMITH,JOHN` → SMITH JOHN; `José García` → JOSé GARCíA — non-ASCII letters are not converted to upper case, so `JOSÉ` and `José` are not the same word; this affects only suggestion scores, never automatic matching, and is a limitation accepted so that results do not depend on the Unicode version; v0.7.2 clarification, self-test review #11, round-3 self-test #3); remove MR, MRS, MS, DR, LTD, LIMITED, LLP, PLC, AND, THE; if either side has no words, similarity is 0. Two words "match" = they are identical, or one is a single letter equal to the other's first letter. Similarity = **maximum one-to-one matching count** (each word used at most once) ÷ the larger of the two word counts.
  - Amount equals the investor's cash due, or equals what they still owe (cash due − received, when > 0): +0.25.
  - Only ≥ 0.3 is listed as a candidate; at most 3; ties go by list order; each candidate lists its scoring reasons (reference matches / reference nearly matches / payer name matches / payer name partly matches / amount matches).
- **C-REC-4 Received** = the sum of all matched statement lines (automatic or manually confirmed); difference = received − cash due.
- **C-REC-5 Long unmatched**: cut-off date − statement date > threshold days (default 10). Class "Reminder".
- **C-REC-6 Carry to allocation**: each investor carries over min(received, cash due); any excess is listed as a pending refund. (v0.8: withdrawn investors are not carried over; everything they received is listed as a pending refund at carry-over, reason `Withdrawn`; see C-REC-7, R-ALL-10.)
- **C-REC-7 Withdrawal** (v0.8):
  - A withdrawal is a mark on the investor (withdrawal date + written consent ticked), not a decision on a receipt. The booking rules for receipts (C-REC-2, R-REC-04) do not change: a withdrawn investor's reference still matches exactly and still counts in confidence scoring, and booked receipts stay under their name, so the ledger is complete and the money's destination is "refund".
  - A withdrawn investor's received and difference = calculated as in C-REC-4 (status shows Withdrawn); not carried to the allocation; pending refund = everything they received, reason "Withdrawn". A withdrawn investor who received nothing does not appear in pending refunds.
  - The chase list, chase CSV and the summary's total due exclude withdrawn investors; the summary also shows "Withdrawn: n investors, £x to refund" ("1 investor" when n = 1).
  - The arithmetic check R-REC-07 does not change; added: total pending refunds = Σ received of withdrawn investors + Σ over everyone else of max(0, received − cash due).
  - The withdrawal mark is tied to the investor ID. If the investor is deleted from the list, or their investor ID or payment reference is changed (compared after C-REC-1 normalisation, so `NW-012` → `NW 012` is not a change), the withdrawal mark is voided (back to normal) and logged; changing name, email, cash due or tax scheme has no effect. A full list replacement on import is judged per investor by the same rule.
  - Undoing a withdrawal: back to normal, logged.
  - Withdrawal and a fee payer change: if an investor withdraws after a change is active, their adjustment row is kept (a withdrawn investor is not counted as due anyway), and after the withdrawal is undone the adjustment applies as usual. **While a change is active, any investor in the list who is not withdrawn but is not covered by that change** (covered = everyone in the C-ALL-10 scope at the time of applying, including those marked "Not participating — unchanged"; not covered = those withdrawn at the time of applying and later undone; those added after applying; those whose row was voided) is marked "Not covered by the active fee payer change — reverse and redo" and, as "Needs review" (C-03), disables carry-over to the allocation until the change is reversed and redone (voiding is permanent; changing a value back does not restore coverage).
  - Marking, undoing or voiding a withdrawal is a change to reconciliation data: an allocation already carried over shows "Out of date, carry over again" (R-X-07).
- **C-REC-8 Messages to investors** (v0.8): fixed English templates; braces are variables; amounts in the I-01 display format plus the currency code (e.g. `£1,250.00 GBP`, `US$500.00 USD`); dates written `D Month YYYY` (e.g. `14 October 2026`). Only the variables listed below appear in a message.
  - **Template A (chase)**, for: an unpaid or underpaid investor who is not withdrawn; `{outstanding}` = cash due − received:
    ```
    Hi {name},

    For {deal name}, we have received {received} of the {cash due} due from you, so {outstanding} is still outstanding. Please pay it using the payment reference {reference} exactly as written.

    If you have already sent this payment, please ask your bank for the MT103 (or equivalent) for the transfer, showing its UETR, and send it to us so we can trace the payment.

    Thank you.
    ```
    When unpaid (received = 0) the first sentence becomes "For {deal name}, we have not yet received the {cash due} due from you."; the rest is unchanged.
  - **Template B (payment query)**, for: one candidate investor of a receipt awaiting review:
    ```
    Hi {name},

    For {deal name}, we received a payment of {amount} on {date} that we could not match to an investor automatically. If you sent it, please reply with the name on the account it came from and the payment reference you used. If you did not send it, there is nothing you need to do.

    Thank you.
    ```
  - Messages are plain text: investor names and the deal name are inserted as they are, with no HTML escaping.

### 5.3 Closing allocation (C-ALL)
Let: an investor's received amount be R, the total of investor-paid percentage fee rates be p, the total of per-investor fixed fees be F.

- **C-ALL-1 Investable amount M (before rounding)**:
  - "Deducted from the payment" (default; requires p < 100%): percentage fees are charged on the "gross amount used for this deal". M = round down to the penny((R − F) × (1 − p)).
  - "Added on top of the investment": percentage fees are charged on the investment amount. M = round down to the penny((R − F) ÷ (1 + p)).
  - R ≤ F or M ≤ 0 → does not take part (full refund, no fees).
- **C-ALL-2 Minimum**: the comparison uses the **commitment-basis** amount: R under "deducted from the payment"; M under "added on top". Below the minimum → does not take part.
- **C-ALL-3 Oversubscription**: when participants' M total > cap, the cap is split among them in proportion to M using the largest remainder method, giving the target investment T; otherwise T = M. If after scale-back anyone's commitment-basis amount (deducted from the payment: T ÷ (1 − p) + F; added on top: T) is below the minimum → "cannot close" (blocker), and those investors are listed.
- **C-ALL-4 Per-investor fixed fees**: for each fixed fee, every participant pays that amount; non-participants do not pay.
- **C-ALL-5 Investment and shares** (SPV nominee): I = T. Shares held = I ÷ share price, truncated to 6 decimal places only for display (fractional shares allowed). All investors in one deal have the same share price, so the shareholding ratio = the investment ratio.
- **C-ALL-6 Investor percentage fees** (each fee calculated separately, then summed):
  - Deducted from the payment: that fee = I × that fee's rate ÷ (1 − p), round half up.
  - Added on top: that fee = I × that fee's rate, round half up.
- **C-ALL-7 Refund** = R − I − all fees. If negative (separate rounding of several fees can be a few pence off): reduce I by 1 penny and recalculate, repeating until the refund is ≥ 0. **Whenever I becomes 0, the investor does not take part** (full refund, no fees).
- **C-ALL-8 S/EIS claimable (estimate)**: claimable shares = round down(shares held); claimable amount = claimable shares × share price, rounded down to the penny; non-claimable amount = I − claimable amount. When > 0 it is flagged, with the notice text: "This estimate uses whole shares in the final allocation. Fees, scale-back and rounding can leave a remainder even when the wire is a multiple of the share price. Check the final allocated share count."
- **C-ALL-9 Deal-level fees**: company-paid / lead-paid percentage fees = total investment × rate, round half up; fixed fees at the entered amount. Paid to company = total investment − company-paid fees; < 0 → cannot close.
- **C-ALL-10 Changing the payer of a percentage fee** (v0.8). Principle: **each investor keeps the investment their commitment buys under today's fees**, and the new cash due absorbs the change in fees (consistent with common SPV practice: investors top up when a fee moves to them, and the excess is refunded when it moves away from them).
  - Scope: investors in the reconciliation list who are not withdrawn and are in the current allocation snapshot. Let the current fee table be Fees, and the new table Fees' = Fees with only the chosen fee's payer changed (rate, basis, cap, minimum and share price unchanged). Fees' must pass the input checks of R-ALL-01/02 (e.g. under "deducted from the payment" the investor-paid percentages must still total < 100%); otherwise it is an input error.
  - **Step 1, target investment T_i**: with Fees and each investor's **cash due** (not received) as R, run one full allocation under C-ALL-1 to C-ALL-9 (the "commitment allocation"). If it cannot close, the preview shows its reasons (blockers) and the change cannot be applied. **It also cannot be applied when the commitment allocation is scaled back by the cap** (blocker "The round is over the cap — resolve the scale-back first"), so that no scale-back refund mixes into the differences. For participants T_i = their investment I; non-participants (below the minimum, R ≤ F, etc.) keep their cash due, marked "Not participating — unchanged" in the preview.
  - **Step 2, new cash due N_i**: under Fees', for that investor alone, using C-ALL-1, C-ALL-4, C-ALL-6 and C-ALL-7 (ignoring the cap and minimum), the **smallest** whole-penny R whose final investment I(R) ≥ T_i. N_i above the I-01 limit → input error.
    - Lower bound (the implementation searches upward penny by penny from here): deducted from the payment R ≥ F' + ⌈T_i ÷ (1 − p')⌉; added on top R ≥ F' + ⌈T_i × (1 + p')⌉ (p' and F' are the investor percentage rate total and per-investor fixed fee total under Fees').
  - Note on step 2: each extra penny raises M(R) by at most 1 penny; after the C-ALL-7 reduction, I(R) is monotonic and rises by at most 1 penny per step; and at the lower bound M = T_i, so the smallest N_i always gives exactly I = T_i (the self-test review gave a proof and checked it with 3,000 random inputs). In the implementation, I(N_i) ≠ T_i is an "arithmetic check failed" (internal error, C-03).
  - **Step 3, check**: run a full allocation again with Fees' and each investor's N_i. Steps 1 and 3 must have the same participants (e.g. under added on top the minimum is compared with M, so after a fee moves away from investors a former non-participant may become a participant, and vice versa); otherwise it is blocked with names and reasons. Each participant's I must equal T_i, otherwise blocked. Any blocker of the step-3 allocation itself (R-ALL-08: e.g. company-paid fees above the total investment, a negative payment to the company) is shown as a blocker as well, the change cannot be applied, and names and reasons are given (e.g. under deducted from the payment the minimum is compared with R, so after a fee moves away from investors N_i may fall below the minimum).
  - Difference = N_i − current cash due: > 0 is a top-up, < 0 a refund (after applying, reconciliation shows them as underpaid / overpaid).
  - When this fee is paid by the company or the lead it = total investment × rate (C-ALL-9); the preview shows the fee before and after applying: before from the step-1 commitment allocation, after from the step-3 allocation (both on cash due, not on received).
  - Hand-worked examples (fee basis "deducted from the payment", minimum £0, no cap, one 3% fee only):
    - investors → company: cash due £1,000.00 → T = ⌊1,000.00 × 0.97⌋ = £970.00 (fee £30.00, refund 0); under Fees' there is no investor fee, N = £970.00, difference −£30.00 (refund); company-paid fee = £970.00 × 3% = £29.10.
    - company → investors: cash due £1,000.00 → T = £1,000.00; lower bound ⌈1,000.00 ÷ 0.97⌉ = £1,030.93: M = ⌊1,030.93 × 0.97⌋ = ⌊1,000.0021⌋ = £1,000.00, fee = 1,000.00 × 0.03 ÷ 0.97 = 30.9278 → £30.93, refund = 1,030.93 − 1,000.00 − 30.93 = 0; N = £1,030.93, difference +£30.93 (top-up). (At £1,030.92, M = ⌊999.9924⌋ = £999.99 < T.)
    - minimum £1,000, cash due £1,000.00, 3% investors → company: T = £970.00, N = £970.00 < £1,000 → in step 3 this investor does not participate, blocker "would fall below the minimum commitment".
- **C-ALL-11 Adjustment record for a fee payer change** (v0.8; same approach as the C-REC-7 withdrawal mark, following the accounting-software practice "leave the original, record an adjustment, allow reversal"; research note in the private development repository):
  - Applying saves one change record: the fee, original payer → new payer, whether consent evidence was ticked, the time, and the status (active / reversed / voided); under it one row per affected investor: investor ID, original cash due at the time of applying, new cash due N_i, difference. The cash due field in the investor list is **not changed**.
  - **Effective cash due** = N_i while the change is active and that investor's row is not voided, otherwise the cash due in the list. All reconciliation calculations (status, difference, chase list and messages, amount match in confidence scoring, pending refunds, carry to allocation) use the effective cash due.
  - An investor's row is voided (back to the original cash due, logged, the row shows the R-REC-12 voided notice) when: the investor is deleted; their investor ID or payment reference is changed; their cash due is edited by hand (compared by value: a submitted value different from the original cash due at the time of applying; submitting the same value is not a change. Once voided it stays voided, and changing it back later does not restore it, as with voided decisions); or any of these results from a full list replacement on import. Voiding does not recalculate automatically.
  - The whole change is voided when the fee's payer, rate, type or basis differs from the values recorded at the time of applying (compared by value: submitting the same value is not a change), or the fee is deleted; voiding is permanent, and changing back does not restore it. All rows go back to the original cash due, it is logged, and the banner asks to redo it.
  - Applying also saves: a row for **every** investor in scope (investor ID, normalised reference, original cash due, new cash due N_i or "unchanged", T_i, valid or not), and the allocation settings at the time (minimum, cap, share price, fee basis and the whole fee table).
  - If the minimum, cap, share price or another fee is changed after applying (compared by value with the saved settings): the change is not voided, but the panel and banner show the warning "Allocation settings changed since this fee payer change — check the preview", and step 3 is recalculated with the saved T_i and the current settings; any blockers this produces are shown as usual (the allocation itself also calculates under the new settings).
  - Reversing (R-ALL-12.5): an active change can be reversed at any time (no need for an up-to-date snapshot or to tick consent again); the fee goes back to its original payer, all rows go back to the original cash due, and the record is marked reversed.
  - Applying, reversing and voiding are changes to reconciliation data; an allocation already carried over shows "Out of date" (R-X-07).

### 5.4 Exit distribution (C-DIS)
Let: total investor capital C (must be > 0), proceeds G, exit costs E, carry rate k, annual hurdle h, years n, catch-up rate c. The two modes are mutually exclusive: fixed mode uses k, h, c; tiered mode uses only the tier table, and h and c do not apply (when the mode is switched the UI clears fields that do not apply; the engine treats any value it receives for them as an input error).

- **C-DIS-1 Order**: D = G − E (E > G → blocker, show the shortfall E − G) → return capital min(D, C) → distribute the remaining profit by carry mode.
- **C-DIS-2** When D ≤ C, carry is 0. Investors can make a loss; a loss is not an error.
- **C-DIS-3 Hurdle (fixed mode)**: P = C × ((1 + h)^n − 1), compounded annually, calculated exactly and then rounded half up to the penny (an exact half penny rounds up); amount actually paid P' = min(remaining, P).
- **C-DIS-4 Catch-up (fixed mode)**: c = 0 means none; when h = 0, c must be 0; when h > 0 and c > 0, k < c ≤ 100% is required. Required catch-up band Y = k × P' ÷ (c − k), round half up; actual Y' = min(remaining, Y); the lead gets Y' × c (round half up), the rest goes to investors. When there is enough money and c = 100%, final carry = k × total profit (error ≤ 1 penny).
- **C-DIS-5 Fixed mode remainder**: the lead gets remaining × k (round half up), the rest goes to investors.
- **C-DIS-6 Tiered mode**: boundary B_j = round half up((m_j − 1) × C) (pence), B_0 = 0; band j profit = clamp(profit − B_{j−1}, 0, B_j − B_{j−1}) (the last band has no upper limit); each band's carry = band profit × band rate, round half up; bands are summed. Multiples strictly increase; the last band has no upper limit.
- **C-DIS-7 Between investors**: the investors' total is split in proportion to **capital**, using the largest remainder method. Reason: all investors in one deal have the same share price, and shares = investment ÷ share price, so the capital ratio = the shareholding ratio. Preconditions: one deal has only one share price (§2.2), and capital = investment amount, excluding all fees (met automatically when carried from the allocation; for manual entry and import, the column name and import notes remind the user). Shares in the holdings table are for display only: capital ÷ holdings share price, truncated to 6 decimal places; the share price is saved with the snapshot on carry-over, so later upstream price changes do not affect the display (it is only marked "out of date"); with no share price, shares show "—". Each investor's "profit or loss" = distribution − capital; "multiple" = distribution ÷ capital, to 2 decimal places (excluding entry fees).

### 5.5 Import formats (CSV)

| File | Columns (required in **bold**) | Accepted aliases |
|---|---|---|
| Commitment list | investor_id; **name**; email; **reference**; **cash_due**; scheme | investor_id: id, investor id; name: investor name, investor, full name; reference: payment reference, ref; cash_due: cash due, amount due, expected, expected amount (committed / commitment are deliberately not accepted, to avoid confusion with the "investment commitment"); scheme: tax scheme, seis/eis |
| Bank statement | transaction_id; **date**; **amount**; payer; reference | transaction_id: id, transaction id, txn id; date: value date, booking date; amount: credit, paid in; payer: payer name, counterparty, from, name; reference: description, payment reference, narrative |
| Allocation investors | investor_id; **name**; **received**; scheme | received: cash received, amount received |
| Holdings | investor_id; **name**; **capital** (investment amount, excluding fees); share_price | capital: invested, amount invested (column names that may include fees, such as cost, paid, wired, are not accepted); share_price: price per share, price (same on every row; different values are an error) |

Holdings CSV: weights come only from `capital`; other columns in the file (such as `shares_display` included on export) are ignored. Exporting holdings and importing them again loses no precision.

Aliases are compared after converting to lower case and trimming leading and trailing spaces. For headers with a currency label (`(£)`, `(€)`, `($)`, `gbp`, `eur`, `usd`), the labelled currency is first checked against the deal currency; **a mismatch is an import error**; only on a match is the label removed before comparing aliases (example: a GBP deal accepts `Amount (£)` and `amount gbp`, and rejects `Amount (€)`; a USD label may also be written `(US$)`). All four import files may carry a `currency` column (alias `ccy`): a non-empty cell must be the deal currency's ISO code (any case), otherwise it is an import error naming the row; an empty cell means the deal currency (v0.7.5, decision 10). The repository's `fixtures/` folder has a sample CSV for each file type, which is also the input for the import tests.

v0.8 export changes (import formats unchanged; withdrawal marks and the activity log cannot be imported): the reconciliation ledger CSV (one row per receipt) gets a `withdrawn_on` column: the withdrawal date when the receipt is booked to a withdrawn investor, otherwise blank. The chase list CSV (one row per investor, withdrawn investors excluded) has `committed` = effective cash due, plus `committed_original` and `committed_adjustment` columns (blank when there is no adjustment), and a `message` column (R-REC-10.1). New: the activity log CSV, columns `seq, time, initials, event, investor_id, investor_name, transaction_id, amount, detail, currency`; as in the other exports, `currency` is the last column (decision 10), and each row holds the deal currency code **at the time of the event** (a later currency change does not alter old entries; events without an amount also record the currency at the time). New columns all go before `currency`.

### 5.6 Activity log (C-X) (v0.8)
- **C-X-1 Which events are logged** (one row each; `amount` only when there is an amount, in the I-01 display format without a currency symbol (the currency is in the `currency` column)):
  | event | When | What `detail` holds |
  |---|---|---|
  | `import` | A commitment list / bank statement import succeeds (replace or append) | File type, replace or append, rows added, receipts auto-booked by this import. Bank statement: among the receipts accepted in this batch (replace = all rows of the new file; append = the added rows, not counting duplicates ignored under R-REC-02.2), how many are auto-booked under C-REC-2 after the import. Commitment list: the number of receipts that are auto-booked after the import and were not before |
  | `confirm` / `assign` / `not_in_deal` / `undo` | A manual decision on a receipt (R-REC-04.2) | Status before → after; `assign` names the assigned investor |
  | `decision_voided` | A manual decision voided by a data edit or deletion (R-REC-04.4) | The reason (receipt edited / deleted, investor edited / deleted). When one action voids several (e.g. a full replacement import), one entry says how many were voided; editing or deleting one by one logs one row each |
  | `withdrawn` / `withdrawal_undone` / `withdrawal_voided` | C-REC-7 | The withdrawal date; the reason for voiding |
  | `handoff_allocation` / `handoff_exit` | The two "Carry to …" actions | Snapshot version, number of investors, total amount |
  | `fee_payer_changed` | Applying under R-ALL-12.3 | One summary entry (the fee, original payer → new payer, whether consent evidence was ticked), then one entry per affected investor (original cash due → new cash due; `amount` holds the difference, positive for a top-up, negative for a refund) |
  | `fee_payer_change_reversed` / `fee_payer_change_voided` / `adjustment_voided` | R-ALL-12.5, C-ALL-11 | The scope reversed or voided (the whole change / one investor) and the reason |
  | `log_exported` | Exporting the activity log CSV | Exported up to which entry (`seq`) |
  | `message_copied` | Copying a chase or query message | Template A or B; the text itself is not logged. When the clipboard is unavailable and the text is selected for the user to copy by hand, an entry is still logged, with detail `selected for manual copy` |
  | `sample_loaded` | Loading the sample deal | Loading the sample clears existing entries first; this is the first new entry |
- Cell edits themselves are not logged (an edit takes effect after 300 ms, and logging every keystroke means nothing); only decisions voided by an edit are logged.
- Decisions made by the tour ("Do this for me") log the same events as manual actions, with detail `guided tour`. Jumping to a chapter, Resume and replay rebuild the sample and count as "Load sample": the log is cleared and, from `sample_loaded` on, the decisions the tour makes while rebuilding are logged one by one, so nothing is logged twice (v0.8 clarification, Guided tour v0.3 §8 item 5).
- `seq` starts at 1 and increases by one; `time` is local time, ISO 8601 with time zone offset, to the second.
- The log is saved in this browser with the deal data; it is cleared on "Clear all data" and "Load sample".
- **Capacity** (basis: NIST SP 800-92 §5.1.2: stopping logging is "usually unacceptable"; when full, overwrite the oldest and warn at 80–90% so it can be archived first; OWASP: a logging failure must not stop the application working): limit 5,000 entries (estimate: a deal usually produces 400–1,500 entries; the whole deal data is about 0.9M characters, plus 5,000 entries about 2.5M–3.5M characters: within most browsers' local storage limits; browsers that count the quota in UTF-16 bytes may exceed it at extreme sizes, handled by R-X-08.5).
  - From 4,000 entries, a warning to export (R-X-08.4). Exporting records the `seq` exported up to.
  - Above 5,000 entries the oldest are removed; the removed entries are merged into one `truncated` entry at the top, saying how many were removed, the `seq` range, and whether they had all been exported; the `truncated` row does not count towards the 5,000 and has no `seq` of its own. `seq` is never reused, so any gap is visible.
  - When saving in this browser fails because storage is full, the oldest entries are removed first (also recorded in `truncated`) and the save is retried, deal data first (R-X-08.5).

---

## 6. Success criteria

| Goal | Measure | Target |
|---|---|---|
| G1 | Demo from opening the link to finishing all three modules | ≤ 3 minutes, 2 timed rehearsals |
| G2 | Test users who complete the sample tour | ≥ 5 people (invited one to one by direct message, not broadcast in groups) |
| G2 | Users who have run one calculation with their own data | ≥ 2 people |
| G3 | Calculation errors reported by users | 0; if one appears, stop promotion, fix it and add a test |
| Learning | "What this tool did not solve for me" | ≥ 5 items, into the backlog |

---

## 7. Milestones

| Milestone | Content | Gate |
|---|---|---|
| M0 | Docs v0.2 → Codex re-review → owner signs off | G0 + G1 |
| M1 | Rewrite or correct the three engines to the v0.2 rules; unit tests + independent Python recalculation all agree; freeze every result row of the sample deal | G2 |
| M2 | Reconciliation + allocation UI + carry-over; Vercel preview | G2 |
| M3 | Exit distribution UI + sample tour + end-to-end tests | G2 |
| M4 | Full acceptance → production launch → smoke test → invite users | G3 |

---

## 8. Decision log

| # | Question | Decision | Date |
|---|---|---|---|
| 1 | Product name | Deal Ops Toolkit | 2026-10-16 |
| 2 | Feedback channel | Email link only, with a note not to send real investor information | 2026-10-16 |
| 3 | Analytics | None in v1 | 2026-10-16 |
| 4 | How to describe the product | Call it a "prototype"; talk only about what is implemented, tested and live; never imply it saved any platform money or meets regulatory requirements | 2026-10-16 |
| 5 | Scope | Finish all three modules before launch | 2026-10-16 |
| 6 | Holding structure | ~~Optional, default SPV nominee; direct holding = whole shares + refund the remainder~~ (2026-10-16) → **SPV nominee only**: the nominee is on the investee company's register of members, investors hold beneficial interests and receive proof of them, and fractional shares are supported | 2026-10-17 |
| 7 | Basis for investor percentage fees | Support both; default deducted from the payment | 2026-10-16 |
| 8 | Visual and interaction style | The project's own visual design: open-licensed fonts (Inter, IBM Plex Mono) and its own design tokens; no third-party names, marks, trademarks, brand assets or page text; the page keeps a "not affiliated with any platform" notice | 2026-10-20 |
| 9 | Light and dark switch | ~~Follow the device only, no manual switch~~ (the M4 visual plan (not published), item F, 2026-10-20) → **manual switch added**: System / Light / Dark, following the device by default, the choice kept only in this browser. Reason: trying the live site, the owner could not find where to turn dark mode on | 2026-10-20 |
| 11 | What to add for chasing payments and changes before closing (v0.8) | **Owner approved "as recommended" on 2026-10-23**: build R-REC-10 (chase and query messages), R-REC-11 (withdrawal before closing), R-ALL-12 (changing the fee payer before closing), R-X-08 (activity log). Not built: sending email automatically (breaks "data never leaves the browser"); withdrawal after closing, rolling close, share conversion, two valuations (they conflict with the "one contribution, one exit" model and need a new data model); changing the payer of fixed fees (percentage platform fees are the common case). Recommendations on the 3 open points after research (research note in the private development repository): ① a fee payer change is saved as a separate adjustment record, without overwriting the original cash due, and can be reversed in one step (C-ALL-11); ② at 5,000 entries the activity log overwrites the oldest, warns at 80% to export, and never blocks an action (C-X-1); ③ the tour adds no steps, only one sentence at step 6 and a new end card (R-X-01.2). Also: v0.8 ships in two PRs (first: messages and activity log; then: withdrawal and fee payer change); "storage full" being misreported as "storage blocked" is an existing v1.1.0 issue, fixed on its own first (v1.1.1). After the document review the owner approved the full v0.8 text on 2026-10-25 ("approved") | 2026-10-23; full text approved 2026-10-25 |
| 12 | Can the currency change while a fee payer change is active (v0.8.1) | **Owner decided on 2026-10-27: lock it; reverse first, then change.** Research (official docs): QuickBooks Online locks a customer's currency once they have transactions (to change it, deactivate and create a new customer); Stripe locks the amount fields of a finalised invoice (changes go through a credit note, or void and re-issue). The shared practice: change freely while nothing is recorded; once an adjustment is recorded, lock until it is reversed. Decision 10 covers typed amounts (nothing recorded) and stays; a fee payer change is a recorded adjustment (like a credit note), so it locks. Not chosen: voiding automatically, or relabelling into the new currency — neither is industry practice, and the second carries adjustments worked out in the old currency into the new one unchecked | 2026-10-27 |
| 10 | Currency display, change and export | Following common practice (research: GOV.UK design system, Stripe and Wise exports, Microsoft localisation guidance, HMRC currency input): money labels name the currency; a currency change converts nothing and asks first when amounts exist (not locked, since a change usually corrects a wrong choice); every export row carries a `currency` column (ISO code, fixed column names for downstream templates); imports may carry a `currency` column, which is checked; the confirmation names the currency code; USD shown as `US$`; share prices accept thousands commas. No calculation changed | 2026-10-20 |

---

## 9. Change log
| Date | Version | Change | Approval |
|---|---|---|---|
| 2026-10-23 | v0.8 | Chasing payments and changes before closing (decision 11): R-REC-10 chase and payment-query messages; R-REC-11 withdrawal before closing; R-ALL-12 changing who pays a percentage fee before closing; R-X-08 activity log; rules C-REC-7, C-REC-8, C-ALL-10, C-X-1; the field table gains withdrawal date and initials; R-X-05 gains 3 terms. Existing calculation rules unchanged. Added after research: C-ALL-11 adjustment record and reversal, R-REC-12, R-ALL-12.5, R-X-08.4/08.5 capacity warning and storage-full handling, R-X-01.2 tour changes. The 3 recommendations approved (decision 11) | **Owner decision 2026-10-23** (in conversation: "as recommended"); document review: fresh-context review 14 items + Codex 3 rounds (10 / 7 / 2 items) all fixed, round 3 "READY AFTER FIXES"; **full text approved by the owner on 2026-10-25** (in conversation: "approved") |
| 2026-10-16 | v0.1 | First draft | Codex: REWORK |
| 2026-10-16 | v0.2 | Revised per the 24 review items + decisions 1–7: input rules, exact-match boundaries, holding structure, fee basis, per-fee calculation, cannot-close conditions, exit definitions and limits, privacy wording, snapshot passing | Codex: REWORK (round 2, 14 items) |
| 2026-10-16 | v0.3 | Field table and import formats; five check classes; infeasible fees and zero-investment handling; cash due definition; tier rounding; one-to-one maximum name matching; reference format; S/EIS notice rewritten; links added to evidence (not in this public version) | Codex: REWORK (round 3, 6 items) |
| 2026-10-16 | v0.4 | Nominee weights use the exact investment amount; header currency must match the deal; zero-amount statement lines skipped; holdings share count limit | Codex: REWORK (round 4, 2 items) |
| 2026-10-17 | v0.5 | Holdings weight basis: editing changes only that row, not the basis; CSV carries a basis column, lossless export and re-import; share count check applies only to the by-shares basis | Codex: READY AFTER FIXES (round 5, 2 minor) |
| 2026-10-17 | v0.6 | Holdings export format; snapshot saves the share price; share price optional on import | Codex passed |
| 2026-10-17 | v0.7.2 | Clarifications (definitions unchanged): exact hurdle calculation, floating-point exception removed; reference digit comparison by segment combination; export escaping by column type, reversed on import; non-English letters count as letters, only a–z converted to upper case; punctuation and hyphens in names treated as spaces. Source: M1 code review #1 #11 #12, self-test review #9 #10 #11 | Confirmed with M1 acceptance |
| 2026-10-23 | v0.7.6 | R-X-02: when saving in the browser fails, tell "storage blocked" apart from "storage full"; before, both showed "storage is blocked", which named the wrong cause when storage was full (found while preparing the next version). No calculation rule changed | **owner decision (2026-10-23)** (in conversation: "as suggested", the recommendation being to fix it on its own first) |
| 2026-10-27 | v0.8.1 | R-DEAL-01: currency locked while a fee payer change is active; reverse first (decision 12). Found while building M6: the PRD did not cover this case | **owner decision (2026-10-27)** |
| 2026-10-27 | v0.8.2 | C-REC-8 template A: the MT103 paragraph, and the chasing row of the §1.1 evidence table, in generic wording (found by the review before publishing the repository). Text only; no calculation or decision changed | **owner decision (2026-10-27)** (in conversation: "change it to generic wording, then publish") |
| 2026-10-20 | v0.7.5 | R-DEAL-01, R-ALL-10, I-01, I-03, §5.5: currency display, confirmation before a currency change, `currency` column in exports, `currency` column checked on import, US$, thousands commas in share prices (decision 10). No calculation rule changed | **owner decision (2026-10-20)** |
| 2026-10-20 | v0.7.4 | R-X-04: manual theme switch System / Light / Dark, following the device by default (decision 9). No calculation rule changed | **owner decision (2026-10-20)** |
| 2026-10-20 | v0.7.3 | §2.2 non-goals and rule P6: visual and interaction style is an owner decision; still no third-party names, marks, trademarks, brand assets or page text (decision 8). No calculation rule changed | **owner decision (2026-10-20)** |
| 2026-10-17 | v0.7 | Additions (owner agreed; no rules or numbers changed): holding capital = investment amount, excluding fees, written into R-DIS-01, the field table, C-DIS-7 and §5.5. Direct holding removed, SPV nominee only; holdings weighted by capital only (weight basis removed); three currencies and append import kept | Codex round 6 READY AFTER FIXES, fixes done; **owner approved 2026-10-17** (replied in conversation "Approved, please go ahead") |
