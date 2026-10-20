// Test Plan §4 E2E-05 (guided tour, docs/en/05_GUIDED_TOUR.md v0.2) and E2E-07 (375px, P1).
import { expect, test, type Page } from '@playwright/test'
import { reviewSample, start, watchConsole } from './helpers'

const card = (page: Page) => page.getByTestId('tour-card')

/**
 * Every highlighted target exists and is visible; the first one starts inside the viewport and its start
 * (the top 40px, or all of it if shorter) is not covered by the card.
 */
async function checkTargets(page: Page, step: number) {
  const targets = page.locator('.tour-target')
  expect(await targets.count(), `step ${step}: highlighted targets`).toBeGreaterThan(0)
  for (const t of await targets.all()) await expect(t, `step ${step}: target visible`).toBeVisible()
  const t = await targets.first().boundingBox()
  const c = await card(page).boundingBox()
  const vp = page.viewportSize()!
  expect(t && c, `step ${step}: boxes`).toBeTruthy()
  expect(t!.y, `step ${step}: target starts in the viewport`).toBeGreaterThanOrEqual(0)
  expect(t!.y + Math.min(40, t!.height), `step ${step}: target starts in the viewport`).toBeLessThanOrEqual(vp.height)
  const h = Math.min(40, t!.height)
  const overlap = t!.x < c!.x + c!.width && t!.x + t!.width > c!.x && t!.y < c!.y + c!.height && t!.y + h > c!.y
  expect(overlap, `step ${step}: target not under the card`).toBe(false)
}

async function walkTour(page: Page) {
  const problems = watchConsole(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'I understand — take the 3-minute tour' }).click()
  for (let i = 1; i <= 12; i++) {
    await expect(card(page)).toContainText(`Step ${i} of 12`)
    await checkTargets(page, i)
    // an action step: Enter does it for me, then the result shows and Enter moves on
    const doIt = card(page).getByRole('button', { name: 'Do this for me' })
    if (await doIt.isVisible()) {
      await expect(doIt).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(card(page)).toContainText('Done for you — in a real deal, this is your decision.')
      await checkTargets(page, i) // the completed step still points at something real
    }
    await expect(card(page).getByRole('button', { name: i === 12 ? 'Finish' : 'Next' })).toBeFocused()
    await page.keyboard.press('Enter')
  }
  await expect(page.getByTestId('tour-end')).toBeVisible()
  await expect(page.getByTestId('exit-totals')).toContainText('£57,021.00')
  await expect(page.getByTestId('exit-totals')).toContainText('£328,479.00')
  expect(problems).toEqual([])
}

test('E2E-05 guided tour: pressing Enter walks all 12 steps; every target is there; the exit matches Test Plan §3', async ({ page }) => {
  await walkTour(page)
})

// the sidebar layout starts at 1024px; a short window leaves the least room above the card (M4 self-test #3)
test.describe('1024×640', () => {
  test.use({ viewport: { width: 1024, height: 640 } })
  test('E2E-05 at 1024×640 with the sidebar every step starts in view and clear of the card', async ({ page }) => {
    await walkTour(page)
  })
})

test('E2E-05 step 10 demo cap is put back; Esc keeps the data and Resume returns to the same step; chapter jump replays', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'I understand — take the 3-minute tour' }).click()
  await card(page).getByRole('button', { name: 'Jump to Allocation (steps 8–11)' }).click()
  await expect(card(page)).toContainText('Step 8 of 12')
  await expect(page.getByTestId('alloc-totals')).toContainText('£100,395.00')
  await card(page).getByRole('button', { name: 'Next' }).click()
  await card(page).getByRole('button', { name: 'Next' }).click()
  await expect(card(page)).toContainText('Step 10 of 12')
  await card(page).getByRole('button', { name: 'Try a £80,000 cap' }).click()
  await expect(page.getByTestId('blockers')).toContainText('Isla Campbell')
  await expect(card(page)).toContainText('Next puts the cap back to £150,000.00')
  await card(page).getByRole('button', { name: 'Next' }).click()
  await expect(page.getByLabel('Round cap')).toHaveValue('150000.00')
  await expect(page.getByTestId('alloc-totals')).toContainText('£100,395.00')

  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect(page.getByTestId('alloc-totals')).toContainText('£100,395.00')
  await page.reload()
  await page.getByRole('button', { name: 'Resume tour (step 11 of 12)' }).click()
  await expect(card(page)).toContainText('Step 11 of 12')

  await card(page).getByRole('button', { name: 'Jump to Exit (steps 12–12)' }).click()
  await expect(card(page)).toContainText('Step 12 of 12')
  await expect(page.getByTestId('exit-totals')).toContainText('£57,021.00')
})

test('E2E-05 a wrong decision during the tour is named and "Fix it for me" restores it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'I understand — take the 3-minute tour' }).click()
  await card(page).getByRole('button', { name: 'Next' }).click()
  await card(page).getByRole('button', { name: 'Do this for me' }).click()
  await card(page).getByRole('button', { name: 'Next' }).click()
  await expect(card(page)).toContainText('Step 3 of 12')
  await page.getByLabel('Assign t05 to an investor').first().selectOption({ label: 'Ben Okafor (NW-002)' })
  await expect(card(page)).toContainText('That booked £15,000.00 to Ben Okafor')
  await card(page).getByRole('button', { name: 'Fix it for me' }).click()
  await expect(card(page)).toContainText('Booked. Booked to investors is now £101,000.00.')
})

