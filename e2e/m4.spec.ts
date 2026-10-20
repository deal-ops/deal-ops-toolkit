// M4 visual refresh (the M4 visual plan (not published) v0.2): checks the self-test review found missing.
import { expect, test, type Locator } from '@playwright/test'
import { reviewSample, start, watchConsole } from './helpers'

/** WCAG contrast between an element's text colour and its own background colour (both must be opaque rgb). */
async function contrast(el: Locator) {
  return el.evaluate((node) => {
    const s = getComputedStyle(node)
    const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).map(Number)
    const [fr, fg, fb] = rgb(s.color)
    const [br, bg, bb, ba = 1] = rgb(s.backgroundColor)
    if (ba < 1) return 0 // a see-through button has no fill of its own
    const lum = (r: number, g: number, b: number) =>
      [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
    const [hi, lo] = [lum(fr, fg, fb), lum(br, bg, bb)].sort((a, b) => b - a)
    return (hi + 0.05) / (lo + 0.05)
  })
}

for (const scheme of ['light', 'dark'] as const) {
  test(`E2E-04 at 1280px in ${scheme} mode the "Clear everything" confirmation is a solid, readable button (M4 self-test #1)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await page.getByRole('button', { name: 'I understand', exact: true }).click()
    await page.getByRole('button', { name: 'Load sample deal' }).click()
    await page.getByRole('button', { name: 'Clear all data' }).click()
    const confirm = page.getByRole('button', { name: 'Clear everything' })
    await expect(confirm).toBeVisible()
    expect(await contrast(confirm)).toBeGreaterThanOrEqual(4.5)
    await confirm.click()
    await expect(page.getByTestId('deal-name')).toHaveText('New deal')
  })
}

test('E2E-04 at 1280px the "Clear all data" confirmation sits inside the sidebar, whole (UI polish, owner review)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await start(page)
  await page.getByRole('button', { name: 'Clear all data' }).click()
  const side = await page.locator('aside.side').boundingBox()
  for (const name of ['Clear everything', 'Cancel']) {
    const b = await page.getByRole('button', { name, exact: true }).boundingBox()
    expect(b!.x).toBeGreaterThanOrEqual(side!.x)
    expect(b!.x + b!.width).toBeLessThanOrEqual(side!.x + side!.width)
  }
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
})

test('E2E-01b a click on the hurdle explanation inside the "Fixed rate" label leaves Tiered chosen (UI polish self-test #4)', async ({ page }) => {
  await start(page)
  await page.getByRole('tab', { name: /Exit distribution/ }).click()
  await page.getByLabel(/Tiered/).check()
  await page.getByRole('button', { name: 'What is hurdle?' }).click()
  await page.getByRole('note').click()
  await expect(page.getByLabel(/Tiered/)).toBeChecked()
})

// print colours must win over the dark tokens whether dark comes from the device or the switch (UI polish self-test #1)
for (const [scheme, choice] of [
  ['dark', null],
  ['light', 'Dark'],
  ['dark', 'Dark'],
] as const) {
  test(`E2E-07 printing with a ${scheme} device${choice ? ` and ${choice} chosen` : ''} uses black text on white`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await start(page)
    if (choice) await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: choice }).click()
    await page.emulateMedia({ media: 'print', colorScheme: scheme })
    // the colours the body is actually drawn in (the build shortens #000000 to #000, so tokens are not compared as text)
    const drawn = await page.evaluate(() => {
      const s = getComputedStyle(document.body)
      return [s.color, s.backgroundColor]
    })
    expect(drawn).toEqual(['rgb(0, 0, 0)', 'rgb(255, 255, 255)'])
  })
}

test('E2E-03 the open-licensed fonts load from the site itself under the production CSP', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))
  expect(loaded).toContain('Inter Variable')
  expect(loaded).toContain('IBM Plex Mono')
  expect(problems).toEqual([])
})

for (const width of [1512, 1024]) {
  test(`E2E-01a at ${width}px every summary figure stays inside its card, up to £9,999,999.99 (M4 simulated acceptance)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await start(page)
    await reviewSample(page)
    await page.getByRole('button', { name: 'Hand off to allocation' }).click()
    const fits = await page.locator('[data-testid=alloc-totals] dd').evaluateAll((dds) => {
      const probe = dds[0].cloneNode() as HTMLElement
      dds[0].parentElement!.appendChild(probe)
      probe.textContent = '£9,999,999.99'
      const result = [...dds, probe].map((d) => d.scrollWidth <= d.clientWidth && d.clientHeight <= dds[0].clientHeight)
      probe.remove()
      return result
    })
    expect(fits).toEqual(fits.map(() => true))
  })
}
