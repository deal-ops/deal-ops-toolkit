// Guided tour card (R-X-01, docs/en/05_GUIDED_TOUR.md v0.2). Non-modal, keyboard-first; no overlay, no inline styles.
import { useEffect, useId, useRef, useState } from 'react'
import { CHAPTERS, STEPS, firstStepOf, type Chapter, type Ctx, type TryNext } from '../tour/script'
import { byTour } from '../tour/anchor'

export function TourCard({
  index,
  ctx,
  demo,
  doneForYou,
  onBack,
  onNext,
  onDoIt,
  onFix,
  onDemo,
  onJump,
  onExit,
}: {
  index: number
  ctx: Ctx
  demo: boolean
  doneForYou: boolean
  onBack: () => void
  onNext: () => void
  onDoIt: () => void
  onFix: () => void
  onDemo: () => void
  onJump: (c: Chapter) => void
  onExit: () => void
}) {
  const step = STEPS[index]
  const action = step.action
  const done = action ? action.done(ctx) : true
  const wrong = action && !done ? (action.wrong?.(ctx) ?? null) : null
  const last = index === STEPS.length - 1
  const primary = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [top, setTop] = useState(false)
  const bodyId = useId()
  const titleId = useId()
  const targets = step.targets(ctx, demo)

  // keep focus on the main button, so pressing Enter walks the whole tour (§1)
  const isWrong = Boolean(wrong)
  useEffect(() => {
    primary.current?.focus({ preventScroll: true })
  }, [index, done, isWrong, demo])

  // highlight the targets and describe them by the card; re-applied after every render, since rows can be re-created
  const targetKey = targets.join('|')
  useEffect(() => {
    const els = findTargets(targetKey)
    for (const e of els) {
      e.classList.add('tour-target')
      e.setAttribute('aria-describedby', bodyId)
    }
    return () => {
      for (const e of els) {
        e.classList.remove('tour-target')
        e.removeAttribute('aria-describedby')
      }
    }
  })

  // bring the first target into view when the step changes, then put the card where it does not cover it.
  // The scroll is immediate so the position is measured where the target really ends up.
  useEffect(() => {
    // anchor on the topmost target, so a step that points at several rows brings them in together
    const first = findTargets(targetKey).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
    const c = card.current?.getBoundingClientRect()
    if (!first || !c) return
    first.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' })
    // centring in the room left above the touring padding can push a tall target's start above the window (M4 self-test #3)
    const centred = first.getBoundingClientRect().top
    if (centred < 8) window.scrollBy(0, centred - 16)
    const t = first.getBoundingClientRect()
    const W = window.innerWidth
    const H = window.innerHeight
    const across = t.left < W - 16 && t.right > W - 16 - c.width
    const underBottom = across && t.bottom > H - 16 - c.height && t.top < H - 16
    const underTop = across && t.top < 16 + c.height && t.bottom > 16
    if (underBottom && underTop) {
      // neither corner is clear: lift the target into the space above the card (the page has spare room while touring)
      // a target taller than that space starts at the top of the window, so its beginning is never covered
      const lift = t.bottom - (H - 32 - c.height)
      window.scrollBy(0, t.top - lift >= 8 ? lift : t.top - 16)
      setTop(false)
    } else setTop(underBottom)
  }, [targetKey, index])

  // Esc closes; arrows move, except while typing in a field (§4)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
      if (e.key === 'Escape') onExit()
      else if (!typing && e.key === 'ArrowLeft' && index > 0) onBack()
      else if (!typing && e.key === 'ArrowRight' && done) onNext()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, done, onBack, onNext, onExit])

  const takeMeToIt = () => {
    const el = byTour(targets[0])
    const focusable = el?.matches('button, input, select, a') ? el : el?.querySelector<HTMLElement>('button:not(:disabled), input, select, a')
    focusable?.focus()
  }

  return (
    <aside
      ref={card}
      className={`tour-card${top ? ' pos-top' : ''}${collapsed ? ' collapsed' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="tour-card"
    >
      <div className="tour-head">
        <nav className="tour-progress" aria-label="Tour chapters">
          {CHAPTERS.map((ch) => {
            const from = firstStepOf(ch)
            const to = from + STEPS.filter((s) => s.chapter === ch).length
            return (
              <button
                key={ch}
                type="button"
                className={step.chapter === ch ? 'seg current' : index >= to ? 'seg done' : 'seg'}
                aria-label={`Jump to ${ch} (steps ${from + 1}–${to})`}
                aria-current={step.chapter === ch ? 'step' : undefined}
                onClick={() => onJump(ch)}
              >
                {ch}
              </button>
            )
          })}
        </nav>
        <button type="button" className="link tour-collapse" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? `Step ${index + 1}/${STEPS.length} · Show` : 'Hide'}
        </button>
      </div>
      <p className="tour-count" id={titleId}>
        Step {index + 1} of {STEPS.length}
        {step.tab !== 'rec' && <span className="tour-where"> · Now in: {step.tab === 'alloc' ? '2. Allocation' : '3. Exit distribution'}</span>}
      </p>
      <div className="tour-body" id={bodyId} aria-live="polite">
        <p>{step.text(ctx, demo)}</p>
        {action && !done && !wrong && <p className="tour-ask">{action.ask}</p>}
        {wrong && <p className="tour-wrong">{wrong}</p>}
        {action && done && (
          <p className="tour-result">
            {action.result(ctx)}
            {doneForYou ? ' Done for you — in a real deal, this is your decision.' : ' Done ✓'}
          </p>
        )}
      </div>
      <div className="tour-actions">
        <button type="button" onClick={onBack} disabled={index === 0}>
          Back
        </button>
        {step.id === 'scale-back' && !demo && (
          <button type="button" onClick={onDemo}>
            Try a £80,000 cap
          </button>
        )}
        {wrong ? (
          <button type="button" className="primary" ref={primary} onClick={onFix}>
            Fix it for me
          </button>
        ) : !done ? (
          <button type="button" className="primary" ref={primary} onClick={onDoIt}>
            Do this for me
          </button>
        ) : (
          <button type="button" className="primary" ref={primary} onClick={onNext}>
            {last ? 'Finish' : 'Next'}
          </button>
        )}
        <button type="button" className="link" onClick={takeMeToIt}>
          Take me to it
        </button>
        <button type="button" className="link" onClick={onExit}>
          Exit tour
        </button>
      </div>
    </aside>
  )
}

function findTargets(key: string): HTMLElement[] {
  return key
    .split('|')
    .map((t) => byTour(t))
    .filter((e): e is HTMLElement => e !== null)
}

/** The cards before and after the steps, and the one shown when a resumed tour no longer matches the data. */
export function TourNote({
  kind,
  step,
  replaces,
  onStart,
  onCancel,
  onReplay,
  onClearOwn,
  tryNext = [],
  onTakeMeTo,
  top = false,
}: {
  /** the end card sits at the top while its "Take me to it" target would be under it (guide v0.3 §3.2) */
  top?: boolean
  kind: 'start' | 'end' | 'stale' | 'jump'
  step?: number
  replaces?: boolean
  onStart: () => void
  onCancel: () => void
  onReplay?: () => void
  onClearOwn?: () => void
  /** end card (guide v0.3 §3.2): what to try next on the sample */
  tryNext?: TryNext[]
  onTakeMeTo?: (t: TryNext) => void
}) {
  const primary = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useEffect(() => primary.current?.focus({ preventScroll: true }), [kind])
  return (
    <aside className={top ? 'tour-card pos-top' : 'tour-card'} role="dialog" aria-modal="false" aria-labelledby={titleId} data-testid={`tour-${kind}`}>
      {kind === 'start' && (
        <>
          <p className="tour-count" id={titleId}>
            Guided tour
          </p>
          <p>Walk through a fictional seed round: you&apos;ll book receipts, close the round and split an exit. About 3 minutes — leave any time with Esc.</p>
          {replaces && <p className="tour-wrong">This replaces the deal currently on this page. It is stored only in this browser.</p>}
          <div className="tour-actions">
            <button type="button" className="primary" ref={primary} onClick={onStart}>
              Start
            </button>
            <button type="button" onClick={onCancel}>
              Not now
            </button>
          </div>
        </>
      )}
      {kind === 'stale' && (
        <>
          <p className="tour-count" id={titleId}>
            Resume tour
          </p>
          <p>The data has changed since you left. Restart the tour from step {(step ?? 0) + 1}? This reloads the fictional sample.</p>
          {replaces && <p className="tour-wrong">This replaces the deal currently on this page. It is stored only in this browser.</p>}
          <div className="tour-actions">
            <button type="button" className="primary" ref={primary} onClick={onStart}>
              Restart from step {(step ?? 0) + 1}
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
      {kind === 'jump' && (
        <>
          <p className="tour-count" id={titleId}>
            Jump to step {(step ?? 0) + 1}
          </p>
          <p>You have changed the sample since the tour reached this point. Jumping replays the fictional sample to step {(step ?? 0) + 1}.</p>
          {replaces && <p className="tour-wrong">This replaces the deal currently on this page. It is stored only in this browser.</p>}
          <div className="tour-actions">
            <button type="button" className="primary" ref={primary} onClick={onStart}>
              Replace and jump
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
      {kind === 'end' && (
        <>
          <p className="tour-count" id={titleId}>
            That&apos;s the whole flow
          </p>
          <p>
            Receipts → closing → exit. Each investor&apos;s exit share follows the amount invested, fees excluded. Tiered carry is under the carry type switch.
          </p>
          <p>Every decision you just made is in the Activity log.</p>
          {tryNext.length > 0 && (
            <>
              <p className="tour-subhead">Try next</p>
              <ul className="try-next">
                {tryNext.map((t) => (
                  <li key={t.target}>
                    {t.text}{' '}
                    <button type="button" className="link" onClick={() => onTakeMeTo?.(t)}>
                      Take me to it
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>To try your own deal, clear the sample and import your investor list and bank statement.</p>
          <p className="hint">Your deal data never left this browser.</p>
          <div className="tour-actions">
            <button type="button" className="primary" ref={primary} onClick={onCancel}>
              Keep exploring the sample
            </button>
            <button type="button" onClick={onClearOwn}>
              Clear and start my own deal
            </button>
            <button type="button" className="link" onClick={onReplay}>
              Replay tour
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
