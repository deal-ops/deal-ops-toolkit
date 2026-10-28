// Changing who pays a percentage fee before closing (PRD R-ALL-12, C-ALL-10; Tech Design §9.2.3).
// Each investor keeps the investment their commitment buys under today's fees; the new cash due absorbs the change.
// The M1 allocation engine is reused whole — nothing of it is copied here.
import { allocate, validateAllocation, type AllocationInput, type AllocationResult, type Fee, type FeePayer, type TaxScheme } from './allocation'
import { formatMoney, mulDivN, MAX_MONEY, sum, sumExact, type Currency } from './money'
import { normRef } from './reconcile'
import type { Check, Outcome } from './outcome'
import type { FeePayerChange } from './adjust'

export interface FeePayerInput {
  feeBasis: AllocationInput['feeBasis']
  minimum: number
  cap: number | null
  priceMicros: number
  /** the current fee table (Fees) */
  fees: Fee[]
  feeId: string
  to: FeePayer
  /** the scope: investors not withdrawn and in the current allocation snapshot; cash due as on the investor list */
  investors: { id: string; name: string; cashDue: number; scheme: TaxScheme; reference?: string }[]
  /** a change already applied, re-checked against the current settings (C-ALL-11): step 3 only, with its T_i and N_i */
  applied?: { targets: Record<string, number>; newCashDue: Record<string, number> }
}

export type FeePayerBlockerCode =
  | 'before-no-participants'
  | 'before-company-fees-exceed'
  | 'before-scale-back-below-minimum'
  | 'over-cap'
  | 'after-no-participants'
  | 'after-company-fees-exceed'
  | 'after-scale-back-below-minimum'
  | 'would-join'
  | 'would-leave'
  | 'would-fall-below-minimum'
  | 'invested-differs'

export interface FeePayerBlocker {
  code: FeePayerBlockerCode
  /** null for a deal-level blocker */
  investorId: string | null
  text: string
}

export interface FeePayerRow {
  id: string
  name: string
  currentDue: number
  participatingBefore: boolean
  /** "Not participating — unchanged" */
  unchanged: boolean
  /** T_i, or null when not participating */
  target: number | null
  newDue: number
  /** newDue − currentDue: > 0 top-up, < 0 refund */
  difference: number
  participatingAfter: boolean
  investedAfter: number
}

export interface FeePayerPreview {
  /** false when step 1 is blocked: then only currentDue and participatingBefore mean anything */
  computed: boolean
  rows: FeePayerRow[]
  blockers: FeePayerBlocker[]
  canApply: boolean
  /** the fee's total in the step-1 (commitment) allocation and in the step-3 allocation */
  feeBefore: number | null
  feeAfter: number | null
  totals: { currentDue: number; newDue: number; difference: number; topUps: number; topUpTotal: number; refunds: number; refundTotal: number }
  feeLabel: string
  from: FeePayer
  to: FeePayer
  /** the fee table with the new payer (Fees') */
  feesAfter: Fee[]
}

/** R-ALL-12.2: what the new payer needs, word for word. */
export const CONSENT_TEXT: Record<FeePayer, string> = {
  investors: 'Investors’ consent needed — keep the evidence',
  company: 'The company’s consent needed — it pays by invoice or from the wire',
  lead: 'Inform only — no consent needed',
}
export const needsConsent = (to: FeePayer) => to !== 'lead'

const BEFORE_TEXT: Record<AllocationResult['blockers'][number]['code'], string> = {
  'no-participants': 'No investor can be allocated',
  'company-fees-exceed': 'Company-paid fees are more than the total invested',
  'scale-back-below-minimum': 'After scale-back, falls below the minimum commitment',
}
export const OVER_CAP_TEXT = 'The round is over the cap — resolve the scale-back first'

/** R-ALL-12.3, fixed wording: "Apply: 0 top-ups totalling £0.00 · 12 refunds totalling £3,720.00". */
export function applyLabel(p: Pick<FeePayerPreview, 'totals'>, currency: Currency): string {
  const m = (x: number) => formatMoney(x, currency)
  return `Apply: ${p.totals.topUps} top-ups totalling ${m(p.totals.topUpTotal)} · ${p.totals.refunds} refunds totalling ${m(p.totals.refundTotal)}`
}

