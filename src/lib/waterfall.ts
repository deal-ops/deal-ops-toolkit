// Exit distribution (PRD §4.3, C-DIS-1..7). One contribution, one exit, uniform terms.
import { hurdleAmount, mulDiv, mulDivN, splitProRata, sum, toNum } from './money'
import { Errors, LIMITS, MAX_HOLDINGS } from './validate'
import { finish, type Check, type InputError, type Outcome } from './outcome'

export interface Holding {
  id: string
  name: string
  /** Amount invested, excluding fees. Also the ownership weight (C-DIS-7). */
  capital: number
}

export type CarryTerms =
  | { mode: 'fixed'; k: number; h: number; c: number }
  /** upTo100: gross multiple × 100 where the tier ends (BigInt: no ceiling on size); null = last tier.
   *  h / c must be absent in tiered mode — their presence, even as 0, is an input error. */
  | { mode: 'tiered'; tiers: { upTo100: bigint | null; rate: number }[]; h?: number; c?: number }

export interface WaterfallInput {
  holdings: Holding[]
  proceeds: number
  exitCosts: number
  /** years × 100 */
  years100: number
  carry: CarryTerms
}

export interface WaterfallStep {
  label: string
  toInvestors: number
  toLead: number
  explain: string
}

export interface WaterfallRow {
  id: string
  name: string
  capital: number
  distribution: number
  profit: number
  /** distribution ÷ capital × 100, half-up; excludes entry fees */
  multiple100: number
}

export interface WaterfallResult {
  steps: WaterfallStep[]
  rows: WaterfallRow[]
  capital: number
  shortfall: number
  costsPaid: number
  returnOfCapital: number
  hurdlePaid: number
  catchUpTranche: number
  catchUpToLead: number
  carry: number
  investorsTotal: number
}

