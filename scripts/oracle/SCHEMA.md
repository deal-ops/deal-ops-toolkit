# Oracle case format (shared by the TypeScript engines and the Python oracle)

Each case is one JSON file. All money is integer minor units (pence/cents). Percentages are integer basis
points (1% = 100). Share prices are integer micros (1e-6 of the currency unit). Multiples and years are
integer hundredths (3.00x = 300, 2.5 years = 250). Inputs in case files are always already parsed and valid
unless the case says `"expectInvalid": true`.

Both implementations read a case and print one JSON object (keys sorted, no extra whitespace needed). The
compare script diffs the two outputs field by field; any difference fails CI.

## allocation

Input:
```json
{
  "kind": "allocation",
  "feeBasis": "deducted" | "onTop",
  "minimum": 100000,
  "cap": 15000000 | null,
  "priceMicros": 2413700,
  "fees": [ { "id": "f1", "kind": "percent" | "perInvestor" | "fixed", "value": 300, "payer": "investors" | "company" | "lead" } ],
  "investors": [ { "id": "c01", "received": 1000000, "scheme": "none" | "SEIS" | "EIS" } ]
}
```
Allowed fee combinations: payer `investors` → kind `percent` or `perInvestor`; payer `company`/`lead` → kind `percent` or `fixed`.

Output:
```json
{
  "ok": true,
  "investors": {
    "c01": {
      "participating": true,
      "invested": 970000,
      "fees": { "f1": 30000 },
      "refund": 0,
      "microShares": 4018726436,
      "claimableShares": 4018,
      "claimableAmount": 969824
    }
  },
  "feeTotals": { "f1": 31050 },
  "totalInvested": 0,
  "companyFees": 150000,
  "leadInvoice": 0,
  "wire": 0,
  "blockers": ["company-fees-exceed" | "no-participants" | "scale-back-below-minimum"]
}
```
- Non-participating investors: `participating: false`, `invested: 0`, `fees: {}` (no keys), `refund` = received, `microShares: 0`, `claimableShares: 0`, `claimableAmount: 0`.
- `fees` for a participant has one key per investor-paid fee (percent and perInvestor), including zero amounts.
- `feeTotals` has one key per fee in the input (all payers).
- `microShares` = floor(invested × 10,000 × 1,000,000 ÷ priceMicros). `claimableShares` = floor(invested × 10,000 ÷ priceMicros). `claimableAmount` = floor(claimableShares × priceMicros ÷ 10,000). These are reported for every participant regardless of scheme.
- `blockers` sorted alphabetically, empty array if none.
- If the input violates PRD rules (e.g. deducted basis with investor percent fees summing to ≥ 100%), output `{ "ok": false }`.

## waterfall

Input:
```json
{
  "kind": "waterfall",
  "holdings": [ { "id": "a", "capital": 6000000 } ],
  "proceeds": 30000000,
  "exitCosts": 0,
  "years100": 500,
  "carry": { "mode": "fixed", "k": 2000, "h": 800, "c": 10000 }
        | { "mode": "tiered", "tiers": [ { "upTo100": 300, "rate": 2000 }, { "upTo100": null, "rate": 3000 } ] }
}
```
Output:
```json
{
  "ok": true,
  "blockers": [] | ["exit-cost-shortfall"],
  "shortfall": 0,
  "costsPaid": 0,
  "returnOfCapital": 0,
  "hurdlePaid": 0,
  "catchUpTranche": 0,
  "catchUpToLead": 0,
  "carry": 0,
  "investorsTotal": 0,
  "distributions": { "a": 0 }
}
```
- When `exit-cost-shortfall` is a blocker: `shortfall` = exitCosts − proceeds, `costsPaid` = proceeds, every other amount 0 and every distribution 0.
- Fields that do not apply (e.g. hurdle in tiered mode) are 0.
- Invalid input → `{ "ok": false }`.

## reconcile

Input:
```json
{
  "kind": "reconcile",
  "asOf": "2026-10-16",
  "thresholdDays": 10,
  "commitments": [ { "id": "c01", "name": "Amelia Hart", "reference": "NW-001", "cashDue": 1000000 } ],
  "lines": [ { "id": "t01", "txnId": "t01" | null, "date": "2026-10-06", "amount": 1000000, "payer": "A HART", "reference": "NW-001" } ],
  "decisions": { "t03": { "assign": "c03" } | { "reject": true } }
}
```
Decisions in case files are always valid (invalidation is covered by unit tests).

