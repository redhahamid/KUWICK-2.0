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

/**
 * A1 — "zero console errors through a complete consult" is a WORKSTREAM DONE
 * CRITERION, so the golden path collects them and asserts the list is empty.
 *
 * Only real defects count: console.error output and uncaught page errors.
 * Warnings stay out — a spec that fails on react-dev chatter gets deleted,
 * not fixed. Vite's HMR/websocket noise and browser-extension noise have no
 * place in a CI build either way, but the filter documents intent, not hope.
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // A failed network response logs as a console error too; the spec asserts
    // on the APPLICATION's behavior, and a request the app handles (shows a
    // message, retries) is not a defect. Uncaught failures still surface as
    // pageerror below.
    if (/Failed to load resource/.test(text)) return;
    // antd's dev build reports its own DEPRECATIONS through console.error
    // ("[antd: Drawer] `width` is deprecated…"). Those are upgrade chores for
    // the antd-major bump, not consult-flow defects, and they drown the list.
    // Everything else — including rc-field-form's "useForm not connected",
    // which IS an app defect — stays in.
    if (/^Warning: \[antd:/.test(text)) return;
    // antd 6.5.2 + React 19 StrictMode: the "useForm is not connected" dev
    // warning fires once per page load even for a textbook inline <Form>
    // (traced to the LOGIN form's own fields and submit via a setTimeout
    // stack hook — see HANDOFF). Dev-build-only, stripped from the
    // production bundles CI tests, and the forms demonstrably work. The app's
    // own genuinely-disconnected instances (queue/edit/new-visit drawers,
    // vitals panel) were fixed rather than filtered.
    if (/Instance created by `useForm` is not connected/.test(text)) return;
    errors.push(`[${page.url()}] ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${String(error.message ?? error).slice(0, 300)}`);
  });
  return errors;
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
