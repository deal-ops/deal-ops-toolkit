// Test Plan §4: every end-to-end case due at the current milestone ran and passed.
// Untagged cases are due from M2, when Playwright was introduced. Reads the Playwright JSON report.
import { readFileSync } from 'node:fs'

const order = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']
const current = readFileSync('docs/milestone.txt', 'utf8').trim()
const plan = readFileSync('docs/04_TEST_PLAN.md', 'utf8')
const report = JSON.parse(readFileSync(process.argv[2] ?? 'e2e-report.json', 'utf8'))

const due = []
for (const line of plan.split('\n')) {
  const m = /^- (E2E-\d+[a-z]?)( 〔(M\d)〕)?/.exec(line)
  if (!m) continue
  if (order.indexOf(m[3] ?? 'M2') <= order.indexOf(current)) due.push(m[1])
}
if (order.indexOf(current) >= order.indexOf('M2') && due.length === 0) {
  console.log('no end-to-end cases are due — the test plan could not be read')
  process.exit(1)
}

const results = new Map()
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    const id = /^(E2E-\d+[a-z]?)\b/.exec(spec.title)?.[1]
    if (!id) continue
    for (const t of spec.tests) results.set(id, [...(results.get(id) ?? []), t.status])
  }
  for (const s of suite.suites ?? []) walk(s)
}
for (const s of report.suites) walk(s)

const missing = due.filter((id) => !results.has(id))
const failed = due.filter((id) => results.has(id) && results.get(id).some((s) => s !== 'expected'))
console.log(`milestone ${current}: ${due.length} end-to-end cases due, ${due.length - missing.length - failed.length} passed`)
if (missing.length) console.log(`NOT RUN: ${missing.join(', ')}`)
if (failed.length) console.log(`FAILED: ${failed.join(', ')}`)
process.exit(missing.length || failed.length ? 1 : 0)
