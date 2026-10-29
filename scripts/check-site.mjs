// Project website checks (docs/en/SITE_HANDBOOK.md §6, §8). Exits 1 on any failure.
// - CSP rules in the page: one external script (site.js), no inline script, no style attribute, no <style>
// - every local file the page or stylesheet refers to exists; every in-page anchor has a target
// - the privacy and disclaimer sentences match the app word for word (src/config.ts, R-X-02 / R-X-03)
// - the trust figures are in the release notes (rule P9)
// - site/site.js is the current build of site-src/site.js and is ≤ 6 KB gzip (handbook §6)
// - every clip is ≤ 5 s (WCAG 2.2.2: the page has no pause control); read from the MP4's mvhd box, no ffprobe needed
// - the headers file carries the expected CSP
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const SITE = 'site'
const problems = []
const fail = (msg) => problems.push(msg)
const html = readFileSync(join(SITE, 'index.html'), 'utf8')
const css = readFileSync(join(SITE, 'styles.css'), 'utf8')

// CSP rules in the markup
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
if (scripts.length !== 1 || !/\bsrc="site\.js"/.test(scripts[0][1]) || scripts[0][2].trim())
  fail('page must have exactly one <script src="site.js"></script> and no inline script')
if (/\sstyle\s*=/i.test(html)) fail('page has a style attribute')
if (/<style\b/i.test(html)) fail('page has a <style> element')
if (/\son[a-z]+\s*=/i.test(html)) fail('page has an inline event handler')

// local files and anchors
const local = [...html.matchAll(/\b(?:src|href|srcset)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|mailto:|#)/.test(u))
const fromCss = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1]).filter((u) => !/^(data:|#)/.test(u))
for (const f of new Set([...local, ...fromCss])) if (!existsSync(join(SITE, f))) fail(`missing file: ${f}`)
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))
for (const [, a] of html.matchAll(/href="#([^"]+)"/g)) if (!ids.has(a)) fail(`anchor #${a} has no target`)
for (const [, u] of html.matchAll(/href="(https?:[^"]+)"/g))
  if (!/^https:\/\/(deal-ops-toolkit\.vercel\.app|github\.com\/yuannh\/deal-ops-toolkit)(\/|$)/.test(u)) fail(`unexpected external link: ${u}`)

// app sentences, word for word
const config = readFileSync('src/config.ts', 'utf8')
const sentence = (name) => new RegExp(`${name}\\s*=\\s*\\n?\\s*'([^']+)'`).exec(config)?.[1]
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
for (const name of ['PRIVACY_TEXT', 'DISCLAIMER_TEXT']) {
  const s = sentence(name)
  if (!s) fail(`cannot read ${name} from src/config.ts`)
  else if (!text.includes(s)) fail(`page does not carry ${name} word for word`)
}
if (!text.includes('Not affiliated with any platform')) fail('"Not affiliated with any platform" missing')

// trust figures (P9): each must be backed by the release notes
const notes = readFileSync('docs/RELEASE_NOTES.md', 'utf8')
const figures = [
  ['1,800', /agree with it on 1,800 generated cases/],
  ['267 / 267', /267 of 267 deliberate code breakages caught/],
  ['199 / 199', /all 199 test-plan cases due/],
]
for (const [shown, backed] of figures) {
  if (!html.includes(`<dt>${shown}</dt>`)) fail(`trust figure ${shown} not on the page as expected`)
  if (!backed.test(notes)) fail(`trust figure ${shown} is not backed by docs/RELEASE_NOTES.md`)
}

// the served script is the current build, and small
const dir = mkdtempSync(join(tmpdir(), 'site-check-'))
try {
  execFileSync('npx', ['rolldown', 'site-src/site.js', '-f', 'iife', '-m', '-o', join(dir, 'site.js')], { stdio: 'pipe' })
  if (readFileSync(join(dir, 'site.js'), 'utf8') !== readFileSync(join(SITE, 'site.js'), 'utf8'))
    fail('site/site.js is not the current build of site-src/site.js (run npm run site:build)')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
const gz = gzipSync(readFileSync(join(SITE, 'site.js'))).length
if (gz > 6144) fail(`site/site.js is ${gz} bytes gzip, over 6 KB`)

// clips ≤ 5 s
function mp4Seconds(buf) {
  const i = buf.indexOf('mvhd')
  if (i < 0) return NaN
  const v = buf[i + 4]
  const scale = v === 1 ? buf.readUInt32BE(i + 24) : buf.readUInt32BE(i + 16)
  const dur = v === 1 ? Number(buf.readBigUInt64BE(i + 28)) : buf.readUInt32BE(i + 20)
  return dur / scale
}
const clips = readdirSync(join(SITE, 'media')).filter((f) => f.endsWith('.mp4'))
for (const f of clips) {
  const s = mp4Seconds(readFileSync(join(SITE, 'media', f)))
  if (!(s <= 5.05)) fail(`clip ${f} is ${s.toFixed(2)} s, over 5 s`)
}

// headers
const csp = JSON.parse(readFileSync(join(SITE, 'vercel.json'), 'utf8')).headers[0].headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "media-src 'self'", "frame-ancestors 'none'"])
  if (!csp.includes(d)) fail(`CSP lacks ${d}`)

if (problems.length) {
  console.error(`site check: ${problems.length} problem(s)\n- ` + problems.join('\n- '))
  process.exit(1)
}
console.log(`site check: OK (${local.length} local references, ${ids.size} ids, ${clips.length} clips ≤ 5 s, script ${gz} bytes gzip)`)
