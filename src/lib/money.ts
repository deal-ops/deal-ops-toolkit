// Exact arithmetic and input parsing (PRD §5.0 I-01..I-06, §5.1 C-01/C-02).
// Money is integer minor units; rates are basis points; prices are micros (1e-6 of a unit);
// multiples and years are hundredths. Every intermediate product or quotient goes through BigInt.

export type Currency = 'GBP' | 'EUR' | 'USD'
export const CURRENCIES: Currency[] = ['GBP', 'EUR', 'USD']
export const SYMBOL: Record<Currency, string> = { GBP: '£', EUR: '€', USD: '$' }

export const MAX_MONEY = 100_000_000_000 // 1,000,000,000.00 in minor units (I-01)
export const MAX_PRICE_MICROS = 1_000_000_000_000 // 1,000,000 (I-03)
export const MICROS_PER_MINOR = 10_000

/** Trim ASCII whitespace only (PRD I-09): a non-breaking space is content, not padding. */
export const trimAscii = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }
const fail = (reason: string): Parsed<never> => ({ ok: false, reason })
const okv = <T>(value: T): Parsed<T> => ({ ok: true, value })

const DIGITS = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`

/** I-01. `allowNegative` only for fields the field table lets go negative (bank amounts). */
export function parseMoney(raw: string, currency: Currency, allowNegative = false): Parsed<number> {
  const s = trimAscii(raw)
  if (s === '') return fail('required')
  const m = new RegExp(String.raw`^(-)?([£€$])?(-)?(${DIGITS})(?:\.(\d{1,2}))?$`).exec(s)
  if (!m) return fail(`"${raw}" is not an amount (use 1234.56 or 1,234.56)`)
  const [, neg1, sym, neg2, int, frac] = m
  if (neg1 && neg2) return fail(`"${raw}" is not an amount`)
  if (sym && sym !== SYMBOL[currency]) return fail(`"${raw}" uses ${sym} but this deal is in ${currency}`)
  const negative = Boolean(neg1 || neg2)
  if (negative && !allowNegative) return fail('cannot be negative')
  const minor = Number(int.replace(/,/g, '')) * 100 + Number((frac ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(minor) || minor > MAX_MONEY) return fail('exceeds the 1,000,000,000 limit')
  return okv(negative ? -minor : minor)
}

/** I-02: 0–100, up to 2 decimals, optional %. Returns basis points. */
export function parsePercent(raw: string): Parsed<number> {
  const s = trimAscii(trimAscii(raw).replace(/%$/, ''))
  if (s === '') return fail('required')
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return fail(`"${raw}" is not a percentage between 0 and 100 with up to 2 decimals`)
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  if (bps > 10_000) return fail('cannot exceed 100%')
  return okv(bps)
}

/** I-03: > 0, up to 6 decimals, ≤ 1,000,000. Returns micros. */
export function parsePrice(raw: string, currency: Currency): Parsed<number> {
  const s = trimAscii(raw)
  if (s === '') return fail('required')
  const m = /^([£€$])?(\d+)(?:\.(\d{1,6}))?$/.exec(s)
  if (!m) return fail(`"${raw}" is not a share price (up to 6 decimals)`)
  if (m[1] && m[1] !== SYMBOL[currency]) return fail(`"${raw}" uses ${m[1]} but this deal is in ${currency}`)
  const micros = Number(m[2]) * 1_000_000 + Number((m[3] ?? '').padEnd(6, '0'))
  if (micros <= 0) return fail('must be greater than 0')
  if (micros > MAX_PRICE_MICROS) return fail('exceeds the 1,000,000 limit')
  return okv(micros)
}

/** I-04: YYYY-MM-DD or DD/MM/YYYY. Returns ISO yyyy-mm-dd. */
export function parseDate(raw: string): Parsed<string> {
  const s = trimAscii(raw)
  if (s === '') return fail('required')
  let y: number, mo: number, d: number
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else return fail(`"${raw}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)`)
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return fail(`"${raw}" is not a real date`)
  return okv(`${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
}

function parseHundredths(raw: string, what: string): Parsed<number> {
  const s = trimAscii(raw).replace(/x$/i, '')
  if (s === '') return fail('required')
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return fail(`"${raw}" is not a ${what} with up to 2 decimals`)
  return okv(Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')))
}

/** I-05: > 1, up to 2 decimals. Returns hundredths as BigInt (no upper limit, no precision loss). */
export function parseMultiple(raw: string): Parsed<bigint> {
  const s = trimAscii(raw).replace(/x$/i, '')
  if (s === '') return fail('required')
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return fail(`"${raw}" is not a multiple with up to 2 decimals`)
  const v = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'))
  return v <= 100n ? fail('must be greater than 1') : okv(v)
}

/** Strict ISO date check used at every engine entry (I-04). */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** I-06: 0–50, up to 2 decimals. Returns hundredths. */
export function parseYears(raw: string): Parsed<number> {
  const r = parseHundredths(raw, 'number of years')
  if (r.ok && r.value > 5_000) return fail('cannot exceed 50')
  return r
}

// ---------- exact arithmetic ----------

export type Rounding = 'floor' | 'ceil' | 'halfUp'

/** round(a × b ÷ d) for non-negative integers, exactly. */
export function mulDiv(a: number | bigint, b: number | bigint, d: number | bigint, mode: Rounding): bigint {
  const A = BigInt(a)
  const B = BigInt(b)
  const D = BigInt(d)
  if (D <= 0n) throw new Error('mulDiv: divisor must be positive')
  const n = A * B
  if (n < 0n) throw new Error('mulDiv: negative operands are not used in this codebase')
  const q = n / D
  const r = n % D
  if (mode === 'floor' || r === 0n) return q
  if (mode === 'ceil') return q + 1n
  return 2n * r >= D ? q + 1n : q
}

/** Number version that refuses to lose precision. */
export function toNum(x: bigint): number {
  const n = Number(x)
  if (!Number.isSafeInteger(n)) throw new Error('value outside safe integer range')
  return n
}

export const mulDivN = (a: number | bigint, b: number | bigint, d: number | bigint, mode: Rounding) =>
  toNum(mulDiv(a, b, d, mode))

/**
 * Largest-remainder split (C-02): parts are whole units, sum exactly to `total`;
 * equal remainders go to the earlier item.
 */
export function splitProRata(total: number, weights: (number | bigint)[]): number[] {
  const W = weights.map((w) => BigInt(w))
  const S = W.reduce((a, b) => a + b, 0n)
  if (total === 0 || S === 0n) return W.map(() => 0)
  const T = BigInt(total)
  const base = W.map((w) => (T * w) / S)
  const rem = W.map((w, i) => T * w - base[i] * S)
  let left = T - base.reduce((a, b) => a + b, 0n)
  const order = W.map((_, i) => i).sort((i, j) => (rem[i] === rem[j] ? i - j : rem[i] > rem[j] ? -1 : 1))
  for (const i of order) {
    if (left === 0n) break
    if (W[i] > 0n) {
      base[i] += 1n
      left -= 1n
    }
  }
  return base.map(toNum)
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
/** Sum that refuses to lose precision (review M1 #10). */
export const sumExact = (xs: number[]): number => toNum(xs.reduce((a, b) => a + BigInt(b), 0n))

// ---------- exact hurdle (C-DIS-3) ----------

/** floor(a^(1/k)) for a ≥ 0 by Newton's method on BigInt. */
export function nthRoot(a: bigint, k: number): bigint {
  if (a < 2n) return a
  const K = BigInt(k)
  let x = 1n << BigInt(Math.ceil(a.toString(2).length / k) + 1)
  for (;;) {
    const y = ((K - 1n) * x + a / x ** (K - 1n)) / K
    if (y >= x) break
    x = y
  }
  while (x ** K > a) x -= 1n
  while ((x + 1n) ** K <= a) x += 1n
  return x
}

const ROOT_SCALE = 10n ** 60n

/**
 * P = C × ((1 + h)^n − 1), rounded half-up to a minor unit, without floating point.
 * Whole years are exact; a fractional part (hundredths of a year) uses a 100th root
 * at 60 decimal digits, far below anything that could move a half-penny decision.
 */
export function hurdleAmount(capital: number, hBps: number, years100: number): bigint {
  const C = BigInt(capital)
  const base = 10_000n + BigInt(hBps)
  const whole = BigInt(Math.floor(years100 / 100))
  const frac = years100 % 100
  // (1 + h)^whole = base^whole / 10000^whole
  let num = base ** whole
  let den = 10_000n ** whole
  if (frac > 0) {
    // (1 + h)^(frac/100) ≈ R / ROOT_SCALE, R = floor(100th root of base^frac × S^100 / 10000^frac)
    const R = nthRoot((base ** BigInt(frac) * ROOT_SCALE ** 100n) / 10_000n ** BigInt(frac), 100)
    num *= R
    den *= ROOT_SCALE
  }
  const n = C * (num - den)
  const q = n / den
  const r = n % den
  return 2n * r >= den ? q + 1n : q
}

// ---------- formatting ----------

export function formatMoney(minor: number, currency: Currency): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${SYMBOL[currency]}${Math.floor(abs / 100).toLocaleString('en-GB')}.${String(abs % 100).padStart(2, '0')}`
}

/** Plain decimal for CSV export: 1234.56 */
export function plainMoney(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** micro-shares → "4018.726436" (already truncated by construction) */
export function formatMicroShares(micro: bigint | number): string {
  const m = BigInt(micro)
  return `${m / 1_000_000n}.${String(m % 1_000_000n).padStart(6, '0')}`
}

export const formatPercent = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`

export function formatPrice(micros: number, currency: Currency): string {
  const frac = String(micros % 1_000_000).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')
  return `${SYMBOL[currency]}${Math.floor(micros / 1_000_000).toLocaleString('en-GB')}.${frac}`
}
