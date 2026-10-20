// Closing allocation, nominee SPV only (PRD §4.2, C-ALL-1..9).
import { mulDiv, mulDivN, splitProRata, sum, sumExact, toNum, MAX_PRICE_MICROS } from './money'
import { Errors, LIMITS, MAX_FEES, MAX_INVESTORS } from './validate'
import { finish, type Check, type InputError, type Outcome } from './outcome'

export type TaxScheme = 'none' | 'SEIS' | 'EIS'
export type FeeBasis = 'deducted' | 'onTop'
export type FeePayer = 'investors' | 'company' | 'lead'
/** percent: bps; perInvestor / fixed: minor units */
export type FeeKind = 'percent' | 'perInvestor' | 'fixed'

export interface Fee {
  id: string
  label: string
  kind: FeeKind
  value: number
  payer: FeePayer
}

export interface AllocationInvestor {
  id: string
  name: string
  received: number
  scheme: TaxScheme
}

export interface AllocationInput {
  feeBasis: FeeBasis
  minimum: number
  cap: number | null
  priceMicros: number
  fees: Fee[]
  investors: AllocationInvestor[]
}

export type ExclusionReason = 'no-funds' | 'fees-exceed-receipt' | 'below-minimum' | 'zero-investment'

export interface AllocationRow {
  id: string
  name: string
  scheme: TaxScheme
  received: number
  participating: boolean
  exclusion: ExclusionReason | null
  /** Target before refund retries (= M, or the scaled-back share of the cap). */
  target: number
  scaledBack: boolean
  invested: number
  /** investor-paid fee id → amount (participants only) */
  fees: Record<string, number>
  feesTotal: number
  refund: number
  /** floor(invested ÷ price) in millionths of a share — display only */
  microShares: bigint
  claimableShares: number
  claimableAmount: number
  nonClaimable: number
}

export interface AllocationResult {
  rows: AllocationRow[]
  feeTotals: { id: string; label: string; payer: FeePayer; kind: FeeKind; amount: number }[]
  totals: {
    received: number
    invested: number
    investorFees: number
    refunds: number
    companyFees: number
    leadInvoice: number
    wire: number
  }
  byScheme: Record<TaxScheme, { investors: number; invested: number; microShares: bigint }>
  scaledBack: boolean
  blockers: { code: 'no-participants' | 'company-fees-exceed' | 'scale-back-below-minimum'; names: string[] }[]
}

export function validateAllocation(input: AllocationInput): InputError[] {
  const e = new Errors()
  if (!Number.isSafeInteger(input.priceMicros) || input.priceMicros <= 0 || input.priceMicros > MAX_PRICE_MICROS)
    e.add('sharePrice', 'must be greater than 0 and at most 1,000,000')
  e.money(input.minimum, 'minimum', 0)
  if (input.cap !== null) e.money(input.cap, 'cap', 1)
  if (input.feeBasis !== 'deducted' && input.feeBasis !== 'onTop') e.add('feeBasis', 'must be deducted or onTop')
  e.count(input.fees.length, MAX_FEES, 'fees')
  e.uniqueIds(input.fees.map((f) => f.id), 'fees')
  // labels become export column names, so they must be unique too (self-test #7)
  e.uniqueIds(input.fees.map((f) => f.label.trim().toLowerCase()), 'fee labels')
  input.fees.forEach((f, i) => {
    const where = `fees[${i + 1}] ${f.label}`
    e.text(f.id, `${where} id`, LIMITS.investorId, true)
    e.text(f.label, `${where} label`, LIMITS.freeText, false)
    const okKind = f.payer === 'investors' ? f.kind === 'percent' || f.kind === 'perInvestor' : (f.payer === 'company' || f.payer === 'lead') && (f.kind === 'percent' || f.kind === 'fixed')
    if (!okKind)
      e.add(where, f.payer === 'investors' ? 'investor-paid fees must be a percentage or a fixed amount per investor' : 'company- or lead-paid fees must be a percentage or a fixed total')
    if (f.kind === 'percent') {
      if (!Number.isInteger(f.value) || f.value < 0 || f.value > 10_000) e.add(where, 'percentage must be between 0% and 100%')
    } else e.money(f.value, where, 1)
  })
  const p = sum(input.fees.filter((f) => f.payer === 'investors' && f.kind === 'percent').map((f) => f.value))
  if (input.feeBasis === 'deducted' && p >= 10_000) e.add('fees', 'investor percentage fees deducted from the wire must total less than 100%')
  e.count(input.investors.length, MAX_INVESTORS, 'investors')
  e.uniqueIds(input.investors.map((v) => v.id), 'investors')
  input.investors.forEach((v, i) => {
    const where = `investors[${i + 1}]`
    e.text(v.id, `${where} id`, LIMITS.investorId, true)
    e.text(v.name, `${where} name`, LIMITS.name, true)
    if (!['none', 'SEIS', 'EIS'].includes(v.scheme)) e.add(`${where} scheme`, 'must be none, SEIS or EIS')
    e.money(v.received, `${where} received`, 0)
  })
  return e.list
}

