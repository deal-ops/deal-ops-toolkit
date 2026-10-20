// Field-table rules (PRD §5.0) shared by every engine entry and every CSV import (review M1 #7, #8).
import { isIsoDate, MAX_MONEY } from './money'
import type { InputError } from './outcome'

export const MAX_INVESTORS = 500
export const MAX_BANK_LINES = 2_000
export const MAX_HOLDINGS = 500
export const MAX_FEES = 20
export const LIMITS = { investorId: 40, name: 120, txnId: 80, freeText: 200 }

export class Errors {
  list: InputError[] = []
  add(where: string, message: string) {
    this.list.push({ where, message })
  }
  text(v: string, where: string, max: number, required: boolean) {
    if (typeof v !== 'string') return this.add(where, 'must be text')
    if (required && v.trim() === '') return this.add(where, 'required')
    if (v.length > max) this.add(where, `at most ${max} characters`)
  }
  email(v: string, where: string) {
    if (v && !/^[^\s@]+@[^\s@]+$/.test(v)) this.add(where, 'not an email address')
  }
  /** integer minor units within [min, MAX_MONEY]; negatives only when min < 0 */
  money(v: number, where: string, min: number, max = MAX_MONEY) {
    if (!Number.isSafeInteger(v) || v < min || v > max) this.add(where, `must be a whole number of minor units between ${min} and ${max}`)
  }
  date(v: string, where: string) {
    if (!isIsoDate(v)) this.add(where, 'not a real date (YYYY-MM-DD)')
  }
  count(n: number, max: number, what: string) {
    if (n > max) this.add(what, `at most ${max} ${what}`)
  }
  uniqueIds(ids: string[], what: string) {
    const seen = new Map<string, number>()
    ids.forEach((id, i) => {
      if (seen.has(id)) this.add(`${what} row ${i + 1}`, `duplicate id "${id}" (also row ${seen.get(id)! + 1})`)
      else seen.set(id, i)
    })
  }
}
