// Test Plan §1 "独立复算": the TypeScript engines and the independent Python oracle
// (scripts/oracle/oracle.py, written from the PRD text only) must agree field by field.
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allocate, type AllocationInput, type Fee } from './allocation'
import { distribute, type WaterfallInput } from './waterfall'
import { decide, handoffToAllocation, reconcile, type BankLine, type Commitment, type Decisions } from './reconcile'
import { previewFeePayerChange, type FeePayerInput } from './feePayer'
import { SAMPLE_BANK, SAMPLE_CAP, SAMPLE_COMMITMENTS, SAMPLE_EXIT, SAMPLE_FEES, SAMPLE_PRICE_MICROS } from './sample'

type Case = Record<string, unknown> & { kind: 'allocation' | 'waterfall' | 'reconcile' | 'feePayerChange' }

// ---------- TypeScript side, in the oracle's output shape (scripts/oracle/SCHEMA.md) ----------

function tsAllocation(c: Case) {
  const input = c as unknown as AllocationInput & { fees: Fee[] }
  const o = allocate({ ...input, fees: input.fees.map((f) => ({ ...f, label: f.id })), investors: input.investors.map((v) => ({ ...v, name: v.id })) })
  if (!o.ok) return { ok: false }
  const r = o.result
  const invFees = input.fees.filter((f) => f.payer === 'investors')
  return {
    ok: true,
    investors: Object.fromEntries(
      r.rows.map((x) => [
        x.id,
        {
          participating: x.participating,
          invested: x.invested,
          fees: x.participating ? Object.fromEntries(invFees.map((f) => [f.id, x.fees[f.id]])) : {},
          refund: x.refund,
          microShares: String(x.microShares),
          claimableShares: x.claimableShares,
          claimableAmount: x.claimableAmount,
        },
      ]),
    ),
    feeTotals: Object.fromEntries(r.feeTotals.map((f) => [f.id, f.amount])),
    totalInvested: r.totals.invested,
    companyFees: r.totals.companyFees,
    leadInvoice: r.totals.leadInvoice,
    wire: r.totals.wire,
    blockers: r.blockers.map((b) => b.code).sort(),
  }
}

function tsWaterfall(c: Case) {
  const input = c as unknown as WaterfallInput
  const raw = c.carry as { mode: string; tiers?: { upTo100: number | null; rate: number }[] }
  const carry =
    raw.mode === 'tiered'
      ? { ...raw, tiers: raw.tiers!.map((t) => ({ ...t, upTo100: t.upTo100 === null ? null : BigInt(t.upTo100) })) }
      : raw
  const o = distribute({ ...input, carry: carry as WaterfallInput['carry'], holdings: input.holdings.map((h) => ({ ...h, name: h.id })) })
  if (!o.ok) return { ok: false }
  const r = o.result
  return {
    ok: true,
    blockers: r.shortfall > 0 ? ['exit-cost-shortfall'] : [],
    shortfall: r.shortfall,
    costsPaid: r.costsPaid,
    returnOfCapital: r.returnOfCapital,
    hurdlePaid: r.hurdlePaid,
    catchUpTranche: r.catchUpTranche,
    catchUpToLead: r.catchUpToLead,
    carry: r.carry,
    investorsTotal: r.investorsTotal,
    distributions: Object.fromEntries(r.rows.map((x) => [x.id, x.distribution])),
  }
}

