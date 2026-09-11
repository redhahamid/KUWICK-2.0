import { HubCategory, HubShell } from './HubShell';

// M1 (owner-approved) — CMS Settings: configuration changed a few times a
// year, extracted out of Management so review/approve/submit work and
// set-once config stop sharing one menu. Same HubShell as Management, its
// own categories. The pages themselves are the untouched existing
// components; old /management/operation/* URLs redirect here (App.tsx).
const SETTINGS_CATEGORIES: HubCategory[] = [
  {
    key: 'organisation',
    label: 'Organisation & Branches',
    items: [
      { path: '/settings/organisation/branches', label: 'Branches' },
      // FINAL-UAT — tenant-defined roles; assignment happens on the Staff
      // page's Access drawer.
      { path: '/settings/organisation/roles', label: 'Roles & Permissions' },
      { path: '/management/hr/staff', label: 'Users & Staff →' },
    ],
  },
  {
    key: 'scheduling',
    label: 'Appointments & Scheduling',
    items: [
      // What remains here is the BRANCH's own booking policy — its session
      // band, its notice, how far ahead it takes bookings, and the days it is
      // shut. Everything else that used to live here has moved to where the
      // question is actually asked:
      //
      //   Provider Availability  → Appointments ▸ Roster & Availability
      //   Doctor-Service Mapping → Appointments ▸ Services ▸ Providers
      //   Slot Capacity          → Appointments ▸ Services ▸ Scheduling
      //
      // No data was deleted; the junction tables are untouched, and every old
      // URL redirects.
      { path: '/settings/scheduling/booking-rules', label: 'Branch Booking Rules' },
      // PHASE 8 — the canonical home of message templates and reminder
      // rules. The Booking Page tab links here instead of keeping a copy.
      { path: '/settings/scheduling/communication', label: 'Communication & Reminders' },
      { path: '/appointments/roster', label: 'Roster & Availability →' },
      { path: '/appointments/services', label: 'Services & Booking →' },
      { path: '/appointments/booking-page', label: 'Public Booking Page →' },
    ],
  },
  {
    key: 'queue',
    label: 'Queue & Visit Workflow',
    items: [
      { path: '/settings/queue/rooms', label: 'Rooms & Stations' },
      { path: '/settings/queue/display', label: 'Queue Screen' },
    ],
  },
  {
    key: 'clinical',
    label: 'Clinical',
    items: [
      { path: '/settings/clinical/services', label: 'Services & Procedures' },
      { path: '/settings/clinical/consultation-tariffs', label: 'Consultation Tariffs' },
      { path: '/settings/clinical/diagnoses', label: 'Diagnoses' },
      // b1 PHASE 1G — the five lists the prescribing form is built from.
      { path: '/settings/clinical/prescription-vocabulary', label: 'Prescription Vocabulary' },
    ],
  },
  {
    key: 'documents',
    label: 'Documents & Templates',
    items: [{ path: '/settings/documents/templates', label: 'Document Templates' }],
  },
  /*
   * NO "HR & ATTENDANCE" HERE.
   *
   * It held Public Holidays and nothing else, while HR carried its own six
   * settings cards under `/admin/hr/settings`. Two places called HR settings,
   * one of them a single link — a manager looking for one could land on the
   * other. Public Holidays moved to where the rest of HR's settings are.
   */
];

export function SettingsLayout() {
  return <HubShell title="Clinic Settings" categories={SETTINGS_CATEGORIES} />;
}