const input = (where: string, message: string): Outcome<never> => ({ ok: false, errors: [{ where, message }] })
const internal = (label: string): Outcome<never> => ({
  ok: false,
  errors: [{ where: 'internal', message: 'A self-check failed. Please report this; no figures are shown.' }],
  internal: [{ id: 'fee-payer-search', kind: 'invariant', pass: false, label }],
})

/** C-ALL-10 step 2 lower bound: F' + ⌈T ÷ (1 − p')⌉ deducted, F' + ⌈T × (1 + p')⌉ on top; below it M < T. */
export function lowerBound(T: number, feesAfter: Fee[], basis: AllocationInput['feeBasis']): number {
  const p = sum(feesAfter.filter((f) => f.payer === 'investors' && f.kind === 'percent').map((f) => f.value))
  const F = sum(feesAfter.filter((f) => f.payer === 'investors' && f.kind === 'perInvestor').map((f) => f.value))
  return F + (basis === 'deducted' ? mulDivN(T, 10_000, 10_000 - p, 'ceil') : mulDivN(T, 10_000 + p, 10_000, 'ceil'))
}

/**
 * Step 2: the smallest whole-penny cash due R whose investment, alone under Fees' with no minimum and no cap, reaches T.
 * Below R_lo the most investable is under T, so the search starts there; within ⌈k/2⌉ pennies above it the fees, each at
 * most half a penny over their exact value, leave a refund ≥ 0 at I = T (Tech Design §9.2.3). Not found = a bug.
 */
export function minimalCashDue(T: number, feesAfter: Fee[], basis: AllocationInput['feeBasis'], priceMicros: number): { ok: true; value: number } | { ok: false; reason: 'limit' | 'internal' } {
  const pct = feesAfter.filter((f) => f.payer === 'investors' && f.kind === 'percent')
  const lo = lowerBound(T, feesAfter, basis)
  const hi = lo + Math.ceil(pct.length / 2)
  for (let R = lo; R <= hi; R++) {
    if (R > MAX_MONEY) return { ok: false, reason: 'limit' }
    const o = allocate({ feeBasis: basis, minimum: 0, cap: null, priceMicros, fees: feesAfter, investors: [{ id: 'x', name: 'x', received: R, scheme: 'none' }] })
    if (!o.ok) return { ok: false, reason: 'internal' }
    const I = o.result.rows[0].invested
    if (I >= T) return I === T ? { ok: true, value: R } : { ok: false, reason: 'internal' }
  }
  return { ok: false, reason: 'internal' }
}