function tsReconcile(c: Case) {
  const commitments = (c.commitments as Omit<Commitment, 'email' | 'scheme'>[]).map((x) => ({ ...x, email: '', scheme: 'none' as const }))
  const lines = c.lines as BankLine[]
  const raw = c.decisions as Record<string, { assign?: string; reject?: boolean }>
  const decisions: Decisions = {}
  for (const [id, d] of Object.entries(raw)) {
    const line = lines.find((l) => l.id === id)!
    decisions[id] = decide(line, d.assign ? commitments.find((x) => x.id === d.assign)! : null)
  }
  // v0.8 (SCHEMA.md "reconcile — v0.8 extension"): withdrawal marks (the date plays no part) and effective cash due
  const extended = 'withdrawn' in c || 'adjustedCashDue' in c
  const withdrawn: Record<string, string> = Object.create(null)
  for (const id of (c.withdrawn as string[] | undefined) ?? []) withdrawn[id] = '2026-10-16'
  const due: Record<string, number> = Object.assign(Object.create(null), c.adjustedCashDue ?? {})
  if (new Set((c.withdrawn as string[] | undefined) ?? []).size !== ((c.withdrawn as string[] | undefined) ?? []).length) return { ok: false }
  const o = reconcile({ commitments, lines, decisions, asOf: c.asOf as string, thresholdDays: c.thresholdDays as number, ...(extended ? { withdrawn, due } : {}) })
  if (!o.ok) return { ok: false }
  const r = o.result
  const base = {
    lines: Object.fromEntries(
      r.lines.map((l) => [
        l.line.id,
        {
          status: l.status,
          assignedTo: l.assignedTo,
          suspectedDuplicate: l.suspectedDuplicate,
          candidates: l.status === 'suggested' ? l.candidates.map((x) => ({ id: x.commitmentId, score: Math.round(x.score * 10_000) / 10_000 })) : [],
        },
      ]),
    ),
    commitments: Object.fromEntries(r.commitments.map((x) => [x.commitment.id, { received: x.received, difference: x.difference, status: x.status }])),
    totals: { bank: r.totals.bank, booked: r.totals.booked, unbooked: r.totals.unbooked },
    aged: r.lines.filter((l) => l.aged).map((l) => l.line.id).sort(),
  }
  if (!extended) return base
  // the C-REC-6 snapshot formula, asked of the engine even while suggestions are open (the oracle has no review gate)
  const h = handoffToAllocation({ ...r, pendingSuggestions: 0, notCovered: [] })
  if (!h.ok) throw new Error(h.reason)
  return {
    ...base,
    commitments: Object.fromEntries(
      r.commitments.map((x) => [x.commitment.id, { received: x.received, difference: x.difference, status: x.status, cashDue: x.due, withdrawn: x.withdrawnOn !== null }]),
    ),
    refunds: r.refunds.map((x) => ({ id: x.id, amount: x.amount, reason: x.reason === 'Withdrawn' ? 'withdrawn' : 'overpayment' })),
    refundTotal: r.refunds.reduce((a, b) => a + b.amount, 0),
    receivable: r.totals.cashDue,
    withdrawnSummary: { count: r.totals.withdrawn.count, refund: r.totals.withdrawn.toRefund },
    chase: r.commitments.filter((x) => x.status === 'partial' || x.status === 'outstanding').map((x) => ({ id: x.commitment.id, outstanding: x.due - x.received })),
    handoff: Object.fromEntries(h.value.investors.map((v) => [v.id, v.received])),
    // an invariant that failed would have made the outcome an internal error
    checks: { refundIdentity: o.checks.some((k) => k.id === 'refunds-tie' && k.pass) },
  }
}

function tsFeePayer(c: Case) {
  const x = c as unknown as FeePayerInput & { newPayer: FeePayerInput['to']; investors: { id: string; cashDue: number; scheme: 'none' }[] }
  const o = previewFeePayerChange({
    feeBasis: x.feeBasis,
    minimum: x.minimum,
    cap: x.cap,
    priceMicros: x.priceMicros,
    fees: x.fees.map((f) => ({ ...f, label: f.id })),
    feeId: x.feeId,
    to: x.newPayer,
    investors: x.investors.map((v) => ({ ...v, name: v.id })),
    ...(x.applied ? { applied: x.applied } : {}),
  })
  if (!o.ok) return o.internal ? { internal: true } : { ok: false }
  const p = o.result
  const n = (v: number | null) => (p.computed ? v : null)
  return {
    ok: true,
    canApply: p.canApply,
    // the engine's own blockers are deal-level in the oracle's shape: one entry per code, no investor (SCHEMA.md)
    blockers: [...new Map(p.blockers.map((b) => (/^(before|after)-/.test(b.code) ? { code: b.code, investor: null } : { code: b.code, investor: b.investorId })).map((b) => [`${b.code}|${b.investor}`, b])).values()]
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : (a.investor ?? '') < (b.investor ?? '') ? -1 : 1)),
    investors: Object.fromEntries(
      p.rows.map((r) => [
        r.id,
        {
          cashDue: r.currentDue,
          participatingBefore: r.participatingBefore,
          unchanged: p.computed ? r.unchanged : null,
          target: n(r.target),
          newCashDue: n(r.newDue),
          difference: n(r.difference),
          participatingAfter: p.computed ? r.participatingAfter : null,
          investedAfter: n(r.investedAfter),
        },
      ]),
    ),
    feeBefore: p.feeBefore,
    feeAfter: p.feeAfter,
    totals: {
      cashDue: p.totals.currentDue,
      newCashDue: n(p.totals.newDue),
      difference: n(p.totals.difference),
      topUpCount: n(p.totals.topUps),
      topUpTotal: n(p.totals.topUpTotal),
      refundCount: n(p.totals.refunds),
      refundTotal: n(p.totals.refundTotal),
    },
  }
}

