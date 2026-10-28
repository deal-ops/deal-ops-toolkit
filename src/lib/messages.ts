// Messages to investors (PRD R-REC-10, C-REC-8): fixed English templates, copied by a person and sent by them.
// Plain text: names are inserted as they are, never escaped; nothing here is sent or put in a URL (R-X-02).
import { formatMoney, type Currency } from './money'
import type { CommitmentResult } from './reconcile'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** `£1,250.00 GBP`, `US$500.00 USD` (C-REC-8: I-01 display format plus the ISO code). */
export const amountWithCode = (minor: number, currency: Currency) => `${formatMoney(minor, currency)} ${currency}`

/** `2026-10-14` → `14 October 2026`; integer parts only, so the result does not depend on time zone or browser language. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

const MT103 =
  'If you have already sent this payment, please ask your bank for the MT103 (or equivalent) for the transfer, showing its UETR, and send it to us so we can trace the payment.'

/** Template A, for an investor who is short or has not paid. `{cash due}` is the effective cash due (C-ALL-11); `{outstanding}` = it − received. */
export function chaseMessage(dealName: string, currency: Currency, r: CommitmentResult): string {
  const c = r.commitment
  const a = (x: number) => amountWithCode(x, currency)
  const first =
    r.received === 0
      ? `For ${dealName}, we have not yet received the ${a(r.due)} due from you.`
      : `For ${dealName}, we have received ${a(r.received)} of the ${a(r.due)} due from you, so ${a(r.due - r.received)} is still outstanding.`
  return [`Hi ${c.name},`, `${first} Please pay it using the payment reference ${c.reference} exactly as written.`, MT103, 'Thank you.'].join('\n\n')
}

/**
 * Template B, asking a candidate whether an unmatched receipt is theirs. It takes only the amount and the date, so the
 * payer, the bank reference and the transaction ID — possibly someone else's details — cannot reach the text (R-REC-10.2).
 */
export function queryMessage(dealName: string, currency: Currency, investorName: string, payment: { amount: number; date: string }): string {
  return [
    `Hi ${investorName},`,
    `For ${dealName}, we received a payment of ${amountWithCode(payment.amount, currency)} on ${longDate(payment.date)} that we could not match to an investor automatically. If you sent it, please reply with the name on the account it came from and the payment reference you used. If you did not send it, there is nothing you need to do.`,
    'Thank you.',
  ].join('\n\n')
}
