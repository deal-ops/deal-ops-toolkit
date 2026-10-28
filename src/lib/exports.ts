// Export formats (Test Plan §6) and the closing confirmation (R-ALL-10).
import { formatMicroShares, formatMoney, formatPrice, plainMoney, type Currency } from './money'
import { toCsv } from './csv'
import { chaseMessage } from './messages'
import type { ReconcileResult } from './reconcile'
import type { AllocationResult } from './allocation'
import type { Holding, WaterfallResult } from './waterfall'

/** Every export ends with the deal currency's ISO code on each row; column names stay fixed (Test Plan §6, v0.7.5). */
export function ledgerCsv(r: ReconcileResult, currency: Currency): string {
  const names = new Map(r.commitments.map((c) => [c.commitment.id, c.commitment.name]))
  // v0.8: the withdrawal date on every line booked to a withdrawn investor (PRD §5.5)
  const withdrawnOn = new Map(r.commitments.map((c) => [c.commitment.id, c.withdrawnOn]))
  return toCsv(
    ['transaction_id', 'date', 'amount', 'payer', 'reference', 'status', 'investor_id', 'investor_name', 'decided_by', 'withdrawn_on', 'currency'],
    r.lines.map((l) => [
      l.line.txnId ?? '',
      l.line.date,
      plainMoney(l.line.amount),
      l.line.payer,
      l.line.reference,
      l.status,
      l.assignedTo ?? '',
      l.assignedTo ? names.get(l.assignedTo) ?? '' : '',
      l.status === 'auto' ? 'auto' : l.status === 'confirmed' || l.status === 'rejected' ? 'person' : '',
      l.assignedTo ? (withdrawnOn.get(l.assignedTo) ?? '') : '',
      currency,
    ]),
    ['amount'],
  )
}

/**
 * Partial and outstanding only (TC-REC-27), so never a withdrawn investor. `committed` is the effective cash due; where a
 * fee payer change adjusts it, `committed_original` / `committed_adjustment` show the list value and the difference
 * (C-ALL-11). `message` is the chase text, made by the same function as "Copy message" (R-REC-10.1).
 */
export function chaseListCsv(r: ReconcileResult, currency: Currency, dealName: string): string {
  return toCsv(
    ['investor_id', 'name', 'email', 'committed', 'received', 'difference', 'status', 'committed_original', 'committed_adjustment', 'message', 'currency'],
    r.commitments
      .filter((c) => c.status === 'partial' || c.status === 'outstanding')
      .map((c) => [
        c.commitment.id,
        c.commitment.name,
        c.commitment.email,
        plainMoney(c.due),
        plainMoney(c.received),
        plainMoney(c.difference),
        c.status,
        c.due !== c.commitment.cashDue ? plainMoney(c.commitment.cashDue) : '',
        c.due !== c.commitment.cashDue ? plainMoney(c.due - c.commitment.cashDue) : '',
        chaseMessage(dealName, currency, c),
        currency,
      ]),
    ['committed', 'received', 'difference', 'committed_original', 'committed_adjustment'],
  )
}

export function allocationCsv(r: AllocationResult, currency: Currency): string {
  const investorFees = r.feeTotals.filter((f) => f.payer === 'investors')
  return toCsv(
    [
      'investor_id',
      'name',
      'scheme',
      'received',
      'invested',
      'units',
      ...investorFees.map((f) => `fee_${f.label}`),
      'fees_total',
      'refund',
      'seis_eis_claimable_shares',
      'seis_eis_claimable_amount',
      'status',
      'currency',
    ],
    r.rows.map((x) => [
      x.id,
      x.name,
      x.scheme,
      plainMoney(x.received),
      plainMoney(x.invested),
      formatMicroShares(x.microShares),
      ...investorFees.map((f) => plainMoney(x.fees[f.id] ?? 0)),
      plainMoney(x.feesTotal),
      plainMoney(x.refund),
      x.participating && x.scheme !== 'none' ? x.claimableShares : '',
      x.participating && x.scheme !== 'none' ? plainMoney(x.claimableAmount) : '',
      x.participating ? (x.scaledBack ? 'scaled-back' : 'allocated') : x.exclusion ?? '',
      currency,
    ]),
    ['received', 'invested', 'units', ...investorFees.map((f) => `fee_${f.label}`), 'fees_total', 'refund', 'seis_eis_claimable_shares', 'seis_eis_claimable_amount'],
  )
}

