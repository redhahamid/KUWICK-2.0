import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SetupStepList } from './SettingsSetupWizard';
import { useHrSetup, type SetupStepKey } from './useHrSetup';

/**
 * STAYING IN THE WIZARD (new-clinic UAT #2, item 69).
 *
 * A step settled on its own page (Payroll items, Public holidays, Employees…)
 * used to send the owner off to that page with no way back but the menu. Every
 * page the wizard opens is now opened with `from=setup`; while that trail is
 * on, the HR side rail shows the eight steps instead of the HR sections, and a
 * step opens the wizard at that step. "Leave setup" or finishing the wizard
 * turns it off. Kept for the browser tab only (sessionStorage).
 */
const KEY = 'kw.hr.setupTrail';

/** A wizard link: the same page, marked as opened from setup. */
export function fromSetup(to: string): string {
  return `${to}${to.includes('?') ? '&' : '?'}from=setup`;
}

function stored(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function endSetupTrail() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage may be unavailable; the trail is a convenience only.
  }
}

/** Which step a page belongs to, so the rail can light it. */
const STEP_OF_PAGE: [string, SetupStepKey][] = [
  ['/admin/hr/settings/company', 'company'],
  ['/admin/hr/settings/payroll-items', 'items'],
  ['/admin/hr/settings/payroll', 'payRules'],
  ['/admin/hr/settings/public-holidays', 'holidays'],
  ['/admin/hr/settings/opening-balances', 'opening'],
  ['/admin/hr/settings/statutory', 'rates'],
  ['/admin/hr/employees', 'employees'],
];

export function stepOfPage(pathname: string): SetupStepKey | null {
  return STEP_OF_PAGE.find(([path]) => pathname === path || pathname.startsWith(`${path}/`))?.[1] ?? null;
}

/** Whether the rail should show the wizard's steps on this page. */
export function useSetupTrail(): { on: boolean; leave: () => void } {
  const location = useLocation();
  const [on, setOn] = useState(stored);
  const marked = new URLSearchParams(location.search).get('from') === 'setup';
  useEffect(() => {
    if (!marked) return;
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      // As above.
    }
    setOn(true);
  }, [marked]);
  const leave = () => {
    endSetupTrail();
    setOn(false);
  };
  // The wizard draws its own list.
  const onWizard = location.pathname === '/admin/hr/settings';
  return { on: (on || marked) && !onWizard, leave };
}

export function SetupRail({ onLeave }: { onLeave: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const setup = useHrSetup();
  const done = setup.steps.filter((step) => step.done).length;
  return (
    <div className="hr-setupRail">
      <span className="kw-hubRail__heading">
        Set up payroll · {done}/{setup.steps.length}
      </span>
      <SetupStepList compact steps={setup.steps} open={stepOfPage(location.pathname)} onOpen={(key) => navigate(`/admin/hr/settings?step=${key}`)} />
      <button
        type="button"
        className="hr-btn hr-btn--sm hr-setupRail__leave"
        onClick={() => {
          onLeave();
          navigate('/admin/hr/settings?all=1');
        }}
      >
        Leave setup
      </button>
    </div>
  );
}
