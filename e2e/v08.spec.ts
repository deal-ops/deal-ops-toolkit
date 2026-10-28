// PRD v0.8 (Test Plan E2E-08, 〔M5〕): messages are copied, never sent; the activity log shows what was done.
import { expect, test, type Request } from '@playwright/test'
import { reviewSample, row, start, watchConsole } from './helpers'

test('E2E-08 copy a chase message, undo t03 and copy the query, see both in the activity log; copying makes no request', async ({ page, context }) => {
  const problems = watchConsole(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await start(page)
  await reviewSample(page)
  const requests: Request[] = []
  context.on('request', (r) => requests.push(r))

  await page.getByRole('button', { name: 'Copy message for David Kim' }).click()
  await expect(page.getByText('Copied. Send it yourself from your usual email.')).toBeVisible()
  const chase = await page.evaluate(() => navigator.clipboard.readText())
  expect(chase).toContain(
    'Hi David Kim,\n\nFor Northwind Robotics — Seed SPV (fictional sample), we have received £2,000.00 GBP of the £2,500.00 GBP due from you',
  )
  expect(chase).toContain('showing its UETR, and send it to us so we can trace the payment.')

  await page.getByRole('button', { name: 'Undo decision on t03' }).click()
  await page.getByRole('button', { name: 'Copy query for Chloe Martin about t03' }).click()
  const query = await page.evaluate(() => navigator.clipboard.readText())
  expect(query).toContain('we received a payment of £20,000.00 GBP on 7 October 2026 that we could not match to an investor automatically.')
  for (const other of ['CHLOE MARTIN', 't03']) expect(query).not.toContain(other)

  await page.getByRole('tab', { name: 'Activity log' }).click()
  const log = page.getByRole('table', { name: 'Activity log' })
  const events = await log.locator('tbody tr td:nth-child(4)').allTextContents()
  expect(events.slice(0, 3)).toEqual(['message_copied', 'undo', 'message_copied'])
  expect(events.at(-1)).toBe('sample_loaded')

  // copying sent nothing: no request at all after the review
  expect(requests).toEqual([])
  expect(await page.locator('a[href^="mailto:"]').count()).toBe(1) // only the feedback link in the footer
  expect(problems).toEqual([])
})

test('E2E-09 withdraw Lucas, move the platform fee to the company at a £970 minimum, see the adjustment, then reverse it', async ({ page }) => {
  const problems = watchConsole(page)
  await start(page)
  await reviewSample(page)
  const status = (id: string) => page.locator(`[data-status="${id}"]`)

  await page.getByRole('button', { name: 'Mark Lucas Meyer withdrawn' }).click()
  await page.getByLabel('Written consent from the investor received').check()
  await page.getByRole('button', { name: 'Confirm withdrawal' }).click()
  await expect(status('c12')).toContainText('Withdrawn')
  await expect(page.getByTestId('withdrawn-summary')).toHaveText('Withdrawn: 1 investor, £3,000.00 to refund')

  await page.getByRole('tab', { name: 'Deal settings' }).click()
  const minimum = page.getByRole('textbox', { name: 'Minimum commitment', exact: true })
  await minimum.fill('970')
  await minimum.blur()
  await page.getByRole('tab', { name: /Reconciliation/ }).click()
  await page.getByRole('button', { name: 'Hand off to allocation' }).click()
  await expect(row(page, 'Lucas Meyer')).toHaveCount(0)
  await expect(page.getByTestId('excess')).toContainText('Lucas Meyer: £3,000.00 (withdrawn before closing)')

  const panel = page.getByRole('region', { name: /Change who pays a fee/ })
  await expect(panel.getByRole('button', { name: /^Apply:/ })).toHaveText('Apply: 0 top-ups totalling £0.00 · 11 refunds totalling £3,630.00')
  await panel.getByLabel('Consent evidence received').check()
  await panel.getByRole('button', { name: /^Apply:/ }).click()
  await expect(page.getByTestId('stale')).toBeVisible()

  await page.getByRole('tab', { name: /Reconciliation/ }).click()
  await expect(page.getByTestId('fee-change-banner')).toContainText('Fee payer change active: Platform fee → company · consent recorded')
  await expect(status('c01')).toContainText('£9,700.00was £10,000.00 · −£300.00 fee payer change (Platform fee: investors → company)')
  await expect(status('c01')).toContainText('Overpaid')
  await expect(status('c04')).toContainText('£2,425.00')

  await page.getByTestId('fee-change-banner').getByRole('button', { name: 'Reverse' }).click()
  await expect(page.getByTestId('fee-change-banner')).toHaveCount(0)
  await expect(status('c01')).toContainText('Paid in full')
  await expect(status('c01')).not.toContainText('was £10,000.00')
  await page.getByRole('tab', { name: /Allocation/ }).click()
  await expect(page.getByLabel('Fee 1 paid by')).toHaveValue('investors')
  expect(problems).toEqual([])
})

test('E2E-09 375px: the manual-copy box and the withdraw form open wholly in view, at once', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 })
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }))
  await start(page)
  const inView = async (name: string, el: ReturnType<typeof page.getByRole>) => {
    const b = (await el.boundingBox())!
    expect([name, b.x >= 0, b.x + b.width <= 375, b.y >= 0, b.y + b.height <= 740]).toEqual([name, true, true, true, true])
  }

  await page.getByRole('button', { name: 'Copy message for David Kim' }).click()
  const box = page.getByRole('textbox', { name: 'David Kim: text to copy' })
  await expect(box).toBeFocused()
  await inView('manual-copy box', box)

  await page.getByRole('button', { name: 'Mark Lucas Meyer withdrawn' }).click()
  const consent = page.getByLabel('Written consent from the investor received')
  await expect(consent).toBeFocused()
  // no smooth scroll to wait for: the whole form, its consent box and its buttons are on screen at once (Codex 375px #1)
  await inView('withdraw form', page.getByRole('group', { name: 'Withdraw Lucas Meyer' }))
  await inView('consent box', consent)
  await inView('confirm button', page.getByRole('button', { name: 'Confirm withdrawal' }))
})
