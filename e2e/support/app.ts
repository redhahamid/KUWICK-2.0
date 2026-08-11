import { Page, expect } from '@playwright/test';

/**
 * THE GUARDRAIL — shared moves.
 *
 * Deliberately thin. A page-object layer thick enough to hide the UI is a
 * layer thick enough to keep passing while the UI is broken, which is the
 * failure mode this whole suite exists to catch. Everything here is either a
 * login, a wait, or a piece of vocabulary the specs would otherwise repeat.
 */

/** The synthetic staging clinic. Every account is on an RFC 2606 `.invalid`. */
export const ACCOUNTS = {
  owner: 'owner@uat.kuwick.invalid',
  frontDesk: 'frontdesk@uat.kuwick.invalid',
  finance: 'finance@uat.kuwick.invalid',
  doctor: 'doctor@uat.kuwick.invalid',
} as const;

export const PASSWORD = process.env.E2E_PASSWORD ?? 'DevLocal!2026';

export const MEDICATION = 'Paracetamol 500mg';
export const DIAGNOSIS_CODE = 'J06.9';

export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // Landing on any authenticated route is enough; which one is a product
  // decision this suite has no opinion about.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

export async function logout(page: Page): Promise<void> {
  // Clearing the persisted session is more reliable than hunting for a menu
  // item, and this is setup, not the thing under test.
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/login');
}

/**
 * A name nothing else in the clinic shares, so a spec can find its own
 * patient in a queue that has eight UAT scenarios already in it.
 */
export function uniquePatientName(prefix: string): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  return `${prefix} ${stamp}`;
}

/**
 * Click an antd "button style" radio.
 *
 * antd hides the real `<input type="radio">` behind a styled label and paints
 * the label instead, so the accessible radio node is never clickable. Clicking
 * the label is what a person does, and it is what this does.
 */
export async function chooseRadio(scope: { getByText: Page['getByText'] }, label: string): Promise<void> {
  await scope.getByText(label, { exact: true }).click();
}

/** Every visible control on the page — for building specs, not asserting. */
export async function describeControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen: string[] = [];
    document
      .querySelectorAll('button, input, textarea, [role="tab"], [role="option"], [data-testid], h3, h4, h5')
      .forEach((element) => {
        const node = element as HTMLElement;
        const text = (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 70);
        const testId = node.getAttribute('data-testid');
        const placeholder = node.getAttribute('placeholder');
        seen.push(
          `${node.tagName.toLowerCase()}${testId ? `[testid=${testId}]` : ''}${placeholder ? `[ph=${placeholder}]` : ''}: ${text}`,
        );
      });
    return [...new Set(seen)];
  });
}
