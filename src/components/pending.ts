// Cells report an edit that is typed but not yet committed, so results can be marked as updating and the
// actions that would use them disabled until the value on screen is the value calculated (Codex M2 #4).
import { createContext } from 'react'

export const PendingContext = createContext<(cellId: string, pending: boolean) => void>(() => {})