export function distributionCsv(r: WaterfallResult, sharePriceMicros: number | null, currency: Currency): string {
  return toCsv(
    ['investor_id', 'name', 'capital', 'shares_display', 'distribution', 'profit', 'multiple_excl_entry_fees', 'currency'],
    r.rows.map((x) => [
      x.id,
      x.name,
      plainMoney(x.capital),
      sharesDisplay(x.capital, sharePriceMicros),
      plainMoney(x.distribution),
      plainMoney(x.profit),
      (x.multiple100 / 100).toFixed(2),
      currency,
    ]),
    ['capital', 'shares_display', 'distribution', 'profit', 'multiple_excl_entry_fees'],
  )
}

/** Reusable holdings export; re-import takes only capital and share_price. */
export function holdingsCsv(rows: Holding[], sharePriceMicros: number | null, currency: Currency): string {
  return toCsv(
    ['investor_id', 'name', 'capital', 'shares_display', 'share_price', 'currency'],
    rows.map((h) => [h.id, h.name, plainMoney(h.capital), sharesDisplay(h.capital, sharePriceMicros), sharePriceMicros === null ? '' : plainPrice(sharePriceMicros), currency]),
    ['capital', 'shares_display', 'share_price'],
  )
}

export function sharesDisplay(capital: number, sharePriceMicros: number | null): string {
  if (sharePriceMicros === null) return '—'
  return formatMicroShares((BigInt(capital) * 10_000n * 1_000_000n) / BigInt(sharePriceMicros))
}

export function plainPrice(micros: number): string {
  const frac = String(micros % 1_000_000).padStart(6, '0').replace(/0+$/, '')
  return `${Math.floor(micros / 1_000_000)}${frac ? `.${frac}` : ''}`
}

/** R-ALL-10: the summary a lead confirms instead of an email chain. */
export function closingConfirmation(
  dealName: string,
  currency: Currency,
  priceMicros: number,
  r: AllocationResult,
  /** refunds found in reconciliation, outside the allocation: over-payments (R-REC-08) and withdrawals (C-REC-7) */
  excess: { name: string; amount: number; reason?: 'Withdrawn' | 'Over-paid' }[] = [],
): string {
  const m = (x: number) => formatMoney(x, currency)
  const lines = [
    `Closing confirmation — ${dealName}`,
    `Currency: ${currency}`,
    `Share price: ${formatPrice(priceMicros, currency)} (nominee SPV; fractional shares allowed)`,
    '',
    `Cash received: ${m(r.totals.received)}`,
    `Total invested: ${m(r.totals.invested)}`,
    ...r.feeTotals.map((f) => `${f.label} (paid by ${f.payer}): ${m(f.amount)}`),
    `Refunds: ${m(r.totals.refunds)}`,
    `Wire to company: ${m(r.totals.wire)}`,
    ...(r.totals.leadInvoice ? [`Invoice to lead: ${m(r.totals.leadInvoice)}`] : []),
    '',
    'Per investor:',
    ...r.rows.map((x) =>
      x.participating
        ? `- ${x.name}: invests ${m(x.invested)}, fees ${m(x.feesTotal)}, refund ${m(x.refund)}`
        : `- ${x.name}: not in this close, refund ${m(x.refund)}`,
    ),
  ]
  const over = excess.filter((x) => x.reason !== 'Withdrawn')
  const withdrawn = excess.filter((x) => x.reason === 'Withdrawn')
  if (over.length) lines.push('', 'Over-payments to refund (not part of the allocation):', ...over.map((x) => `- ${x.name}: ${m(x.amount)}`))
  // R-ALL-10 (v0.8): withdrawn investors after the over-payments
  if (withdrawn.length) lines.push('', 'Withdrawn before closing (refund in full):', ...withdrawn.map((x) => `- ${x.name}: ${m(x.amount)}`))
  if (r.blockers.length) lines.push('', 'NOT READY TO CLOSE: ' + r.blockers.map((b) => b.code + (b.names.length ? ` (${b.names.join(', ')})` : '')).join('; '))
  return lines.join('\n')
}
