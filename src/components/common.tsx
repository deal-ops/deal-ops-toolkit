// Small building blocks shared by the modules. No money maths here (Rules D1): only display.
import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { PendingContext } from './pending'
import type { Check, InputError } from '../lib/outcome'
import { GLOSSARY, type Term as TermName } from '../glossary'

/** Typing pause after which a cell commits on its own (Tech Design §5: 300 ms debounce). */
export const COMMIT_DELAY_MS = 300

/**
 * A text input that commits 300 ms after typing stops, and at once on blur or Enter. While the text on screen
 * differs from the stored value the cell reports itself pending, and the modules mark their figures as updating
 * and disable copy, export and hand-off (Codex M2 #4).
 * `holdBlank` keeps a blank value as a draft until blur, for fields where blank means "generate one".
 */
export function Cell({
  value,
  onCommit,
  label,
  className,
  placeholder,
  holdBlank,
}: {
  value: string
  onCommit: (v: string) => void
  label: string
  className?: string
  placeholder?: string
  holdBlank?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [shown, setShown] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (shown !== value) {
    // the stored value changed elsewhere (import, reset): show it
    setShown(value)
    setDraft(value)
  }
  // a pending commit belongs to the value it was typed over: if that value is replaced (import, hand-off),
  // the commit is dropped rather than written into whatever now sits in this row (Codex M2 #7)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    },
    [value],
  )
  const report = useContext(PendingContext)
  const cellId = useId()
  const pending = draft !== value
  useEffect(() => report(cellId, pending), [report, cellId, pending])
  useEffect(() => () => report(cellId, false), [report, cellId])
  const commit = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (v !== value) onCommit(v)
  }
  return (
    <input
      className={className ?? 'cell'}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value
        setDraft(v)
        if (timer.current) clearTimeout(timer.current)
        timer.current = holdBlank && v.trim() === '' ? null : setTimeout(() => commit(v), COMMIT_DELAY_MS)
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(draft)
        if (e.key === 'Escape') {
          if (timer.current) clearTimeout(timer.current)
          setDraft(value)
        }
      }}
    />
  )
}

/** R-X-05: a term with a one-line explanation on hover (title) or on tap (expand). */
export function Term({ term, children }: { term: TermName; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="term">
      <span className="term-word" title={GLOSSARY[term]}>
        {children ?? term}
      </span>
      <button type="button" className="term-q" aria-label={`What is ${term}?`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        ?
      </button>
      {open && (
        <span className="term-def" id={id} role="note">
          {GLOSSARY[term]}
        </span>
      )}
    </span>
  )
}

export function ErrorList({ errors, title }: { errors: InputError[]; title: string }) {
  if (!errors.length) return null
  return (
    <div className="errors" role="alert">
      <p className="errors-title">{title}</p>
      <ErrorItems errors={errors.slice(0, 50)} />
      {errors.length > 50 && (
        // every located error stays reachable (R-REC-02.4, Codex M2 #6)
        <details>
          <summary>Show the other {errors.length - 50} errors</summary>
          <ErrorItems errors={errors.slice(50)} />
        </details>
      )}
    </div>
  )
}

function ErrorItems({ errors }: { errors: InputError[] }) {
  return (
    <ul>
      {errors.map((e, i) => (
        <li key={i}>
          <strong>{e.where}:</strong> {e.message}
        </li>
      ))}
    </ul>
  )
}

const KIND_LABEL: Record<Check['kind'], string> = {
  invariant: 'Self-check',
  blocker: 'Blocker',
  review: 'Needs review',
  warning: 'Reminder',
}

/** PRD C-03. With input errors the checks cannot run, and say so. */
export function Checks({
  checks,
  unavailable,
  internal,
  pending,
  tour,
}: {
  checks: Check[]
  unavailable?: boolean
  internal?: boolean
  pending?: boolean
  /** guided-tour anchor */
  tour?: string
}) {
  return (
    <section className={pending ? 'checks pending' : 'checks'} aria-label="Checks" aria-busy={pending} data-tour={tour}>
      <h3>Checks</h3>
      {internal ? (
        <p className="check-status bad" data-testid="checks-status">
          Internal error: a self-check failed, so no figures are shown. Please report this (without real investor data).
        </p>
      ) : unavailable ? (
        <p className="check-status off" data-testid="checks-status">
          Unavailable — fix the input errors first.
        </p>
      ) : (
        <ul className="check-list">
          {checks.map((c) => (
            <li key={c.id} className={c.pass ? 'pass' : c.kind === 'warning' ? 'warn' : 'fail'}>
              <span className="check-mark" aria-hidden="true">
                {c.pass ? '✓' : c.kind === 'warning' ? '!' : '✕'}
              </span>
              <span className="check-kind">{KIND_LABEL[c.kind]}</span> {c.label}
              {!c.pass && c.detail ? <span className="check-detail"> — {c.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Paste CSV text or choose a file; either way the text goes through the same atomic importer. */
export function ImportBox({ title, help, onImport, extra }: { title: string; help: ReactNode; onImport: (text: string) => void; extra?: ReactNode }) {
  const [text, setText] = useState('')
  const id = useId()
  // a file read that finishes after this box is gone (e.g. "Clear all data") must not bring data back (Codex M2 #3)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  // the read finishes later: use the handler from the latest render, so the import works on the data as it is
  // then, not as it was when the file was chosen (Codex M2 round 4 #9)
  const latestImport = useRef(onImport)
  useEffect(() => {
    latestImport.current = onImport
  })
  return (
    <details className="import">
      <summary>{title}</summary>
      <div className="import-body">
        <p className="hint">{help}</p>
        {extra}
        <label htmlFor={id}>Paste CSV text (first line is the header)</label>
        <textarea id={id} rows={5} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="row-actions">
          <button type="button" onClick={() => onImport(text)} disabled={!text.trim()}>
            Import pasted text
          </button>
          <label className="file">
            Or choose a CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const content = await f.text()
                if (alive.current) latestImport.current(content)
              }}
            />
          </label>
        </div>
      </div>
    </details>
  )
}

export function Notice({ kind, children }: { kind: 'info' | 'ok' | 'bad' | 'warn'; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

/** Shown while a typed value has not been calculated yet (Codex M2 #4). */
export function UpdatingNotice() {
  return (
    <Notice kind="info">
      <span data-testid="updating">Updating after your edit — the figures below are from before it. Press Enter or leave the field to update now.</span>
    </Notice>
  )
}

/**
 * A list section that folds. It starts open while its list is empty, or with an import message showing; after that only the
 * person folds it, so adding the first row by hand or importing never hides what just happened (G3 M-11). `resetKey` is the
 * list's replacement counter: a whole new list (import, sample, hand-off) resets the folding without remounting anything, so
 * keyboard focus stays on the control that was used (Codex G3 #1).
 */
export function Section({ resetKey, startOpen, keepOpen, children }: { resetKey: number; startOpen: boolean; keepOpen: boolean; children: ReactNode }) {
  const [state, setState] = useState({ resetKey, open: startOpen || keepOpen })
  if (state.resetKey !== resetKey) setState({ resetKey, open: startOpen || keepOpen }) // adjust during render, no extra paint
  return (
    <details className="section" open={state.open} onToggle={(e) => setState({ resetKey, open: e.currentTarget.open })}>
      {children}
    </details>
  )
}
