import { describe, expect, it } from 'vitest';

/**
 * NO PANEL SCREEN ASKS FOR A PORTAL PASSWORD, AND NONE INVITES AUTOFILL (N-10).
 *
 * Owner instruction, 2026-11-03, from a competitor's failure: they stored
 * clinic staff's panel portal passwords, readable back, and the browser
 * offered to autofill them.
 *
 * THE BROWSER IS THE HALF THAT IS EASY TO MISS. Even with no password field
 * and no column, a browser that has seen a panel portal login will offer the
 * saved username and password into any form it recognises as a login. One
 * mis-click and a third party's password is posted to Kuwick — into whichever
 * field the browser chose. `autoComplete="off"` on the panel's text inputs is
 * what declines that offer.
 *
 * Sources are read through Vite's `?raw` glob rather than from disk, the same
 * as `slateIsolation.test.tsx`: a `<Input>` prop is a fact about the source,
 * and no rendered component shows whether the NEXT one added will carry it.
 *
 * The API-side guard (`panel-no-portal-credentials.spec.ts`) covers the schema
 * and the DTOs. This covers the screens.
 */
const SOURCES = import.meta.glob('./*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const screens = Object.entries(SOURCES).filter(([file]) => !file.endsWith('.test.tsx'));

/**
 * A CREDENTIAL-SHAPED IDENTIFIER, not the word.
 *
 * The first version of this matched the word anywhere and immediately failed
 * on the configuration screen's own sentence — "Kuwick never stores a panel
 * portal password" — which is the screen TELLING the user the right thing. A
 * guard that forbids saying so would have been quietly removed within a
 * release, and with it the guard against the field.
 *
 * So this matches a credential word used as a NAME: an object key, an
 * assignment, a prop. `portalPassword:`, `password=`, `draft.portalPassword =`
 * all match; prose does not. The field is the risk; the sentence is the fix.
 */
const CREDENTIAL = /(?:^|[.\s{,(])(\w*(?:password|passwd|passcode|pwd|secret|credential|apikey)\w*)\s*[:=]/i;

/** Comments in this repo discuss passwords deliberately; a comment is not a field. */
const code = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the panel screens', () => {
  it('has screens to check, so this file means something', () => {
    expect(screens.length).toBeGreaterThan(2);
    expect(screens.map(([file]) => file)).toContain('./PanelConfigPage.tsx');
  });

  it.each(screens.map(([file]) => file))('%s has no password input', (file) => {
    const source = code(SOURCES[file]);
    expect({ file, hasPasswordType: /type=["']password["']/.test(source) }).toEqual({
      file,
      hasPasswordType: false,
    });
    expect({ file, namesACredential: CREDENTIAL.test(source) }).toEqual({
      file,
      namesACredential: false,
    });
  });

  /**
   * Every free-text input on the panel configuration screen declines autofill.
   * That screen is the one a browser is most likely to mistake for a portal
   * login: it sits beside the portal address and it is where somebody goes
   * right after signing into the portal itself.
   */
  it('declines autofill on every text input of the configuration screen', () => {
    const source = SOURCES['./PanelConfigPage.tsx'];
    const inputs = source.match(/<Input\b[\s\S]*?\/>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect({ input: input.slice(0, 50), declinesAutofill: /autoComplete="off"/.test(input) }).toEqual(
        { input: input.slice(0, 50), declinesAutofill: true },
      );
    }
  });
});
