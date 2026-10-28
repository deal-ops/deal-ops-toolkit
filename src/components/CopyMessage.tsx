// R-REC-10.3: a message is only copied; the person sends it. No mailto:, nothing in a URL (R-X-02).
import { useEffect, useRef, useState } from 'react'

export const COPIED_TEXT = 'Copied. Send it yourself from your usual email.'
export const COPY_FAILED_TEXT = 'Could not copy. Select the text and copy it yourself.'

/**
 * `onCopy()` is called at the click and returns the report for this copy: `report(false)` once the text is on the clipboard,
 * `report(true)` once it is shown selected because the clipboard was not available.
 */
export function CopyMessage({
  label,
  name,
  text,
  onCopy,
  tour,
}: {
  label: string
  /** accessible name, e.g. "Copy message for David Kim" */
  name: string
  text: () => string
  onCopy: () => (manual: boolean) => void
  tour?: string
}) {
  const [state, setState] = useState<{ kind: 'copied' } | { kind: 'manual'; text: string; report: (manual: boolean) => void } | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const reported = useRef<object | null>(null)
  useEffect(() => {
    // focused and selected, so the next keystroke copies it; the manual-copy entry is written for exactly the text that
    // was shown and selected, once (Codex M5 r4 #3)
    if (state?.kind === 'manual' && box.current && reported.current !== state) {
      // inside a wide table on a phone the box can start off-screen: bring the whole box into view first
      box.current.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      box.current.focus({ preventScroll: true })
      box.current.select()
      reported.current = state
      state.report(true)
    }
  }, [state])
  const copy = async () => {
    const t = text()
    // the report made at the click: it names the investor as copied, even if renamed before the copy finishes (Codex M5 r3 #2)
    const report = onCopy()
    setState(null) // emptied first, so copying again announces the message again
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(t)
      // the text is on the clipboard: logged even if the person has moved to another page meanwhile (Codex M5 r4 #2); the
      // caller drops it if the data was cleared or replaced since the click (Codex M5 r2 #1)
      report(false)
      setState({ kind: 'copied' })
    } catch {
      setState({ kind: 'manual', text: t, report })
    }
  }
  return (
    <span className="copy-message">
      <button type="button" className="link" aria-label={name} data-tour={tour} onClick={copy}>
        {label}
      </button>
      <span role="status" className="copy-status">
        {state?.kind === 'copied' && COPIED_TEXT}
        {state?.kind === 'manual' && COPY_FAILED_TEXT}
      </span>
      {state?.kind === 'manual' && <textarea ref={box} className="copy-box" readOnly value={state.text} aria-label={`${name}: text to copy`} rows={8} />}
    </span>
  )
}
