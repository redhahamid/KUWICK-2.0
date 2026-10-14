// The user guides live in docs/guides so they can be read outside the app too.
import hrEn from '../../../../docs/guides/owner-hr-guide.en.md?raw';
import hrMs from '../../../../docs/guides/owner-hr-guide.ms.md?raw';
import staffEn from '../../../../docs/guides/staff-guide.en.md?raw';
import staffMs from '../../../../docs/guides/staff-guide.ms.md?raw';

export type GuideKey = 'hr' | 'staff';
export type GuideLanguage = 'en' | 'ms';

export const GUIDES: Record<GuideKey, Record<GuideLanguage, string>> = {
  hr: { en: hrEn, ms: hrMs },
  staff: { en: staffEn, ms: staffMs },
};
