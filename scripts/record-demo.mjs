#!/usr/bin/env node
// Records a narrated walkthrough video of the RUNNING app (real Supabase auth, real API, live Gemini call).
// Prereqs: `npm run dev:api` and `npm run dev:web` running with keys configured (docs/DEPLOYMENT.md).
// Usage: node scripts/record-demo.mjs [--base http://localhost:5173] [--out path/to/video.webm]
// Output: docs/demo/leadpilot-demo.webm.
// Account: if scripts/.demo-credentials (git-ignored; lines DEMO_EMAIL=... and DEMO_PASSWORD=...) exists, the video
// signs in with that account; otherwise it registers a fresh one (requires "Confirm email" off in Supabase).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:5173'
const OUT_DIR = path.join(ROOT, 'docs', 'demo')
const TMP_DIR = path.join(OUT_DIR, '.raw')
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
const CREDS_FILE = path.join(ROOT, 'scripts', '.demo-credentials')
const creds = existsSync(CREDS_FILE)
  ? Object.fromEntries(
      readFileSync(CREDS_FILE, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    )
  : {}
const SIGN_IN = Boolean(creds.DEMO_EMAIL && creds.DEMO_PASSWORD)
const ACCOUNT = SIGN_IN
  ? { email: creds.DEMO_EMAIL, password: creds.DEMO_PASSWORD }
  : { name: 'Demo Presenter', email: `leadpilot.demo.${stamp}@example.com`, password: `Demo-${stamp}-pw!` }

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('__demo_caption')
    if (!el) {
      el = document.createElement('div')
      el.id = '__demo_caption'
      el.style.cssText =
        'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;max-width:80%;' +
        'background:rgba(17,24,39,.88);color:#fff;font:500 16px/1.4 system-ui,sans-serif;padding:10px 18px;' +
        'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none;text-align:center'
      document.body.appendChild(el)
    }
    el.textContent = t
  }, text)
}

async function scene(page, text, fn, hold = 2500) {
  try {
    await caption(page, text)
    await fn()
    await caption(page, text) // re-add after navigation
    await pause(hold)
  } catch (err) {
    console.warn(`scene "${text}" skipped: ${err.message.split('\n')[0]}`)
  }
}

async function go(page, route) {
  await page.goto(BASE + route)
  await page.waitForLoadState('networkidle').catch(() => {})
  await pause(800)
}

async function smoothScroll(page, px) {
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, px / 10)
    await pause(60)
  }
}