export function previewFeePayerChange(x: FeePayerInput): Outcome<FeePayerPreview> {
  const fee = x.fees.filter((f) => f.id === x.feeId)
  if (fee.length !== 1 || fee[0].kind !== 'percent') return input('Fee payer change', 'choose one percentage fee')
  const from = fee[0].payer
  if (!x.applied && from === x.to) return input('Fee payer change', 'choose a payer other than the current one')
  if (!['investors', 'company', 'lead'].includes(x.to)) return input('Fee payer change', 'choose investors, the company or the lead')
  const feesAfter = x.fees.map((f) => (f.id === x.feeId ? { ...f, payer: x.to } : f))
  const base = { feeBasis: x.feeBasis, minimum: x.minimum, cap: x.cap, priceMicros: x.priceMicros }
  // Fees' must pass the same input checks as any fee table (e.g. investor % fees deducted from the wire stay under 100%)
  const after = validateAllocation({ ...base, fees: feesAfter, investors: [] })
  if (after.length) return { ok: false, errors: after.map((e) => ({ where: `After the change, ${e.where}`, message: e.message })) }
  const names = new Map(x.investors.map((v) => [v.id, v.name]))
  const nameOf = (id: string) => names.get(id) ?? id
  const asInvestors = (received: (v: FeePayerInput['investors'][number]) => number) =>
    x.investors.map((v) => ({ id: v.id, name: v.name, received: received(v), scheme: v.scheme }))
  const feeTotal = (r: AllocationResult) => r.feeTotals.find((f) => f.id === x.feeId)?.amount ?? 0
  const blockers: FeePayerBlocker[] = []
  const deal = (prefix: 'before' | 'after', r: AllocationResult) => {
    for (const b of r.blockers) {
      if (b.code === 'scale-back-below-minimum')
        for (const n of b.names) {
          const id = x.investors.find((v) => v.name === n)?.id ?? null
          blockers.push({ code: `${prefix}-${b.code}`, investorId: id, text: `${n}: ${BEFORE_TEXT[b.code].toLowerCase()}` })
        }
      else blockers.push({ code: `${prefix}-${b.code}`, investorId: null, text: BEFORE_TEXT[b.code] })
    }
  }

  // Step 1: the commitment allocation (received = cash due) under today's fees; or the targets saved when applied
  let feeBefore: number | null = null
  const target = new Map<string, number>()
  const newDue = new Map<string, number>()
  if (x.applied) {
    for (const v of x.investors) if (Object.hasOwn(x.applied.targets, v.id)) target.set(v.id, x.applied.targets[v.id])
    for (const v of x.investors) newDue.set(v.id, target.has(v.id) && Object.hasOwn(x.applied.newCashDue, v.id) ? x.applied.newCashDue[v.id] : v.cashDue)
  } else {
    const s1 = allocate({ ...base, fees: x.fees, investors: asInvestors((v) => v.cashDue) })
    if (!s1.ok) return s1
    const r1 = s1.result
    feeBefore = feeTotal(r1)
    deal('before', r1)
    if (r1.scaledBack) blockers.push({ code: 'over-cap', investorId: null, text: OVER_CAP_TEXT })
    if (blockers.length) return finishPreview(x, from, feesAfter, r1, null, feeBefore, blockers, target, newDue)
    for (const row of r1.rows) if (row.participating) target.set(row.id, row.invested)
    // Step 2: each participant alone; everyone else keeps their cash due
    for (const v of x.investors) {
      const T = target.get(v.id)
      if (T === undefined) {
        newDue.set(v.id, v.cashDue)
        continue
      }
      const n = minimalCashDue(T, feesAfter, x.feeBasis, x.priceMicros)
      if (!n.ok) return n.reason === 'limit' ? input(`Fee payer change, ${v.name}`, 'the new cash due would exceed the 1,000,000,000 limit') : internal(`New cash due for ${v.name} not found`)
      newDue.set(v.id, n.value)
    }
  }

  // Step 3: the allocation under Fees' with the new cash due; the same people must take part, each investing T_i
  const s3 = allocate({ ...base, fees: feesAfter, investors: asInvestors((v) => newDue.get(v.id)!) })
  if (!s3.ok) return s3
  const r3 = s3.result
  deal('after', r3)
  for (const row of r3.rows) {
    const T = target.get(row.id)
    const name = nameOf(row.id)
    if (T === undefined) {
      if (row.participating) blockers.push({ code: 'would-join', investorId: row.id, text: `${name} would join the allocation` })
    } else if (!row.participating) {
      blockers.push(
        row.exclusion === 'below-minimum'
          ? { code: 'would-fall-below-minimum', investorId: row.id, text: `${name} would fall below the minimum commitment` }
          : { code: 'would-leave', investorId: row.id, text: `${name} would leave the allocation` },
      )
    } else if (row.invested !== T) {
      blockers.push({
        code: 'invested-differs',
        investorId: row.id,
        text: row.scaledBack ? `${name} would be scaled back by the round cap` : `${name} would invest ${row.invested} instead of ${T}`,
      })
    }
  }
  return finishPreview(x, from, feesAfter, r3, r3, feeBefore, blockers, target, newDue)
}

