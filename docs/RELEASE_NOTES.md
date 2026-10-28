# Deal Ops Toolkit — release notes

Rule P9: only what is implemented, tested and deployed is listed. Each line names the requirement and the tests that cover it.

## v1.2.1 — released 2026-10-28

Live at https://deal-ops-toolkit.vercel.app (build `index-bxRVcwES.js`). The tag `v1.2.1` and the release commit `e19b640` are in the private development repository. Production smoke test on 2026-10-28: the sample deal's figures match Test Plan §3; the copied chase message carries the new wording word for word; withdrawing an investor and changing then reversing who pays the platform fee work as before; 12 requests, all same-origin GETs without bodies or query strings; no console errors; the security headers match `vercel.json` (Tech Design §4).

A wording change (PRD v0.8.2; PR #32 in the private development repository). No calculation, money decision, export column or saved-data format changed. Checked on `main` on 2026-10-28: 420 unit tests pass; all 199 test-plan cases due at M6 ran and passed; 11 of 11 end-to-end cases (31 tests); 267 of 267 deliberate code breakages caught; the Python oracle's self-check 178 of 178, and the TypeScript engines agree with it on 1,800 generated cases.

**Chase message** (R-REC-10, C-REC-8 template A)
- The paragraph for investors who have already paid now reads: "If you have already sent this payment, please ask your bank for the MT103 (or equivalent) for the transfer, showing its UETR, and send it to us so we can trace the payment." The Reconciliation hint says the message asks anyone who has already paid to send the bank's MT103 / UETR.
- Tests: TC-REC-42, TC-REC-43, TC-X-14, E2E-08.

## v1.2.0 — released 2026-10-27

Live at https://deal-ops-toolkit.vercel.app (build `index-fWQP9R2X.js`). The tag `v1.2.0` and the release commit `69f211a` are in the private development repository. Production smoke test on 2026-10-27: the sample deal's figures match Test Plan §3 (reconciliation, allocation and exit); copying a chase message, withdrawing an investor and changing then reversing who pays the platform fee work as checked before release; 12 requests, all same-origin GETs without bodies or query strings; no console errors; the security headers match `vercel.json` (Tech Design §4).

M5 and M6 (PRD v0.8 and v0.8.1; PRs #24 and #27 in the private development repository). No existing calculation rule changed. Checked on `main` on 2026-10-27: 420 unit tests pass; all 199 test-plan cases due at M6 ran and passed; 11 of 11 end-to-end cases (31 tests); 264 of 265 deliberate code breakages caught, the remaining one on redundant code that was then removed (re-run 5 of 5); the Python oracle's self-check 178 of 178, and the TypeScript engines agree with it on 1,800 generated cases.

**Messages to investors** (R-REC-10)
- "Copy message" next to each investor who is short or has not paid copies a chase email (with what to ask the bank for: the MT103 and its UETR); the chase list CSV has the same text in a `message` column.
- "Copy query" next to each suggested investor for an unmatched receipt copies a question with only the date, the amount and the currency — never the payer, the bank reference or the transaction ID.
- Nothing is sent: the text is copied for you to send; without a clipboard it is shown selected for copying by hand.
- Tests: TC-REC-42 to TC-REC-46, E2E-08.

**Activity log** (R-X-08)
- A read-only "Activity log" page: imports, every decision, voided decisions, hand-offs, copies, withdrawals, fee payer changes and exports, newest first, with your initials if you set them; export as CSV.
- Up to 5,000 entries; a reminder to export from 4,000; when the browser's storage is full the oldest entries go first so the deal data is kept, and the page says how many were removed before export.
- Tests: TC-X-05 to TC-X-11, TC-X-16 to TC-X-19.

**Withdrawal before closing** (R-REC-11, C-REC-7)
- Mark an investor withdrawn with their written consent and a date; it can be undone. They are not chased and not carried into the allocation; everything they paid is listed to refund, and the closing confirmation lists them under "Withdrawn before closing (refund in full)". The ledger CSV gains `withdrawn_on`.
- Tests: TC-REC-47 to TC-REC-54, TC-IO-47, E2E-09.

**Changing who pays a percentage fee before closing** (R-ALL-12, R-REC-12, C-ALL-10, C-ALL-11)
- A panel previews each investor's new amount due so that their investment stays the same, with the top-ups and refunds it causes and the consent the new payer needs; applying it records an adjustment beside the investor list (the list itself is not changed) and can be reversed in one step. Reconciliation, the chase list (with `committed_original` and `committed_adjustment`) and refunds use the adjusted amounts.
- Edits that no longer fit an adjustment void it for good and say so; a change of allocation settings brings a reminder and a re-check. While a change is active, the deal currency is locked until it is reversed (decision 12).
- Tests: TC-ALL-31 to TC-ALL-49, TC-REC-53, TC-REC-54, E2E-09.

**Guided tour** (R-X-01.2): still 12 steps; step 6 mentions "Copy message"; the end card points to the Activity log and offers three things to try next, each with "Take me to it" (TC-X-11, TC-X-12, TC-X-20, E2E-05).

**Saved data:** this version saves in a new format (schema 2) and reads saves from v1.1.x. Earlier versions cannot read the new format: going back to v1.1.x would start from an empty page (Tech Design §9.7).

## v1.1.1 — released 2026-10-23

Live at https://deal-ops-toolkit.vercel.app (build `index-CZaWFdNy.js`). The tag `v1.1.1` and the release commit `8734580` are in the private development repository. Production smoke test on 2026-10-23: the sample deal's figures match Test Plan §3 (reconciliation, allocation and exit); the save-status region is present and empty while saving works; 7 requests, all same-origin GETs without bodies or query strings; no console errors; the security headers read from the production URL match `vercel.json` (Tech Design §4).

A fix found while preparing the next version (PR #18 in the private development repository; PRD v0.7.6). The tag `v1.1.1` and the release commit `8734580` are in the private development repository. No calculation rule or figure changed. Checked on `main` on 2026-10-23: 287 unit tests pass; all 150 test-plan cases due at M4 ran and passed; 9 of 9 end-to-end cases (27 tests); 141 of 141 deliberate code breakages caught; the Python oracle's self-check 139 of 139.

**Saving in the browser** (R-X-02, TC-X-04)
- When the browser's storage for the page is full, the page now says so: "This browser's storage for this page is full, so your latest changes are not being saved. Export what you need before you close the page." Before, it wrongly said storage was blocked.
- When the browser refuses storage altogether (for example when site data is blocked), the page now says "storage is blocked". Before, it said nothing, so the data looked saved but was gone when the page closed.
- The message is announced by screen readers.

## v1.1.0 — released 2026-10-21

Live at https://deal-ops-toolkit.vercel.app (build `index-DLntVfU4.js`). The tag `v1.1.0` and the release commit `d588b56` are in the private development repository. Production smoke test on 2026-10-21: the sample deal's figures match Test Plan §3 and the confirmation names `Currency: GBP`; a Dark choice survives a reload; 12 requests, all same-origin GETs without bodies or query strings; no console errors; the security headers match Tech Design §4.

Changes since v1.0.0 after the owner's review of the live site (PR #11 in the private development repository; PRD v0.7.4 and v0.7.5). No calculation rule or figure changed. Checked on `main` on 2026-10-21: 284 unit tests pass; all 149 test-plan cases due at M4 ran and passed; 9 of 9 end-to-end cases (27 tests); 131 of 131 deliberate code breakages caught; the Python oracle's self-check 139 of 139.

**Currency** (R-DEAL-01, R-ALL-10, I-01, I-03, §5.5; decision 10)
- Every money field names the deal currency (£ / € / US$), also for screen readers; US dollars are shown as US$, and `$` or `US$` is accepted on input.
- Changing the currency converts nothing: the page says so, and when amounts exist it asks first, giving how many amounts will be recorded in the new currency.
- Every CSV export ends with a `currency` column (ISO code on each row); imports accept an optional `currency` column and refuse a different currency.
- The closing confirmation names the currency code; import messages say which currency the amounts were read in; share prices accept thousands commas.
- Tests: TC-IO-44, TC-IO-45, TC-IO-46, TC-DEAL-03, TC-ALL-30.

**Appearance and interaction** (R-X-04, R-X-05; decision 9)
- A System / Light / Dark switch, following the device by default and kept only in this browser; "Clear all data" returns it to System. Printing stays black on white in every theme (TC-X-03, E2E-07).
- Glossary explanations open under their "?" without splitting the sentence, close with Esc, a click elsewhere or moving focus away, and stay inside the window on a phone (TC-X-01, E2E-01b).
- The "Clear all data" confirmation fits the sidebar and takes keyboard focus (E2E-04); one arrow style for every select, with the native arrow in high-contrast mode; fee placeholders that do not look like values; fields in a row line up.

## v1.0.0 — released 2026-10-20

Live at https://deal-ops-toolkit.vercel.app (build `index-Dav9BeIm.js`). The tag `v1.0.0` and the release commit `d54c903` are in the private development repository; the public repository is a snapshot of that release. Checked on the release commit on 2026-10-20: 271 unit tests pass; all 143 test-plan cases due at M4 ran and passed (the other 5 IDs were removed in PRD v0.7); 9 of 9 end-to-end cases (22 tests); 107 of 107 deliberate code breakages caught by the tests; the Python oracle's self-check 139 of 139. Production smoke test: the sample deal's figures match Test Plan §3, only same-origin static files are requested, and the security headers match Tech Design §4.

A browser tool for SPV deal operations: payment reconciliation → closing allocation → exit distribution. Deal data is processed in the browser and never sent by the app.

**Payment reconciliation** (R-REC-01..09)
- Import investors and bank statements by paste, CSV file or table editing; append or replace statements, with duplicate and conflict detection. Imports are all-or-nothing, and every error is listed with its row and column.
- A receipt is booked automatically only when its bank reference contains exactly one investor's payment reference. Everything else is a suggestion with a score and reasons, and a person confirms, assigns, rejects or undoes it.
- Changing or deleting a line or an investor voids the decisions made on it.
- Per-investor status (paid, underpaid, overpaid, not paid); unmatched-receipt reminders; ledger and chase-list CSV exports.
- Tests: TC-IO-*, TC-REC-*, TC-IO-20, E2E-01a, E2E-02a.

**Closing allocation** (R-ALL-01..11)
- Covers the share price, round cap, investor / company / lead fees (percentage or fixed), the minimum commitment, and pro-rata scale-back.
- Fractional shares through the nominee.
- S/EIS whole-share estimates, with the not-claimable remainder flagged.
- Blockers ("Can't close yet") with the investors named.
- A closing confirmation to copy, including over-payment refunds, and a CSV export.
- Tests: TC-ALL-*, TC-ALL-24, E2E-01a.

**Exit distribution** (R-DIS-01..07)
- Holdings handed off from the allocation, or imported and edited.
- Fixed carry with an optional compounding hurdle and catch-up, or tiered carry.
- A step-by-step waterfall with the reason for each step.
- Per-investor distribution, profit and multiple.
- A shortfall is shown when exit costs exceed proceeds.
- CSV exports.
- Tests: TC-DIS-*, TC-DIS-21, E2E-01b, E2E-02b.

**Throughout**
- Hand-offs between modules are snapshots; changes upstream mark the downstream module "out of date" (R-X-07).
- Every figure comes from exact integer arithmetic and is cross-checked against an independent Python implementation, which agrees on the hand-calculated cases and on 1,100 generated cases (400 allocations, 400 waterfalls, 300 reconciliations).
- A 3-minute guided tour on a fictional deal (R-X-01, E2E-05).
- First-open disclaimer, glossary of terms, feedback by email, local saving with a confirmed "Clear all data" (R-X-02, R-X-03, R-X-05, R-X-06; E2E-03, E2E-04, E2E-06).
- Security headers and a strict content security policy; the app makes no network requests of its own (E2E-03).
- Light and dark appearance that follows the device setting, open-licensed fonts served by the site itself, and a layout that works on a phone (E2E-07); print shows the page content only.
- List sections stay open after an import or a first row added by hand, so the result is visible; an import message disappears once the list is replaced by something else.

**Not in this release:** money movement, bank connections, legal documents, KYC/AML, tax filings, multi-currency within a deal, staged contributions or prior distributions in the exit, investor-specific carry terms, management fees, VAT (PRD §2.2).
