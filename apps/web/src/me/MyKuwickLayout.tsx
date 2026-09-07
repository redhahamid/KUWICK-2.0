import { ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  CalendarOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  HomeOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useMyHome, useMyProfile } from './hooks/useMe';
import { setClinicTimeZone } from '../clinical/clinicTime';
import './my-kuwick.css';

/**
 * MY KUWICK — the shell an employee lives in.
 *
 * Deliberately NOT the Administration shell. A member of staff should never
 * see the module rail or the branch picker: a screen that shows controls it
 * then refuses is worse than one that never offered them, and every one of
 * those controls implies a management view they do not have.
 *
 * Phone first. The navigation is a bottom bar under a thumb; at desktop width
 * the same five destinations move to the side and nothing else changes.
 */

const TABS: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/my', label: 'Home', icon: <HomeOutlined />, end: true },
  { to: '/my/schedule', label: 'Schedule', icon: <CalendarOutlined /> },
  { to: '/my/attendance', label: 'Attendance', icon: <ClockCircleOutlined /> },
  { to: '/my/leave', label: 'Leave', icon: <FileTextOutlined /> },
  { to: '/my/claims', label: 'Claims', icon: <WalletOutlined /> },
];

export function MyKuwickLayout() {
  const { data: profile } = useMyProfile();
  const { data: home } = useMyHome();

  // THE CLINIC'S ZONE, FROM THE SERVER, BEFORE ANY TIME IS DRAWN.
  //
  // `clinicTime` defaults to Asia/Kuala_Lumpur and its own comment says it is
  // "called once, from the session, at app boot" — which nothing in the app
  // actually did, so every screen has been running on that default. It happens
  // to be right for a Malaysian clinic and wrong for anybody else's, and this
  // area is the one people read on a phone in another country. `/me/home`
  // knows the answer for THIS employee's branch, so it is set here.
  if (home?.timeZone) setClinicTimeZone(home.timeZone);

  // The counts that put a dot on a tab. Only things waiting on somebody ELSE
  // are counted — a badge for work the employee has already done is noise.
  const waiting: Record<string, number> = {
    '/my/leave': home?.waiting.leaveRequests ?? 0,
    '/my/claims': home?.waiting.claims ?? 0,
    '/my/attendance': home?.waiting.attendanceCorrections ?? 0,
  };

  return (
    <div className="kw-my" data-testid="my-kuwick">
      <header className="kw-my__head">
        <div className="kw-my__greeting">
          <span className="kw-my__hello">My Kuwick</span>
          <span className="kw-my__name">{profile?.fullName ?? '—'}</span>
          {profile?.branch ? <span className="kw-my__branch">{profile.branch.name}</span> : null}
        </div>
        <Link to="/my/profile" aria-label="My profile" style={{ color: '#fff', fontSize: 20, lineHeight: 1 }}>
          <UserOutlined />
        </Link>
      </header>

      <nav className="kw-my__tabs" aria-label="My Kuwick">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `kw-my__tab${isActive ? ' kw-my__tab--active' : ''}`}
          >
            <span className="kw-my__tabWrap">
              {tab.icon}
              {waiting[tab.to] > 0 ? (
                <span className="kw-my__tabDot" aria-label={`${waiting[tab.to]} waiting`}>
                  {waiting[tab.to]}
                </span>
              ) : null}
            </span>
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <main className="kw-my__body">
        <Outlet />
      </main>
    </div>
  );
}

/** The empty state this area uses everywhere: why, and what to do about it. */
export function MyEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="kw-my-empty">
      <div className="kw-my-empty__title">{title}</div>
      {children}
    </div>
  );
}
