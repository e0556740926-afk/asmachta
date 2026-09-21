import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

// Some sandboxed dev environments pre-install Chromium at a fixed path
// instead of the revision this Playwright version would normally fetch.
// Use it only if it's actually there; everywhere else (a developer's
// machine, CI) falls back to Playwright's normal browser resolution.
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const launchOptions = existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions,
      },
    },
  ],
})
