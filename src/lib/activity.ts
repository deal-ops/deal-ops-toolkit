// Activity log (PRD R-X-08, C-X-1): a local, append-only working record — not a regulatory ledger.
// Pure: the time comes in from the caller's clock; nothing here reads the system time.
import { formatMoney, trimAscii, type Currency } from './money'
import { toCsv } from './csv'
import type { LineStatus } from './reconcile'

export type LogEvent =
  | 'import'
  | 'confirm'
  | 'assign'
  | 'not_in_deal'
  | 'undo'
  | 'decision_voided'
  | 'withdrawn'
  | 'withdrawal_undone'
  | 'withdrawal_voided'
  | 'handoff_allocation'
  | 'handoff_exit'
  | 'fee_payer_changed'
  | 'fee_payer_change_reversed'
  | 'fee_payer_change_voided'
  | 'adjustment_voided'
  | 'log_exported'
  | 'message_copied'
  | 'sample_loaded'

export const LOG_EVENTS: readonly LogEvent[] = [
  'import',
  'confirm',
  'assign',
  'not_in_deal',
  'undo',
  'decision_voided',
  'withdrawn',
  'withdrawal_undone',
  'withdrawal_voided',
  'handoff_allocation',
  'handoff_exit',
  'fee_payer_changed',
  'fee_payer_change_reversed',
  'fee_payer_change_voided',
  'adjustment_voided',
  'log_exported',
  'message_copied',
  'sample_loaded',
]

export interface LogEntry {
  seq: number
  time: string
  initials: string
  event: LogEvent
  investorId: string
  investorName: string
  transactionId: string
  /** minor units; formatted only on export */
  amount: number | null
  /** the deal currency when the event happened; a later change of currency does not rewrite it (PRD §5.5) */
  currency: Currency
  detail: string
}

export interface Truncated {
  count: number
  fromSeq: number
  toSeq: number
  /** how many of the removed entries had never been exported */
  unexported: number
}

export interface ActivityLog {
  /** ascending seq; the page shows them newest first */
  entries: LogEntry[]
  /** starts at 1 and never goes back, even when entries are removed */
  nextSeq: number
  /** 0 = never exported */
  lastExportedSeq: number
  /** removed entries, merged into one count shown first; it has no seq and takes no place in the 5,000 */
  truncated: Truncated | null
}

export type NewEvent = Pick<LogEntry, 'event'> & Partial<Pick<LogEntry, 'investorId' | 'investorName' | 'transactionId' | 'amount' | 'detail'>>

/** How a bank line's status reads, on the page and in the log. */
export const LINE_STATUS_WORDS: Record<LineStatus, string> = {
  auto: 'Matched automatically',
  confirmed: 'Confirmed by you',
  suggested: 'Needs review',
  unmatched: 'Not matched',
  rejected: 'Not part of this deal',
  skipped: 'Skipped: not a receipt',
  future: 'After the as-of date: not counted',
}

export const LOG_CAP = 5_000
/** 80% of the cap: from here the page asks for an export (R-X-08.4) */
export const LOG_WARN_AT = 4_000

export const emptyLog = (): ActivityLog => ({ entries: [], nextSeq: 1, lastExportedSeq: 0, truncated: null })

/** Append events in order, numbering them; past the cap the oldest are removed. Never throws on valid input. */
export function appendEvents(log: ActivityLog, events: NewEvent[], meta: { time: string; initials: string; currency: Currency }): ActivityLog {
  // the numbering would leave the exactly representable range (only a crafted save gets near it): stop numbering rather
  // than repeat a number (C-X-1: seq is never reused; Codex M5 r3 #5, r4 #4)
  if (events.length === 0 || log.nextSeq + events.length >= Number.MAX_SAFE_INTEGER) return log
  let seq = log.nextSeq
  const added: LogEntry[] = events.map((e) => ({
    seq: seq++,
    time: meta.time,
    initials: meta.initials,
    event: e.event,
    investorId: e.investorId ?? '',
    investorName: e.investorName ?? '',
    transactionId: e.transactionId ?? '',
    amount: e.amount ?? null,
    currency: meta.currency,
    detail: e.detail ?? '',
  }))
  const next: ActivityLog = { ...log, entries: [...log.entries, ...added], nextSeq: seq }
  const over = next.entries.length - LOG_CAP
  return over > 0 ? dropOldest(next, over) : next
}

