// PRD v0.8 R-X-08, C-X-1: the activity log engine (Test Plan §2.5, 〔M5〕).
import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import {
  activityCsv,
  appendEvents,
  dropOldest,
  emptyLog,
  localIsoTime,
  logAmount,
  logStatus,
  markExported,
  parseInitials,
  removedText,
  type ActivityLog,
  type NewEvent,
} from './activity'

const META = { time: '2026-10-23T14:05:09+01:00', initials: 'HY', currency: 'GBP' as const }
const many = (n: number): NewEvent[] => Array.from({ length: n }, () => ({ event: 'confirm' }))
const filled = (n: number) => appendEvents(emptyLog(), many(n), META)

describe('C-X-1 activity log', () => {
  it('TC-X-07 numbers entries from 1 without gaps; 80% warning from 4,000; past 5,000 the oldest go into truncated', () => {
    const l3 = filled(3)
    expect(l3.entries.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(l3.nextSeq).toBe(4)
    expect(logStatus(filled(3_999)).nearFull).toBe(false)
    expect(logStatus(filled(4_000)).nearFull).toBe(true)
    const full = filled(5_000)
    expect(full.entries.length).toBe(5_000)
    expect(full.truncated).toBeNull()
    // exported at 4,500, then one more past the cap: the removed entry had been exported
    let log = appendEvents(markExported(filled(4_500), META), many(500), META)
    expect(log.entries.length).toBe(5_000)
    expect(log.truncated).toEqual({ count: 1, fromSeq: 1, toSeq: 1, unexported: 0 }) // 4,500 + log_exported + 500 = 5,001
    expect(log.entries[0].seq).toBe(2)
    expect(logStatus(log).removedUnexported).toBe(0)
    // keep going until entries never exported are removed: the warning turns into the count
    log = appendEvents(log, many(4_600), META)
    expect(log.entries.length).toBe(5_000)
    expect(log.truncated!.count).toBe(4_601)
    expect(log.truncated!.unexported).toBe(101) // exported up to seq 4,500; seq 4,501 (the export itself) to 4,601 were not
    expect(removedText(logStatus(log).removedUnexported)).toBe('101 entries were removed before export.')
    // seq numbers are never reused
    const seqs = log.entries.map((e) => e.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(seqs[0]).toBe(log.truncated!.toSeq + 1)
    expect(log.nextSeq).toBe(seqs[seqs.length - 1] + 1)
  })

  it('TC-X-07 dropping merges into one truncated count; dropping nothing changes nothing', () => {
    const log = filled(10)
    expect(dropOldest(log, 0)).toBe(log)
    const twice = dropOldest(dropOldest(log, 3), 2)
    expect(twice.truncated).toEqual({ count: 5, fromSeq: 1, toSeq: 5, unexported: 5 })
    expect(twice.entries.map((e) => e.seq)).toEqual([6, 7, 8, 9, 10])
    expect(dropOldest(log, 99).entries).toEqual([])
  })

  it('TC-X-09 the CSV header, escaping, the truncated line first, amounts in display format', () => {
    let log: ActivityLog = appendEvents(
      emptyLog(),
      [
        { event: 'confirm', investorId: 'c03', investorName: '=HYPERLINK("x")', transactionId: 't03', amount: 2_000_000, detail: 'Needs review → Confirmed by you' },
        { event: 'fee_payer_changed', investorId: 'c01', investorName: 'Amelia Hart', amount: -30_000, detail: '+cmd' },
      ],
      META,
    )
    log = dropOldest(appendEvents(log, [{ event: 'undo' }], META), 1)
    const rows = Papa.parse<string[]>(activityCsv(log), { skipEmptyLines: true }).data
    expect(rows[0].join(',')).toBe('seq,time,initials,event,investor_id,investor_name,transaction_id,amount,detail,currency')
    expect(rows[1].slice(0, 4)).toEqual(['', '', '', 'truncated'])
    expect(rows[1][8]).toBe('1 earlier entry removed (seq 1–1); 1 not exported before removal')
    expect(rows[2]).toEqual(['2', META.time, 'HY', 'fee_payer_changed', 'c01', 'Amelia Hart', '', '-300.00', "'+cmd", 'GBP'])
    const csv = activityCsv(appendEvents(emptyLog(), [{ event: 'confirm', investorName: '=HYPERLINK("x")', amount: 2_000_000 }], META))
    const row = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data[1]
    expect(row[5]).toBe('\'=HYPERLINK("x")')
    expect(row[7]).toBe('20,000.00')
    expect(logAmount(125_000)).toBe('1,250.00')
    expect(logAmount(-3_093)).toBe('-30.93')
  })

  it('TC-X-09 an export records how far it went, then itself', () => {
    const log = markExported(filled(3), META)
    expect(log.lastExportedSeq).toBe(3)
    expect(log.entries[3]).toMatchObject({ seq: 4, event: 'log_exported', detail: 'exported up to seq 3' })
  })

  it('TC-X-05 local time in ISO 8601 with the offset, to the second', () => {
    const t = Date.UTC(2026, 9, 23, 13, 5, 9, 900)
    expect(localIsoTime(t, 60)).toBe('2026-10-23T14:05:09+01:00')
    expect(localIsoTime(t, 0)).toBe('2026-10-23T13:05:09+00:00')
    expect(localIsoTime(t, -300)).toBe('2026-10-23T08:05:09-05:00')
    expect(localIsoTime(t, 330)).toBe('2026-10-23T18:35:09+05:30')
    expect(localIsoTime(Date.UTC(2028, 1, 29, 23, 30, 0), 60)).toBe('2028-03-01T00:30:00+01:00')
    expect(localIsoTime(Date.UTC(2026, 11, 31, 23, 59, 59), 0)).toBe('2026-12-31T23:59:59+00:00')
    expect(localIsoTime(Date.UTC(2027, 0, 1, 0, 0, 0), -60)).toBe('2026-12-31T23:00:00-01:00')
  })

  it('TC-X-16 initials: up to 10 letters, digits, spaces, dots or hyphens', () => {
    expect(parseInitials('HY')).toBe('HY')
    expect(parseInitials('  H.Y-2  ')).toBe('H.Y-2')
    expect(parseInitials('')).toBe('')
    expect(parseInitials('ABCDEFGHIJ')).toBe('ABCDEFGHIJ')
    for (const bad of ['H@Y', 'ABCDEFGHIJK', 'Hé', '=1', 'H,Y']) expect(parseInitials(bad)).toBeNull()
  })
})