const tsRun = (c: Case) =>
  c.kind === 'allocation' ? tsAllocation(c) : c.kind === 'waterfall' ? tsWaterfall(c) : c.kind === 'feePayerChange' ? tsFeePayer(c) : tsReconcile(c)

function pyRun(cases: Case[]): unknown[] {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-'))
  const file = join(dir, 'cases.json')
  writeFileSync(file, JSON.stringify(cases))
  const out = execFileSync('python3', [new URL('../../scripts/oracle/batch.py', import.meta.url).pathname, file], { encoding: 'utf8', maxBuffer: 1 << 28 })
  return JSON.parse(out)
}

// ---------- deterministic case generator (valid inputs only) ----------

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function genAllocation(r: () => number, i: number): Case {
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const feeBasis = r() < 0.5 ? 'deducted' : 'onTop'
  const fees: Fee[] = []
  let p = 0
  for (let k = int(0, 3); k > 0; k--) {
    const v = int(0, 1500)
    p += v
    fees.push({ id: `p${fees.length}`, label: '', kind: 'percent', value: v, payer: 'investors' })
  }
  for (let k = int(0, 2); k > 0; k--) fees.push({ id: `q${fees.length}`, label: '', kind: 'perInvestor', value: int(1, 5_000), payer: 'investors' })
  if (r() < 0.5) fees.push({ id: `c${fees.length}`, label: '', kind: r() < 0.5 ? 'percent' : 'fixed', value: int(1, 300_000), payer: 'company' })
  if (r() < 0.4) fees.push({ id: `l${fees.length}`, label: '', kind: r() < 0.5 ? 'percent' : 'fixed', value: int(1, 2_000), payer: 'lead' })
  for (const f of fees) if (f.kind === 'percent' && f.value > 10_000) f.value = 10_000
  if (p >= 10_000) fees.length = 0
  const investors = Array.from({ length: int(1, 15) }, (_, j) => ({
    id: `i${j}`,
    received: r() < 0.1 ? int(0, 200) : int(0, 3_000_000),
    scheme: (['none', 'SEIS', 'EIS'] as const)[int(0, 2)],
  }))
  const demand = investors.reduce((a, b) => a + b.received, 0)
  const priceChoices = [1, 333_333, 1_000_000, 2_413_700, int(1, 50_000_000), 100_000_000_000]
  return {
    kind: 'allocation',
    id: `alloc-${i}`,
    feeBasis,
    minimum: r() < 0.5 ? 0 : int(1, 200_000),
    cap: r() < 0.5 ? null : int(1, Math.max(1, demand)),
    priceMicros: priceChoices[int(0, priceChoices.length - 1)],
    fees,
    investors,
  }
}