function finishPreview(
  x: FeePayerInput,
  from: FeePayer,
  feesAfter: Fee[],
  last: AllocationResult,
  r3: AllocationResult | null,
  feeBefore: number | null,
  blockers: FeePayerBlocker[],
  target: Map<string, number>,
  newDue: Map<string, number>,
): Outcome<FeePayerPreview> {
  const computed = r3 !== null
  const after = new Map((r3?.rows ?? []).map((r) => [r.id, r]))
  const rows: FeePayerRow[] = x.investors.map((v) => {
    const N = computed ? newDue.get(v.id)! : v.cashDue
    const a = after.get(v.id)
    return {
      id: v.id,
      name: v.name,
      currentDue: v.cashDue,
      participatingBefore: computed ? target.has(v.id) : (last.rows.find((r) => r.id === v.id)?.participating ?? false),
      unchanged: !target.has(v.id),
      target: target.get(v.id) ?? null,
      newDue: N,
      difference: N - v.cashDue,
      participatingAfter: a?.participating ?? false,
      investedAfter: a?.invested ?? 0,
    }
  })
  const diffs = computed ? rows.map((r) => r.difference) : []
  const ups = diffs.filter((d) => d > 0)
  const downs = diffs.filter((d) => d < 0)
  const feeLabel = x.fees.find((f) => f.id === x.feeId)!.label
  const preview: FeePayerPreview = {
    computed,
    rows,
    blockers,
    canApply: blockers.length === 0,
    feeBefore,
    feeAfter: r3 ? (r3.feeTotals.find((f) => f.id === x.feeId)?.amount ?? 0) : null,
    totals: {
      currentDue: sumExact(rows.map((r) => r.currentDue)),
      newDue: sumExact(rows.map((r) => r.newDue)),
      difference: sumExact(diffs),
      topUps: ups.length,
      topUpTotal: sumExact(ups),
      refunds: downs.length,
      refundTotal: 0 - sumExact(downs), // not -sum: no refunds is 0, never -0
    },
    feeLabel,
    from,
    to: x.to,
    feesAfter,
  }
  // the preview's own self-checks: the new cash due adds up, and every participant invests exactly T_i (C-ALL-10)
  const checks: Check[] = [
    {
      id: 'fee-payer-totals',
      kind: 'invariant',
      label: 'New cash due = current cash due + top-ups − refunds',
      pass: preview.totals.newDue === preview.totals.currentDue + preview.totals.topUpTotal - preview.totals.refundTotal,
    },
  ]
  if (checks.some((c) => !c.pass)) return { ok: false, errors: [{ where: 'internal', message: 'A self-check failed. Please report this; no figures are shown.' }], internal: checks }
  return { ok: true, result: preview, checks }
}

/** R-ALL-12.4 texts with amounts in the deal currency. */
export function blockerText(b: FeePayerBlocker, currency: Currency): string {
  return b.text.replace(/would invest (\d+) instead of (\d+)/, (_, i, t) => `would invest ${formatMoney(Number(i), currency)} instead of ${formatMoney(Number(t), currency)}`)
}

/** C-ALL-11: the change record the reducer saves when the preview is applied. */
export function buildChange(
  p: FeePayerPreview,
  x: FeePayerInput,
  meta: { id: string; consent: boolean; appliedAt: string },
): FeePayerChange {
  const refs = new Map(x.investors.map((v) => [v.id, normRef(v.reference ?? '')]))
  const targets: Record<string, number> = Object.create(null)
  for (const r of p.rows) if (r.target !== null) targets[r.id] = r.target
  return {
    id: meta.id,
    feeId: x.feeId,
    feeLabel: p.feeLabel,
    from: p.from,
    to: p.to,
    consent: meta.consent,
    appliedAt: meta.appliedAt,
    status: 'active',
    voidReason: null,
    feeAtApply: { rateBps: x.fees.find((f) => f.id === x.feeId)!.value, basis: x.feeBasis },
    settingsAtApply: { minimum: x.minimum, cap: x.cap, priceMicros: x.priceMicros, basis: x.feeBasis, fees: p.feesAfter },
    targets,
    lines: p.rows.map((r) => ({ investorId: r.id, reference: refs.get(r.id) ?? '', baseCashDue: r.currentDue, newCashDue: r.newDue, voided: false, voidReason: null })),
  }
}
