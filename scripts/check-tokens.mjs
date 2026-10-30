// src/tokens.css is shared word for word with Deal Ops Inbox, a second component in design. Its design rules, which record this hash,
// are not yet published. Change the rules first, then both copies and this hash. The website (site/) does not use it.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const want = '3d53459029a0b910eff5962cb7dc89eb7ac84775f9fde534b67736e93424de6a'
const have = createHash('sha256').update(readFileSync('src/tokens.css')).digest('hex')
if (want !== have) {
  console.error(
    `src/tokens.css differs from the shared design variables (Deal Ops Inbox design rules)\n  recorded ${want}\n  file     ${have}\nChange the rules first, then both copies.`,
  )
  process.exit(1)
}
console.log('tokens.css matches the shared design variables')