function genWaterfall(r: () => number, i: number): Case {
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const holdings = Array.from({ length: int(1, 8) }, (_, j) => ({ id: `h${j}`, capital: r() < 0.1 ? int(1, 10) : int(1, 5_000_000) }))
  const C = holdings.reduce((a, b) => a + b.capital, 0)
  const proceeds = int(0, C * 6)
  const exitCosts = r() < 0.6 ? 0 : int(0, Math.max(1, Math.floor(proceeds / 5) + (r() < 0.1 ? proceeds : 0)))
  let carry: unknown
  if (r() < 0.6) {
    const k = int(0, 4000)
    const h = r() < 0.5 ? 0 : int(1, 1500)
    const c = h === 0 || r() < 0.3 ? 0 : int(k + 1, 10_000)
    carry = { mode: 'fixed', k, h, c }
  } else {
    const n = int(1, 3)
    const tiers: { upTo100: number | null; rate: number }[] = []
    let m = 100
    for (let t = 0; t < n; t++) {
      m += int(1, 300)
      tiers.push({ upTo100: t === n - 1 ? null : m, rate: int(0, 5000) })
    }
    carry = { mode: 'tiered', tiers }
  }
  return { kind: 'waterfall', id: `wf-${i}`, holdings, proceeds, exitCosts, years100: int(0, 1000), carry }
}

const NAMES = ['John Smith', 'Priya Shah', 'Tom Okafor', 'Ana Lima', 'Mary-Jane Watts', 'Li Wei', 'Omar Haddad', 'Sara Holm']
function genReconcile(r: () => number, i: number): Case {
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const pick = <T,>(xs: T[]) => xs[int(0, xs.length - 1)]
  const nC = int(2, 7)
  const commitments = Array.from({ length: nC }, (_, j) => ({ id: `c${j}`, name: NAMES[j], reference: `NW-${String(j * 7 + 1).padStart(3, '0')}`, cashDue: pick([100_000, 250_000, 500_000, int(1, 900_000)]) }))
  const lines: BankLine[] = []
  for (let j = int(1, 12); j > 0; j--) {
    const c = pick(commitments)
    const refStyle = int(0, 6)
    const reference = [c.reference, c.reference.replace('-', ' ').toLowerCase(), `${c.reference}9`, '', `INV ${int(1, 99)}`, `${commitments[0].reference} ${c.reference}`, c.reference.replace('-', '').slice(0, -1)][refStyle]
    const payer = pick([c.name.toUpperCase(), `${c.name[0]} ${c.name.split(' ').pop()!.toUpperCase()}`, `${c.name.split(' ').pop()} FAMILY OFFICE LTD`, 'UNKNOWN CO'])
    const amount = r() < 0.08 ? -int(1, 5_000) : r() < 0.05 ? 0 : pick([c.cashDue, Math.floor(c.cashDue / 2), int(1, 900_000)])
    const day = int(1, 20)
    const noId = r() < 0.25
    const line: BankLine = { id: `l${lines.length}`, txnId: noId ? null : `l${lines.length}`, date: `2026-10-${String(day).padStart(2, '0')}`, amount, payer, reference }
    lines.push(line)
    if (r() < 0.15) lines.push({ ...line, id: `l${lines.length}`, txnId: noId ? null : `l${lines.length}` })
  }
  const decisions: Record<string, { assign: string } | { reject: true }> = {}
  for (const l of lines) if (r() < 0.2) decisions[l.id] = r() < 0.6 ? { assign: pick(commitments).id } : { reject: true }
  return { kind: 'reconcile', id: `rec-${i}`, asOf: '2026-10-16', thresholdDays: int(1, 12), commitments, lines, decisions }
}

/** v0.8: the same reconciliations with some investors withdrawn and some cash due adjusted (C-REC-7, C-ALL-11). */
function genReconcileV08(r: () => number, i: number): Case {
  const c = genReconcile(r, i)
  const ids = (c.commitments as { id: string; cashDue: number }[]).map((x) => x.id)
  const withdrawn = ids.filter(() => r() < 0.3)
  const adjustedCashDue: Record<string, number> = {}
  for (const x of c.commitments as { id: string; cashDue: number }[]) if (r() < 0.4) adjustedCashDue[x.id] = Math.max(1, Math.round(x.cashDue * (0.9 + r() * 0.2)))
  return { ...c, id: `rec08-${i}`, withdrawn, adjustedCashDue }
}