export function allocate(input: AllocationInput): Outcome<AllocationResult> {
  const errors = validateAllocation(input)
  if (errors.length) return { ok: false, errors }
  try {
    return compute(input)
  } catch (err) {
    // Only reachable with extreme fee combinations whose totals cannot be represented exactly (review M1 #10).
    if (err instanceof Error && /safe integer/.test(err.message)) return { ok: false, errors: [{ where: 'fees', message: 'totals exceed the supported size' }] }
    throw err
  }
}

function compute(input: AllocationInput): Outcome<AllocationResult> {

  const { feeBasis, minimum, cap, priceMicros: price, fees, investors } = input
  const pctFees = fees.filter((f) => f.payer === 'investors' && f.kind === 'percent')
  const perInvFees = fees.filter((f) => f.payer === 'investors' && f.kind === 'perInvestor')
  const p = sum(pctFees.map((f) => f.value))
  const F = sum(perInvFees.map((f) => f.value))

  // C-ALL-1: maximum investable M; C-ALL-2: minimum on the commitment basis.
  const M = investors.map((v) => {
    if (v.received <= F) return 0
    return feeBasis === 'deducted'
      ? mulDivN(v.received - F, 10_000 - p, 10_000, 'floor')
      : mulDivN(v.received - F, 10_000, 10_000 + p, 'floor')
  })
  const exclusion: (ExclusionReason | null)[] = investors.map((v, i) => {
    if (v.received === 0) return 'no-funds'
    if (v.received <= F || M[i] <= 0) return 'fees-exceed-receipt'
    const commitment = feeBasis === 'deducted' ? v.received : M[i]
    return commitment < minimum ? 'below-minimum' : null
  })
  const inM = M.map((m, i) => (exclusion[i] ? 0 : m))

  // C-ALL-3: pro-rata scale-back to the cap.
  const demand = sum(inM)
  const scaledBack = cap !== null && demand > cap
  const T = scaledBack ? splitProRata(cap, inM) : inM
  const belowAfterScale: string[] = []
  if (scaledBack) {
    investors.forEach((v, i) => {
      if (exclusion[i]) return // every participant is checked, even if rounding left T = M (review M1 #3)
      // deducted: T/(1−p) + F < minimum  ⇔  T × 10,000 < (minimum − F) × (10,000 − p)
      const below =
        feeBasis === 'deducted'
          ? BigInt(T[i]) * 10_000n < BigInt(minimum - F) * BigInt(10_000 - p)
          : T[i] < minimum
      if (below) belowAfterScale.push(v.name)
    })
  }

  // C-ALL-5..7: invest T, charge each fee separately, retry 1p at a time until the refund is ≥ 0.
  const pctFee = (I: number, rate: number) =>
    feeBasis === 'deducted' ? mulDivN(I, rate, 10_000 - p, 'halfUp') : mulDivN(I, rate, 10_000, 'halfUp')

  const rows: AllocationRow[] = investors.map((v, i) => {
    const base = {
      id: v.id,
      name: v.name,
      scheme: v.scheme,
      received: v.received,
      target: T[i],
      scaledBack: scaledBack && !exclusion[i] && T[i] < inM[i],
    }
    const out = (reason: ExclusionReason): AllocationRow => ({
      ...base,
      participating: false,
      exclusion: reason,
      invested: 0,
      fees: Object.create(null),
      feesTotal: 0,
      refund: v.received,
      microShares: 0n,
      claimableShares: 0,
      claimableAmount: 0,
      nonClaimable: 0,
    })
    if (exclusion[i]) return out(exclusion[i]!)
    let I = T[i]
    for (;;) {
      if (I <= 0) return out('zero-investment')
      const feeMap: Record<string, number> = Object.create(null) // fee ids such as "__proto__" stay ordinary keys
      for (const f of pctFees) feeMap[f.id] = pctFee(I, f.value)
      for (const f of perInvFees) feeMap[f.id] = f.value
      const feesTotal = sum(Object.values(feeMap))
      const refund = v.received - I - feesTotal
      if (refund < 0) {
        I -= 1
        continue
      }
      const claimableShares = toNum(mulDiv(I, 10_000, price, 'floor'))
      const claimableAmount = toNum(mulDiv(claimableShares, price, 10_000, 'floor'))
      return {
        ...base,
        participating: true,
        exclusion: null,
        invested: I,
        fees: feeMap,
        feesTotal,
        refund,
        microShares: mulDiv(BigInt(I) * 10_000n, 1_000_000n, price, 'floor'),
        claimableShares,
        claimableAmount,
        nonClaimable: I - claimableAmount,
      }
    }
  })

  // C-ALL-9: deal-level fees and the wire.
  const invested = sumExact(rows.map((r) => r.invested))
  const feeTotals = fees.map((f) => ({
    id: f.id,
    label: f.label,
    payer: f.payer,
    kind: f.kind,
    amount:
      f.payer === 'investors'
        ? sumExact(rows.map((r) => r.fees[f.id] ?? 0))
        : f.kind === 'percent'
          ? mulDivN(invested, f.value, 10_000, 'halfUp')
          : f.value,
  }))
  const companyFees = sumExact(feeTotals.filter((f) => f.payer === 'company').map((f) => f.amount))
  const leadInvoice = sumExact(feeTotals.filter((f) => f.payer === 'lead').map((f) => f.amount))
  const participants = rows.filter((r) => r.participating)

  const byScheme: AllocationResult['byScheme'] = {
    none: { investors: 0, invested: 0, microShares: 0n },
    SEIS: { investors: 0, invested: 0, microShares: 0n },
    EIS: { investors: 0, invested: 0, microShares: 0n },
  }
  for (const r of participants) {
    byScheme[r.scheme].investors += 1
    byScheme[r.scheme].invested += r.invested
    byScheme[r.scheme].microShares += r.microShares
  }

  const blockers: AllocationResult['blockers'] = []
  if (participants.length === 0) blockers.push({ code: 'no-participants', names: [] })
  if (companyFees > invested) blockers.push({ code: 'company-fees-exceed', names: [] })
  if (belowAfterScale.length) blockers.push({ code: 'scale-back-below-minimum', names: belowAfterScale })

  const result: AllocationResult = {
    rows,
    feeTotals,
    totals: {
      received: sumExact(rows.map((r) => r.received)),
      invested,
      investorFees: sumExact(rows.map((r) => r.feesTotal)),
      refunds: sumExact(rows.map((r) => r.refund)),
      companyFees,
      leadInvoice,
      wire: invested - companyFees,
    },
    byScheme,
    scaledBack,
    blockers,
  }

  const checks: Check[] = [
    {
      id: 'cash-balances',
      kind: 'invariant',
      label: 'For every investor, cash received = invested + fees + refund',
      pass: rows.every((r) => r.received === r.invested + r.feesTotal + r.refund),
    },
    {
      id: 'no-negative-refund',
      kind: 'invariant',
      label: 'No refund is negative',
      pass: rows.every((r) => r.refund >= 0),
    },
    {
      id: 'fee-items',
      kind: 'invariant',
      label: 'Each investor-paid fee adds up across investors',
      pass: feeTotals
        .filter((f) => f.payer === 'investors')
        .every((f) => f.amount === sumExact(participants.map((r) => r.fees[f.id] ?? 0))),
    },
    {
      // Independent of how each fee was computed: total investor % fees must sit within one penny per fee
      // of the rate applied to the right base (self-test #6 — catches a fee computed on the wrong base).
      id: 'fee-rate',
      kind: 'invariant',
      label: 'Investor percentage fees match their rates',
      pass: participants.every((r) => {
        const pct = sum(pctFees.map((f) => r.fees[f.id]))
        const expectedX10000 = feeBasis === 'deducted' ? BigInt(r.invested) * BigInt(p) * 10_000n / BigInt(10_000 - p) : BigInt(r.invested) * BigInt(p)
        const diff = BigInt(pct) * 10_000n - expectedX10000
        return (diff < 0n ? -diff : diff) <= BigInt(pctFees.length) * 10_000n
      }),
    },
    {
      id: 'non-participants',
      kind: 'invariant',
      label: 'Investors who are out pay no fees and get everything back',
      pass: rows.filter((r) => !r.participating).every((r) => r.invested === 0 && r.feesTotal === 0 && r.refund === r.received),
    },
    {
      id: 'cap',
      kind: 'invariant',
      label: 'Total invested is within the round cap',
      pass: cap === null || invested <= cap,
    },
    {
      id: 'wire',
      kind: 'invariant',
      label: 'Wire to company + company-paid fees = total invested',
      pass: result.totals.wire + companyFees === invested,
    },
    {
      id: 'no-participants',
      kind: 'blocker',
      label: 'At least one investor is in the allocation',
      pass: participants.length > 0,
    },
    {
      id: 'company-fees-exceed',
      kind: 'blocker',
      label: 'Company-paid fees do not exceed the amount raised',
      pass: companyFees <= invested,
    },
    {
      id: 'scale-back-below-minimum',
      kind: 'blocker',
      label: 'Nobody falls below the minimum after scale-back',
      pass: belowAfterScale.length === 0,
      detail: belowAfterScale.join(', '),
    },
    ...participants
      .filter((r) => r.scheme !== 'none' && r.nonClaimable > 0)
      .map(
        (r): Check => ({
          id: `seis-eis-remainder-${r.id}`,
          kind: 'warning',
          label: `${r.name}: part of the investment is outside whole shares for ${r.scheme}`,
          pass: false,
          detail: SEIS_EIS_HINT,
        }),
      ),
  ]
  return finish(result, checks)
}

/** C-ALL-8 wording, verbatim. */
export const SEIS_EIS_HINT =
  'This estimate uses whole shares in the final allocation. Fees, scale-back and rounding can leave a remainder even when the wire is a multiple of the share price. Check the final allocated share count.'

export const SEIS_BEFORE_EIS_NOTE =
  'SEIS shares must be issued on an earlier day than EIS shares — the same day is not enough.'
