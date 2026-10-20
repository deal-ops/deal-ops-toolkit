import { expect, type Page } from '@playwright/test'

/** Fail the test on any Content-Security-Policy violation or page error. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
  return problems
}

export async function start(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'I understand', exact: true }).click()
  await page.getByRole('button', { name: 'Load sample deal' }).click()
}

/** Test Plan §3: confirm the three suggestions, reject t11 and t14. */
export async function reviewSample(page: Page) {
  for (const name of ['Confirm Chloe Martin', 'Confirm Elena Rossi', 'Confirm Kavya Iyer']) await page.getByRole('button', { name }).click()
  await page.getByRole('button', { name: 'Mark t11 as not part of this deal' }).click()
  await page.getByRole('button', { name: 'Mark t14 as not part of this deal' }).click()
  await expect(page.getByText('Nothing to review.')).toBeVisible()
}

export const row = (page: Page, investor: string) => page.locator(`[data-investor="${investor}"]`)
