// Site handbook §5 (docs/en/SITE_HANDBOOK.md): records the website's clips and stills from the real app (sample deal), light and dark.
// Usage: npm run build && npx vite preview --port 4175, then `node scripts/site-media.mjs [baseURL]`. Frames come from Chrome's screencast at 2×.
// Needs ffmpeg on PATH. Writes site/media/{rec,alloc,exit}-{light,dark}-focus.{mp4,jpg} (the step cards' close-ups). H.264 only: every target browser plays it, and VP9 came out about 5× larger.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:4175'
const OUT = 'site/media'
// 1440 wide: the app's tables fit without scrolling sideways
const VIEW = { width: 1440, height: 860 }
// Captured at 2×, so text stays sharp when the clip is shown smaller than life: the window is twice the size and the app
// is zoomed ×2 (CSS zoom keeps the 1440 × 860 layout). Headless Chrome's video and screencast both capture CSS pixels,
// so a device-pixel ratio alone does not do it.
const DPR = 2
mkdirSync(OUT, { recursive: true })

const pause = (page, ms) => page.waitForTimeout(ms)

async function start(page) {
  await page.goto(BASE)
  await page.evaluate((z) => document.documentElement.style.setProperty('zoom', String(z)), DPR)
  await page.getByRole('button', { name: 'I understand', exact: true }).click()
  await page.getByRole('button', { name: 'Load sample deal' }).click()
}

async function reviewSample(page) {
  for (const name of ['Confirm Chloe Martin', 'Confirm Elena Rossi', 'Confirm Kavya Iyer']) await page.getByRole('button', { name }).click()
  await page.getByRole('button', { name: 'Mark t11 as not part of this deal' }).click()
  await page.getByRole('button', { name: 'Mark t14 as not part of this deal' }).click()
}

/** Scrolls so `locator` sits `offset` px below the top, either at once or eased over `ms`. */
async function scrollTo(page, locator, offset, ms = 0) {
  const box = await locator.boundingBox()
  const y = (await page.evaluate(() => scrollY)) + box.y - offset
  await page.evaluate(
    ([to, dur]) =>
      new Promise((done) => {
        const from = scrollY
        if (!dur) return done(scrollTo(0, to))
        const t0 = performance.now()
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur)
          scrollTo(0, from + (to - from) * (1 - Math.pow(1 - k, 3)))
          if (k < 1) requestAnimationFrame(step)
          else done()
        }
        requestAnimationFrame(step)
      }),
    [y, ms],
  )
}

// Each clip: set up the frame, then the recorded actions; timing is measured around `act`. `focus` is the close-up the
// step cards show (FOCUS logical px, from `dx` right of the main column's left edge and just above the `top` heading);
// every clip that plays by itself stays under 5 s (WCAG 2.2.2: the page has no pause control, owner 2026-10-29).
const FOCUS = { width: 640, height: 400 }
const CLIPS = {
  rec: {
    focus: { dx: 0, top: 'Summary' },
    async setup(page) {
      await start(page)
      await scrollTo(page, page.getByRole('heading', { name: 'Summary' }), 24)
    },
    async act(page) {
      await pause(page, 600)
      for (const name of ['Confirm Chloe Martin', 'Confirm Elena Rossi', 'Confirm Kavya Iyer']) {
        await page.getByRole('button', { name }).click()
        await pause(page, 1100)
      }
      await pause(page, 700)
    },
  },
  alloc: {
    focus: { dx: 0, top: 'Result' },
    async setup(page) {
      await start(page)
      await reviewSample(page)
      await page.getByRole('button', { name: 'Hand off to allocation' }).click()
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await scrollTo(page, page.getByRole('heading', { name: 'Result', exact: true }), 24)
    },
    async act(page) {
      await pause(page, 1200)
      await scrollTo(page, page.getByRole('heading', { name: 'Per investor' }), 24, 1600)
      await pause(page, 1600)
    },
  },
  exit: {
    focus: { dx: 542, top: 'Result' },
    async setup(page) {
      await start(page)
      await reviewSample(page)
      await page.getByRole('button', { name: 'Hand off to allocation' }).click()
      await page.getByRole('button', { name: 'Hand off to exit distribution' }).click()
      await page.getByLabel(/Exit proceeds/).fill('250000')
      await page.getByLabel(/Exit proceeds/).press('Enter')
      await scrollTo(page, page.getByRole('heading', { name: 'Exit', exact: true }), 24)
      await pause(page, 500)
    },
    async act(page) {
      await pause(page, 1000)
      const field = page.getByLabel(/Exit proceeds/)
      await field.selectText()
      await field.pressSequentially('390000', { delay: 90 })
      await field.press('Enter')
      await pause(page, 2300)
    },
  },
}

