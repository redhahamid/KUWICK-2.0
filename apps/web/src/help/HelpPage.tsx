import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GUIDES, guidePicture, type GuideKey, type GuideLanguage } from './guides';
import { Markdown } from './Markdown';

const KEY = 'kuwick.help.language';
const saved = (): GuideLanguage => {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'ms';
  } catch {
    return 'ms';
  }
};

/**
 * HELP (testing, 15 October 2026): the owner/HR guide inside HR, the staff
 * guide inside My Kuwick, each in Bahasa Melayu or English.
 */
export function HelpPage({ guide }: { guide: GuideKey }) {
  const [language, setLanguage] = useState<GuideLanguage>(saved);
  const choose = (next: GuideLanguage) => {
    setLanguage(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // A private window keeps the choice for this visit only.
    }
  };
  return (
    <div className="kw-helpPage" data-testid={`help-${guide}`}>
      <div className="kw-helpPage__bar">
        <span className="hr-dots" role="group" aria-label="Language">
          {(['ms', 'en'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={language === value ? 'hr-btn hr-btn--sm hr-btn--primary' : 'hr-btn hr-btn--sm'}
              aria-pressed={language === value}
              onClick={() => choose(value)}
            >
              {value === 'ms' ? 'Bahasa Melayu' : 'English'}
            </button>
          ))}
        </span>
        {guide === 'hr' ? (
          <span className="kw-helpPage__guides">
            {/* Payroll A–Z (3 November 2026): the whole month, step by step, with screenshots. */}
            <Link to="/admin/hr/help/payroll" className="hr-btn hr-btn--sm">
              {language === 'ms' ? 'Gaji A–Z (langkah demi langkah)' : 'Payroll A–Z (step by step)'}
            </Link>
            <Link to="/my/help" className="hr-linkButton">
              {language === 'ms' ? 'Panduan staf (My Kuwick)' : 'Staff guide (My Kuwick)'}
            </Link>
          </span>
        ) : guide === 'payroll' ? (
          <Link to="/admin/hr/help" className="hr-linkButton">
            {language === 'ms' ? '← Panduan pemilik / HR' : '← Owner / HR guide'}
          </Link>
        ) : null}
      </div>
      <Markdown source={GUIDES[guide][language]} imageUrl={guidePicture} />
    </div>
  );
}
