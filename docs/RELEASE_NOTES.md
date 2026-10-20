# Deal Ops Toolkit — release notes

Rule P9: only what is implemented, tested and deployed is listed. Each line names the requirement and the tests that cover it.

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
