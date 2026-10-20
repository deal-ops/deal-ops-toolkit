// Rules D4 / Test Plan §1: every test-plan case due at the current milestone must have run and passed.
// Reads the Vitest JSON report; never searches source text.
import { readFileSync } from 'node:fs'

const order = ['M1', 'M2', 'M3', 'M4']
const current = readFileSync('docs/milestone.txt', 'utf8').trim()
if (!order.includes(current)) {
  console.log(`invalid milestone "${current}" in docs/milestone.txt (expected one of ${order.join(', ')})`)
  process.exit(1)
}
const plan = readFileSync('docs/04_TEST_PLAN.md', 'utf8')
const report = JSON.parse(readFileSync(process.argv[2] ?? 'test-report.json', 'utf8'))

const due = []
for (const line of plan.split('\n')) {
  const m = /^\| (TC-[A-Z]+-\d+)( 〔(M\d)〕)? \|/.exec(line)
  if (!m) continue
  if (line.includes('v0.7 删除')) continue
  const ms = m[3] ?? 'M1'
  if (order.indexOf(ms) <= order.indexOf(current)) due.push(m[1])
}

if (due.length === 0) {
  console.log('no cases are due — the test plan could not be read')
  process.exit(1)
}

// Every test whose title starts with the id must have passed; skipped or pending counts as not passed.
const results = new Map()
for (const file of report.testResults) for (const t of file.assertionResults) {
  const id = /^(TC-[A-Z]+-\d+)\b/.exec(t.title)?.[1]
  if (!id) continue
  results.set(id, [...(results.get(id) ?? []), t.status])
}

const missing = due.filter((id) => !results.has(id))
const failed = due.filter((id) => results.has(id) && results.get(id).some((s) => s !== 'passed'))
console.log(`milestone ${current}: ${due.length} cases due, ${due.length - missing.length - failed.length} passed`)
if (missing.length) console.log(`NOT RUN: ${missing.join(', ')}`)
if (failed.length) console.log(`FAILED: ${failed.join(', ')}`)
process.exit(missing.length || failed.length ? 1 : 0)
