import { expect, test } from '@playwright/test'

/**
 * Full CRUD against a real Supabase-backed deployment. Runs only when E2E_EMAIL and E2E_PASSWORD
 * are set (an account with at least the `admin` role in its active workspace, since deleting a
 * lead needs admin). The local stack has no Supabase Auth project, so this is skipped there.
 *
 *   E2E_BASE_URL=https://<your-pages-domain> E2E_EMAIL=... E2E_PASSWORD=... npx playwright test e2e/authenticated.spec.ts
 */
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

test.describe('authenticated lead lifecycle', () => {
  test.skip(!email || !password, 'E2E_EMAIL and E2E_PASSWORD are not set; this suite needs a real Supabase-backed deployment')

  test('sign in, create, edit, add a note and delete a lead', async ({ page }) => {
    const stamp = Date.now()
    const name = `E2E Lead ${stamp}`
    const leadEmail = `e2e-${stamp}@example.com`

    await page.goto('/login')
    await page.getByLabel('Email').fill(email!)
    await page.getByLabel('Password').fill(password!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    await page.goto('/leads')
    await page.getByRole('button', { name: 'New lead' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name *').fill(name)
    await form.getByLabel('Email *').fill(leadEmail)
    await form.getByLabel('Company *').fill('E2E Test Co')
    await form.getByLabel('Inquiry message *').fill('Automated end-to-end test lead. Safe to delete.')
    await form.getByRole('button', { name: /^(Create|Save)/ }).click()
    await expect(form).toBeHidden()

    await page.getByLabel('Search leads').fill(name)
    await page.getByRole('link', { name }).click()
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog')
    await edit.getByLabel('Job title').fill('Head of Testing')
    await edit.getByRole('button', { name: /^Save/ }).click()
    await expect(edit).toBeHidden()
    await expect(page.getByText(/Head of Testing/).first()).toBeVisible()

    const note = `E2E note ${stamp}`
    await page.getByLabel('New note').fill(note)
    await page.getByRole('button', { name: 'Add note' }).click()
    await expect(page.getByText(note)).toBeVisible()

    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete lead' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete lead' }).click()
    await expect(page).toHaveURL(/\/leads(\?.*)?$/)
    await page.getByLabel('Search leads').fill(name)
    await expect(page.getByRole('link', { name })).toHaveCount(0)
  })
})