/** C-ALL-10: random fee tables, both bases, with caps and minimums; some re-checks of an applied change (C-ALL-11). */
function genFeePayer(r: () => number, i: number): Case {
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const payers = ['investors', 'company', 'lead'] as const
  const fees: Fee[] = []
  for (let k = int(1, 3); k > 0; k--) fees.push({ id: `p${fees.length}`, label: '', kind: 'percent', value: int(0, 1500), payer: payers[int(0, 2)] })
  if (r() < 0.4) fees.push({ id: `q${fees.length}`, label: '', kind: 'perInvestor', value: int(1, 3_000), payer: 'investors' })
  if (r() < 0.3) fees.push({ id: `c${fees.length}`, label: '', kind: 'fixed', value: int(1, 200_000), payer: 'company' })
  const pick = fees.filter((f) => f.kind === 'percent')[int(0, fees.filter((f) => f.kind === 'percent').length - 1)]
  const others = payers.filter((p) => p !== pick.payer)
  const investors = Array.from({ length: int(1, 8) }, (_, j) => ({ id: `i${j}`, cashDue: int(1, 3_000_000), scheme: 'none' as const }))
  const demand = investors.reduce((a, b) => a + b.cashDue, 0)
  const c: Case = {
    kind: 'feePayerChange',
    id: `fpc-${i}`,
    feeBasis: r() < 0.5 ? 'deducted' : 'onTop',
    minimum: r() < 0.5 ? 0 : int(1, 500_000),
    cap: r() < 0.7 ? null : int(1, Math.max(1, demand)),
    priceMicros: [1_000_000, 2_413_700, int(1, 50_000_000)][int(0, 2)],
    fees,
    feeId: pick.id,
    newPayer: others[int(0, 1)],
    investors,
  }
  if (r() < 0.25) {
    // re-check: apply it, then change a setting; both sides run step 3 only, with the saved T_i and N_i
    const first = previewFeePayerChange({ ...(c as unknown as FeePayerInput), to: c.newPayer as FeePayerInput['to'], fees: fees.map((f) => ({ ...f, label: f.id })), investors: investors.map((v) => ({ ...v, name: v.id })) })
    if (first.ok && first.result.canApply) {
      const targets: Record<string, number> = {}
      const newCashDue: Record<string, number> = {}
      for (const x of first.result.rows) if (x.target !== null) {
        targets[x.id] = x.target
        newCashDue[x.id] = x.newDue
      }
      const after = fees.map((f) => (f.id === pick.id ? { ...f, payer: c.newPayer as Fee['payer'] } : f))
      return { ...c, id: `fpc-applied-${i}`, fees: r() < 0.5 ? after : [...after, { id: 'z', label: '', kind: 'perInvestor', value: int(1, 2_000), payer: 'investors' }], minimum: r() < 0.5 ? c.minimum : int(0, 300_000), applied: { targets, newCashDue } }
    }
  }
  return c
}

// ---------- fixed cases: hand calculations and the sample deal ----------

const W = (over: Record<string, unknown>): Case => ({
  kind: 'waterfall',
  holdings: [
    { id: 'A', capital: 6_000_000 },
    { id: 'B', capital: 4_000_000 },
  ],
  proceeds: 30_000_000,
  exitCosts: 0,
  years100: 500,
  carry: { mode: 'fixed', k: 2000, h: 0, c: 0 },
  ...over,
})

