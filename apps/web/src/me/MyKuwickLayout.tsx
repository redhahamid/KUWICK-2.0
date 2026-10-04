import type { ReactNode } from "react";
import { canvas, fontFamily } from "../design-system/tokens";
import { ConfigProvider } from "antd";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  CalendarOutlined,
  ClockCircleOutlined,
  FileDoneOutlined,
  HomeOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { SectionTileContext, type SectionTile } from "../admin/hr/ui/sectionTile";
import { useAuthStore } from "../core/auth-store";
import { setClinicTimeZone } from "../clinical/clinicTime";
import { initialsOf } from "../admin/hr/ui/who";
import "../admin/hr/ui/slate.css";
import { useMyHome, useMyProfile } from "./hooks/useMe";

/**
 * MY KUWICK — the employee's own portal, after `portal-*.html`.
 *
 * The same kit as HR, with no sidebar: a slate bar with the clinic and the
 * person, five pill tabs, and the page held to 960px. Whoever signs in sees
 * only what is theirs; the API enforces that by identity, not by this screen.
 *
 * Five tabs, not six: the mockups carry no Schedule tab, so the roster lives
 * on Attendance (the shifts a month of punches was measured against) and
 * `/my/schedule` lands there.
 */
const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: "/my", label: "Home", end: true },
  { to: "/my/payslips", label: "Payslips" },
  { to: "/my/leave", label: "Leave" },
  { to: "/my/claims", label: "Claims" },
  { to: "/my/attendance", label: "Attendance" },
];

/** The tile each tab's panels wear — see `SectionTileContext`. */
const TILES: Record<string, SectionTile> = {
  "/my": { tone: "indigo", icon: <HomeOutlined aria-hidden="true" /> },
  "/my/payslips": { tone: "violet", icon: <WalletOutlined aria-hidden="true" /> },
  "/my/leave": { tone: "teal", icon: <CalendarOutlined aria-hidden="true" /> },
  "/my/claims": { tone: "green", icon: <FileDoneOutlined aria-hidden="true" /> },
  "/my/attendance": { tone: "amber", icon: <ClockCircleOutlined aria-hidden="true" /> },
  "/my/profile": { tone: "slate", icon: <UserOutlined aria-hidden="true" /> },
};

export function MyKuwickLayout() {
  const location = useLocation();
  const { data: profile } = useMyProfile();
  const { data: home } = useMyHome();
  const tenantName = useAuthStore((state) => state.tenant?.name ?? null);

  if (home?.timeZone) setClinicTimeZone(home.timeZone);

  const waiting: Record<string, number> = {
    "/my/leave": home?.waiting.leaveRequests ?? 0,
    "/my/claims": home?.waiting.claims ?? 0,
    "/my/attendance": home?.waiting.attendanceCorrections ?? 0,
  };
  const name = profile?.fullName ?? home?.fullName ?? "";
  // The longest tab path that leads this route: `/my/leave/…` wears Leave's tile.
  const tileKey =
    Object.keys(TILES)
      .filter((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))
      .sort((a, b) => b.length - a.length)[0] ?? "/my";

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: canvas.indigo,
          colorLink: canvas.indigo,
          borderRadius: canvas.radiusControl,
          fontFamily,
        },
      }}
    >
      <SectionTileContext.Provider value={TILES[tileKey]}>
      <div className="kw-hrSlate hr-portal" data-testid="my-kuwick">
        <header className="hr-top">
          <Link to="/my" className="hr-top__logo">
            KUWICK
          </Link>
          <span className="hr-top__crumbs">My Kuwick</span>
          <div className="hr-top__right">
            {tenantName ? (
              <span className="hr-top__clinic">{tenantName}</span>
            ) : null}
            <span className="hr-top__name">{name || "—"}</span>
            <Link
              to="/my/profile"
              className="hr-top__avatar"
              aria-label="My profile"
            >
              {name ? initialsOf(name) : "·"}
            </Link>
          </div>
        </header>

        <main className="hr-portal__main">
          <nav className="hr-ptabs" aria-label="My Kuwick">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) => (isActive ? "is-active" : "")}
              >
                {tab.label}
                {waiting[tab.to] > 0 ? (
                  <span
                    className="hr-ptabs__count"
                    aria-label={`${waiting[tab.to]} waiting`}
                  >
                    {waiting[tab.to]}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>
          <Outlet />
        </main>
      </div>
      </SectionTileContext.Provider>
    </ConfigProvider>
  );
}

/** Kept for the pages that say "nothing here yet" — the kit's quiet empty state. */
export function MyEmpty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="hr-portal__empty">
      <b>{title}</b>
      {children}
    </div>
  );
}
