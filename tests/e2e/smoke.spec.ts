import { test, expect } from '@playwright/test'

// Unauthenticated smoke coverage only: there is no seeded test account yet,
// so screens behind login aren't exercised here. This still catches the
// class of failure that shipped once already (a blank page from a client
// that throws before first render).

test('sign-in page renders in RTL with the app name and title', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByText('אסמכתא').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'כניסה לאסמכתא' })).toBeVisible()
})

test('switching to sign-up mode shows the display-name field', async ({ page }) => {
  await page.goto('/')
  await page.getByText('עוד אין לך חשבון? להרשמה').click()
  await expect(page.getByRole('heading', { name: 'הרשמה לאסמכתא' })).toBeVisible()
  await expect(page.getByLabel('שם מלא')).toBeVisible()
})

test('forgot-password mode sends back to sign-in', async ({ page }) => {
  await page.goto('/')
  await page.getByText('שכחת סיסמה?').click()
  await expect(page.getByRole('heading', { name: 'שחזור סיסמה' })).toBeVisible()
  await page.getByText('חזרה לכניסה').click()
  await expect(page.getByRole('heading', { name: 'כניסה לאסמכתא' })).toBeVisible()
})
