import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../core/auth-store';
import { Panel, PanelHead, StatusChip } from '../admin/hr/ui';
import { useMyProfile } from './hooks/useMe';
import { PortalEmpty } from './portal';

/**
 * PROFILE — what the clinic holds about the person, read-only: the record is
 * HR's to correct. The bank account is deliberately not editable here (there
 * is no self-service endpoint for it): a payslip must never be paid to a
 * number nobody checked.
 */
export function MyProfilePage() {
  const { data } = useMyProfile();
  const navigate = useNavigate();
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const kv = (label: string, value: string | null | undefined) => (
    <span key={label} style={{ display: 'contents' }}>
      <span className="hr-kv__k">{label}</span>
      <span className="hr-kv__v">{value || '—'}</span>
    </span>
  );

  return (
    <>
      <div className="hr-pageHead">
        <div>
          <h1>Profile</h1>
          <div className="hr-sub">Anything wrong here is corrected by HR, not on this screen.</div>
        </div>
        <div className="hr-pageHead__actions">
          <button
            type="button"
            className="hr-btn"
            onClick={() => {
              clearAuth();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="hr-grid2">
        <Panel>
          <PanelHead title="You" />
          <div className="hr-kv">
            {kv('Name', data?.fullName)}
            {kv('Branch', data?.branch?.name)}
            {kv('Kind of work', data?.category?.toLowerCase())}
          </div>
          <div className="hr-panelHead--top">
            <PanelHead title="Contact" />
          </div>
          <div className="hr-kv">
            {kv('Phone', data?.employment?.phone)}
            {kv('Email', data?.employment?.email)}
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Employment" />
          {data?.hasEmploymentProfile ? (
            <div className="hr-kv">
              {kv('Employee number', data.employment?.employeeNo)}
              {kv('Position', data.employment?.position)}
              {kv('Department', data.employment?.department)}
              {kv('Type', data.employment?.employmentType?.toLowerCase())}
              {kv('Started', data.employment?.startDate ? dayjs(data.employment.startDate).format('D MMM YYYY') : null)}
              <span className="hr-kv__k">Status</span>
              <span className="hr-kv__v">
                <StatusChip tone={data.employment?.employmentStatus === 'ACTIVE' ? 'done' : 'muted'}>
                  {data.employment?.employmentStatus?.toLowerCase() ?? '—'}
                </StatusChip>
              </span>
            </div>
          ) : (
            <PortalEmpty title="Your employment record is not finished yet">
              You can sign in and see your roster, but payroll cannot include you until HR completes your employment
              profile. Ask them to finish it.
            </PortalEmpty>
          )}
          <div className="hr-panelHead--top">
            <PanelHead title="Bank account" />
          </div>
          <PortalEmpty title="Changed through HR">
            Tell your manager or HR the new account, with proof it is yours. Payroll is paid only to an account HR has
            checked, so it cannot be changed from here.
          </PortalEmpty>
        </Panel>
      </div>
    </>
  );
}
