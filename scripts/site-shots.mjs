// Site handbook §8 (docs/en/SITE_HANDBOOK.md): screenshots of the site at desktop (light, dark), phone and reduced-motion, plus console/CSP errors.
// Usage: node scripts/site-preview.mjs & then node scripts/site-shots.mjs <out-dir>
import { chromium } from '@playwright/test'
const out = process.argv[2]
const b = await chromium.launch()
const errs = []
async function run(name, opts, steps) {
  const p = await b.newPage(opts)
  p.on('console', (m) => m.type() === 'error' && errs.push(name + ': ' + m.text()))
  p.on('pageerror', (e) => errs.push(name + ': ' + e.message))
  await p.goto('http://localhost:4180/')
  await p.waitForTimeout(2200)
  for (const [label, fn] of steps) {
    await fn(p)
    await p.waitForTimeout(900)
    await p.screenshot({ path: `${out}/${name}-${label}.png` })
  }
  const m = await p.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    w: innerWidth,
    playing: [...document.querySelectorAll('video')].map((v) => !v.paused),
  }))
  console.log(name, JSON.stringify(m))
  await p.close()
}
const deckAt = (k) => async (p) =>
  p.evaluate((k) => {
    const d = document.querySelector('[data-deck]')
    const top = d.getBoundingClientRect().top + scrollY
    scrollTo(0, top + (d.offsetHeight - innerHeight) * k)
  }, k)
const desk = [
  ['hero', async () => {}],
  ['show', async (p) => p.evaluate(() => document.querySelector('[data-scene]').scrollIntoView({ block: 'center' }))],
  ['deck0', deckAt(0)],
  ['deck15', deckAt(0.15)],
  ['deck25', deckAt(0.25)],
  ['deck35', deckAt(0.35)],
  ['deck50', deckAt(0.5)],
  ['deck100', deckAt(1)],
  ['footer', async (p) => p.evaluate(() => scrollTo(0, document.body.scrollHeight))],
]
await run('light', { viewport: { width: 1440, height: 900 }, colorScheme: 'light' }, desk)
await run('short', { viewport: { width: 1261, height: 657 }, colorScheme: 'light' }, desk.slice(2, 7))
await run('dark', { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }, desk.slice(0, 4))
await run('phone', { viewport: { width: 375, height: 812 }, colorScheme: 'light', deviceScaleFactor: 2, isMobile: true, hasTouch: true }, [
  ['hero', async () => {}],
  ['show', async (p) => p.evaluate(() => document.querySelector('[data-scene]').scrollIntoView({ block: 'center' }))],
  ['steps', async (p) => p.evaluate(() => document.getElementById('step-1').scrollIntoView())],
])
await run('reduced', { viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' }, [
  ['deck', async (p) => p.evaluate(() => document.getElementById('step-1').scrollIntoView())],
])
console.log('errors', JSON.stringify(errs))
await b.close()
