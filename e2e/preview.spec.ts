import { expect, test } from '@playwright/test'

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8787'

const banner = (page: import('@playwright/test').Page) => page.getByText('Portfolio preview — read-only sample data.')

test('dashboard KPIs render from the API and the read-only banner shows', async ({ page, request }) => {
  const res = await request.get(`${API}/api/v1/demo/dashboard/summary`)
  expect(res.ok()).toBe(true)
  const { totals } = (await res.json()) as { totals: Record<'leads' | 'qualified' | 'highPriority' | 'needsReview', number> }
  await page.goto('/preview/dashboard')
  await expect(banner(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  const kpis: [string, number][] = [['Total leads', totals.leads], ['Qualified', totals.qualified], ['High priority', totals.highPriority], ['Needs review', totals.needsReview]]
  for (const [label, value] of kpis) {
    const card = page.getByText(label, { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
    await expect(card).toContainText(String(value))
  }
})

test('leads list: search, filter, pagination and opening a lead', async ({ page }) => {
  await page.goto('/preview/leads')
  await expect(page.getByText(/^1–25 of \d+$/)).toBeVisible()

  await page.getByRole('button', { name: /next/i }).last().click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByText(/^26–\d+ of \d+$/)).toBeVisible()

  await page.getByLabel('Search leads').fill('Ivy')
  await expect(page).toHaveURL(/q=Ivy/)
  await expect(page.getByRole('row').filter({ hasText: 'Ivy Stubworth' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Xena Mockford' })).toHaveCount(0)

  await page.goto('/preview/leads')
  await page.getByLabel('Filter by qualification status').click()
  await page.getByRole('option', { name: 'Failed' }).click()
  await expect(page).toHaveURL(/qualificationStatus=failed/)
  const rows = page.locator('tbody tr')
  await expect(page.getByText(/^1–\d+ of \d+$/)).not.toHaveText(/of 28$/)
  await expect.poll(async () => {
    const texts = await rows.allInnerTexts()
    return texts.length > 0 && texts.every((t) => t.includes('Failed'))
  }).toBe(true)

  await rows.first().getByRole('link').first().click()
  await expect(page).toHaveURL(/\/preview\/leads\/[0-9a-f-]{36}/)
  await expect(page.getByText('Inquiry message', { exact: true })).toBeVisible()
})

test('lead detail shows the AI qualification card with disclaimer and history', async ({ page }) => {
  await page.goto('/preview/leads?q=Ivy')
  await page.getByRole('link', { name: 'Ivy Stubworth' }).click()
  await expect(page.getByText('AI qualification', { exact: true })).toBeVisible()
  await expect(page.getByText(/AI-generated estimate/)).toBeVisible()
  await expect(page.getByText('Recommended next step')).toBeVisible()
  await expect(page.getByText('Qualification history')).toBeVisible()
  await expect(page.getByText('Every AI run and manual override, newest first')).toBeVisible()
})

test('mutation buttons are disabled in preview and explain why', async ({ page }) => {
  await page.goto('/preview/leads?q=Ivy')
  await page.getByRole('link', { name: 'Ivy Stubworth' }).click()
  const run = page.getByRole('button', { name: 'Run AI qualification' })
  await expect(run).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Edit' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Add note' })).toBeDisabled()
  await run.locator('xpath=ancestor::*[@data-slot="read-only-guard"][1]').hover()
  await expect(page.getByRole('tooltip').or(page.locator('[data-slot="tooltip-content"]')).first()).toContainText(/Sign in to/)

  await page.goto('/preview/leads')
  await expect(page.getByRole('button', { name: 'New lead' })).toBeDisabled()
})

test('workflows: execution sheet shows steps', async ({ page }) => {
  await page.goto('/preview/workflows')
  await page.getByRole('row', { name: /^Open execution:/ }).first().click()
  await expect(page).toHaveURL(/execution=/)
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Steps' })).toBeVisible()
  await expect(sheet.locator('li').first()).toBeVisible()
})

test('analytics range switch updates the URL', async ({ page }) => {
  await page.goto('/preview/analytics')
  await page.getByRole('radio', { name: '7 days' }).click()
  await expect(page).toHaveURL(/days=7/)
  await expect(page.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: '30 days' }).click()
  await expect(page).not.toHaveURL(/days=/)
})

test('integrations page and API expose no secrets', async ({ page, request }) => {
  const res = await request.get(`${API}/api/v1/demo/integrations`)
  expect(res.ok()).toBe(true)
  const json = await res.text()
  await page.goto('/preview/integrations')
  await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()
  const text = await page.locator('main').innerText()
  for (const s of [json, text]) {
    expect(s).not.toMatch(/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/\w+/)
    expect(s).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/)
    expect(s).not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}\./)
  }
})

for (const path of ['/login', '/register', '/forgot-password']) {
  test(`${path} explains sign-in is unavailable without Supabase`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByText('Sign-in is unavailable in this deployment')).toBeVisible()
  })
}

test('unknown route shows the 404 page', async ({ page }) => {
  await page.goto('/definitely-not-a-page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('sidebar opens as a sheet', async ({ page }) => {
    await page.goto('/preview/dashboard')
    await expect(page.getByRole('link', { name: 'Analytics' })).toBeHidden()
    await page.getByRole('button', { name: 'Toggle Sidebar' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('link', { name: 'Analytics' }).click()
    await expect(page).toHaveURL(/\/preview\/analytics/)
  })
})
