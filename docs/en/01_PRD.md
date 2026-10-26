English snapshot of docs/01_PRD.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20, updated at v1.1.0 on 2026-10-21 and for v1.1.1 on 2026-10-23.

# Deal Ops Toolkit — Product Requirements Document (PRD)

Version v0.7.6 (last revised 2026-10-23) · 2026-10-17 · Status: **Approved (2026-10-17)**, G0/G1 gates passed, freeze lifted (until G0 passed, no implementation code was written apart from the existing spike)

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
| R-DEAL-01 | Deal name, currency (GBP/EUR/USD), cut-off date (default today). The currency is the unit of every amount and nothing is converted: money input labels show the currency symbol; the currency select says nothing is converted; when amounts exist, changing the currency asks first and says how many amounts will be recorded in the new currency with unchanged values; USD is shown as `US$`; a successful import says which currency the amounts were read in (v0.7.5, decision 10) | P0 |
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
| R-ALL-10 | Closing confirmation: a summary for the lead to confirm (currency code, totals, each fee, payment to company, refunds, per-investor detail), can be copied; CSV export | P0 |
| R-ALL-11 | "Carry to exit distribution as holdings" | P0 |

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
| R-X-02 | Privacy: deal data entered or imported is processed only locally in the browser, and the code never sends it anywhere; the page wording is "Your deal data is processed in your browser and never sent by this app. The hosting provider still receives normal page requests."; data is kept in this browser on this device, with a "Clear all data" button; deal data never appears in the URL. When saving fails, the message names the cause (v0.7.6): storage blocked → "This browser is not saving your data (storage is blocked), so it will be gone when you close the page."; storage full → "This browser's storage for this page is full, so your latest changes are not being saved. Export what you need before you close the page." | P0 |
| R-X-03 | On first open and in the footer: not investment, tax or legal advice; results need human checking; not affiliated with any platform | P0 |
| R-X-04 | At mobile width (375px) all steps of manual acceptance checklist M-01 to M-07 can be completed; light and dark themes supported. The theme can be switched on the page: System (follows the device, default) / Light / Dark; the choice is kept only in this browser and "Clear all data" removes it too (v0.7.4, decision 9) | P1 |
| R-X-05 | UI in English, in plain words; these terms have a one-line explanation in the UI (hover or expand): SPV, nominee / bare trust, beneficial interest, minimum commitment, scale-back, S/EIS, carry, hurdle, catch-up, tiered carry, waterfall | P0 |
| R-X-06 | Feedback: one email link on the page, with the note "please do not send real investor information" | P0 |
| R-X-07 | Modules pass snapshots: downstream data is replaced only when "Carry to …" is clicked; after an upstream change, downstream shows "Out of date, carry over again" | P0 |

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
- **C-REC-6 Carry to allocation**: each investor carries over min(received, cash due); any excess is listed as a pending refund.

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
| 10 | Currency display, change and export | Following common practice (research: GOV.UK design system, Stripe and Wise exports, Microsoft localisation guidance, HMRC currency input): money labels name the currency; a currency change converts nothing and asks first when amounts exist (not locked, since a change usually corrects a wrong choice); every export row carries a `currency` column (ISO code, fixed column names for downstream templates); imports may carry a `currency` column, which is checked; the confirmation names the currency code; USD shown as `US$`; share prices accept thousands commas. No calculation changed | 2026-10-20 |

---

## 9. Change log
| Date | Version | Change | Approval |
|---|---|---|---|
| 2026-10-16 | v0.1 | First draft | Codex: REWORK |
| 2026-10-16 | v0.2 | Revised per the 24 review items + decisions 1–7: input rules, exact-match boundaries, holding structure, fee basis, per-fee calculation, cannot-close conditions, exit definitions and limits, privacy wording, snapshot passing | Codex: REWORK (round 2, 14 items) |
| 2026-10-16 | v0.3 | Field table and import formats; five check classes; infeasible fees and zero-investment handling; cash due definition; tier rounding; one-to-one maximum name matching; reference format; S/EIS notice rewritten; links added to evidence (not in this public version) | Codex: REWORK (round 3, 6 items) |
| 2026-10-16 | v0.4 | Nominee weights use the exact investment amount; header currency must match the deal; zero-amount statement lines skipped; holdings share count limit | Codex: REWORK (round 4, 2 items) |
| 2026-10-17 | v0.5 | Holdings weight basis: editing changes only that row, not the basis; CSV carries a basis column, lossless export and re-import; share count check applies only to the by-shares basis | Codex: READY AFTER FIXES (round 5, 2 minor) |
| 2026-10-17 | v0.6 | Holdings export format; snapshot saves the share price; share price optional on import | Codex passed |
| 2026-10-17 | v0.7.2 | Clarifications (definitions unchanged): exact hurdle calculation, floating-point exception removed; reference digit comparison by segment combination; export escaping by column type, reversed on import; non-English letters count as letters, only a–z converted to upper case; punctuation and hyphens in names treated as spaces. Source: M1 code review #1 #11 #12, self-test review #9 #10 #11 | Confirmed with M1 acceptance |
| 2026-10-23 | v0.7.6 | R-X-02: when saving in the browser fails, tell "storage blocked" apart from "storage full"; before, both showed "storage is blocked", which named the wrong cause when storage was full (found while preparing the next version). No calculation rule changed | **owner decision (2026-10-23)** (in conversation: "as suggested", the recommendation being to fix it on its own first) |
| 2026-10-20 | v0.7.5 | R-DEAL-01, R-ALL-10, I-01, I-03, §5.5: currency display, confirmation before a currency change, `currency` column in exports, `currency` column checked on import, US$, thousands commas in share prices (decision 10). No calculation rule changed | **owner decision (2026-10-20)** |
| 2026-10-20 | v0.7.4 | R-X-04: manual theme switch System / Light / Dark, following the device by default (decision 9). No calculation rule changed | **owner decision (2026-10-20)** |
| 2026-10-20 | v0.7.3 | §2.2 non-goals and rule P6: visual and interaction style is an owner decision; still no third-party names, marks, trademarks, brand assets or page text (decision 8). No calculation rule changed | **owner decision (2026-10-20)** |
| 2026-10-17 | v0.7 | Additions (owner agreed; no rules or numbers changed): holding capital = investment amount, excluding fees, written into R-DIS-01, the field table, C-DIS-7 and §5.5. Direct holding removed, SPV nominee only; holdings weighted by capital only (weight basis removed); three currencies and append import kept | Codex round 6 READY AFTER FIXES, fixes done; **owner approved 2026-10-17** (replied in conversation "Approved, please go ahead") |
