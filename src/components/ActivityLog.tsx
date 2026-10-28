// PRD R-X-08: the activity log, newest first, read-only, with a CSV export.
import { useState, type Dispatch } from 'react'
import { activityCsv, LOG_NOTE, logAmount, truncatedDetail, type ActivityLog as Log } from '../lib/activity'
import type { Action } from '../state'
import { download } from './download'

/** Entries shown at first; "Show more" adds this many again, so 5,000 rows are never drawn at once (Tech Design §9.7). */
const PAGE = 200

export function ActivityLog({ log, dispatch, currency }: { log: Log; dispatch: Dispatch<Action>; currency: string }) {
  const [shown, setShown] = useState(PAGE)
  const newest = [...log.entries].reverse()
  const visible = newest.slice(0, shown)
  const exportCsv = () => {
    download(`activity_log_${currency}.csv`, activityCsv(log))
    dispatch({ type: 'logExported' })
  }
  return (
    <section className="panel" aria-labelledby="log-h">
      <p className="eyebrow">Record</p>
      <h2 id="log-h">Activity log</h2>
      <p className="hint">{LOG_NOTE}</p>
      <div className="row-actions">
        <button type="button" onClick={exportCsv} disabled={log.entries.length === 0 && !log.truncated}>
          Export activity log CSV
        </button>
      </div>
      {log.entries.length === 0 && !log.truncated ? (
        <div className="empty-state">
          <p className="empty-title">Nothing recorded yet</p>
          <p className="hint">Decisions you make appear here.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid read" aria-label="Activity log">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Time</th>
                <th>By</th>
                <th>Event</th>
                <th>Investor</th>
                <th>Transaction</th>
                <th className="num">Amount</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {/* C-X-1: the removed entries are one line shown first, whatever page of the log is open */}
              {log.truncated && (
                <tr>
                  <td className="num">—</td>
                  <td />
                  <td />
                  <td className="mono">truncated</td>
                  <td />
                  <td />
                  <td />
                  <td>{truncatedDetail(log.truncated)}</td>
                </tr>
              )}
              {visible.map((e) => (
                <tr key={e.seq}>
                  <td className="num">{e.seq}</td>
                  <td className="nowrap mono">{e.time}</td>
                  <td>{e.initials}</td>
                  <td className="mono">{e.event}</td>
                  <td className="nowrap">{e.investorName}</td>
                  <td className="mono">{e.transactionId}</td>
                  <td className="num">{e.amount === null ? '' : `${logAmount(e.amount)} ${e.currency}`}</td>
                  <td>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown < newest.length && (
        <button type="button" onClick={() => setShown(shown + PAGE)}>
          Show more ({newest.length - shown} older)
        </button>
      )}
    </section>
  )
}
