import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  useEmployees,
  useLeavePolicies,
  useLegalEmployers,
  usePayComponents,
  usePayrollApprovalPolicy,
  usePayrollPolicies,
  usePayrollRuns,
  useStatutoryRates,
  useAttendancePolicy,
} from '../hooks/useAdmin';
import { usePublicHolidays } from '../../hr/hooks/usePublicHolidays';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { IconTile } from '../../design-system/components/IconTile';
import type { TileTone } from '../../design-system/tokens';
import { HrPage, StatusChip, type ChipTone } from './ui';
import { IconClock, IconCompany, IconList, IconSliders } from './ui/icons';
import { payDateLabel } from './PayDateCell';
import { SettingsSetupWizard, type SetupStep, type SetupStepKey } from './SettingsSetupWizard';

const APPROVED_BY: Record<string, string> = {
  STANDARD: 'One approver',
  MAKER_CHECKER: 'Somebody other than the preparer',
  DUAL_APPROVAL: 'Two approvers',
};

/**
 * SETTINGS — set up once, then left alone.
 *
 * Until the five setup steps are done, Settings is those steps and nothing
 * else (docs/hr-mockup/SetupWizard.html). After, it is one line saying setup
 * is complete and four cards, each opening the one page where its settings
 * live (docs/hr-mockup/SettingsHome.html). The rarely-touched pages sit under
 * Advanced. Employees are not a setting: the setup step opens the Employees
 * page, and nothing here edits a person.
 *
 * Each card opens a page that calls itself the same thing, and a unit guard
 * fails the build if that ever stops being true.
 */
