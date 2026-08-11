import { test } from '@playwright/test';
import { ACCOUNTS, describeControls, login } from './support/app';

/**
 * SCAFFOLD — not a guardrail. Deleted once the golden path is written.
 * It exists only to print what each screen actually renders, so the real spec
 * targets accessible names that exist rather than names that sound right.
 */
test('dump the registration and queue surfaces', async ({ page }) => {
  await login(page, ACCOUNTS.frontDesk);

  await page.goto('/patients');
  await page.waitForTimeout(2500);
  console.log('\n===== /patients =====\n' + (await describeControls(page)).join('\n'));

  await page.getByRole('button', { name: /add patient/i }).click();
  await page.waitForTimeout(1500);
  console.log('\n===== add patient modal =====\n' + (await describeControls(page)).join('\n'));
  await page.keyboard.press('Escape');

  await page.goto('/queue');
  await page.waitForTimeout(2500);
  console.log('\n===== /queue =====\n' + (await describeControls(page)).join('\n'));

  await page.getByRole('button', { name: /add to queue/i }).click();
  await page.waitForTimeout(1500);
  console.log('\n===== add to queue modal =====\n' + (await describeControls(page)).join('\n'));
});
