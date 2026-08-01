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
    items: [{ path: '/settings/organisation/branches', label: 'Branches' }],
  },
  {
    key: 'scheduling',
    label: 'Appointments & Scheduling',
    items: [
      { path: '/settings/scheduling/doctor-service-mapping', label: 'Doctor-Service Mapping' },
      { path: '/settings/scheduling/slot-capacity', label: 'Slot Capacity' },
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
      { path: '/settings/clinical/diagnoses', label: 'Diagnoses' },
    ],
  },
  {
    key: 'documents',
    label: 'Documents & Templates',
    items: [{ path: '/settings/documents/templates', label: 'Document Templates' }],
  },
  {
    key: 'hr',
    label: 'HR & Attendance',
    items: [{ path: '/settings/hr/public-holidays', label: 'Public Holidays' }],
  },
];

export function SettingsLayout() {
  return <HubShell title="Clinic Settings" categories={SETTINGS_CATEGORIES} />;
}
