import { Button, Tag } from 'antd';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../core/auth-store';
import { MyEmpty } from './MyKuwickLayout';
import { useMyProfile } from './hooks/useMe';

/**
 * MY PROFILE — who Kuwick thinks I am.
 *
 * Read-only, and short. There is no salary on it: pay is read from a payslip,
 * a document about one month with a total that can be checked, not from a
 * settings screen somebody might think they can edit. Corrections to any of
 * this go through HR, which is what the screen says.
 */
export function MyProfilePage() {
  const { data } = useMyProfile();
  const navigate = useNavigate();
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const row = (label: string, value: string | null | undefined) => (
    <div className="kw-my-shift" key={label}>
      <span className="kw-my-shift__meta">{label}</span>
      <span className="kw-my-shift__time">{value || '—'}</span>
    </div>
  );

  return (
    <>
      <div>
        <h1 className="kw-my__title">My profile</h1>
        <p className="kw-my__subtitle">Anything wrong here is corrected by HR, not on this screen.</p>
      </div>

      <div className="kw-my-card">
        <div className="kw-my-card__label">You</div>
        {row('Name', data?.fullName)}
        {row('Branch', data?.branch?.name)}
        {row('Kind of work', data?.category?.toLowerCase())}
      </div>

      {data?.hasEmploymentProfile ? (
        <div className="kw-my-card">
          <div className="kw-my-card__label">Employment</div>
          {row('Employee number', data.employment?.employeeNo)}
          {row('Position', data.employment?.position)}
          {row('Department', data.employment?.department)}
          {row('Type', data.employment?.employmentType?.toLowerCase())}
          {row('Started', data.employment?.startDate ? dayjs(data.employment.startDate).format('D MMM YYYY') : null)}
          <div className="kw-my-shift">
            <span className="kw-my-shift__meta">Status</span>
            <Tag color={data.employment?.employmentStatus === 'ACTIVE' ? 'green' : 'default'}>
              {data.employment?.employmentStatus?.toLowerCase()}
            </Tag>
          </div>
        </div>
      ) : (
        <div className="kw-my-card">
          <MyEmpty title="Your employment record is not finished yet">
            You can sign in and see your schedule, but payroll cannot include you until HR completes your
            employment profile. Ask them to finish it.
          </MyEmpty>
        </div>
      )}

      <div className="kw-my-card">
        <div className="kw-my-card__label">Contact</div>
        {row('Phone', data?.employment?.phone)}
        {row('Email', data?.employment?.email)}
      </div>

      <Button
        block
        size="large"
        onClick={() => {
          clearAuth();
          navigate('/login');
        }}
      >
        Sign out
      </Button>
    </>
  );
}