Output:
```json
{
  "lines": {
    "t01": { "status": "auto" | "confirmed" | "suggested" | "unmatched" | "rejected" | "skipped" | "future",
             "assignedTo": "c01" | null,
             "suspectedDuplicate": false,
             "candidates": [ { "id": "c03", "score": 0.55 } ] }
  },
  "commitments": { "c01": { "received": 1000000, "difference": 0, "status": "paid" | "partial" | "overpaid" | "outstanding" } },
  "totals": { "bank": 0, "booked": 0, "unbooked": 0 },
  "aged": ["t11"]
}
```
- `skipped` = amount ≤ 0; `future` = date after `asOf`. Neither counts in totals, neither has candidates.
- `candidates` only for `suggested` lines (empty list otherwise); `score` rounded to 4 decimal places.
- `aged`: line ids that are not booked (suggested, unmatched or rejected) and whose age in days (asOf − date) is greater than `thresholdDays`; sorted.

### reconcile — v0.8 extension (C-REC-7 withdrawal, C-ALL-11 effective cash due)

Two optional input fields. **When neither key is present the output is exactly the v0.7 output above**
(no new keys, byte-identical). When either key is present (even `"withdrawn": []`), the extended output applies.
```json
{
  "withdrawn": ["lucas"],
  "adjustedCashDue": { "amelia": 970000 }
}
```
- `withdrawn`: ids of investors marked Withdrawn (consent ticked, date given; the date does not enter any
  calculation). Ids must exist and be unique, else `{ "ok": false }`.
- `adjustedCashDue`: effective cash due (C-ALL-11: N_i of an active fee payer change whose row is not void),
  integer 1..100,000,000,000. Ids must exist. Investors not listed use `cashDue`.
- The effective cash due replaces `cashDue` everywhere: status, difference, amount match in candidate scoring
  (C-REC-3), refunds, chase list, hand-off. Withdrawn investors' references still match and score as normal and
  their lines still book to them (C-REC-7, R-REC-11.3).

Extended output (adds to the v0.7 output; keys sorted):
```json
{
  "commitments": { "c01": { "received": 0, "difference": 0, "status": "... | withdrawn", "cashDue": 970000, "withdrawn": false } },
  "refunds": [ { "id": "hugo", "amount": 500000, "reason": "overpayment" }, { "id": "lucas", "amount": 300000, "reason": "withdrawn" } ],
  "refundTotal": 800000,
  "receivable": 12100000,
  "withdrawnSummary": { "count": 1, "refund": 300000 },
  "chase": [ { "id": "david", "outstanding": 50000 } ],
  "handoff": { "amelia": 1000000 },
  "checks": { "refundIdentity": true }
}
```
- `status` is `withdrawn` for withdrawn investors (other statuses unchanged); `difference` stays received −
  effective cash due (C-REC-4) for everyone; `cashDue` = effective cash due.
- `refunds`: in commitment-list order. Withdrawn with received > 0 → full received, reason `withdrawn` (none if
  received = 0); others with received > effective cash due → the excess, reason `overpayment`.
- `receivable` = Σ effective cash due of non-withdrawn investors. `withdrawnSummary.refund` = Σ received of
  withdrawn investors.
- `chase`: non-withdrawn investors with received < effective cash due (unpaid or part-paid), list order,
  `outstanding` = effective cash due − received.
- `handoff` (C-REC-6 snapshot): every non-withdrawn investor → min(received, effective cash due). Withdrawn
  investors are absent.
- `checks.refundIdentity`: `refundTotal` = Σ withdrawn received + Σ others max(0, received − effective cash due),
  computed separately from the list (a mismatch is an internal error, never `false` in practice).

## feePayerChange (C-ALL-10, v0.8)

