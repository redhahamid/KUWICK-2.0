import { describe, expect, it } from 'vitest';
// Node environment (the suite default), so `import.meta.url` is a real file
// URL and the stylesheets can be read from disk. Same suppression as
// clinical/attachmentsSingleMount.test.ts: the app tsconfig deliberately has
// no node types.
// @ts-expect-error — node builtin without @types/node in the browser tsconfig
import { readFileSync } from 'node:fs';
// @ts-expect-error — node builtin without @types/node in the browser tsconfig
import { fileURLToPath } from 'node:url';

/**
 * SLATE CANNOT REACH THE OTHER FOUR MODULES.
 *
 * `design-system/tokens.ts` is the one source for the whole product: it feeds
 * antd's theme AND generates the `--kw-*` properties in `index.css`. Its
 * palette is navy. Slate is a different palette, and HR is the only module
 * being rebuilt on it — so the Slate values live under `.kw-hrSlate` and
 * `.kw-hrSlateHeader`, and nowhere else.
 *
 * This is the guard for that sentence. Without it the first convenient
 * `:root { --hr-teal: … }` repaints Operation, Stock, Panel and Finance, and
 * nobody notices until somebody opens Finance.
 *
 * Stylesheets are read from DISK rather than imported. Vite's CSS plugin
 * answers a `?raw` import of a `.css` file with an empty string, so a guard
 * written that way asserts nothing at all — which is how this file first
 * passed while proving none of it.
 */
const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8');

const slateCss = read('./slate.css');
const indexCss = read('../../../index.css');
const tokensSource = read('../../../design-system/tokens.ts');

/** Slate's own colours, as written in `docs/design/hr-slate/kit.css`. */
const SLATE_HEXES = ['#16302b', '#1e3e37', '#0f8f7a', '#b9cfc8', '#b7791f', '#c2362e', '#1e7f45'];

/** Comments name the other modules deliberately; a selector check must not read them as selectors. */
const rules = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((block) => block.split('{')[0].trim())
    .filter(Boolean);

const SOURCES = import.meta.glob('../../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Vite resolves a relative glob's keys against THIS file, which sits in
 * `admin/hr/ui`. So HR's own files come back as `./x` or `../x`, and
 * everything else in the app is at least two levels up.
 */
const insideHr = (file: string) => !file.startsWith('../../');

describe('the Slate kit', () => {
  it('was actually read, so the rest of this file means something', () => {
    expect(slateCss.length).toBeGreaterThan(2000);
    expect(indexCss.length).toBeGreaterThan(2000);
    expect(tokensSource.length).toBeGreaterThan(500);
  });

  it('declares its palette only on HR scopes, never on :root', () => {
    // USES are everywhere and are fine; DECLARATIONS are the leak. Strip the
    // `var(--hr-…)` reads first, and whatever `--hr-` survives is a definition.
    const leaked = slateCss
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/var\(--hr-[a-z0-9-]+\)/g, '')
      .split('}')
      .filter((block) => block.includes('--hr-'))
      .map((block) => block.split('{')[0].trim())
      .filter((selector) => !/\.kw-hrSlate(Header)?/.test(selector));
    expect(leaked).toEqual([]);
    expect(rules(slateCss)).not.toContain(':root');
  });

  it('is not reachable from any file outside the HR module', () => {
    const outsiders = Object.entries(SOURCES)
      .filter(([file]) => !insideHr(file))
      .filter(([, source]) => source.includes('--hr-') || source.includes('ui/slate.css'))
      .map(([file]) => file);
    expect(outsiders).toEqual([]);
  });

  it('left the product-wide palette alone', () => {
    // If a Slate colour has found its way into the global tokens or the global
    // stylesheet, the other four modules have been repainted.
    const found = SLATE_HEXES.filter(
      (hex) => tokensSource.toLowerCase().includes(hex) || indexCss.toLowerCase().includes(hex),
    );
    expect(found).toEqual([]);
  });

  it('scopes the app header by CLASS, because the header is not inside HR', () => {
    // The one thing Slate touches outside its own subtree is the product
    // header, which is a sibling. It gets a class on HR routes and nothing
    // else — no global selector, no element rule.
    expect(slateCss).toContain('.kw-app-header.kw-hrSlateHeader');
    const headerRules = rules(slateCss).filter(
      (selector) => selector.includes('kw-app-header') || selector.includes('ant-'),
    );
    expect(headerRules.length).toBeGreaterThan(3);
    // Scoped by one of HR's own classes — the shell, the header variant, or
    // an `hr-` component — never bare. `.hr-table .ant-table` is fine;
    // `.ant-table` alone would restyle every module's tables.
    for (const selector of headerRules) {
      expect({ selector, scoped: /(kw-hrSlate(Header)?|\.hr-[a-z])/.test(selector) }).toEqual({ selector, scoped: true });
    }
  });
});