test.describe('375px', () => {
  test.use({ viewport: { width: 375, height: 760 } })

  test('E2E-05 at 375px the S/EIS target of step 9 is visible above the drawer', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'I understand — take the 3-minute tour' }).click()
    await card(page).getByRole('button', { name: 'Jump to Allocation (steps 8–11)' }).click()
    await card(page).getByRole('button', { name: 'Next' }).click()
    await expect(card(page)).toContainText('Step 9 of 12')
    await checkTargets(page, 9)
  })

  test('E2E-07 at 375px the open module tab is scrolled into the tab bar (G3 M-11)', async ({ page }) => {
    await start(page)
    await page.evaluate(() => window.scrollTo(0, 400))
    for (const name of [/Exit distribution/, /Allocation/, /Reconciliation/, 'Deal settings', /Exit distribution/]) {
      const tab = page.getByRole('tab', { name })
      await tab.evaluate((el: HTMLElement) => el.click()) // a plain click: Playwright's own click would scroll the bar for us
      const [t, bar] = await Promise.all([tab.boundingBox(), page.getByRole('tablist', { name: 'Modules' }).boundingBox()])
      expect(t!.x, `${name}: left edge inside the bar`).toBeGreaterThanOrEqual(bar!.x - 0.5)
      expect(t!.x + t!.width, `${name}: right edge inside the bar`).toBeLessThanOrEqual(bar!.x + bar!.width + 0.5)
      // only the bar moves: the page keeps its place, since the guided tour positions its card from the page scroll
      expect(await page.evaluate(() => window.scrollY), `${name}: page did not scroll`).toBe(400)
    }
  })

  test('E2E-05 at 375px every tour control is at least 44px tall, folded or not (05_GUIDED_TOUR.md §4; Codex M4 #1)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'I understand — take the 3-minute tour' }).click()
    await expect(card(page)).toContainText('Step 1 of 12')
    const heights = async () =>
      Promise.all((await card(page).getByRole('button').all()).map(async (b) => [await b.innerText(), (await b.boundingBox())?.height ?? 0] as const))
    for (const [name, h] of await heights()) expect(h, `${name}: height`).toBeGreaterThanOrEqual(43.5) // 44px, give or take sub-pixel rounding
    await card(page).getByRole('button', { name: 'Hide' }).click()
    const folded = card(page).getByRole('button', { name: /Show$/ })
    expect((await folded.boundingBox())!.height).toBeGreaterThanOrEqual(43.5)
  })

  test('E2E-07 at 375px the M-01 to M-07 operations work without horizontal page scroll (P1)', async ({ page }) => {
    const problems = watchConsole(page)
    await start(page)
    const noPageScroll = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await expect(page.getByTestId('rec-totals')).toContainText('£114,840.00') // M-01
    await noPageScroll()
    await reviewSample(page) // M-02
    await expect(page.getByTestId('rec-totals')).toContainText('£108,500.00')
    await expect(page.locator('.check-list li:not(.pass)')).toHaveCount(1)
    await expect(page.locator('.check-list li:not(.pass)')).toContainText('WESTBRIDGE SUPPLIES: not matched for 13 days')
    await page.getByRole('button', { name: 'Hand off to allocation' }).click() // M-03
    await expect(page.getByTestId('alloc-totals')).toContainText('£98,895.00')
    await expect(page.locator('[data-investor="Amelia Hart"]')).toContainText('4,018 shares / £9,698.24')
    await expect(page.locator('[data-investor="David Kim"]')).toContainText('£1,940.00')
    await expect(page.locator('[data-investor="Isla Campbell"]')).toContainText('£970.00')
    await expect(page.locator('.check-list li.fail')).toHaveCount(0)
    await noPageScroll()
    await page.getByLabel('Round cap').fill('80000') // M-04
    await page.getByLabel('Round cap').press('Enter')
    await expect(page.getByTestId('blockers')).toContainText('Isla Campbell')
    await page.getByLabel('Round cap').fill('150000')
    await page.getByLabel('Round cap').press('Enter')
    await page.getByRole('tab', { name: 'Deal settings' }).click() // M-05
    await expect(page.getByTestId('holding-structure')).toBeVisible()
    await page.getByRole('tab', { name: /Allocation/ }).click()
    await page.getByLabel('Share price').fill('abc') // M-06
    await page.getByLabel('Share price').press('Enter')
    await expect(page.getByTestId('checks-status')).toContainText('Unavailable')
    await page.getByLabel('Share price').fill('2.4137')
    await page.getByLabel('Share price').press('Enter')
    await page.getByRole('button', { name: 'Hand off to exit distribution' }).click() // M-07
    await expect(page.getByTestId('exit-totals')).toContainText('£57,021.00')
    await page.getByLabel(/Tiered/).check()
    await page.getByRole('button', { name: 'Add tier' }).click()
    await page.getByLabel('Tier 1 up to multiple').fill('3')
    await page.getByLabel('Tier 1 carry rate').fill('20')
    await page.getByLabel('Tier 2 carry rate').fill('30')
    await page.getByLabel('Tier 2 carry rate').press('Enter')
    const steps = page.getByRole('table', { name: 'Waterfall steps' })
    await expect(steps).toContainText('Profit from 1.00x to 3.00x')
    await expect(steps).toContainText('Profit above 3.00x')
    await expect(steps).toContainText('carry on the profit in this band only')
    await noPageScroll()
    expect(problems).toEqual([])
  })
})