Input (allocation settings as in `allocation`; investors carry cash due, not received):
```json
{
  "kind": "feePayerChange",
  "feeBasis": "deducted" | "onTop",
  "minimum": 100000,
  "cap": 15000000 | null,
  "priceMicros": 2413700,
  "fees": [ { "id": "platform", "kind": "percent", "value": 300, "payer": "investors" } ],
  "feeId": "platform",
  "newPayer": "investors" | "company" | "lead",
  "investors": [ { "id": "c01", "cashDue": 1000000, "scheme": "none" } ],
  "applied": { "targets": { "c01": 970000 }, "newCashDue": { "c01": 970000 } }
}
```
- `investors` = the scope (non-withdrawn investors in the current allocation snapshot), cash due integer > 0.
- `fees` = the current fee table Fees; Fees' = the same table with only `feeId`'s payer set to `newPayer`.
- `{ "ok": false }` (input error) when: `feeId` is not exactly one `percent` fee; `newPayer` invalid or (without
  `applied`) equal to the current payer; Fees or Fees' fails the `allocation` validation (e.g. deducted basis
  with investor percent fees summing to ≥ 100%); any N_i > 100,000,000,000 (I-01).
- `applied` (optional) = re-check of an applied change (C-ALL-11: settings changed since applying). Then `fees`
  is the CURRENT fee table and step 1/2 are not recomputed: step-1 participants are the ids in `targets`, their
  T_i and N_i come from `applied`; everyone else keeps `cashDue`. Only step 3 runs with the current settings.

Method:
1. Step 1: `allocation` under Fees with received = cashDue. Its blockers are reported as `before-<code>`; if the
   participants' M (C-ALL-1/2) sum exceeds the cap, `over-cap` is added. Any step-1 blocker stops here.
   T_i = step-1 `invested` of each participant.
2. Step 2: N_i = smallest whole-penny R with I(R) ≥ T_i, where I(R) = `invested` of a one-investor allocation
   under Fees' with minimum 0 and no cap. Searched upward from R0 = F' + ⌈T_i ÷ (1 − p')⌉ (deducted) or
   F' + ⌈T_i × (1 + p')⌉ (onTop); below R0, M(R) < T_i so I(R) < T_i. I(N_i) ≠ T_i is an internal error (the
   oracle raises). Non-participants: N_i = cashDue (unchanged).
3. Step 3: `allocation` under Fees' with received = N_i (participants) / cashDue (others). Its blockers are
   reported as `after-<code>`. Per investor: step-1 participant not participating now → `would-fall-below-minimum`
   (M > 0 but the commitment-basis amount < minimum) or `would-leave` (any other reason); non-participant now
   participating → `would-join`; participant in both with invested ≠ T_i → `invested-differs`.

Output (keys sorted):
```json
{
  "ok": true,
  "canApply": true,
  "blockers": [ { "code": "would-fall-below-minimum", "investor": "isla" }, { "code": "over-cap", "investor": null } ],
  "investors": {
    "c01": { "cashDue": 1000000, "participatingBefore": true, "unchanged": false, "target": 970000,
             "newCashDue": 970000, "difference": -30000, "participatingAfter": true, "investedAfter": 970000 }
  },
  "feeBefore": 30000,
  "feeAfter": 29100,
  "totals": { "cashDue": 0, "newCashDue": 0, "difference": 0,
              "topUpCount": 0, "topUpTotal": 0, "refundCount": 0, "refundTotal": 0 }
}
```
- Blocker codes: `before-company-fees-exceed`, `before-no-participants`, `before-scale-back-below-minimum`,
  `over-cap`, `after-company-fees-exceed`, `after-no-participants`, `after-scale-back-below-minimum`,
  `would-join`, `would-leave`, `would-fall-below-minimum`, `invested-differs`. Deal-level blockers have
  `investor: null`. Sorted by (code, investor). `canApply` = no blockers.
- Non-participants in step 1: `unchanged: true`, `target: null`, `newCashDue` = cashDue, `difference: 0`.
- `difference` = N_i − cashDue (> 0 top-up, < 0 refund). `topUpTotal` and `refundTotal` are positive amounts.
- `feeBefore` = `feeId`'s total in the step-1 allocation (null with `applied`); `feeAfter` = its total in the
  step-3 allocation.
- When step 1 has any blocker: per investor only `cashDue` and `participatingBefore` are filled; `unchanged`,
  `target`, `newCashDue`, `difference`, `participatingAfter`, `investedAfter` are null; `feeAfter` and every
  total except `totals.cashDue` are null.