const sampleReceived = [1_000_000, 500_000, 2_000_000, 200_000, 1_500_000, 1_000_000, 2_500_000, 500_000, 100_000, 0, 750_000, 300_000]
const FIXED: Case[] = [
  W({}),
  W({ proceeds: 8_000_000 }),
  W({ exitCosts: 1_000_000 }),
  W({ carry: { mode: 'fixed', k: 2000, h: 800, c: 10_000 } }),
  W({ carry: { mode: 'fixed', k: 2000, h: 800, c: 5000 } }),
  W({ proceeds: 16_000_000, carry: { mode: 'fixed', k: 2000, h: 800, c: 5000 } }),
  W({ years100: 250, carry: { mode: 'fixed', k: 2000, h: 800, c: 0 } }),
  W({ proceeds: 31_001_000, exitCosts: 1_000_000, carry: { mode: 'tiered', tiers: [{ upTo100: 300, rate: 2000 }, { upTo100: null, rate: 3000 }] } }),
  W({ proceeds: 100, exitCosts: 200 }),
  // invalid inputs must be rejected by both implementations (Codex M1 #16 and round 2)
  W({ carry: { mode: 'tiered', tiers: [{ upTo100: null, rate: 2000 }], h: 0 } }),
  W({ carry: { mode: 'tiered', tiers: [{ upTo100: null, rate: 2000 }], k: 9000 } }),
  W({ carry: { mode: 'fixed', k: 2000, h: 0, c: 0, tiers: [{ upTo100: null, rate: 9000 }] } }),
  W({ carry: { mode: 'fixed', k: 2000, h: 0, c: 5000 } }),
  {
    kind: 'allocation',
    feeBasis: 'deducted',
    minimum: 100_000,
    cap: SAMPLE_CAP,
    priceMicros: SAMPLE_PRICE_MICROS,
    fees: SAMPLE_FEES,
    investors: SAMPLE_COMMITMENTS.map((c, i) => ({ id: c.id, received: sampleReceived[i], scheme: c.scheme })),
  },
  { kind: 'waterfall', holdings: SAMPLE_COMMITMENTS.filter((_, i) => sampleReceived[i] > 0).map((c, i) => ({ id: c.id, capital: Math.round((sampleReceived.filter((x) => x > 0)[i] * 97) / 100) })), years100: SAMPLE_EXIT.years100, proceeds: SAMPLE_EXIT.proceeds, exitCosts: SAMPLE_EXIT.exitCosts, carry: SAMPLE_EXIT.carry },
  {
    kind: 'reconcile',
    asOf: '2026-10-16',
    thresholdDays: 10,
    commitments: SAMPLE_COMMITMENTS.map(({ id, name, reference, cashDue }) => ({ id, name, reference, cashDue })),
    lines: SAMPLE_BANK,
    decisions: {},
  },
  // non-ASCII inputs (self-test R3): separators are ASCII only, so both sides must agree on every runtime
  {
    kind: 'reconcile',
    asOf: '2026-10-16',
    thresholdDays: 10,
    commitments: [
      { id: 'c0', name: 'José García', reference: 'NW001', cashDue: 10_000 },
      { id: 'c1', name: '𐐀BC', reference: 'SS-001', cashDue: 20_000 },
    ],
    lines: [
      { id: 'a', txnId: 'a', date: '2026-10-10', amount: 10_000, payer: 'J. GARCÍA', reference: 'NW001Ɤ' },
      { id: 'b', txnId: 'b', date: '2026-10-10', amount: 10_000, payer: 'josé garcía', reference: 'Ref NW001 Ɤ' },
      { id: 'c', txnId: 'c', date: '2026-10-10', amount: 20_000, payer: '𐐀', reference: 'ß001' },
      { id: 'd', txnId: 'd', date: '2026-10-10', amount: 20_000, payer: 'X', reference: 'SS00𝐀' },
      { id: 'e', txnId: 'e', date: '2026-10-10', amount: 1, payer: 'Y', reference: 'NW-001–X' },
    ],
    decisions: {},
  },

  {
    kind: 'reconcile',
    asOf: '2026-10-16',
    thresholdDays: 10,
    commitments: SAMPLE_COMMITMENTS.map(({ id, name, reference, cashDue }) => ({ id, name, reference, cashDue })),
    lines: SAMPLE_BANK,
    decisions: { t03: { assign: 'c03' }, t05: { assign: 'c05' }, t12: { assign: 'c11' }, t11: { reject: true }, t14: { reject: true } },
  },
  // v0.8: TC-REC-47 (Lucas withdrawn after review) and the sample's platform fee moved to the company (TC-ALL-35)
  {
    kind: 'reconcile',
    asOf: '2026-10-16',
    thresholdDays: 10,
    commitments: SAMPLE_COMMITMENTS.map(({ id, name, reference, cashDue }) => ({ id, name, reference, cashDue })),
    lines: SAMPLE_BANK,
    decisions: { t03: { assign: 'c03' }, t05: { assign: 'c05' }, t12: { assign: 'c11' }, t11: { reject: true }, t14: { reject: true } },
    withdrawn: ['c12'],
    adjustedCashDue: { c01: 970_000 },
  },
  ...[100_000, 97_000].map(
    (minimum): Case => ({
      kind: 'feePayerChange',
      feeBasis: 'deducted',
      minimum,
      cap: SAMPLE_CAP,
      priceMicros: SAMPLE_PRICE_MICROS,
      fees: SAMPLE_FEES,
      feeId: 'f1',
      newPayer: 'company',
      investors: SAMPLE_COMMITMENTS.map((x) => ({ id: x.id, cashDue: x.cashDue, scheme: x.scheme })),
    }),
  ),
  { kind: 'feePayerChange', feeBasis: 'deducted', minimum: 0, cap: null, priceMicros: 1_000_000, fees: [{ id: 'f', label: 'f', kind: 'percent', value: 300, payer: 'company' }], feeId: 'f', newPayer: 'investors', investors: [{ id: 'a', cashDue: 100_000, scheme: 'none' }] },
  { kind: 'feePayerChange', feeBasis: 'deducted', minimum: 0, cap: 8_000_000, priceMicros: SAMPLE_PRICE_MICROS, fees: SAMPLE_FEES, feeId: 'f1', newPayer: 'company', investors: SAMPLE_COMMITMENTS.map((x) => ({ id: x.id, cashDue: x.cashDue, scheme: x.scheme })) },
]

