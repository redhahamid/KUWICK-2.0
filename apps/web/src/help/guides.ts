// The user guides live in docs/guides so they can be read outside the app too.
import hrEn from '../../../../docs/guides/owner-hr-guide.en.md?raw';
import hrMs from '../../../../docs/guides/owner-hr-guide.ms.md?raw';
import staffEn from '../../../../docs/guides/staff-guide.en.md?raw';
import staffMs from '../../../../docs/guides/staff-guide.ms.md?raw';
import payrollEn from '../../../../docs/guides/payroll-a-z-en.md?raw';
import payrollMs from '../../../../docs/guides/payroll-a-z-bm.md?raw';

export type GuideKey = 'hr' | 'staff' | 'payroll';
export type GuideLanguage = 'en' | 'ms';

export const GUIDES: Record<GuideKey, Record<GuideLanguage, string>> = {
  hr: { en: hrEn, ms: hrMs },
  staff: { en: staffEn, ms: staffMs },
  // Payroll A–Z (3 November 2026): the whole month for an owner, with screenshots.
  payroll: { en: payrollEn, ms: payrollMs },
};

/*
 * THE GUIDES' SCREENSHOTS, bundled by Vite and fetched only when a guide
 * shows them. A guide names a picture as it sits beside it in docs/guides
 * (`img/payroll-a-z/a03-company.webp`), which is also how GitHub shows it.
 */
const PICTURES = import.meta.glob('../../../../docs/guides/img/**/*.{png,webp,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export function guidePicture(path: string): string | undefined {
  return PICTURES[`../../../../docs/guides/${path.replace(/^\.\//, '')}`];
}