/** Remove the oldest `n` entries into the `truncated` count (over the cap, or when the browser's storage is full). */
export function dropOldest(log: ActivityLog, n: number): ActivityLog {
  const gone = log.entries.slice(0, Math.max(0, n))
  if (gone.length === 0) return log
  const t = log.truncated
  const unexported = gone.filter((e) => e.seq > log.lastExportedSeq).length
  return {
    ...log,
    entries: log.entries.slice(gone.length),
    truncated: {
      count: (t?.count ?? 0) + gone.length,
      fromSeq: t ? t.fromSeq : gone[0].seq,
      toSeq: gone[gone.length - 1].seq,
      unexported: (t?.unexported ?? 0) + unexported,
    },
  }
}

/** Mark everything up to now as exported, then record the export itself. */
export function markExported(log: ActivityLog, meta: { time: string; initials: string; currency: Currency }): ActivityLog {
  const last = log.entries.length ? log.entries[log.entries.length - 1].seq : 0
  return appendEvents({ ...log, lastExportedSeq: last }, [{ event: 'log_exported', detail: `exported up to seq ${last}` }], meta)
}

export function logStatus(log: ActivityLog): { count: number; nearFull: boolean; removedUnexported: number } {
  return { count: log.entries.length, nearFull: log.entries.length >= LOG_WARN_AT, removedUnexported: log.truncated?.unexported ?? 0 }
}

export const NEAR_FULL_TEXT = 'Activity log is 80% full. Export it now; after 5,000 entries the oldest are removed.'
export const removedText = (n: number) => `${n} ${n === 1 ? 'entry was' : 'entries were'} removed before export.`
export const LOG_NOTE =
  'Kept in this browser only. A working record, not a regulatory ledger. Anyone using this browser can clear it, and once it holds 5,000 entries the oldest are removed. Export the CSV to keep a full copy.'

/** What the truncated line says, in the page and in the CSV. */
export function truncatedDetail(t: Truncated): string {
  const exported = t.unexported === 0 ? 'all exported before removal' : `${t.unexported} not exported before removal`
  return `${t.count} earlier ${t.count === 1 ? 'entry' : 'entries'} removed (seq ${t.fromSeq}–${t.toSeq}); ${exported}`
}

/** I-01 display format without a currency symbol: `1,250.00`, `-30.93` (the currency is its own column). */
export function logAmount(minor: number): string {
  return formatMoney(minor, 'GBP').replace('£', '')
}

/** C-X-1 / §5.5: oldest first, the truncated line before everything else with an empty seq. */
export function activityCsv(log: ActivityLog): string {
  const header = ['seq', 'time', 'initials', 'event', 'investor_id', 'investor_name', 'transaction_id', 'amount', 'detail', 'currency']
  const rows: (string | number)[][] = []
  const t = log.truncated
  if (t) rows.push(['', '', '', 'truncated', '', '', '', '', truncatedDetail(t), log.entries[0]?.currency ?? ''])
  for (const e of log.entries)
    rows.push([String(e.seq), e.time, e.initials, e.event, e.investorId, e.investorName, e.transactionId, e.amount === null ? '' : logAmount(e.amount), e.detail, e.currency])
  return toCsv(header, rows, ['seq', 'amount'])
}

/** `2026-10-23T14:05:09+01:00`, from epoch milliseconds and the local offset in minutes (east of UTC positive). */
export function localIsoTime(epochMs: number, offsetMinutes: number): string {
  const totalSec = Math.floor(epochMs / 1000) + offsetMinutes * 60
  const days = Math.floor(totalSec / 86_400)
  const secOfDay = totalSec - days * 86_400
  const [y, m, d] = civilFromDays(days)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const sign = offsetMinutes < 0 ? '-' : '+'
  const off = Math.abs(offsetMinutes)
  return `${p(y, 4)}-${p(m)}-${p(d)}T${p(Math.floor(secOfDay / 3600))}:${p(Math.floor((secOfDay % 3600) / 60))}:${p(secOfDay % 60)}${sign}${p(Math.floor(off / 60))}:${p(off % 60)}`
}

/** Days since 1970-01-01 → [year, month, day] (H. Hinnant's civil_from_days, integers only). */
function civilFromDays(z: number): [number, number, number] {
  z += 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d]
}

/** Your initials (PRD field table): ≤ 10 characters of letters, digits, spaces, `.` and `-`; anything else is null. */
export function parseInitials(raw: string): string | null {
  const v = trimAscii(raw)
  return v.length <= 10 && /^[A-Za-z0-9 .-]*$/.test(v) ? v : null
}
