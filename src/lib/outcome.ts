// PRD C-03: five kinds of check, each with its own consequence.
//  input     → no result (errors list)
//  invariant → no result (an arithmetic self-check failed: implementation bug)
//  blocker   → result shown, export / transfer disabled
//  review    → result shown, transfer disabled
//  warning   → result shown, nothing disabled

export type CheckKind = 'invariant' | 'blocker' | 'review' | 'warning'

export interface Check {
  id: string
  kind: CheckKind
  pass: boolean
  label: string
  detail?: string
}

export interface InputError {
  /** e.g. "investors[3].received" or "row 5, amount" */
  where: string
  message: string
}

export type Outcome<T> =
  | { ok: true; result: T; checks: Check[] }
  | { ok: false; errors: InputError[]; internal?: Check[] }

/** Wrap a finished calculation: any failing invariant turns the whole outcome into an internal error. */
export function finish<T>(result: T, checks: Check[]): Outcome<T> {
  const broken = checks.filter((c) => c.kind === 'invariant' && !c.pass)
  if (broken.length) {
    return {
      ok: false,
      errors: [{ where: 'internal', message: 'A self-check failed. Please report this; no figures are shown.' }],
      internal: broken,
    }
  }
  return { ok: true, result, checks }
}

export const blocked = (checks: Check[]) => checks.some((c) => c.kind === 'blocker' && !c.pass)
export const needsReview = (checks: Check[]) => checks.some((c) => c.kind === 'review' && !c.pass)
