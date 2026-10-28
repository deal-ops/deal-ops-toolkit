English snapshot of docs/04_TEST_PLAN.md (Chinese, source of truth) at release v1.0.0, translated on 2026-10-20, updated at v1.1.0 on 2026-10-21, for v1.1.1 on 2026-10-23 and for the v0.8 documents on 2026-10-25.

The scripts that check test coverage read the Chinese file; this English file is for reading.

# Deal Ops Toolkit — Test Plan

Version v0.8 (last revised 2026-10-25; based on PRD v0.8, passed 3 rounds of Codex review, approved by the owner 2026-10-25) · 2026-10-17 · Status: **Approved (2026-10-17)** · Based on: PRD v0.7

- v0.1 → v0.2: changed per Codex review #16 #17 #21 #24: each acceptance point maps to a test; independent recalculation extended to adversarial cases; new cases for boundaries, invalid input, formats and end-to-end; sample deal rewritten under the v0.2 default conventions, with numbers that can be frozen. All hand-calculated numbers were rechecked with Python `decimal`.
- v0.2 → v0.3: added cases per round 2 R2-01/04/05/08/09/10/11/12/13; each case tagged with its due milestone; reset steps added to the manual checklist; default conditions for exit distribution written out in full.
- v0.7 → v0.7.1 (2026-10-20, clarification): §6 exported negative amounts keep their minus sign.
- v0.7.1 → v0.7.2 (2026-10-23): added TC-X-04 (PRD v0.7.6 R-X-02, save failures reported by cause).
- v0.7.2 → v0.8 (2026-10-23, approved 2026-10-25): added §2.5 (PRD v0.8: TC-REC-42 to 54, TC-ALL-31 to 49, TC-IO-47, TC-X-05 to 20, milestones 〔M5〕〔M6〕), E2E-08/09, M-12/13 and 4 traceability rows; independent recalculation adds C-ALL-10 and withdrawal in M6.

---

## 1. Test layers

| Layer | Tool | What it tests | When it runs |
|---|---|---|---|
| Unit | Vitest | TCs in §2 that are **due** (due milestone ≤ current milestone); invalid input; formats | Every commit (CI) |
| Invariants | Vitest, batch-generating **valid** inputs with a fixed random seed (two fee conventions × various fee combinations × three currencies) | Per person: received = invested + each fee + refund; refund ≥ 0; for each fee, the sum of per-person shares = that fee's total; total invested ≤ cap; non-participants have 0 investment and 0 fees; exit: investors + carry + exit costs = proceeds; sum of per-holding splits = investor total | Every commit |
| Independent recalculation | Python (standard library `fractions` / `decimal` only), **implemented from the PRD text, without looking at the TS code** | Due hand-calculated cases + the sample deal + the same batch of random inputs as the invariants, compared with TS row by row and field by field | Every commit from M1 (CI) |
| Coverage check | Script reads the test runner's JSON report | Every due TC **actually ran and passed** (all tests under the same ID must pass; skipped counts as not passed); fails if the milestone value is invalid or the set of due cases is empty; cases not yet due need not exist | Every commit |
| Mutation check | `scripts/mutation-check.mjs` | Deliberately breaks key code (rounding direction, boundaries, comparison operators, fees, review, escaping, etc.); each mutation must be caught by at least one test | Before Codex review (self-test gate), and when core calculations change |
| Performance | Vitest bench | Time per module at the size limit (500 people / 2,000 rows), recorded in `docs/perf.md` | M1, and when algorithms change |
| End-to-end | Playwright (from M2) | §4 | Every PR preview, before release, after go-live |
| Manual acceptance | Owner | §5 | PRs check only the relevant items; releases check all |

## 2. Cases (unit test names start with the ID)

Amounts are GBP by default. Unless stated: share price £1.00, no minimum, no cap, SPV nominee, fees "deducted from payment".
**Due milestone**: cases in §2.1–§2.4 are due at **M1** by default (engine and parsing layer); cases tagged 〔M2〕/〔M3〕 depend on the UI and are only required to run from that milestone.

### 2.1 Input and formats (IO)

