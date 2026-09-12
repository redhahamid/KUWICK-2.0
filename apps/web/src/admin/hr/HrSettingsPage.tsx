import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  useEmployees,
  useLegalEmployers,
  usePayComponents,
  usePayrollApprovalPolicy,
  usePayrollRuns,
  useStatutoryRates,
  useStatutoryRuleSets,
  useAttendancePolicy,
} from '../hooks/useAdmin';
import { usePublicHolidays } from '../../hr/hooks/usePublicHolidays';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { HrPage, Panel, PanelHead, StatusChip, type ChipTone } from './ui';
import {
  IconCalendar,
  IconClock,
  IconCompany,
  IconList,
  IconOpeningBalances,
  IconSliders,
} from './ui/icons';

/**
 * SETTINGS — set up once, then left alone.
 *
 * Two questions, in the order a clinic asks them. "Can I run a live payroll
 * yet?" is the checklist at the top, and it is five things, not six: the bank
 * payment file is not this clinic's to settle — no bank format is on record —
 * so it sits below the line as optional rather than in a denominator nobody
 * can ever finish.
 *
 * "Where do I change X?" is the six cards. Each card opens a page that calls
 * itself the same thing, and a unit guard fails the build if that ever stops
 * being true.
 */
export function HrSettingsPage() {
  const { clinicId } = useClinicFilter();
  const employers = useLegalEmployers();
  const components = usePayComponents();
  const statutory = useStatutoryRuleSets();
  const approval = usePayrollApprovalPolicy();
  const holidays = usePublicHolidays();
  const runs = usePayrollRuns({ clinicId });
  const rates = useStatutoryRates();
  const attendance = useAttendancePolicy(clinicId);
  const employees = useEmployees({ clinicId });

  const employerRows = employers.data ?? [];
  const componentRows = components.data?.components ?? [];
  const componentCount = componentRows.length;
  const employeeCount = (employees.data ?? []).filter((row) => row.active).length;
  const rateSets = statutory.data ?? [];
  const registryOk = rateSets.length > 0 && rateSets.every((set) => set.verified);
  /** The clinic's own check of the registry — a named person, on a date. */
  const clinicCheck = rates.data?.check ?? null;
  const checked = clinicCheck && clinicCheck.current ? clinicCheck : null;

  // An employer that cannot file is an employer that cannot pay: EPF, SOCSO,
  // EIS and PCB submissions are all made by an entity, and one missing number
  // stops all four.
  const missingNumbers = employerRows.flatMap((row) =>
    [
      !row.epfEmployerNo ? 'EPF' : null,
      !row.socsoEmployerNo ? 'SOCSO' : null,
      !row.lhdnEmployerNo ? 'LHDN' : null,
    ].filter((value): value is string => Boolean(value)),
  );
  const presentNumbers = ['EPF', 'SOCSO', 'LHDN'].filter((scheme) => !missingNumbers.includes(scheme));
  const incompleteEmployers = employerRows.filter(
    (row) => !row.epfEmployerNo || !row.socsoEmployerNo || !row.lhdnEmployerNo,
  );

  const thisYear = dayjs().year();
  const holidaysThisYear = (holidays.data ?? []).filter((row) => dayjs(row.date).year() === thisYear).length;

  /** The month Kuwick first paid anybody here — what "opening balances" is measured against. */
  const firstRunPeriod = (runs.data ?? [])
    .filter((row) => row.status !== 'CANCELLED')
    .map((row) => row.period)
    .sort()[0];

  const changedOn = (dates: (string | undefined)[]) => {
    const sorted = dates.filter((date): date is string => Boolean(date)).sort();
    const latest = sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
    return latest ? `Changed ${dayjs(latest).format('D MMM')}` : null;
  };

  type SetupStep = {
    key: string;
    title: string;
    detail: ReactNode;
    /** The word or two that is outstanding, shown beside the progress ring. */
    outstanding?: string;
    done: boolean;
    to: string | null;
    optional?: true;
  };

  const steps: SetupStep[] = [
    {
      key: 'company',
      title: 'Company & statutory numbers',
      done: employerRows.length > 0 && incompleteEmployers.length === 0,
      outstanding: missingNumbers.length > 0 ? `${missingNumbers[0]} employer number` : 'A legal employer',
      detail:
        employerRows.length === 0
          ? 'No legal employer is recorded. Nothing can be filed or paid without one.'
          : incompleteEmployers.length > 0
            ? (
                <>
                  {incompleteEmployers.map((row) => row.name).join(', ')} —{' '}
                  <em>
                    {missingNumbers.join(', ')} employer {missingNumbers.length === 1 ? 'number' : 'numbers'} missing.
                  </em>
                  {presentNumbers.length > 0 ? ` ${presentNumbers.join(' and ')} ${presentNumbers.length === 1 ? 'is' : 'are'} in.` : ''}
                </>
              )
            : `${employerRows.length} employer${employerRows.length === 1 ? '' : 's'} with registration, EPF, SOCSO and LHDN numbers.`,
      to: '/admin/hr/settings/company',
    },
    {
      key: 'policy',
      title: 'How pay is worked out',
      done: true,
      detail:
        'Overtime on a 26-day month. Unpaid leave on calendar days. Frozen into each run, so a later change cannot reprice a past month.',
      to: '/admin/hr/settings/payroll',
    },
    {
      key: 'components',
      title: 'Payroll items',
      done: componentCount > 0,
      outstanding: 'Pay items',
      detail:
        componentCount > 0
          ? `${componentCount} items, from basic salary to mileage. Each one says what it counts towards.`
          : 'No pay items are set up, so payroll cannot classify anything it pays.',
      to: '/admin/hr/settings/payroll-items',
    },
    {
      key: 'employees',
      title: 'Employees',
      done: employeeCount > 0,
      outstanding: 'Somebody to pay',
      detail:
        employeeCount > 0
          ? `${employeeCount} employees with salary, bank account and statutory details.`
          : 'Nobody is on the payroll yet.',
      to: '/admin/hr/employees',
    },
    {
      key: 'rates',
      title: 'Statutory rates checked',
      done: Boolean(checked),
      outstanding: 'A look at the statutory tables',
      detail: checked
        ? `EPF, SOCSO and EIS tables in force, checked by ${checked.checkedBy ?? 'this clinic'} on ${dayjs(checked.checkedAt).format('D MMM YYYY')}.`
        : clinicCheck
          ? `Checked on ${dayjs(clinicCheck.checkedAt).format('D MMM YYYY')}, but the tables have changed since. Look again.`
          : registryOk
            ? "Kuwick's tables are verified against KWSP, PERKESO and LHDN. Nobody here has looked at them yet."
            : 'EPF, SOCSO and EIS tables are loaded but unchecked. Until somebody checks them, payroll stays in test mode and no run may be paid or filed.',
      to: '/admin/hr/settings/statutory',
    },
    {
      key: 'bank',
      title: 'Bank payment file',
      done: false,
      optional: true,
      detail:
        "No bank format on record. Payroll downloads a listing you key in at the bank's own portal.",
      to: null,
    },
  ];

  const required = steps.filter((step) => !step.optional);
  const complete = required.filter((step) => step.done).length;
  const outstanding = required.find((step) => !step.done);
  const headline =
    complete === required.length ? 'All done' : complete === required.length - 1 ? 'One to go' : `${required.length - complete} to go`;

  const areas: { title: string; description: string; to: string; icon: ReactElement; tone: ChipTone; state: string; meta: string | null }[] = [
    {
      title: 'Company & statutory',
      description: 'The entity that employs, files and pays. Its EPF, SOCSO, EIS and LHDN numbers.',
      to: '/admin/hr/settings/company',
      icon: <IconCompany />,
      tone: incompleteEmployers.length > 0 ? 'attn' : 'done',
      state:
        incompleteEmployers.length > 0
          ? `${missingNumbers.length} number${missingNumbers.length === 1 ? '' : 's'} missing`
          : 'All numbers on file',
      meta: `${employerRows.length} employer${employerRows.length === 1 ? '' : 's'}`,
    },
    {
      title: 'Payroll items',
      description: 'What the clinic can pay or deduct, and whether each counts for EPF, SOCSO, EIS, PCB and HRD.',
      to: '/admin/hr/settings/payroll-items',
      icon: <IconList />,
      tone: componentCount > 0 ? 'done' : 'attn',
      state: componentCount > 0 ? `${componentCount} in use` : 'None set up',
      meta: changedOn(componentRows.map((row) => row.updatedAt)),
    },
    {
      title: 'Payroll policies',
      description: 'Who may approve a run, how overtime and unpaid leave are priced, cut-off day.',
      to: '/admin/hr/settings/payroll',
      icon: <IconSliders />,
      tone: approval.data ? 'done' : 'muted',
      state: approval.data ? 'Set' : 'Not set',
      meta: changedOn([approval.data?.updatedAt]),
    },
    {
      title: 'Attendance & leave policies',
      description: 'Grace period, what counts as a full day, and what counts as overtime.',
      to: '/admin/hr/settings/attendance-leave',
      icon: <IconClock />,
      tone: attendance.data?.source === 'KUWICK_DEFAULT' ? 'muted' : 'done',
      state: attendance.data?.source === 'KUWICK_DEFAULT' ? "Kuwick's defaults" : 'Set',
      meta: changedOn([attendance.data?.updatedAt ?? undefined]),
    },
    {
      title: 'Public holidays',
      description: 'Days the clinic is closed. Attendance and leave both read from this list.',
      to: '/admin/hr/settings/public-holidays',
      icon: <IconCalendar />,
      tone: holidaysThisYear > 0 ? 'done' : 'attn',
      state: `${holidaysThisYear} for ${thisYear}`,
      meta: holidaysThisYear > 0 ? null : 'Add the Malaysia list',
    },
    {
      title: 'Opening balances',
      description: 'Year-to-date pay and deductions for a clinic joining Kuwick part-way through the year.',
      to: '/admin/hr/settings/opening-balances',
      icon: <IconOpeningBalances />,
      tone: 'muted',
      state: firstRunPeriod && dayjs(firstRunPeriod).month() > 0 ? 'Check these' : 'Not needed',
      // A clinic that started in January has nothing to carry in. Blank rather
      // than a guess when Kuwick has not paid anybody here yet.
      meta: firstRunPeriod ? `Started ${dayjs(firstRunPeriod).format('MMM YYYY')}` : null,
    },
  ];

  const error = [employers, components, statutory, approval].find((query) => query.error)?.error;

  return (
    <HrPage
      title="Settings"
      sub="Set up once. Come back when the clinic changes something, not every month."
      error={error instanceof Error ? error.message : null}
    >
      <Panel>
        <PanelHead
          title="Before the first live payroll"
          sub={`${required.length} things to settle. Kuwick blocks a live run until all ${required.length} are done.`}
          actions={
            <div className="hr-progress">
              <span
                className="hr-ring"
                style={{
                  background: `conic-gradient(var(--hr-green) 0 ${(complete / required.length) * 360}deg, var(--hr-gold) ${
                    (complete / required.length) * 360
                  }deg 360deg)`,
                }}
              >
                <i>
                  {complete}/{required.length}
                </i>
              </span>
              <span>
                <b>{headline}</b>
                {outstanding?.outstanding ?? ''}
              </span>
            </div>
          }
        />
        {steps.map((step) => (
          <div key={step.key} className={`hr-setupRow${step.optional ? ' hr-setupRow--optional' : ''}`}>
            <span
              className={`hr-setupRow__num${
                step.optional ? '' : step.done ? ' hr-setupRow__num--ok' : ' hr-setupRow__num--warn'
              }`}
            >
              {step.optional ? '–' : step.done ? '✓' : required.indexOf(step) + 1}
            </span>
            <div>
              <div className="hr-setupRow__title">
                {step.title}
                {step.optional ? <StatusChip tone="muted">Optional</StatusChip> : null}
              </div>
              <div className="hr-setupRow__detail">{step.detail}</div>
            </div>
            {step.optional ? <span /> : <StatusChip tone={step.done ? 'done' : 'attn'}>{step.done ? 'Done' : 'Needs attention'}</StatusChip>}
            {step.to ? (
              <Link className="hr-btn hr-btn--sm" to={step.to}>
                Open
              </Link>
            ) : (
              <span />
            )}
          </div>
        ))}
      </Panel>

      <h2 className="hr-sec">Everything you can change</h2>
      <div className="hr-grid3">
        {areas.map((area) => (
          <Link key={area.title} className={`hr-card${area.tone === 'attn' ? ' hr-card--attn' : ''}`} to={area.to}>
            <div className="hr-card__head">
              <span className="hr-card__icon">{area.icon}</span>
              <h3 className="hr-card__title">{area.title}</h3>
            </div>
            <p>{area.description}</p>
            <div className="hr-card__foot">
              <StatusChip tone={area.tone}>{area.state}</StatusChip>
              <span>{area.meta}</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="hr-note">
        Roles and permissions live under Organisation settings, because they cover every module, not just HR.
      </div>
    </HrPage>
  );
}