describe('independent oracle agreement', () => {
  const r = rng(20261017)
  const cases: Case[] = [
    ...FIXED,
    ...Array.from({ length: 400 }, (_, i) => genAllocation(r, i)),
    ...Array.from({ length: 400 }, (_, i) => genWaterfall(r, i)),
    ...Array.from({ length: 300 }, (_, i) => genReconcile(r, i)),
    ...Array.from({ length: 300 }, (_, i) => genReconcileV08(r, i)),
    ...Array.from({ length: 400 }, (_, i) => genFeePayer(r, i)),
  ]
  const py = pyRun(cases)

  it('ORACLE-01 fixed hand-calculated and sample cases agree', () => {
    FIXED.forEach((c, i) => expect(tsRun(c), `fixed case ${i} (${c.kind})`).toEqual(py[i]))
  })

  it('ORACLE-02 1,800 generated cases agree field by field (v0.8: withdrawals, adjusted cash due, fee payer changes)', () => {
    const mismatches: string[] = []
    cases.forEach((c, i) => {
      if (i < FIXED.length) return
      const a = JSON.stringify(sortKeys(tsRun(c)))
      const b = JSON.stringify(sortKeys(py[i]))
      if (a !== b) mismatches.push(`${c.id}\nTS: ${a}\nPY: ${b}\nCASE: ${JSON.stringify(c)}`)
    })
    expect(mismatches.slice(0, 3).join('\n\n'), `${mismatches.length} mismatches`).toBe('')
  })

  it('ORACLE-03 generated cases are mostly valid (the generator is not testing only error paths)', () => {
    const valid = py.filter((o) => (o as { ok?: boolean }).ok !== false).length
    expect(valid / py.length).toBeGreaterThan(0.95)
    // the fee payer cases reach step 3 often enough, and some can be applied: not only the blocked paths (M6 self-test B)
    const fp = py.filter((o, i) => cases[i].kind === 'feePayerChange' && (o as { ok?: boolean }).ok !== false) as { canApply: boolean; feeAfter: number | null }[]
    expect(fp.filter((o) => o.feeAfter !== null).length / fp.length).toBeGreaterThan(0.5)
    expect(fp.filter((o) => o.canApply).length / fp.length).toBeGreaterThan(0.2)
  })
})

function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys)
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys((x as Record<string, unknown>)[k])]))
  return x
}