/** The app's main column, so the sidebar is cropped away, and the page colour for padding and fades. */
async function contentBox(page) {
  return page.evaluate(() => {
    const r = document.querySelector('main').getBoundingClientRect()
    const [red, green, blue] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number)
    const bg = '0x' + [red, green, blue].map((n) => n.toString(16).padStart(2, '0')).join('')
    return { x: Math.max(0, Math.round(r.left)), w: Math.round(Math.min(r.width, innerWidth - r.left)), bg }
  })
}

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

// Chrome's screencast gives frames at the real device-pixel density (Playwright's recordVideo does not upscale the page);
// frames arrive only when the page changes, so each is held until the next one (ffmpeg concat with durations).
async function capture(context, page, act) {
  const cdp = await context.newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: VIEW.width * DPR, maxHeight: VIEW.height * DPR, everyNthFrame: 1 })
  await page.waitForTimeout(300)
  const t0 = frames.length ? frames[0].t : Date.now() / 1000
  await act()
  const t1 = Date.now() / 1000
  await cdp.send('Page.stopScreencast')
  return { frames, t0, t1 }
}

const browser = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  for (const [name, clip] of Object.entries(CLIPS)) {
    const dir = mkdtempSync(join(tmpdir(), 'site-media-'))
    const context = await browser.newContext({ viewport: { width: VIEW.width * DPR, height: VIEW.height * DPR }, colorScheme: scheme })
    const page = await context.newPage()
    await clip.setup(page)
    const box = await contentBox(page)
    const head = await page.getByRole('heading', { name: clip.focus.top, exact: true }).boundingBox()
    const fy = Math.max(0, Math.round(head.y) - 16 * DPR)
    const { frames, t0, t1 } = await capture(context, page, () => clip.act(page))
    await context.close()
    const list = frames.map((f, i) => {
      const file = join(dir, `f${String(i).padStart(5, '0')}.jpg`)
      writeFileSync(file, Buffer.from(f.data, 'base64'))
      const next = i + 1 < frames.length ? frames[i + 1].t : t1
      return `file '${file}'\nduration ${Math.max(0.001, next - Math.max(f.t, t0)).toFixed(4)}`
    })
    // the concat demuxer needs the last file named again to honour its duration
    writeFileSync(join(dir, 'list.txt'), list.join('\n') + `\nfile '${join(dir, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'\n`)
    const len = t1 - t0
    const base = join(OUT, `${name}-${scheme}`)
    const fw = FOCUS.width * DPR
    const fh = FOCUS.height * DPR
    const fcrop = `crop=${fw}:${fh}:${box.x + clip.focus.dx * DPR}:${fy}`
    const last = join(dir, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)
    ff([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(dir, 'list.txt'),
      '-vf',
      `fps=30,${fcrop}`,
      '-t',
      len.toFixed(2),
      '-an',
      '-c:v',
      'libx264',
      '-crf',
      '27',
      '-preset',
      'slow',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      `${base}-focus.mp4`,
    ])
    ff(['-i', last, '-frames:v', '1', '-vf', fcrop, '-q:v', '3', `${base}-focus.jpg`])
    rmSync(dir, { recursive: true, force: true })
    console.log(`${base}: ${len.toFixed(2)}s, ${frames.length} frames`)
  }
}
await browser.close()
