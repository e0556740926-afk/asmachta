#!/usr/bin/env node
/**
 * Visual QA helper: captures the unauthenticated screens in light + dark
 * mode. There's no seeded test account yet, so authenticated screens
 * (courses, course detail, admin, /design) aren't covered — add them here
 * once a fixture login exists.
 *
 * Usage: npm run dev (in one terminal) then `npm run screenshots`,
 * or just `npm run screenshots` — it starts its own dev server if none
 * is already listening on the target port.
 */
import { chromium } from 'playwright'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

// See playwright.config.ts for why this conditional path exists.
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const launchOptions = existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {}

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'screenshots')
mkdirSync(outDir, { recursive: true })

const baseURL = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5173'

async function isUp(url) {
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

async function waitFor(url, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isUp(url)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

let devServer = null
if (!(await isUp(baseURL))) {
  console.log(`No dev server at ${baseURL}, starting one…`)
  devServer = spawn('npm', ['run', 'dev', '--', '--port', '5173', '--strictPort'], {
    cwd: join(__dirname, '..'),
    stdio: 'ignore',
    detached: true,
  })
  const up = await waitFor(baseURL, 20_000)
  if (!up) {
    console.error('Dev server did not come up in time.')
    process.exit(1)
  }
}

const browser = await chromium.launch(launchOptions)
try {
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ colorScheme, viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()

    await page.goto(baseURL)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: join(outDir, `auth-signin-${colorScheme}.png`) })

    await page.getByText('עוד אין לך חשבון? להרשמה').click()
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(outDir, `auth-signup-${colorScheme}.png`) })

    await context.close()
  }
  console.log(`Saved screenshots to ${outDir}`)
} finally {
  await browser.close()
  if (devServer) process.kill(-devServer.pid)
}
