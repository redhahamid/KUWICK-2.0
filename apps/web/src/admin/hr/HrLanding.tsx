import { Navigate } from 'react-router-dom';
import { useCan } from '../../core/hooks/useCan';
import { HrPage } from './ui';
import { useHrSetup } from './useHrSetup';

/**
 * WHERE "HR" OPENS (new-clinic UAT, 15 October 2026): on the "Set up
 * payroll" steps while any is still to do, for somebody who can set them up;
 * on Payroll once setup is done, because paying people is why HR is opened.
 */
export function HrLanding() {
  const maySetUp = useCan('hr.statutory.manage');
  const setup = useHrSetup();
  if (maySetUp && setup.loading) {
    return (
      <HrPage title="HR">
        <div className="hr-note">Loading…</div>
      </HrPage>
    );
  }
  return <Navigate to={maySetUp && !setup.complete ? '/admin/hr/settings' : '/admin/hr/payroll'} replace />;
}
