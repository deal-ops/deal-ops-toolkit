// Export formats (Test Plan §6) and the closing confirmation (R-ALL-10).
import { formatMicroShares, formatMoney, formatPrice, plainMoney, type Currency } from './money'
import { toCsv } from './csv'
import type { ReconcileResult } from './reconcile'
import type { AllocationResult } from './allocation'
import type { Holding, WaterfallResult } from './waterfall'

export function ledgerCsv(r: ReconcileResult): string {
  const names = new Map(r.commitments.map((c) => [c.commitment.id, c.commitment.name]))
  return toCsv(
    ['transaction_id', 'date', 'amount', 'payer', 'reference', 'status', 'investor_id', 'investor_name', 'decided_by'],
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
    ]),
    ['amount'],
  )
}

/** Partial and outstanding only (TC-REC-27). */
export function chaseListCsv(r: ReconcileResult): string {
  return toCsv(
    ['investor_id', 'name', 'email', 'committed', 'received', 'difference', 'status'],
    r.commitments
      .filter((c) => c.status === 'partial' || c.status === 'outstanding')
      .map((c) => [c.commitment.id, c.commitment.name, c.commitment.email, plainMoney(c.commitment.cashDue), plainMoney(c.received), plainMoney(c.difference), c.status]),
    ['committed', 'received', 'difference'],
  )
}

export function allocationCsv(r: AllocationResult): string {
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
    ]),
    ['received', 'invested', 'units', ...investorFees.map((f) => `fee_${f.label}`), 'fees_total', 'refund', 'seis_eis_claimable_shares', 'seis_eis_claimable_amount'],
  )
}

export function distributionCsv(r: WaterfallResult, sharePriceMicros: number | null): string {
  return toCsv(
    ['investor_id', 'name', 'capital', 'shares_display', 'distribution', 'profit', 'multiple_excl_entry_fees'],
    r.rows.map((x) => [
      x.id,
      x.name,
      plainMoney(x.capital),
      sharesDisplay(x.capital, sharePriceMicros),
      plainMoney(x.distribution),
      plainMoney(x.profit),
      (x.multiple100 / 100).toFixed(2),
    ]),
    ['capital', 'shares_display', 'distribution', 'profit', 'multiple_excl_entry_fees'],
  )
}

/** Reusable holdings export; re-import takes only capital and share_price. */
export function holdingsCsv(rows: Holding[], sharePriceMicros: number | null): string {
  return toCsv(
    ['investor_id', 'name', 'capital', 'shares_display', 'share_price'],
    rows.map((h) => [h.id, h.name, plainMoney(h.capital), sharesDisplay(h.capital, sharePriceMicros), sharePriceMicros === null ? '' : plainPrice(sharePriceMicros)]),
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
  /** over-payments found in reconciliation, refunded outside the allocation (R-REC-08) */
  excess: { name: string; amount: number }[] = [],
): string {
  const m = (x: number) => formatMoney(x, currency)
  const lines = [
    `Closing confirmation — ${dealName}`,
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
  if (excess.length) lines.push('', 'Over-payments to refund (not part of the allocation):', ...excess.map((x) => `- ${x.name}: ${m(x.amount)}`))
  if (r.blockers.length) lines.push('', 'NOT READY TO CLOSE: ' + r.blockers.map((b) => b.code + (b.names.length ? ` (${b.names.join(', ')})` : '')).join('; '))
  return lines.join('\n')
}