const fmtMultiple = (m100: bigint) => `${m100 / 100n}.${String(m100 % 100n).padStart(2, '0')}x`
const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`

/** The holdings table on its own (field table, I-08): shared by the exit engine and the holdings export (review M3 R1 #6). */
export function validateHoldings(holdings: Holding[], e = new Errors()): InputError[] {
  if (holdings.length === 0) e.add('holdings', 'add at least one holding')
  e.count(holdings.length, MAX_HOLDINGS, 'holdings')
  e.uniqueIds(holdings.map((h) => h.id), 'holdings')
  holdings.forEach((h, i) => {
    e.text(h.id, `holdings[${i + 1}] id`, LIMITS.investorId, true)
    e.text(h.name, `holdings[${i + 1}] name`, LIMITS.name, true)
    e.money(h.capital, `holdings[${i + 1}] capital`, 1)
  })
  return e.list
}

export function validateWaterfall(input: WaterfallInput): InputError[] {
  const e = new Errors()
  validateHoldings(input.holdings, e)
  e.money(input.proceeds, 'proceeds', 0)
  e.money(input.exitCosts, 'exitCosts', 0)
  if (!Number.isInteger(input.years100) || input.years100 < 0 || input.years100 > 5_000) e.add('years', 'must be between 0 and 50')
  const rate = (v: number, where: string) => {
    if (!Number.isInteger(v) || v < 0 || v > 10_000) e.add(where, 'must be between 0% and 100%')
  }
  const c = input.carry
  if (c.mode === 'fixed') {
    // modes are exclusive: a tier table in fixed mode is an input error (C-DIS, Codex M1 round 2)
    if ('tiers' in c) e.add('carry', 'tiers do not apply to fixed carry')
    rate(c.k, 'carry')
    rate(c.h, 'hurdle')
    rate(c.c, 'catchUp')
    if (c.h === 0 && c.c !== 0) e.add('catchUp', 'catch-up only applies with a hurdle; set it to 0 or add a hurdle')
    if (c.h > 0 && c.c > 0 && c.c <= c.k) e.add('catchUp', 'catch-up must be higher than the carry rate')
  } else if (c.mode === 'tiered') {
    if ('h' in c || 'c' in c || 'k' in c) e.add('carry', 'a fixed carry rate, hurdle or catch-up does not apply to tiered carry')
    if (c.tiers.length === 0) e.add('tiers', 'add at least one tier')
    let prev = 100n
    c.tiers.forEach((t, i) => {
      const where = `tiers[${i + 1}]`
      rate(t.rate, `${where} rate`)
      const last = i === c.tiers.length - 1
      if (last && t.upTo100 !== null) e.add(where, 'the last tier must have no ceiling')
      if (!last) {
        if (typeof t.upTo100 !== 'bigint' || t.upTo100 <= prev) e.add(where, 'ceiling must be above the previous one and above 1x')
        else prev = t.upTo100
      }
    })
  } else e.add('carry', 'unknown carry mode')
  return e.list
}

export function distribute(input: WaterfallInput): Outcome<WaterfallResult> {
  const errors = validateWaterfall(input)
  if (errors.length) return { ok: false, errors }
  const { holdings, proceeds: G, exitCosts: E, carry } = input
  const C = sum(holdings.map((h) => h.capital))
  const steps: WaterfallStep[] = []
  const zeroRows = holdings.map((h) => ({ id: h.id, name: h.name, capital: h.capital, distribution: 0, profit: -h.capital, multiple100: 0 }))

  // C-DIS-1: exit costs larger than proceeds → shortfall, no final distribution.
  if (E > G) {
    const result: WaterfallResult = {
      steps: [{ label: 'Exit costs', toInvestors: 0, toLead: 0, explain: 'Exit costs exceed proceeds. Nothing can be distributed until this is resolved.' }],
      rows: zeroRows,
      capital: C,
      shortfall: E - G,
      costsPaid: G,
      returnOfCapital: 0,
      hurdlePaid: 0,
      catchUpTranche: 0,
      catchUpToLead: 0,
      carry: 0,
      investorsTotal: 0,
    }
    return finish(result, [{ id: 'exit-cost-shortfall', kind: 'blocker', pass: false, label: 'Exit costs do not exceed proceeds' }])
  }

  const D = G - E
  const roc = Math.min(D, C)
  let rem = D - roc
  steps.push({
    label: 'Return of capital',
    toInvestors: roc,
    toLead: 0,
    explain: roc < C ? 'Not enough to return all capital: there is no profit and no carry.' : 'Investors get back what they invested before any carry is paid.',
  })
  let hurdlePaid = 0
  let catchUpTranche = 0
  let catchUpToLead = 0

  if (rem > 0 && carry.mode === 'fixed') {
    const { k, h, c } = carry
    if (h > 0) {
      // C-DIS-3: exact BigInt hurdle, rounded half-up to pence once; n is only for the explanation text.
      const n = input.years100 / 100
      // exact, half-up (review M1 #1); kept as BigInt until clamped by what is left (self-test #1)
      const P = hurdleAmount(C, h, input.years100)
      hurdlePaid = P < BigInt(rem) ? toNum(P) : rem
      rem -= hurdlePaid
      steps.push({ label: 'Preferred return (hurdle)', toInvestors: hurdlePaid, toLead: 0, explain: `${pct(h)} a year, compounding over ${n} years on capital, paid to investors before any carry.` })
      if (c > 0 && rem > 0) {
        // C-DIS-4: Y = k·P′ / (c − k)
        const Y = mulDivN(hurdlePaid, k, c - k, 'halfUp')
        catchUpTranche = Math.min(rem, Y)
        catchUpToLead = mulDivN(catchUpTranche, c, 10_000, 'halfUp')
        rem -= catchUpTranche
        steps.push({
          label: 'Lead catch-up',
          toInvestors: catchUpTranche - catchUpToLead,
          toLead: catchUpToLead,
          explain: `The lead takes ${pct(c)} of the next distributions until it holds ${pct(k)} of all profit paid so far.`,
        })
      }
    }
    const toLead = mulDivN(rem, k, 10_000, 'halfUp')
    steps.push({ label: 'Carried interest split', toInvestors: rem - toLead, toLead, explain: `Remaining profit: ${pct(10_000 - k)} to investors, ${pct(k)} to the lead.` })
    rem = 0
  } else if (rem > 0 && carry.mode === 'tiered') {
    // C-DIS-6: boundaries rounded to a penny first, then each band's carry rounded half-up.
    const profit = BigInt(rem)
    let prevB = 0n
    let prevM = 100n
    for (const t of carry.tiers) {
      // boundaries stay BigInt until clamped by the actual profit (review M1 #9)
      const B = t.upTo100 === null ? null : mulDiv(t.upTo100 - 100n, C, 100, 'halfUp')
      const top = B === null || B > profit ? profit : B
      const amt = toNum(top > prevB ? top - prevB : 0n)
      const toLead = mulDivN(amt, t.rate, 10_000, 'halfUp')
      steps.push({
        label: t.upTo100 === null ? `Profit above ${fmtMultiple(prevM)}` : `Profit from ${fmtMultiple(prevM)} to ${fmtMultiple(t.upTo100)}`,
        toInvestors: amt - toLead,
        toLead,
        explain: `${pct(t.rate)} carry on the profit in this band only.`,
      })
      if (t.upTo100 !== null && B !== null) {
        prevB = B
        prevM = t.upTo100
      }
    }
    rem = 0
  }

  const investorsTotal = sum(steps.map((s) => s.toInvestors))
  const carryTotal = sum(steps.map((s) => s.toLead))
  const parts = splitProRata(investorsTotal, holdings.map((h) => h.capital))
  const rows: WaterfallRow[] = holdings.map((h, i) => ({
    id: h.id,
    name: h.name,
    capital: h.capital,
    distribution: parts[i],
    profit: parts[i] - h.capital,
    multiple100: mulDivN(parts[i], 100, h.capital, 'halfUp'),
  }))
  const result: WaterfallResult = {
    steps,
    rows,
    capital: C,
    shortfall: 0,
    costsPaid: E,
    returnOfCapital: roc,
    hurdlePaid,
    catchUpTranche,
    catchUpToLead,
    carry: carryTotal,
    investorsTotal,
  }
  const checks: Check[] = [
    { id: 'balances', kind: 'invariant', label: 'Investors + carry + exit costs = proceeds', pass: investorsTotal + carryTotal + E === G },
    { id: 'capital-first', kind: 'invariant', label: 'No carry unless all capital is returned', pass: D > C || carryTotal === 0 },
    {
      id: 'investor-split',
      kind: 'invariant',
      label: 'Investor payouts add up and none is negative',
      pass: sum(parts) === investorsTotal && parts.every((x) => x >= 0),
    },
  ]
  return finish(result, checks)
}

/**
 * True when the lead's carry is the full carry rate of all profit, to within a penny (C-DIS-4: what a 100% catch-up
 * achieves when there is enough money). Used to word explanations; no figure depends on it.
 */
export function carryIsFullShare(r: WaterfallResult, kBps: number): boolean {
  const profit = BigInt(r.investorsTotal + r.carry - r.capital)
  if (profit <= 0n) return false
  const diff = BigInt(r.carry) * 10_000n - profit * BigInt(kBps)
  return (diff < 0n ? -diff : diff) <= 10_000n
}
