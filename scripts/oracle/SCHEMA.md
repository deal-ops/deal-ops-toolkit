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
