// Import messages tied to the version of the list they describe (G3 acceptance).
import { useState } from 'react'

/**
 * An import message that belongs to one version of its list. `listKey` is the list's replacement counter; a successful
 * replace bumps it by one, so the message is set for the next version. Once anything else replaces the list (the sample,
 * a hand-off, a restore), the message no longer describes what is on screen and is not shown (G3 acceptance).
 */
export function useListMessage<T>(listKey: number) {
  const [msg, setMsg] = useState<{ value: T; list: number } | null>(null)
  const current = msg !== null && msg.list === listKey ? msg.value : null
  const set = (value: T, replacesList: boolean) => setMsg({ value, list: listKey + (replacesList ? 1 : 0) })
  return [current, set] as const
}