rmSync(TMP_DIR, { recursive: true, force: true })
mkdirSync(TMP_DIR, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: TMP_DIR, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()
page.setDefaultTimeout(20000)

await go(page, '/login')
await scene(page, 'LeadPilot AI: capture leads, qualify them with AI, and automate follow-up', async () => {}, 3500)

if (SIGN_IN) {
  await scene(page, 'Sign in with Supabase Auth; each user works in a private workspace', async () => {
    await page.getByLabel('Email').pressSequentially(ACCOUNT.email, { delay: 25 })
    await page.getByLabel('Password').fill(ACCOUNT.password)
    await pause(600)
    await page.locator('form button[type="submit"]').click()
    await page.waitForURL(/dashboard/, { timeout: 20000 })
  })
} else await scene(page, 'Create an account (Supabase Auth); each user gets a private workspace', async () => {
  await go(page, '/register')
  await page.getByLabel('Full name').pressSequentially(ACCOUNT.name, { delay: 40 })
  await page.getByLabel('Work email').pressSequentially(ACCOUNT.email, { delay: 25 })
  await page.getByLabel('Password', { exact: true }).fill(ACCOUNT.password)
  await page.getByLabel('Confirm password').fill(ACCOUNT.password)
  await pause(600)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL(/dashboard/, { timeout: 20000 })
})

if (!page.url().includes('/dashboard')) {
  console.error(
    SIGN_IN
      ? 'Sign-in did not reach the dashboard (check scripts/.demo-credentials and that the email is confirmed). Stopping.'
      : 'Sign-up did not reach the dashboard (is "Confirm email" still enabled in Supabase?). Stopping.',
  )
  await context.close()
  await browser.close()
  rmSync(TMP_DIR, { recursive: true, force: true })
  process.exit(1)
}

if (!SIGN_IN) await scene(page, 'A new workspace starts empty, with no invented numbers', async () => {}, 2500)

await scene(page, 'Load the synthetic sample dataset (every record is labeled "Sample")', async () => {
  await go(page, '/settings?tab=sample-data')
  await page.getByRole('button', { name: 'Load sample data' }).click()
  await page.getByText(/Loaded \d+ sample leads/).waitFor()
})

await scene(page, 'Dashboard: totals, conversion funnel, AI activity and workflow health from the database', async () => {
  await go(page, '/dashboard')
  await pause(1500)
  await smoothScroll(page, 600)
  await pause(1500)
  await smoothScroll(page, -600)
}, 2000)

await scene(page, 'CRM leads: search, filter, sort and paginate', async () => {
  await go(page, '/leads')
  await page.getByPlaceholder(/Search name, email/).first().pressSequentially('software', { delay: 60 })
  await pause(1500)
  await page.getByPlaceholder(/Search name, email/).first().fill('')
  await pause(1000)
})

const newLead = {
  name: 'Priya Example',
  email: `priya.${stamp}@northwind-clinics.example`,
  company: 'Northwind Clinics (Demo)',
  title: 'Head of Operations',
  website: 'northwind-clinics.example',
  message:
    'We run 9 physiotherapy clinics and want a patient booking portal with reminders and online payments, integrated with our existing practice software. Budget is about $35k and we would like to launch within 3 months.',
}

await scene(page, 'Add a new inbound lead, with "Run AI qualification after saving" checked', async () => {
  await page.getByRole('button', { name: 'New lead' }).first().click()
  await page.getByLabel('Name *').pressSequentially(newLead.name, { delay: 30 })
  await page.getByLabel('Email *').fill(newLead.email)
  await page.getByLabel('Company *').pressSequentially(newLead.company, { delay: 20 })
  await page.getByLabel('Job title').fill(newLead.title)
  await page.getByLabel('Website').fill(newLead.website)
  await page.getByLabel('Inquiry message *').fill(newLead.message)
  await pause(1200)
}, 1000)

await scene(page, 'Saving: the Worker calls Gemini live and validates its structured JSON output', async () => {
  await page.getByRole('button', { name: 'Create lead' }).click()
  // Wait for the AI outcome toast (success shows a score; failures show a specific error).
  await page.getByText(/score|qualif|AI/i).last().waitFor({ timeout: 45000 })
  await pause(2500)
}, 1500)

await scene(page, 'Lead detail: AI score, priority, reasoning, criteria breakdown and next step (an AI estimate)', async () => {
  await go(page, '/leads')
  await page.getByPlaceholder(/Search name, email/).first().fill('Priya')
  await pause(1500)
  await page.getByText(newLead.name).first().click()
  await page.waitForURL(/\/leads\/[0-9a-f-]{36}/)
  await pause(2500)
  await smoothScroll(page, 500)
  await pause(2500)
  await smoothScroll(page, 500)
  await pause(2000)
}, 1500)

await scene(page, 'AI Qualification: pipeline, quota, review queue and the scoring rubric in use', async () => {
  await go(page, '/qualification')
  await pause(1500)
  await smoothScroll(page, 700)
  await pause(1500)
})

await scene(page, 'Workflows: every run is recorded with steps, durations, errors and retries', async () => {
  await go(page, '/workflows')
  await pause(1500)
  await page.locator('table tbody tr').first().click()
  await pause(3000)
  await page.keyboard.press('Escape')
})

await scene(page, 'Analytics: lead volume, sources, score distribution and workflow outcomes', async () => {
  await go(page, '/analytics')
  await pause(1500)
  await smoothScroll(page, 700)
  await pause(1500)
})

await scene(page, 'Integrations: Gemini quota, encrypted Slack webhook, intake key and self-hosted n8n', async () => {
  await go(page, '/integrations')
  await pause(1500)
  await smoothScroll(page, 700)
  await pause(1500)
})

await scene(page, 'Built with React, Hono on Cloudflare Workers, Supabase (RLS), Gemini and n8n', async () => {
  await go(page, '/dashboard')
}, 4000)

const video = page.video()
await context.close()
await browser.close()
const raw = await video.path()
const out = process.argv.includes('--out') ? path.resolve(process.argv[process.argv.indexOf('--out') + 1]) : path.join(OUT_DIR, 'leadpilot-demo.webm')
renameSync(raw, out)
rmSync(TMP_DIR, { recursive: true, force: true })
console.log(`Saved ${out}`)
if (!SIGN_IN) console.log(`Demo account created: ${ACCOUNT.email} (password printed only here: ${ACCOUNT.password})`)