| ID | Covers | Input | Expected |
|---|---|---|---|
| TC-IO-01 | I-01 | `1,234.56` / `£1,234` / `1234.5` | 123456 / 123400 / 123450 pence |
| TC-IO-02 | I-01 | `1,23` / `12,34.5` / `1.234` / `€5` (GBP deal) / `abc` / empty | All rejected, with the reason stated |
| TC-IO-03 | I-01 | `1000000000.01` | Rejected as over the limit |
| TC-IO-04 | I-02 | `3` / `3.5%` / `100` | 300 / 350 / 10000 bp |
| TC-IO-05 | I-02 | `-1` / `100.01` / `3.333` | Rejected |
| TC-IO-06 | I-03 | `2.4137` / `0` / `0.0000001` / `1000000.01` | 2,413,700 / rejected / rejected / rejected |
| TC-IO-07 | I-04 | `2026-10-16` / `16/10/2026` / `31/02/2026` / `10/16/2026` | Valid / valid / rejected / rejected |
| TC-IO-08 | I-07, R-REC-02.4 | CSV row 3 has an empty amount; row 5 has an invalid date | Whole batch not imported; errors "row 3, amount: required" and "row 5, date: …" |
| TC-IO-09 | I-09 | `reference` column missing | Rejected, naming the column |
| TC-IO-10 | I-09, §5.5 | GBP deal: header `Investor Name, Cash Due (£)`; and `Committed (£)` | The first is recognised; the second is rejected, explaining that an "cash due (including investor-paid fees)" column is needed |
| TC-IO-11 | I-09 | On export, a name is `=HYPERLINK("x")` | Cell is written as `'=HYPERLINK("x")` |
| TC-IO-12 | I-08 | 501 investors | Import refused, stating the limit |
| TC-IO-13 | R-REC-01.1, §5.5 | Import `fixtures/commitments.csv` (2 rows have an empty investor_id) | All imported; empty IDs are filled automatically and are all distinct; fields match the file |
| TC-IO-14 | R-REC-01.2, C-REC-2 | References `NW-001`, `NW 001 A`, `AB/12`, `X_1.Z`, each used verbatim as a bank-line reference | Each matches itself exactly; `UK-NW-A-001` (4 segments) is rejected on import |
| TC-IO-15 | R-REC-02.2 | Append import: transaction ID `T9` already exists with a different amount | Import conflict; whole batch not imported; `T9` named |
| TC-IO-16 | §5.0 field table | Exit costs `-1`; holding capital `0`; two identical non-empty investor_id values in the roster; investor percentage fees totalling 100% under deduct-from-payment; two rows with different share_price in the holdings CSV | Each is an input error, naming the field |
| TC-IO-17 | R-DIS-01, §5.5 | Export the TC-DIS-22 holdings with "Export holdings" (§6), then re-import | After the round trip, capital and share price are identical; with the same proceeds each person gets the same as before (still £19 / £10) |
| TC-IO-18 | R-REC-02.1, §5.5 | Import `fixtures/bank.csv` (with transaction IDs, positive amounts, one 0 row, one negative row) | All positive rows imported; the 0 and negative rows skipped and listed; not an error |
| TC-IO-19 | §5.5 header currency | GBP deal, bank import: header `Amount (£)` / `amount gbp` / `Amount (€)` / `amount usd` | First two accepted; last two are import errors |
| TC-IO-21 | I-09 | Bank file `date,amount,payer` with the next row `2026-10-01,1,234.56,ALICE` (one extra cell) | Whole batch not imported; reports a column-count mismatch on row 2 |
| TC-IO-22 | field table | Roster import: 4-segment reference / references that duplicate after normalisation / empty reference / 121-character name / email `bad` | Each causes the whole batch not to be imported |
| TC-IO-23 | field table, C-03 | Direct engine call: empty cut-off date; date 2026-02-31; amount £1,000,000,000.01; share price 1,000,000.000001; empty name; 501 investors or holdings | Each is an input error |
| TC-IO-24 | R-REC-02.2 | The same transaction ID with identical content appears twice in one file; with 2,000 rows already present, append one identical existing transaction | The first keeps only one row; the second imports successfully (capacity is checked after de-duplication) |
| TC-IO-25 | §5.5 | Holdings `name,capital,cost`; bank `date,amount,cost`; holdings with only `name,cost` | The first two ignore the `cost` column and import; the third is rejected, telling the user to use capital (excluding fees) |
| TC-IO-26 | I-07 | Bank row 2 is blank; row 3 has amount `abc` | Error location is row 3 |
| TC-IO-27 | field table | Two rows both have investor_id `__row7` | Duplicate ID reported |
| TC-IO-28 | I-07 | Roster ends with a `,,` row (a blank row exported by spreadsheet software) | Skipped as a blank row |
| TC-IO-29 | I-07 | File using CR-only line breaks; row 3 amount invalid | Error location is row 3 |
| TC-IO-30 | I-09 | Export holdings (ID `-7`, name `+Ann`), then re-import | Identical to the original (import removes the `'` added on export) |
| TC-IO-31 | I-09 | Export holdings (ID `'a`, names `'+Ann`, `+Bob`), then re-import | Identical to the original (an original `'` is not wrongly removed) |
| TC-IO-32 | field table | Investor and holdings import: 41-character ID, 121-character name | Whole batch not imported in each case |
| TC-IO-33 | R-REC-02.2 | Import one bank row with no transaction ID, then append a row whose transaction ID equals the system ID of the earlier row | The two rows get different internal IDs; reconciliation works normally |
| TC-IO-34 | field table | Transaction IDs 79 and 80 characters long | Imported and reconciled normally |
| TC-IO-35 | I-09 | Payer cell is `'` followed by a tab | The escaping `'` is removed; after import the payer is a single tab (text kept as is, R3-1) |
| TC-IO-36 | I-09, C-REC-2 | Bank CSV reference is `NW001` plus a no-break space (U+00A0); investor NW001 | Import keeps the character; reconciliation gives a suggestion at 0.5, not auto-matched |
| TC-IO-37 | I-09 | Export holdings (names `\tAnn`, ` Bob `), then re-import | Identical |
| TC-IO-38 | I-09 | Transaction `T1` exists; append ` T1 `; roster has `A1` and `A1 ` | The first is not counted twice; the second reports a duplicate ID |
| TC-IO-39 | I-09 | An LF file with one CRLF line inside; roster whose last column is the reference and lines end in CRLF | Payer is `Bob`; reference is `NW001` (no carriage return) |
| TC-IO-40 | I-09 | Transaction ID of spaces only; investor ID of spaces only, email and reference with leading/trailing spaces; share price cell of spaces only | Transaction ID treated as absent; investor ID generated automatically; email and reference trimmed; share price treated as not filled in |
| TC-IO-41 | I-09 | Payer ` Bob `, bank reference `NW001` plus NBSP | Kept as is |
| TC-IO-42 | I-09 | Bank file with CRLF then LF; bank file with LF then CRLF then CR; payer with CRLF inside quotes | All imported correctly by row; line breaks inside quotes kept as is |
| TC-IO-43 | I-09 | Tax scheme is a single no-break space; amount with leading/trailing no-break spaces; date and amount with leading/trailing ordinary spaces | The first two are format errors; the third imports normally |
| TC-IO-44 〔M4〕 | I-01, I-03 | USD deal: amounts `$5`, `US$5`, `US$1,250.50`; share prices `US$1,250.50`, `1,250.5`; GBP deal: amount `US$5`; share prices `1,25.5`, `£2.4137` | 500 / 500 / 125050; 1,250,500,000 / 1,250,500,000; error; error / 2,413,700 |
| TC-IO-45 〔M4〕 | §5.5 | GBP deal: import commitments, bank statement, allocation investors and holdings, each with a `currency` column holding `GBP` / `gbp` / blank; then change one row to `EUR` | The first imports normally and `currency` is not an unknown column; the second imports nothing and reports that row's `currency` |
| TC-IO-46 〔M4〕 | §6, §5.5 | The five exports of a EUR deal | Each ends with a `currency` column holding `EUR` on every row; the holdings export re-imports unchanged into the EUR deal and is refused with a `currency` error in a GBP deal |
| TC-IO-20 〔M2〕 | R-REC-01.1 | Paste a 3-row roster in the UI; then in the table change a name, add a row, delete a row | Roster matches the actions; the new row gets an ID automatically |
| TC-DEAL-01 | R-DEAL-01~04 | Create a new deal | Defaults: GBP, cut-off date = today, deduct from payment, minimum 0; holding structure shown as nominee (bare trust) with no other option; after switching to EUR, `£5` is rejected and `€5` is valid |
| TC-DEAL-02 〔M2〕 | R-DEAL-01 | Change the deal name in the UI, then refresh the page | The new name is saved and shown (M1 review #13: the UI part of TC-DEAL-01 split out to M2) |
| TC-DEAL-03 〔M4〕 | R-DEAL-01 | Load the sample, change the currency to EUR: cancel first, then confirm; in a new deal (no amounts) change to USD | A confirmation first, giving the number of amounts and saying nothing is converted; after Cancel still GBP; after confirming EUR with unchanged values; the new deal changes to USD at once with no confirmation; money labels show `€` / `US$`; results show `US$` |

### 2.2 Payment reconciliation (REC)
Base roster: John Smith `NW-001` £5,000; Priya Shah `NW-002` £10,000; Tom Okafor `NW-003` £2,500; Ana Lima `NW-010` £1,000. Cut-off date 2026-10-12.

| ID | Covers | Bank input | Expected |
|---|---|---|---|
| TC-REC-01 | C-REC-1/2, R-REC-03.1 | Reference `NW-001` / `nw 001` / `NW001 SPV` | All three auto-matched to John |
| TC-REC-02 | R-REC-03.2 | Reference `NW-0019` | Not auto-matched |
| TC-REC-03 | C-REC-2 | Reference `NW-010` | Auto-matched to Ana, not to John |
| TC-REC-04 | C-REC-2 | Reference `NW-001 NW-002` | Both match exactly → not auto-matched; suggestion given |
| TC-REC-05 | R-REC-04.1/04.3 | PRIYA SHAH £10,000, no reference | Suggestion, top choice Priya (0.55); not posted; Priya still unpaid |
| TC-REC-06 | R-REC-04.2 | As above, confirm to Priya | Posted; Priya paid in full |
| TC-REC-07 | R-REC-04.2 | As above, instead assign to Tom (not among the candidates) | Posted to Tom; Tom overpaid +£7,500 |
| TC-REC-08 | R-REC-04.2 | Mark "not part of this deal", then undo | First not posted (listed for review); after undo, back to suggestion |
| TC-REC-09 | R-REC-04.4 | After confirming, change that bank line's amount to £9,000 | Decision voided; back to awaiting review |
| TC-REC-10 | R-REC-04.4 | Confirm to Priya, then delete Priya | Decision voided |
| TC-REC-11 | C-REC-3, R-REC-04.1 | Payer `UNKNOWN`, amount = Ana's commitment, no reference | Amount only, 0.25 < 0.3 → no candidates, "unmatched" |
| TC-REC-12 | C-REC-3 | Name similarity | `J SMITH`/John Smith = 1; `MR JOHN SMITH` = 1; `Okafor Holdings Ltd`/Tom Okafor = 0.5 |
| TC-REC-13 | C-REC-3 | Reference `NW 3`, payer `T OKAFOR`, £2,500 | Partial match (numbers equal) 0.25 + name 0.3 + amount 0.25 = 0.8 → top choice Tom, not auto-matched |
| TC-REC-14 | R-REC-05 | T OKAFOR £2,000 `NW-003`; J SMITH two payments of £5,000 `NW001` (different dates, different transaction IDs) | Tom underpaid −£500; John overpaid +£5,000 |
| TC-REC-15 | R-REC-02.2 | Append-import the same bank file with transaction IDs | Not counted twice |
| TC-REC-16 | R-REC-02.2 | Two rows with no transaction ID and all four fields identical | Both flagged "possible duplicate import"; neither auto-matched; neither deleted |
| TC-REC-17 | R-REC-02.3 | One row −£45 `BANK CHARGE`; one row £0; one row dated 2026-10-13 | The first two skipped and listed; the third excluded and listed |
| TC-REC-18 | R-REC-06, C-REC-5 | Unmatched bank lines 9 / 10 / 11 days from the cut-off date | Only the 11-day one is flagged "long unmatched" |
| TC-REC-19 | R-REC-07 | Any combination | Posted + not posted = bank total; check fails while suggestions are unhandled |
| TC-REC-20 | R-REC-01.2 | Roster contains both `NW-001` and `nw001` | Rejected, naming both row numbers |
| TC-REC-21 | R-REC-08, C-REC-6 | John overpaid £5,000, then carried into allocation | In allocation John received £5,000; refund list shows John £5,000 |
| TC-REC-22 | R-REC-09 | Export the ledger and the chase list | Columns match §6; amounts match the UI |
| TC-REC-23 | R-REC-08, C-REC-6, C-ALL-1 | Convention "added on top" 3%; Priya cash due £10,300, received £10,300, carried into allocation | Reconciliation: paid in full; carried £10,300; allocation I £10,000, fee £300, refund £0 |
| TC-REC-24 | R-REC-02.2 | "Replace" import with a new bank file | Old bank lines and all manual decisions based on them are cleared |
| TC-REC-25 | C-REC-3, R-REC-04.1 | All 4 roster people are named John Smith (different references); bank payer `J SMITH`, no reference, amount matches no one | Exactly 3 candidates, all 0.3, the first 3 in roster order, all with reason "payer name matches" |
| TC-REC-26 | R-REC-06 | Threshold changed to 5 days; unmatched bank lines 5 / 6 days from the cut-off date | Only the 6-day one is flagged; hint text says "operational reminder, not a regulatory deadline" |
| TC-REC-27 | R-REC-09 | Export the chase list for the sample deal | Contains only underpaid and unpaid people (David, Chloe, Elena, Kavya, James, before handling suggestions); excludes paid in full and overpaid |
| TC-REC-28 | C-REC-3 | Name `J JOHN` against `JOHN JAMES` | Similarity 1 (J→JAMES, JOHN→JOHN) |
| TC-REC-29 | R-REC-08, C-03 | Click "Carry into allocation" while 1 suggestion is still unhandled | Blocked, with a prompt to handle suggestions first |
| TC-REC-30 | R-REC-04.4 | After manually confirming a bank line with an exact reference, change its amount; or change that investor's email / tax scheme | Decision voided; the bank line returns to awaiting review and is not auto-matched; review check fails |
| TC-REC-31 | R-REC-02.2, R-REC-04.4 | After rejecting transaction T1, replace-import a file containing the same T1 | All manual decisions cleared |
| TC-REC-32 | C-REC-3 | Investor NW-011 owes £100; bank line £100, payer UNKNOWN, reference `XX 11 INV 4471` | Fragment `11` has equal numbers → suggestion, score 0.5 |
| TC-REC-33 | C-REC-3 | Two investors with the same name (7 words); payer with 4 matching words, same amount | Both 59/140, in roster order; scores compared as exact fractions |
| TC-REC-34 | C-03 | Transaction ID `constructor` / `toString` / `__proto__`, reference matches exactly, no manual decision | Auto-matched |
| TC-REC-35 | C-REC-1/2 | Investor SS-001; bank reference `ß001` or `Payment SS001É` | Neither auto-matched |
| TC-REC-36 | C-REC-3 | `J.A. SMITH` / `SMITH,JOHN` / `MARY-JANE WATTS` against the matching full names | Similarity 1 in each case |
| TC-REC-37 | field table | Investor reference `É001`; investor NW-001 with bank reference `Zahlung NW-001 München` | The first is an input error; the second is auto-matched |
| TC-REC-38 | C-REC-3 | Investor name `𐐀BC`, payer `𐐀`, same amount, no reference | Score 0.55, awaiting review |
| TC-REC-39 | C-REC-3 | Investor NW001; bank reference `NW00𝐀`, same amount | Edit distance 1 → suggestion 0.5 |
| TC-REC-40 | C-REC-1/2/3 | Bank reference `NW001Ɤ` / `NW001\u{11F04}` / `NW001É`; and `Ref NW001 Ɤ`; name `José García` | The first three are not auto-matched; `Ref NW001 Ɤ` is auto-matched; `José García` against `josé garcía` has similarity 1, against `JOSÉ GARCÍA` 0 (non-ASCII letters are not upper-cased; a limitation stated in the PRD) |
| TC-REC-41 | field table | Investor reference `NW--001` / ` NW001` / `-NW001` / `NW001.` | All input errors |

### 2.3 Closing allocation (ALL)

| ID | Covers | Input | Expected | Hand calculation |
|---|---|---|---|---|
| TC-ALL-01 | C-ALL-5 | A received £1,000, no fees | I £1,000; shares 1000.000000; refund £0 | — |
| TC-ALL-02 | C-ALL-1/6 deduct | A £10,000, investor pays 3% | I £9,700; fee £300; refund £0 | 10,000 × 0.97; 9,700 × 0.03 ÷ 0.97 = 300 |
| TC-ALL-03 | C-ALL-1/6 on top | Convention "added on top", A £10,300, 3% | I £10,000; fee £300; refund £0 | 10,300 ÷ 1.03 |
| TC-ALL-04 | — | (removed in v0.7: direct holding) | — | — |
| TC-ALL-05 | C-ALL-5, C-ALL-8 S/EIS | Share price £2.4137, A (SEIS) £5,000, no fees | I £5,000; shares 2071.508472; claimable 2,071 shares / £4,998.77; not claimable £1.23 | 2,071 × 2.4137 = 4,998.7727, rounded down to the penny 4,998.77 |
| TC-ALL-06 | C-ALL-2/5 (Isla case) | Minimum £1,000; share price £2.4137; A £1,000, no fees | I £1,000; shares 414.301694; compliant, not flagged red | Fractional shares, not rounded |
| TC-ALL-07 | C-ALL-2, R-ALL-03 | Minimum £1,000; A £900; investor pays 3% | A does not participate; refund £900; fee £0 | — |
| TC-ALL-08 | C-ALL-2 on top | Convention "added on top", minimum £1,000, 3%, A £1,020 | M = £990.29 < £1,000 → does not participate, refund £1,020 | 1,020 ÷ 1.03 ≈ 990.29 |
| TC-ALL-09 | C-ALL-3, R-ALL-04.1 | Cap £3,000; A £4,000, B £2,000 | A I £2,000 refund £2,000; B I £1,000 refund £1,000 | 3,000 split 4:2 |
| TC-ALL-10 | R-ALL-04.2 | Minimum £1,000; cap £1,500; A and B £1,000 each | Each scaled to £750 → **cannot close**; A and B listed | — |
| TC-ALL-11 | C-ALL-4 | Fixed £10 (admin) and £5 (KYC) per person; A £1,000, B £2,000 | A and B each pay admin £10, KYC £5; admin total £20, KYC total £10; A I £985, B I £1,985 | Each fee separate, not merged |
| TC-ALL-12 | — | (removed in v0.7: direct holding) | — | — |
| TC-ALL-13 | C-ALL-9, R-ALL-08 | A £1,000; company pays fixed £1,500 | **Cannot close**: company-paid fees exceed total investment | — |
| TC-ALL-14 | R-ALL-08 | No investors / all below the minimum | **Cannot close**: no investors to allocate | — |
| TC-ALL-15 | C-ALL-9, R-ALL-07 | A £10,000; company pays fixed £1,500; lead pays 2% | Paid to company £8,500; lead invoice £200 | — |
| TC-ALL-16 | — | (removed in v0.7: direct holding) | — | — |
| TC-ALL-17 | C-ALL-7 | Share price £0.333333; deduct 3.5%; received from £10.00 to £13.99, each penny computed once | Every refund ≥ 0, and received = invested + fees + refund | Invariant |
| TC-ALL-18 | R-ALL-09 | A SEIS £1,000, B EIS £1,000, C none £1,000 | Three groups of 1 person / £1,000 each; shows "SEIS must be issued on a day before EIS" | — |
| TC-ALL-19 | R-ALL-01, C-03 | Share price `abc`; received `-1`; rate `120%`; an investor-paid fixed total fee (not allowed) | Each: no result, check shows "unavailable", export disabled | — |
| TC-ALL-20 | R-ALL-10 | Sample deal | Totals, each fee, payment and refunds in the confirmation note match the result; CSV columns match §6 | — |
| TC-ALL-21 | C-ALL-1/7 | Nominee; fixed fee £10 per person; A received £10, B received £100 | A does not participate: refund £10, fee £0; B: I £90, fee £10 | A: R ≤ F |
| TC-ALL-22 | C-ALL-7 | Share price £0.01; deduct from payment; 5 investor fees of 1% each; A received £0.53 | I 48p; each of 5 fees 1p; refund 0p (needs two retries) | 50p: each fee round(0.526)=1 → refund −2p; 49p: each round(0.516)=1 → −1p; 48p: each round(0.505)=1 → 0p |
| TC-ALL-23 | R-ALL-09 | Sample deal | Sum of headcount, investment and shares across the SEIS / EIS / none groups equals the overall total | — |
| TC-ALL-24 〔M2〕 | R-ALL-10 | Click "Copy confirmation" | Clipboard content matches the confirmation note in the UI | — |
| TC-ALL-30 〔M4〕 | R-ALL-10 | The sample deal's confirmation note | The second line is `Currency: GBP` | — |
| TC-ALL-25 | C-ALL-8 | Result of TC-ALL-05 | Shows the exact notice text specified in C-ALL-8 | — |
| TC-ALL-26 | C-ALL-6 | Investor percentage fee with ID `__proto__`, A received £100, 3% | Invested £97, fee £3, refund £0 |
| TC-ALL-27 | C-ALL-3 | Minimum £1; investor pays 0.01%; A received £1, B received £2; cap £2.97 | Blocked, list contains A (after scaling, A's target is unchanged, but on the commitment basis 99 ÷ 0.9999 ≈ 99.0099p < 100p) |
| TC-ALL-28 | I-08 | 21 fees; and 500 investors at £1 billion each + 20 lead-paid fees at 100% | The first is an input error "at most 20 fees"; in the second the lead invoice is exactly £10 trillion (1,000,000,000,000,000 pence) |
| TC-ALL-29 | R-ALL-02 | Two fees both named "Fee" | Input error (names are used as export column names and must be unique) |

### 2.4 Exit distribution (DIS)
Unless stated: fixed mode; k 20%; h 0; c 0; exit costs 0; n 5; capital A £60,000, B £40,000; shares A 60,000, B 40,000; total C = £100,000.

| ID | Covers | Input | Expected | Hand calculation |
|---|---|---|---|---|
| TC-DIS-01 | C-DIS-5 | Proceeds £300,000; k 20%; no hurdle | carry £40,000; A £156,000; B £104,000 | 200,000 × 20%; 260,000 split 6:4 |
| TC-DIS-02 | C-DIS-2 | Proceeds £80,000 | carry £0; investors £80,000 (a loss, not an error) | — |
| TC-DIS-03 | C-DIS-1 | Proceeds £300,000; exit costs £10,000 | carry £38,000 | (290,000 − 100,000) × 20% |
| TC-DIS-04 | C-DIS-3/4 | k 20%; h 8%; n 5; c 100%; proceeds £300,000 | hurdle £46,932.81; catch-up tranche £11,733.20 (all to the lead); of the remaining £141,333.99 the lead gets £28,266.80; total carry £40,000.00 | 1.08⁵ − 1 = 0.4693280768; 0.2 × 46,932.81 ÷ 0.8 = 11,733.2025 → 11,733.20; 200,000 − 46,932.81 − 11,733.20 = 141,333.99; × 20% = 28,266.798 → 28,266.80 |
| TC-DIS-05 | C-DIS-3 | As above but c = 0 | carry £30,613.44 | (200,000 − 46,932.81) × 20% = 30,613.438 |
| TC-DIS-06 | C-DIS-4 partial catch-up | As TC-DIS-04 but c 50% | catch-up tranche £31,288.54 (lead £15,644.27); of the remaining £121,778.65 the lead gets £24,355.73; carry £40,000.00 | 0.2 × 46,932.81 ÷ 0.3 = 31,288.54; 200,000 − 46,932.81 − 31,288.54 = 121,778.65; × 20% = 24,355.73 |
| TC-DIS-07 | C-DIS-3 | Proceeds £140,000; h 8%; n 5; c 100% | carry £0 | Profit 40,000 < 46,932.81 |
| TC-DIS-08 | C-DIS-3 fractional years | h 8%; n 2.5; c 0; proceeds £300,000 | hurdle £21,215.84; carry £35,756.83 | 1.08^2.5 − 1 ≈ 0.2121584 → 21,215.84; (200,000 − 21,215.84) × 20% = 35,756.832 |
| TC-DIS-09 | C-DIS-6 | 20% up to 3×, 30% above; proceeds £500,000 | carry £100,000 | 200,000 × 20% + 200,000 × 30% |
| TC-DIS-10 | C-DIS-6 boundary | As above; exit costs £10,000; proceeds £310,000 / £310,010 | carry £40,000.00 / £40,003.00 | Distributable exactly 3×; the extra £10 × 30% |
| TC-DIS-11 | — | (removed in v0.7: allocation by share count, only for direct holding) | — | — |
| TC-DIS-12 | C-DIS-7 | Three people with 1 unit each, proceeds £1.00, k 0, capital 1p each | 34p / 33p / 33p | Largest remainder; ties go to the one listed first |
| TC-DIS-13 | R-DIS-07 | Exit costs £2 > proceeds £1 | No final distribution; shows a shortfall of £1 | — |
| TC-DIS-14 | R-DIS-07 | Total capital 0; or h 0 with c 50%; or h 8% with c 20% (≤ k); or tier multiples not increasing | Each is an error; no result | — |
| TC-DIS-15 | R-DIS-06 | Export for the sample deal | CSV columns match §6; totals match the UI | — |
| TC-DIS-16 | C-DIS-4 not enough money | h 8%; n 5; c 50%; proceeds £160,000 | catch-up tranche can only pay £13,067.19; lead £6,533.60; total carry £6,533.60; investors total £153,466.40 | Profit 60,000 − 46,932.81 = 13,067.19 < required 31,288.54; × 50% = 6,533.595 → 6,533.60 |
| TC-DIS-17 | C-DIS-6 boundary | Tiers 20% up to 3×, 30% above; proceeds £299,999.99 / £300,000.00 / £300,000.01 | carry £40,000.00 / £40,000.00 / £40,000.00 | 199,999.99 × 20% = 39,999.998 → 40,000.00; +1p × 30% = 0.3p → 0 |
| TC-DIS-18 | C-DIS-6 half-penny boundary | C = 1p; proceeds 2p; tiers 100% up to 1.5×, 100% above | Boundary B₁ = round half up(0.5p) = 1p; carry 1p; investors 1p | The rule rounds the boundary first, then applies the tiers |
| TC-DIS-19 | R-DIS-06, C-DIS-7 | TC-DIS-01 | A: profit/loss £96,000, multiple 2.60; B: profit/loss £64,000, multiple 2.60 | 156,000 − 60,000; 156,000 ÷ 60,000 |
| TC-DIS-20 | R-DIS-03/04 | In tiered mode, pass h 8% or c 50% | Input error | The two modes are mutually exclusive |
| TC-DIS-22 | C-ALL-5, C-DIS-7 | Nominee; share price £100,000; A invests 19p, B invests 10p (no fees), carried into exit; proceeds £29; k 0 | A £19, B £10 (by amount invested, unaffected by truncation) | 19:10 |
| TC-DIS-23 | C-ALL-5, C-DIS-7 | Nominee; share price £100,000; A invests 1p, B invests £1; carried into exit | Carried successfully (A's weight is 1, not 0); shares shown A 0.000000, B 0.000010 | — |
| TC-DIS-24 | §5.0 | Nominee; share price £0.000001; A invests £10,000, carried into exit | Carried successfully (10¹⁰ shares, within the limit) | — |
| TC-DIS-21 〔M3〕 | R-DIS-01, C-DIS-7 | (a) TC-DIS-22 holdings: change B's capital from 10p to 20p; (b) import `fixtures/holdings.csv` | (a) A's capital unchanged; with proceeds £29, A £14.13, B £14.87 (19:20, largest remainder); (b) whole table replaced, matching the file | (a) 2,900 × 19 ÷ 39 = 1,412.82, 2,900 × 20 ÷ 39 = 1,487.18; the remaining 1p goes to A, which has the larger remainder → 1,413 / 1,487 |
| TC-DIS-26 | C-DIS-7 display | TC-DIS-22 holdings: (a) after carrying, change the allocation share price to £50,000; (b) import holdings with no `share_price` column | (a) Shares shown in the holdings table unchanged (A 0.000001), shown as "out of date"; (b) shares shown as "—"; distribution result unaffected | — |
| TC-DIS-27 | C-DIS-3 | Capital £50, proceeds £50.01, 1 year, hurdle 0.01%, k 100%, c 0; and capital 5p, h 21%, 0.5 years | hurdle exactly 0.5p → 1p; carry 0; investors get £50.01. In the second, 5 × (1.1 − 1) = 0.5p → 1p |
| TC-DIS-28 | C-DIS-6, I-05 | Capital £100 million, proceeds £200 million, tiers 20% up to 10 million×, 30% above; `parseMultiple("90071992547409.93")` | carry £20 million, investors £180 million; multiple parsed with no loss of precision |
| TC-DIS-29 | C-DIS-4/6 | In tiered mode, pass h = 0 or c = 0 | Input error (rejected if present at all) |
| TC-DIS-30 | C-DIS-3 | Capital £100, proceeds £200, 50 years, hurdle 100%, k 20%, c 0 (hurdle far beyond the safe integer range) | No crash; hurdle pays £100, carry 0, investors get £200 |
| TC-DIS-31 | C-DIS mode exclusivity | Fixed mode with a tier table; tiered mode with a fixed carry rate | Both input errors |
| TC-DIS-25 | — | (removed in v0.7: share-count check under the share-count basis) | — | — |
| TC-X-01 〔M2〕 | R-X-05 | Render the UI | All 11 terms listed in PRD R-X-05 have explanatory text | — |
| TC-X-02 〔M2〕 | R-X-06 | Render the footer | Feedback link is `mailto:`, with "Please don't send real investor information" next to it | — |
| TC-X-03 〔M4〕 | R-X-04 | Theme switch: default → choose Dark → reopen → Clear all data | Default is System and the page carries no theme mark; after Dark the page is marked dark and is still Dark after reopening; after "Clear all data" it is back to System and no theme is stored | — |
| TC-X-04 〔M4〕 | R-X-02 | Saving in the browser: ① storage throws `QuotaExceededError` (including Firefox's `NS_ERROR_DOM_QUOTA_REACHED` and older browsers' code 22 / 1014); ② it throws another error (such as `SecurityError`), or the browser already refuses when `localStorage` is read (the usual case when site data is blocked), or `localStorage` is `null`; ③ saving then succeeds again | ① the "storage for this page is full" sentence shows, not "storage is blocked"; ② the "storage is blocked" sentence shows; ③ the message goes away; the message sits in a status region that screen readers announce; the app never fails in any case | — |


### 2.5 v0.8: chase and query messages, activity log, withdrawal, fee payer change (PRD v0.8, decision 11)

Due milestones: 〔M5〕 = the first v0.8 PR (chasing payments: R-REC-10, R-X-08, R-X-01.2); 〔M6〕 = the second PR (changes before closing: R-REC-11, R-REC-12, R-ALL-12). "Sample" means the sample deal (§3: deadline 2026-10-16, minimum £1,000, 3% platform fee paid by investors and deducted from the payment, £1,500 legal fee paid by the company, cap £150,000); "after review" means after confirming t03, t05, t12 and rejecting t11, t14. Time comes from a fixed clock injected by the test, never from the system clock.

| ID | Covers | Input | Expected |
|---|---|---|---|
| TC-REC-42 〔M5〕 | C-REC-8 template A | Sample after review, David Kim (due £2,500, received £2,000, reference NW-004) | The text is exactly: `Hi David Kim,` blank line `For Northwind Robotics — Seed SPV (fictional sample), we have received £2,000.00 GBP of the £2,500.00 GBP due from you, so £500.00 GBP is still outstanding. Please pay it using the payment reference NW-004 exactly as written.` blank line the second paragraph of template A verbatim blank line `Thank you.` |
| TC-REC-43 〔M5〕 | C-REC-8 template A | James Whitfield in the sample (received £0: t16 is after the deadline); the same roster as a USD deal | The first sentence is `For Northwind Robotics — Seed SPV (fictional sample), we have not yet received the £20,000.00 GBP due from you.`, the rest has the same structure as TC-REC-42; in USD the amount reads `US$20,000.00 USD` |
| TC-REC-44 〔M5〕 | C-REC-8 template B, R-REC-10.2 | Sample t03 (£20,000.00, 2026-10-07, payer CHLOE MARTIN) against the candidate Chloe Martin; plus a made-up bank line: payer `BEN OKAFOR`, reference `NW-002 =cmd`, transaction ID `T-SECRET`, candidate Amelia Hart | First: `we received a payment of £20,000.00 GBP on 7 October 2026 that we could not match…`, exactly template B; the second text contains none of `BEN OKAFOR`, `NW-002`, `=cmd`, `T-SECRET` |
| TC-REC-45 〔M5〕 | R-REC-10.1, I-09 | Export the chase list CSV from the sample after review; in another roster one person is named `=HYPERLINK("x")` | Each row has an extra `message` column equal to that person's template A text (line breaks included, quoted per CSV rules); a name starting with `=` is escaped in the `name` column; the `message` column starts with `Hi ` and needs no escaping |
| TC-REC-46 〔M5〕 | R-REC-10.1–10.3 | UI: before review, click "Copy query" for Chloe under t03; after review, click "Copy message" for David | The clipboard holds the texts of TC-REC-44 and TC-REC-42 respectively; then "Copied. Send it yourself from your usual email." shows; the page has no `mailto:` link to the investor and opens no new window; when the clipboard is unavailable the text is selected for manual copying |
| TC-X-05 〔M5〕 | C-X-1, R-X-08.1/08.3 | Enter initials `HY` in deal settings; load the sample → 5 review steps → carry into allocation → copy one chase message | The entries, in order, are `sample_loaded`, `confirm`×3, `not_in_deal`×2, `handoff_allocation`, `message_copied`; `seq` runs on from 1 with no gaps; `time` is the injected clock in ISO 8601 with a time-zone offset; every entry has initials `HY` (loading the sample does not clear initials, PRD field table); the `handoff_allocation` detail has the snapshot version, head count and total; `message_copied` does not contain the text itself |
| TC-X-06 〔M5〕 | C-X-1 | After review, change the amount of t03; then type into an investor's name 5 times in a row | One `decision_voided` entry, reason: the bank line changed; typing a name produces no entries |
| TC-X-07 〔M5〕 | C-X-1 capacity, R-X-08.4 | The engine builds 3,999 / 4,000 / 5,000 / 5,001 entries directly; export once at entry 4,500 | No notice at 3,999; the 80% notice from 4,000; at 5,001 the oldest is deleted and the first entry is `truncated`, giving the number deleted, the `seq` range and that all were exported; `seq` values are never reused; if the deleted entries include unexported ones the notice becomes "N entries were removed before export."; the action always completes as normal |
| TC-X-08 〔M5〕 | R-X-08.5, R-X-02 | On save: the first `setItem` throws `QuotaExceededError` and succeeds after some entries are deleted; in another case it still fails after deleting entries | The first saves, a `truncated` entry appears, and "storage full" is not shown; the second shows the R-X-02 "storage for this page is full" sentence; in both cases no deal data is lost |
| TC-X-09 〔M5〕 | R-X-08.2, §5.5 | Export the activity log CSV; "Clear all data"; then "Load sample" | The header is exactly `seq,time,initials,event,investor_id,investor_name,transaction_id,amount,detail,currency`; text columns are escaped per I-09; the export writes a `log_exported` entry; after clearing the log is empty; after loading the sample there is only one `sample_loaded` entry |
| TC-X-10 〔M5〕 | Saving in the browser | Saved data in the v1.1.1 format (no log, withdrawal or fee payer change fields) | Loads normally with the new fields empty; deal data intact |
| TC-X-11 〔M5〕 | R-X-01.2, C-X-1 | The tour script; "Do this for me" all the way to the end; then jump back to chapter 1 and walk it again | Still 12 steps; step 6 has one extra sentence introducing "Copy message", step 2 is unchanged; the end card has the Activity log sentence and "Try next" item 3 (undo a decision to see Copy query), and its links open the pages and controls given in the guided tour design v0.3; the log has every decision the tour made, with detail `guided tour`; after jumping back the log starts again from `sample_loaded`, with no duplicates |
| TC-X-12 〔M6〕 | R-X-01.2 | The tour end card; the withdrawal and fee payer change panels | "Try next" items 1 and 2 appear with the wording of the guided tour design v0.3, amounts read from the calculation results (£3,000.00, £1,000.00, £970.00); the links only take you to the control and change no data; each panel has one sentence of explanation |
| TC-X-20 〔M6〕 | R-X-01.2 end card item 2 | After finishing the tour: ① no change; ② change the cap to £80,000; ③ change James Whitfield's amount due to £980 and carry again | ① item 2 shows, including "lower the minimum commitment (Deal settings) to £970.00"; ② and ③ do not show item 2 (in ③ the preview computed separately with minimum £970 is still blocked: James's step 1 T = £950.60, and in step 3 £950.60 < £970 so he is excluded) |
| TC-REC-47 〔M6〕 | C-REC-7, R-REC-11.2 | After review, mark Lucas Meyer (received £3,000) as withdrawn (consent ticked, date defaults to 2026-10-16) | Status Withdrawn; not on the chase list; after carrying into allocation Lucas is not in it; pending refunds include Lucas £3,000.00 with reason `Withdrawn`; total due is £3,000.00 lower; the summary shows "Withdrawn: 1 investor, £3,000.00 to refund"; new check: pending refunds total = £3,000.00 + Hugo's overpayment £5,000.00 = £8,000.00 |
| TC-REC-48 〔M6〕 | R-REC-11.1 | Click confirm without ticking consent; withdrawal date `31/02/2026`; undo after marking | The first two cannot be marked and say why; after undo back to Paid in full; the log has `withdrawn` then `withdrawal_undone` |
| TC-REC-49 〔M6〕 | C-REC-7 voiding | After Lucas withdraws: ① change his name, email and amount due; ② change his payment reference; ③ delete him; ④ replace the whole roster by import with Lucas's ID and reference unchanged | ① and ④ keep the withdrawal; ② and ③ void it and log `withdrawal_voided` (with the reason) |
| TC-REC-50 〔M6〕 | R-REC-11.3 | After Lucas withdraws, append a bank line: date 2026-10-16 (not after the deadline), £500, reference `NW-012` | Auto-matched to Lucas; pending refund becomes £3,500.00 |
| TC-REC-51 〔M6〕 | C-REC-7 | In the sample, mark James Whitfield (received £0) as withdrawn | Not on the chase list, not in pending refunds; total due is £20,000.00 lower |
| TC-REC-52 〔M6〕 | R-X-07, C-REC-7 | After carrying into allocation, mark, undo and void a withdrawal once each | After each, allocation shows "out of date, carry again" |
| TC-ALL-31 〔M6〕 | C-ALL-10 example 1 | Deducted from payment, minimum 0, no cap, a single 3% fee; amount due £1,000.00; investors pay → company pays | T £970.00; N £970.00; difference −£30.00; that fee £30.00 before (paid by investors), £29.10 after (paid by the company) |
| TC-ALL-32 〔M6〕 | C-ALL-10 example 2 | As above, company pays → investors pay | T £1,000.00; N £1,030.93 (at £1,030.92 the investment is £999.99); difference +£30.93; investor fee £30.93, refund £0.00 |
| TC-ALL-33 〔M6〕 | C-ALL-10 example 3, R-ALL-12.4 | Example 1 but minimum £1,000 | Step 3 blocks, naming the investor and "would fall below the minimum commitment"; as there is only this one investor, the "no investors to allocate" block also shows; cannot apply |
| TC-ALL-34 〔M6〕 | C-ALL-10 | ① On top, 3% company pays → investors pay, amount due £1,000.00; ② deducted from payment, a per-investor fixed fee £25 + 2% paid by investors, amount due £1,025.00, change the 2% to company pays | ① T £1,000.00, N £1,030.00 (⌊1,030.00 ÷ 1.03⌋ = £1,000.00, fee £30.00), difference +£30.00; ② T £980.00 (fees £20.00 + £25.00, refund 0), N £1,005.00, difference −£20.00 |
| TC-ALL-35 〔M6〕 | C-ALL-10, sample | Carry the sample after review; change the platform fee to company pays; then change the minimum to £970 and recompute | First blocked (Isla Campbell, N £970.00 below £1,000); with minimum £970 the 12 people have N = amount due × 97%, total £124,000.00 → £120,280.00, total difference −£3,720.00; the platform fee becomes company-paid £3,608.40 (£120,280.00 × 3%) |
| TC-ALL-36 〔M6〕 | C-ALL-11, R-REC-12, R-ALL-12.3/12.5 | Continue from TC-ALL-35: tick consent and apply; then reverse | After applying: the amounts due stored in the roster are unchanged; Amelia's effective amount due is £9,700.00, shown as "was £10,000.00 · −£300.00 fee payer change (Platform fee: investors → company)", status overpaid +£300.00, and it goes into pending refunds; a banner shows the change is in effect; allocation is out of date; the log has one summary entry and 12 per-person entries. After reversing: the payer is back to investors, effective amounts due are back to the originals, the entry is marked reversed and `fee_payer_change_reversed` is logged |
| TC-ALL-37 〔M6〕 | C-ALL-11 voiding, R-ALL-12.5 | Continue from TC-ALL-36 after applying: ① manually change Amelia's amount due to £10,500; ② in allocation change the platform fee rate to 4%; ③ pick another fee while a change is in effect | ① only Amelia's row is voided, showing "This fee payer change no longer applies — redo it", logged `adjustment_voided`; ② the whole change is voided, everyone back to the original amount due, logged `fee_payer_change_voided`; ③ the panel shows only the change in effect and "Reverse" |
| TC-ALL-38 〔M6〕 | R-ALL-12.1, C-ALL-10 | ① allocation investors were imported directly; ② allocation is out of date; ③ after carrying, the allocation investor table was edited by hand; ④ pick a fixed fee; ⑤ deducted from payment, investors already pay 60%, change a 40% company-paid fee to investors | ①–③ the panel is disabled and says why; ④ fixed fees are not in the list to pick from; ⑤ input error (investor percentages total 100%) |
| TC-ALL-39 〔M6〕 | R-ALL-12.2/12.3 | Change to investors pay, company pays, lead pays in turn | The first two show the matching consent prompt and cannot apply without ticking "Consent evidence received"; lead pays shows "Inform only — no consent needed" and applies directly; the confirm button gives the number of people and amounts to top up and to refund |
| TC-X-13 〔M5〕 | C-X-1 | After review, replace the whole bank statement with `fixtures/bank.csv` (clearing 5 manual decisions); then confirm 1 bank line by hand and delete it by hand | The replacement produces only 1 `decision_voided` entry whose detail says 5; the manual delete produces 1, reason: the bank line was deleted |
| TC-X-14 〔M5〕 | R-X-05 | Render the reconciliation page | The new terms MT103 / UETR each have a sentence of explanation (the 11 of TC-X-01 as before) |
| TC-X-15 〔M6〕 | R-X-05 | Render the withdrawal and fee payer change panels | The new terms withdrawal and fee payer each have a sentence of explanation |
| TC-X-16 〔M5〕 | Field table initials, R-X-08.3 | Enter initials `H@Y` and make a decision; change back to `HY` and make another | With `H@Y` the field shows an error and that entry's initials are blank; after the change the entry has `HY`; changing the initials itself produces no entry |
| TC-REC-53 〔M6〕 | C-REC-7 × C-ALL-11 | After review: first mark Lucas withdrawn, then apply the platform fee change to company pays (minimum £970, covering 11 people); then undo Lucas's withdrawal; another time: add an investor after applying | Lucas (and the added person) are marked "Not covered by the active fee payer change — reverse and redo"; reconciliation is "needs review" and carrying into allocation is disabled; after reversing the change the marks go away |
| TC-REC-54 〔M6〕 | C-REC-7, C-ALL-11 | With the change in effect and Lucas withdrawn, change Amelia's reference `NW-001` to `NW 001` and Lucas's `NW-012` to `NW 012` | Neither counts as a change: Amelia's effective amount due is still £9,700.00, with no voiding notice or entry; Lucas is still withdrawn |
| TC-ALL-40 〔M6〕 | C-ALL-10 step 3 | On top, minimum £1,000, A due £1,000, B due £2,000, 3% investors pay → company pays | In step 1 A does not take part (M = ⌊1,000 ÷ 1.03⌋ = £970.87 < £1,000), B does; in step 3 A would take part (M = £1,000.00): block "would join the allocation", naming A |
| TC-ALL-41 〔M6〕 | C-ALL-10 step 1 | After review, change the cap to £80,000, then open the fee payer change panel | Block "The round is over the cap — resolve the scale-back first", plus blocks for those below the minimum after scale-back (e.g. Isla Campbell); no differences shown, cannot apply |
| TC-ALL-42 〔M6〕 | C-ALL-11 reminder | Continue from TC-ALL-36 after applying: change the minimum from £970 back to £1,000 | The change is not voided; "Allocation settings changed since this fee payer change — check the preview" shows; the recomputed step 3 shows a block for Isla Campbell |
| TC-ALL-43 〔M6〕 | C-ALL-10 step 2 | Randomly generated inputs across both conventions, 1–5 investor percentage fees, with and without a per-investor fixed fee (fixed seed, 3,000 sets) | In every set N_i gives I(N_i) = T_i, and at N_i − 1 penny I < T_i |
| TC-X-17 〔M5〕 | C-X-1 import | ① After review, replace the whole statement with the sample's own bank file; ② then append the same file (all duplicate rows with the same transaction IDs); ③ replace the commitments roster so that a previously unmatched line becomes an exact match | ① the `import` auto-match count is 9; ② 0 rows added, 0 auto-matched; ③ auto-match count 1 |
| TC-X-18 〔M5〕 | §5.5 activity log CSV | Make a decision in a GBP deal, change the deal to USD and make another, export | First row `currency` is `GBP`, second `USD`; events without an amount also carry the currency at that time |
| TC-X-19 〔M5〕 | Saving in the browser | A schema 2 save without `withdrawals` or `feePayerChanges`; another without only `log` | The first two are not read at all (no silently computing money with no withdrawals and adjustments); with only `log` missing the deal data loads as normal |
| TC-ALL-44 〔M6〕 | C-ALL-10/11 coverage | Deducted from payment, minimum £970; A due £1,000, B £500, 3% investors pay → company pays | Preview passes: A's N £970.00, B marked "Not participating — unchanged"; after applying B is within coverage, **not** marked "Not covered…", and carrying is not blocked |
| TC-ALL-45 〔M6〕 | R-ALL-12.5 | Continue from TC-ALL-36: reverse straight after applying (allocation out of date); another time reverse while reconciliation is "needs review" | Both can be reversed, without ticking consent again |
| TC-ALL-46 〔M6〕 | C-ALL-11 saved settings | Continue from TC-ALL-36 after applying: add a per-investor fixed fee of £10 paid by investors, save and refresh the page | The "Allocation settings changed…" reminder shows; recomputing with the saved T_i: each of the 12 people invests £10.00 less than T_i (e.g. Isla from £970.00 to £960.00), all listed as blocks by name |
| TC-ALL-47 〔M6〕 | C-ALL-10/11 coverage voiding | Continue from TC-ALL-44 after applying: change B's reference to another one and the amount due from £500 to £1,000 (ID unchanged); refresh the page | B's row is voided, marked "Not covered by the active fee payer change — reverse and redo", carrying disabled; still so after refresh |
| TC-ALL-48 〔M6〕 | C-ALL-11 voiding is permanent | Continue from TC-ALL-36 after applying: submit Amelia's amount due as £10,500, then submit £10,000 again; another time submit £10,000 directly (same as the original) | First: voided on submitting £10,500, still voided after changing back to £10,000, effective amount due is the roster value £10,000.00, marked "Not covered…"; second: not a change, effective amount due still £9,700.00 |
| TC-ALL-49 〔M6〕 | C-ALL-10 step 3, R-ALL-08 | Minimum 0, no cap, one investor due £1,000, 3% investors pay, the company pays a whole fixed fee of £960; change the 3% to company pays | N = I = T = £970.00, but company-paid fees £960.00 + £29.10 = £989.10 > total invested £970.00 (paid to the company −£19.10): blocked, cannot apply |
| TC-IO-47 〔M6〕 | §5.5 v0.8 exports, R-ALL-10 | After review: first mark Lucas withdrawn, then change the minimum to £970 and the platform fee to company pays and apply (the change covers 11 people); export the reconciliation ledger and the chase list; after carrying, copy the confirmation | In the ledger t13's `withdrawn_on` is `2026-10-16`, blank on other rows; in the chase list CSV David's row has `committed` `2425.00`, `committed_original` `2500.00`, `committed_adjustment` `-75.00`, and the columns are blank where there is no adjustment; both files still end with `currency`; the confirmation has a new section "Withdrawn before closing (refund in full):" with "- Lucas Meyer: £3,000.00" |

Independent recalculation (oracle) adds in 〔M6〕: C-ALL-10's T, N and differences (randomly generated inputs across both conventions, several fees, with cap and minimum, compared with the TS person by person), and the pending refunds total after withdrawals. Implemented by an independent agent from the PRD wording.

## 3. Sample deal (v0.2 conventions, for freezing)

A fictional "Northwind Robotics seed round SPV". Settings: GBP; cut-off date 2026-10-16; SPV nominee; fees deducted from payment; minimum £1,000; cap £150,000; share price £2.4137; investor-paid platform fee 3%; company-paid legal and admin fee £1,500 (fixed).

**Roster** (commitment = cash due): Amelia Hart NW-001 £10,000 SEIS; Ben Okafor NW-002 £5,000 EIS; Chloe Martin NW-003 £20,000; David Kim NW-004 £2,500 SEIS; Elena Rossi NW-005 £15,000 EIS; Farhan Malik NW-006 £10,000 EIS; Grace Liu NW-007 £25,000; Hugo Bernard NW-008 £5,000 SEIS; Isla Campbell NW-009 £1,000; James Whitfield NW-010 £20,000 EIS; Kavya Iyer NW-011 £7,500 SEIS; Lucas Meyer NW-012 £3,000.

**Bank lines** (all have transaction IDs):

| ID | Date | Amount | Payer | Reference | Expected |
|---|---|---|---|---|---|
| t01 | 10-06 | 10,000 | A HART | NW-001 | Auto → Amelia |
| t02 | 10-06 | 5,000 | B OKAFOR | NW002 NORTHWIND | Auto → Ben |
| t03 | 10-07 | 20,000 | CHLOE MARTIN | (empty) | Suggest Chloe 0.55 |
| t04 | 10-07 | 2,000 | D KIM | NW-004 | Auto → David (underpaid −£500) |
| t05 | 10-08 | 15,000 | ROSSI FAMILY OFFICE LTD | NORTHWIND SEED | Suggest Elena 0.35 |
| t06 | 10-08 | 10,000 | F MALIK | NW-006 | Auto → Farhan |
| t07 | 10-09 | 25,000 | GRACE LIU | NW-007 | Auto → Grace |
| t08 | 10-09 | 5,000 | H BERNARD | NW-008 | Auto → Hugo |
| t09 | 10-10 | 5,000 | H BERNARD | NW-008 | Auto → Hugo (overpaid +£5,000) |
| t10 | 10-10 | 1,000 | ISLA CAMPBELL | NW-009 | Auto → Isla |
| t11 | 10-03 | 2,340 | WESTBRIDGE SUPPLIES | INV 4471 | Unmatched; 13 days → long unmatched |
| t12 | 10-14 | 7,500 | K IYER | NW 11 | Suggest Kavya 0.8 (reference mistyped) |
| t13 | 10-15 | 3,000 | L MEYER | NW-012 | Auto → Lucas |
| t14 | 10-15 | 4,000 | SAM PATEL | NW-0019 | Not auto-matched (embedded in a longer reference); unmatched |
| t15 | 10-15 | −45 | BANK CHARGE | FEE | Skipped (outgoing) |
| t16 | 10-18 | 3,000 | J WHITFIELD | NW-010 | Excluded (after the cut-off date) |

**Reconciliation, before manual handling**: 14 bank lines in reconciliation, total **£114,840.00**; 9 auto-matched **£66,000.00**; 3 suggestions **£42,500.00**; 2 unmatched **£6,340.00**. Status: Amelia, Ben, Farhan, Grace, Isla, Lucas paid in full; David underpaid −£500; Hugo overpaid +£5,000; Chloe, Elena, Kavya, James unpaid.

**After confirming the 3 suggestions and marking t11 and t14 as not part of this deal**: posted **£108,500.00**; not posted **£6,340.00**; the check shows only one "long unmatched" reminder (t11).

**Carry into allocation**: Hugo carried £5,000, refund due £5,000; David £2,000; James £0.

**Closing allocation**: total received carried in **£103,500.00**; 11 participants (James has no funds); total invested **£100,395.00**; total platform fee **£3,105.00**; refunds £0; company pays £1,500; **paid to company £98,895.00**. For each person I = received × 0.97, fee = received × 0.03.
- Amelia (SEIS): I £9,700.00; units 4018.726436; claimable 4,018 shares / £9,698.24; not claimable £1.76.
- David (SEIS): I £1,940.00; units 803.745287; claimable 803 shares / £1,938.20; not claimable £1.80.
- Isla: received £1,000 = minimum → participates; I £970.00.

**Exit distribution** (holdings from the snapshot above): proceeds £390,000; exit costs £4,500; 6 years; k 20%; h 8%; c 100%.
- Distributable £385,500.00; capital returned £100,395.00; profit £285,105.00
- hurdle: 100,395 × (1.08⁶ − 1) = 100,395 × 0.586874322944 = **£58,919.25**
- catch-up: 0.2 × 58,919.25 ÷ 0.8 = **£14,729.81** (all to the lead)
- Remaining £211,455.94; lead's 20% = **£42,291.19**
- **Total carry £57,021.00** (= 285,105 × 20%); investors total **£328,479.00**

Every other row (units, each person's exit proceeds) is generated in M1 by both the TS and Python implementations. Once they agree and the owner's spot check passes, they are written into `src/lib/sample.expected.json` and frozen; after that, any change that causes a mismatch fails CI.

## 4. End-to-end (Playwright, from M2)
- E2E-01a 〔M2〕 Load the sample (downstream empty) → confirm 3, reject 2 → carry into allocation → check the §3 allocation numbers.
- E2E-01b 〔M3〕 Continue from E2E-01a → carry into exit → check the §3 exit numbers.
- E2E-02a 〔M2〕 After carrying into allocation, change one confirmation in reconciliation → allocation shows "out of date"; carry again → allocation data is **replaced as a whole** (not merged), and the stale marker disappears.
- E2E-02b 〔M3〕 After carrying into exit, change the allocation share price → exit shows "out of date"; after carrying again it is replaced as a whole.
- E2E-03 Privacy: record all requests throughout (including same-origin): only GETs for static assets, no request bodies, no investor names or amounts in any URL.
- E2E-04 Local storage: data is still there after refresh; gone after "Clear".
- E2E-05 〔M3〕 Guided tour: walk from the first step to the last; every step's highlight target exists.
- E2E-06 The disclaimer is shown on first open; the footer has the disclaimer and the feedback email link.
- E2E-07 〔M3〕 Complete the manual checklist steps M-01 to M-07 at 375px width (P1).
- E2E-08 〔M5〕 After review of the sample, copy one chase message; undo the t03 confirmation, then copy Chloe's query message and open the activity log to see the matching entries; throughout, only GETs for static assets (copying makes no request).
- E2E-09 〔M6〕 Starting from the sample after review: mark Lucas Meyer withdrawn → carry into allocation and he is not there; change the minimum to £970, change the platform fee to company pays and apply → reconciliation shows the adjustments and overpayments; reverse and everything is restored.

## 5. Manual acceptance checklist
PRs check only the items relevant to that PR; before release, check all of them. Before each item, click "Reset sample" to restore the sample deal to its initial state, unless the item says it continues from the previous one.
- [ ] M-01 Load the sample; reconciliation numbers match §3
- [ ] M-02 (Continue from M-01) Confirm 3, reject 2; the check shows only one long-unmatched reminder
- [ ] M-03 (Continue from M-02) Carry into allocation; the Amelia, David and Isla rows and the totals match §3; checks all green
- [ ] M-04 (Continue from M-03) Change the cap to £80,000 → scaled down pro rata; when someone falls below the minimum, "cannot close" and the list are shown
- [ ] M-05 (removed in v0.7: direct holding) Check that the UI shows the holding structure as nominee (bare trust), with no option to switch
- [ ] M-06 Change share price to `abc` → no result, check shows "unavailable", export disabled
- [ ] M-07 (Continue from M-03) Carry into exit; numbers match §3; switch to tiered mode; each step's explanation is understandable
- [ ] M-08 Disclaimer on first open and in the footer; feedback email link opens; UI fully in English
- [ ] M-09 All text readable in dark mode; the theme switch System / Light / Dark works in all three positions (P1)
- [ ] M-10 Complete M-01 to M-03 on a phone (P1)
- [ ] M-11 Walk through from scratch with a 5-person roster you make up yourself; note where you get stuck
- [ ] M-12 〔v0.8〕 (Continue from M-02) Copy one chase message; undo one confirmation, then copy a query message and read it pasted into an email draft; the activity log shows each step just taken, and the exported CSV opens
- [ ] M-13 〔v0.8〕 (Continue from M-02) Mark one investor withdrawn, change the fee payer once, then reverse; the numbers and explanations at each step are understandable

## 6. Export formats
- Reconciliation ledger: `transaction_id, date, amount, payer, reference, status, investor_id, investor_name, decided_by(auto|person)`; v0.8 adds `withdrawn_on`
- Chase list: `investor_id, name, email, committed, received, difference, status`; from v0.8 `committed` is the effective amount due, and `committed_original, committed_adjustment, message` are added
- Activity log (v0.8): `seq, time, initials, event, investor_id, investor_name, transaction_id, amount, detail, currency`
- Closing allocation: `investor_id, name, scheme, received, invested, units, fee_<each fee name>, fees_total, refund, seis_eis_claimable_shares, seis_eis_claimable_amount, status`
- Exit distribution: `investor_id, name, capital, shares_display, distribution, profit, multiple_excl_entry_fees` (for reading only, not for re-import)
- **Export holdings** (re-importable): `investor_id, name, capital, shares_display, share_price`. On re-import only `capital` and `share_price` are used.
- Amounts are decimals without a currency symbol (e.g. `1234.56`); negative values keep a leading minus sign; file names include the currency (e.g. `allocation_GBP.csv`).
- Every export ends with a `currency` column holding the deal currency's ISO code (e.g. `GBP`) on each row; the column name is fixed and does not change with the currency (v0.7.5, decision 10). Exception (v0.8): the activity log writes on each row the currency **at the time of that event**.

## 7. Requirements traceability matrix

Note: this lists "which cases verify this requirement". An ID being present does not mean coverage is sufficient; that is judged by Codex review and owner acceptance (rule D4).

| Requirement | Tests |
|---|---|
| R-DEAL-01 | TC-DEAL-01, TC-DEAL-02, TC-DEAL-03, TC-IO-07, TC-IO-44 |
| R-DEAL-02 | TC-DEAL-01, TC-ALL-01, 05, 06, M-05 |
| R-DEAL-03 | TC-DEAL-01, TC-ALL-02, 03, 08, TC-REC-23 |
| R-DEAL-04 | TC-DEAL-01, TC-ALL-06, 07, 08, 10 |
| R-REC-01.1 | TC-IO-08, 09, 10, 13, 16, 20 |
| R-REC-01.2 | TC-REC-20, TC-IO-14 |
| R-REC-02.1 | TC-IO-07, 08, 18, 19 |
| R-REC-02.2 | TC-REC-15, 16, 24, TC-IO-15 |
| R-REC-02.3 | TC-REC-17, TC-IO-18 |
| R-REC-02.4 | TC-IO-08, 15 |
| R-REC-03.1 | TC-REC-01, 03, 04, TC-IO-14 |
| R-REC-03.2 | TC-REC-02 |
| R-REC-04.1 | TC-REC-05, 11, 13, 25 |
| R-REC-04.2 | TC-REC-06, 07, 08 |
| R-REC-04.3 | TC-REC-05 |
| R-REC-04.4 | TC-REC-09, 10, 24 |
| R-REC-05 | TC-REC-14, 23 |
| R-REC-06 | TC-REC-18, 26 |
| R-REC-07 | TC-REC-19 |
| R-REC-08 | TC-REC-21, 23, 29 |
| R-REC-09 | TC-REC-22, 27, TC-IO-11 |
| R-REC-10 | TC-REC-42, 43, 44, 45, 46, E2E-08, M-12 |
| R-REC-11 | TC-REC-47, 48, 49, 50, 51, 52, 53, 54, E2E-09, M-13 |
| R-REC-12 | TC-ALL-36, 37, E2E-09 |
| R-ALL-01 | TC-ALL-19, TC-IO-16 |
| R-ALL-02 | TC-ALL-11, 15, 19, 21 |
| R-ALL-03 | TC-ALL-07, 08, 21 |
| R-ALL-04.1 | TC-ALL-09 |
| R-ALL-04.2 | TC-ALL-10, M-04 |
| R-ALL-05 | TC-ALL-01, 06, 17, 22 |
| R-ALL-06 | TC-ALL-05, 25, §3 Amelia/David |
| R-ALL-07 | TC-ALL-15 |
| R-ALL-08 | TC-ALL-10, 13, 14 |
| R-ALL-09 | TC-ALL-18, 23 |
| R-ALL-10 | TC-ALL-20, 24, 30 |
| R-ALL-11 | E2E-01b, E2E-02b |
| R-ALL-12 | TC-ALL-31 to 49, TC-IO-47, E2E-09, M-13 |
| R-DIS-01 | TC-DIS-21, 22, 23, 24, 26, TC-IO-17, E2E-01b |
| R-DIS-02 | TC-DIS-03, 08 |
| R-DIS-03 | TC-DIS-01, 04 ~ 08, 16, 20 |
| R-DIS-04 | TC-DIS-09, 10, 17, 18, 20 |
| R-DIS-05 | M-07 |
| R-DIS-06 | TC-DIS-01, 12, 15, 19 |
| R-DIS-07 | TC-DIS-13, 14, 20 |
| R-X-01 | E2E-05 |
| R-X-02 | E2E-03, 04, TC-X-04 |
| R-X-03 | E2E-06, M-08 |
| R-X-04 | TC-X-03, E2E-07, M-09, M-10 (P1) |
| R-X-05 | TC-X-01, TC-X-14, TC-X-15, M-08 |
| R-X-06 | TC-X-02, E2E-06 |
| R-X-07 | E2E-02a, E2E-02b |
| R-X-08 | TC-X-05, 06, 07, 08, 09, 10, 13, 16, 17, 18, 19, E2E-08, M-12 |
| R-X-01.2 | TC-X-11, TC-X-12, TC-X-20, E2E-05 |
