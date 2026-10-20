// Test Plan §4, M3 end-to-end cases.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { reviewSample, start, watchConsole } from './helpers'

async function toExit(page: Page) {
  await start(page)
  await reviewSample(page)
  await page.getByRole('button', { name: 'Hand off to allocation' }).click()
  await expect(page.getByTestId('alloc-totals')).toContainText('£100,395.00')
  await page.getByRole('button', { name: 'Hand off to exit distribution' }).click()
}

const step = (page: Page, label: string) => page.getByRole('table', { name: 'Waterfall steps' }).locator('tr', { hasText: label })

test('E2E-01b sample → allocation → hand off to exit → exit figures match Test Plan §3', async ({ page }) => {
  const problems = watchConsole(page)
  await toExit(page)
  await expect(page.getByText(/^Holdings \(11\)$/)).toBeVisible() // James had no money and is not a holder
  const totals = page.getByTestId('exit-totals')
  await expect(totals).toContainText('£100,395.00') // amount invested
  await expect(totals).toContainText('£57,021.00') // carry
  await expect(totals).toContainText('£328,479.00') // to investors
  await expect(totals).toContainText('£4,500.00') // exit costs
  await expect(step(page, 'Return of capital')).toContainText('£100,395.00')
  await expect(step(page, 'Preferred return (hurdle)')).toContainText('£58,919.25')
  await expect(step(page, 'Lead catch-up')).toContainText('£14,729.81')
  await expect(step(page, 'Carried interest split')).toContainText('£42,291.19')
  // share price saved with the snapshot (C-DIS-7)
  await expect(page.getByTestId('exit-price')).toContainText('£2.4137')
  await expect(page.locator('[data-holder="Amelia Hart"]')).toContainText('4018.726436')
  await expect(page.locator('.check-list li.fail')).toHaveCount(0)
  // TC-DIS-15 through the interface: file names carry the currency; contents match the screen
  const save = async (name: string) => {
    const dl = page.waitForEvent('download')
    await page.getByRole('button', { name }).click()
    const d = await dl
    return { file: d.suggestedFilename(), text: readFileSync((await d.path())!, 'utf8') }
  }
  const dist = await save('Export distribution CSV')
  expect(dist.file).toBe('distribution_GBP.csv')
  const amelia = (await page.locator('[data-holder="Amelia Hart"]').innerText()).split('\t')
  expect(dist.text).toContain(`c01,Amelia Hart,9700.00,4018.726436,${amelia[3].replace(/[£,]/g, '')},`)
  await page.getByText(/^Holdings \(11\)$/).click()
  const hold = await save('Export holdings CSV')
  expect(hold.file).toBe('holdings_GBP.csv')
  expect(hold.text).toContain('c01,Amelia Hart,9700.00,4018.726436,2.4137')
  expect(problems).toEqual([])
})

test('E2E-02b a changed share price marks the exit out of date; handing off again replaces the holdings whole', async ({ page }) => {
  const problems = watchConsole(page)
  await toExit(page)
  await expect(page.getByTestId('exit-stale')).toHaveCount(0)
  // a downstream edit that a fresh hand-off must wipe out
  await page.getByText(/^Holdings \(11\)$/).click()
  await page.getByRole('button', { name: 'Add holding' }).click()
  await expect(page.getByText(/^Holdings \(12\)$/)).toBeVisible()

  await page.getByRole('tab', { name: /Allocation/ }).click()
  await page.getByLabel('Share price').fill('5')
  await page.getByLabel('Share price').press('Enter')
  await expect(page.getByRole('tab', { name: /Exit distribution/ })).toContainText('out of date')
  await page.getByRole('tab', { name: /Exit distribution/ }).click()
  await expect(page.getByTestId('exit-stale')).toBeVisible()
  // until handed off again, the snapshot keeps its own price (C-DIS-7, TC-DIS-26)
  await expect(page.getByTestId('exit-price')).toContainText('£2.4137')
  await page.getByRole('button', { name: /Hand off again/ }).click()
  await expect(page.getByTestId('exit-stale')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /Exit distribution/ })).not.toContainText('out of date')
  await expect(page.getByText(/^Holdings \(11\)$/)).toBeVisible()
  await expect(page.getByTestId('exit-price')).toContainText('£5.00')
  await expect(page.locator('[data-holder="Amelia Hart"]')).toContainText('1940.000000') // 9,700 ÷ 5
  expect(problems).toEqual([])
})

test('E2E-03 privacy through the tour and the exit: only static GETs, no bodies, no deal data in URLs', async ({ page, context }) => {
  const problems = watchConsole(page)
  const requests: string[] = []
  const bad: string[] = []
  context.on('request', (r) => {
    const url = new URL(r.url())
    if (url.protocol === 'blob:') return
    requests.push(r.url())
    if (
      r.method() !== 'GET' ||
      r.postData() !== null ||
      url.origin !== 'http://localhost:4174' ||
      !/^\/(|favicon\.svg|assets\/[\w.-]+\.(js|css|woff2))$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      bad.push(`${r.method()} ${r.url()}`)
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'I understand — take the 3-minute tour' }).click()
  for (let i = 1; i <= 12; i++) {
    const doIt = page.getByTestId('tour-card').getByRole('button', { name: 'Do this for me' })
    if (await doIt.isVisible()) await doIt.click()
    await page
      .getByTestId('tour-card')
      .getByRole('button', { name: i === 12 ? 'Finish' : 'Next' })
      .click()
  }
  for (const name of ['Export distribution CSV']) {
    const dl = page.waitForEvent('download')
    await page.getByRole('button', { name }).click()
    await dl
  }
  await page.reload()
  expect(requests.length).toBeGreaterThan(0)
  expect(bad).toEqual([])
  for (const u of requests) for (const secret of ['Amelia', 'NW-0', '390000', 'Northwind', 'tour']) expect(decodeURIComponent(u)).not.toContain(secret)
  expect(problems).toEqual([])
})

test('E2E-04 the exit survives a reload; Clear all data also removes the tour progress', async ({ page }) => {
  await toExit(page)
  await page.reload()
  await page.getByRole('tab', { name: /Exit distribution/ }).click()
  await expect(page.getByTestId('exit-totals')).toContainText('£57,021.00')
  await expect(page.getByTestId('exit-stale')).toHaveCount(0)
  await page.getByRole('button', { name: 'Take the tour' }).click()
  await page.getByTestId('tour-start').getByRole('button', { name: 'Start' }).click()
  await page.getByTestId('tour-card').getByRole('button', { name: 'Exit tour' }).click()
  expect(await page.evaluate(() => localStorage.getItem('deal-ops-toolkit:tour'))).not.toBeNull()
  await page.getByRole('button', { name: 'Clear all data' }).click()
  await page.getByRole('button', { name: 'Clear everything' }).click()
  expect(await page.evaluate(() => [localStorage.getItem('deal-ops-toolkit:v1'), localStorage.getItem('deal-ops-toolkit:tour')])).toEqual([null, null])
})