export function HrSettingsPage() {
  const { clinicId } = useClinicFilter();
  const [params, setParams] = useSearchParams();
  const employers = useLegalEmployers();
  const components = usePayComponents();
  const approval = usePayrollApprovalPolicy();
  const policies = usePayrollPolicies();
  const holidays = usePublicHolidays();
  const runs = usePayrollRuns({ clinicId });
  const rates = useStatutoryRates();
  const attendance = useAttendancePolicy(clinicId);
  const leave = useLeavePolicies();
  const employees = useEmployees({ clinicId });
  const [advanced, setAdvanced] = useState(false);

  const employerRows = employers.data ?? [];
  const componentRows = (components.data?.components ?? []).filter((row) => row.active);
  const employeeCount = (employees.data ?? []).filter((row) => row.active).length;
  const clinicCheck = rates.data?.check ?? null;
  const checked = clinicCheck && clinicCheck.current ? clinicCheck : null;
  const rule = (policies.data?.policies ?? []).find((row) => row.isDefault) ?? policies.data?.policies[0] ?? null;

  // An employer that cannot file is an employer that cannot pay: EPF, SOCSO,
  // EIS and PCB submissions are all made by an entity, and one missing number
  // stops all four.
  // Only employers with staff need their numbers (UAT, 15 October 2026): a
  // test company nobody works for must not hold the whole of Settings back.
  const missingNumbers = employerRows.filter((row) => (row.employeeCount ?? 0) > 0).flatMap((row) =>
    [!row.epfEmployerNo ? 'EPF' : null, !row.socsoEmployerNo ? 'SOCSO' : null, !row.lhdnEmployerNo ? 'LHDN' : null].filter(
      (value): value is string => Boolean(value),
    ),
  );

  const partMonth = rule ? (rule.partMonthBasis === 'WORKING_DAYS' ? 'Working days' : 'Calendar days') : 'Calendar days';
  const overtimeOn = rule?.overtime.days ? `${rule.overtime.days} days` : 'Days in the month';

  /** Items grouped by when they are paid, largest group first. */
  const payDates = Object.entries(
    componentRows.reduce<Record<string, string[]>>((groups, row) => {
      const label = payDateLabel(row);
      (groups[label] ??= []).push(row.name);
      return groups;
    }, {}),
  ).sort((a, b) => b[1].length - a[1].length);
  const names = (list: string[]) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3}` : list.join(', '));

  const thisYear = dayjs().year();
  const holidaysThisYear = (holidays.data ?? []).filter((row) => dayjs(row.date).year() === thisYear).length;
  const leaveRule = (leave.data ?? []).find((row) => row.active) ?? null;

  const steps: SetupStep[] = [
    {
      key: 'company',
      title: 'Company & statutory numbers',
      done: employerRows.length > 0 && missingNumbers.length === 0,
      summary:
        employerRows.length === 0
          ? 'No employer yet'
          : missingNumbers.length > 0
            ? `${missingNumbers.length} number${missingNumbers.length === 1 ? '' : 's'} missing`
            : 'EPF · SOCSO · LHDN on file',
      intro: 'The employer that pays the staff. These numbers print on payslips and filing listings.',
    },
    {
      key: 'payRules',
      title: 'Pay rules',
      // Kuwick's rules apply until the clinic sets its own, so there is always an answer.
      done: true,
      summary: `${partMonth === 'Calendar days' ? 'Calendar-day' : 'Working-day'} proration · OT on ${overtimeOn}`,
      intro: 'How a part month, overtime and holiday pay are worked out, and who approves a payroll month.',
    },
    {
      key: 'items',
      title: 'Payroll items',
      done: componentRows.length > 0,
      summary:
        componentRows.length > 0
          ? `${componentRows.length} in use · ${payDates.length} pay date${payDates.length === 1 ? '' : 's'}`
          : 'None set up',
      intro: 'What the clinic pays and deducts, what each counts towards, and when each is paid.',
    },
    {
      key: 'employees',
      title: 'Employees',
      done: employeeCount > 0,
      summary: employeeCount > 0 ? `${employeeCount} employees · opens the Employees page` : 'Nobody to pay yet',
      intro: 'Salary, bank account and statutory details for each person, kept on the Employees page.',
    },
    {
      key: 'rates',
      title: 'Check statutory rates',
      done: Boolean(checked),
      summary: checked
        ? `Checked ${dayjs(checked.checkedAt).format('D MMM YYYY')}`
        : clinicCheck
          ? 'Tables changed since your check'
          : 'Not checked yet',
      intro: 'A look at the EPF, SOCSO and EIS tables Kuwick uses. Until somebody here checks them, no payroll month may be paid or filed.',
    },
  ];

  const facts: Record<Exclude<SetupStepKey, 'company'>, { label: string; value: ReactNode }[]> = {
    payRules: [
      { label: 'Part-month pay', value: partMonth },
      { label: 'Overtime worked out on', value: overtimeOn },
      {
        label: 'Approved by',
        value: approval.data ? (APPROVED_BY[approval.data.mode] ?? approval.data.mode) : 'One approver',
      },
    ],
    // EVERY PAY DATE, one row each (UAT, 10 October 2026: the 1st, for the
    // director's fee, was cut off after two), then what is in use and who an
    // item is for when there are fewer than three dates.
    items: [
      ...(payDates.length
        ? payDates.map(([label, list]) => ({ label: `Paid on the ${label}`, value: names(list) }))
        : [{ label: 'Paid on', value: 'Nothing set up yet' }]),
      ...(payDates.length < 3
        ? [
            {
              label: 'In use',
              value: `${componentRows.filter((row) => row.type !== 'DEDUCTION').length} add · ${componentRows.filter((row) => row.type === 'DEDUCTION').length} deduct`,
            },
          ]
        : []),
      ...(payDates.length < 2
        ? [
            {
              label: 'For named people only',
              value: names(componentRows.filter((row) => row.appliesTo === 'SELECTED').map((row) => row.name)) || 'None',
            },
          ]
        : []),
    ],
    employees: [
      { label: 'Active employees', value: employeeCount },
      { label: 'Where', value: 'The Employees page, not Settings' },
    ],
    rates: [
      { label: 'Tables', value: 'EPF · SOCSO · EIS' },
      {
        label: 'Last checked here',
        value: clinicCheck
          ? `${dayjs(clinicCheck.checkedAt).format('D MMM YYYY')}${clinicCheck.checkedBy ? `, ${clinicCheck.checkedBy}` : ''}${clinicCheck.current ? '' : ' · tables changed since'}`
          : 'Never',
      },
    ],
  };

  const complete = steps.every((step) => step.done);
  const loading = [employers, components, employees, rates].some((query) => query.isLoading);
  const reviewing = params.has('setup');
  // Every Settings card stays reachable while setup is unfinished (UAT, 15 October 2026).
  const showAll = params.has('all');
  const requested = params.get('step') as SetupStepKey | null;
  const openStep: SetupStepKey =
    requested && steps.some((step) => step.key === requested) ? requested : (steps.find((step) => !step.done)?.key ?? 'company');

  const error = [employers, components, approval, policies].find((query) => query.error)?.error;

  if (loading) {
    return (
      <HrPage title="Settings" error={error instanceof Error ? error.message : null}>
        <div className="hr-note">Loading…</div>
      </HrPage>
    );
  }

  if ((!complete && !showAll) || reviewing) {
    return (
      <SettingsSetupWizard
        steps={steps}
        open={openStep}
        onOpen={(key) => setParams(reviewing ? { setup: '1', step: key } : { step: key })}
        onFinished={() => setParams({})}
        reviewing={complete && reviewing}
        employers={employerRows}
        facts={facts}
        error={error instanceof Error ? error.message : null}
      />
    );
  }

  const areas: {
    title: string;
    description: string;
    to: string;
    icon: ReactElement;
    tone: TileTone;
    chip: { tone: ChipTone; label: string };
    facts: { label: string; value: ReactNode }[];
  }[] = [
    {
      title: 'Company & statutory',
      description: 'Who employs and files',
      to: '/admin/hr/settings/company',
      icon: <IconCompany />,
      tone: 'indigo',
      chip: { tone: 'done', label: 'Complete' },
      facts: [
        {
          label: employerRows.length === 1 ? 'Employer' : 'Employers',
          value: employerRows.length === 1 ? employerRows[0].name : employerRows.length,
        },
        { label: 'EPF · SOCSO · LHDN', value: 'All on file' },
        {
          label: 'Zakat through payroll',
          value: employerRows.some((row) => row.zakatThroughPayroll) ? 'On' : 'Off',
        },
      ],
    },
    {
      title: 'Pay rules',
      description: 'How pay is worked out and approved',
      to: '/admin/hr/settings/payroll',
      icon: <IconSliders />,
      tone: 'violet',
      chip: { tone: 'done', label: 'Set' },
      facts: facts.payRules,
    },
    {
      title: 'Payroll items',
      description: 'What the clinic pays and deducts',
      to: '/admin/hr/settings/payroll-items',
      icon: <IconList />,
      tone: 'teal',
      chip: { tone: 'info', label: `${componentRows.length} in use` },
      facts: facts.items,
    },
    {
      title: 'Attendance & leave',
      description: 'Clock-in, leave and holidays',
      to: '/admin/hr/settings/attendance-leave',
      icon: <IconClock />,
      tone: 'sky',
      chip: attendance.data?.source === 'KUWICK_DEFAULT' ? { tone: 'muted', label: 'Defaults' } : { tone: 'done', label: 'Set' },
      facts: [
        {
          label: 'Leave carry forward',
          value: leaveRule?.carryForwardDays ? `Up to ${leaveRule.carryForwardDays} days` : 'None',
        },
        {
          label: 'Unused leave on leaving',
          value: leaveRule?.payUntakenLeaveOnExit ? 'Paid out' : 'Not paid out',
        },
        {
          label: `Public holidays ${thisYear}`,
          value: `${holidaysThisYear} days`,
        },
      ],
    },
  ];

  /** The month Kuwick first paid anybody here — what "opening balances" is measured against. */
  const firstRunPeriod = (runs.data ?? [])
    .filter((row) => row.status !== 'CANCELLED')
    .map((row) => row.period)
    .sort()[0];

  return (
    <HrPage
      title="Settings"
      sub="Set once. Come back only when the clinic changes something."
      error={error instanceof Error ? error.message : null}
    >
      <Link className="hr-setupDone" to="/admin/hr/settings?setup=1">
        <span className="hr-setupDone__tick" aria-hidden="true">
          ✓
        </span>
        <b>Setup complete</b>
        <span className="hr-sub">
          {steps.length} of {steps.length} steps · payroll can go live
        </span>
        <span className="hr-setupDone__link">Review setup</span>
      </Link>

      <div className="hr-areas">
        {areas.map((area) => (
          <Link key={area.title} className="hr-area" to={area.to}>
            <div className="hr-area__head">
              <IconTile tone={area.tone}>{area.icon}</IconTile>
              <div>
                <h3 className="hr-card__title">{area.title}</h3>
                <div className="hr-sub">{area.description}</div>
              </div>
              <StatusChip tone={area.chip.tone}>{area.chip.label}</StatusChip>
            </div>
            <div className="hr-facts">
              {area.facts.map((fact) => (
                <div key={fact.label} className="hr-facts__row">
                  <span>{fact.label}</span>
                  <b>{fact.value}</b>
                </div>
              ))}
            </div>
          </Link>
        ))}
      </div>

      <section className="hr-advanced">
        <div className="hr-advanced__bar">
          <b>Advanced</b>
          <span className="hr-sub">Statutory rate tables · Opening balances · Bank payment file</span>
          <button type="button" className="hr-btn" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
            {advanced ? 'Hide' : 'Show'}
          </button>
        </div>
        {advanced ? (
          <div className="hr-advanced__rows">
            <Link className="hr-advanced__row" to="/admin/hr/settings/statutory">
              <b>Statutory rates</b>
              <span className="hr-sub">EPF, SOCSO and EIS tables as the calculation reads them.</span>
            </Link>
            <Link className="hr-advanced__row" to="/admin/hr/settings/opening-balances">
              <b>Opening balances</b>
              <span className="hr-sub">
                Year-to-date pay for a clinic joining part-way through the year.
                {firstRunPeriod ? ` First payroll month here: ${dayjs(firstRunPeriod).format('MMM YYYY')}.` : ''}
              </span>
            </Link>
            <div className="hr-advanced__row">
              <b>Bank payment file</b>
              <span className="hr-sub">No bank format on record. Payroll downloads a listing you key in at the bank.</span>
            </div>
          </div>
        ) : null}
      </section>

      <p className="hr-note">Roles and permissions are in Organisation settings, because they cover every module.</p>
    </HrPage>
  );
}
