import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useLeavePolicies, useAttendancePolicy } from '../hooks/useAdmin';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { IconTile } from '../../design-system/components/IconTile';
import type { TileTone } from '../../design-system/tokens';
import { WakingNote } from '../../core/WakingNote';
import { HrPage, StatusChip, type ChipTone } from './ui';
import { IconClock, IconCompany, IconList, IconSliders } from './ui/icons';
import { SettingsSetupWizard, type SetupStepKey } from './SettingsSetupWizard';
import { companyMissing, useHrSetup } from './useHrSetup';

/**
 * SETTINGS — set up once, then left alone.
 *
 * Until the setup steps are done, Settings is those steps and nothing else
 * (docs/hr-mockup/SetupWizard.html), and HR opens here. After, it is one line
 * saying setup is complete and four cards, each opening the one page where
 * its settings live (docs/hr-mockup/SettingsHome.html). The rarely-touched
 * pages sit under Advanced. Steps and cards read the same setup status
 * (useHrSetup), so a card never says "Complete" while a step is still open.
 *
 * Each card opens a page that calls itself the same thing, and a unit guard
 * fails the build if that ever stops being true.
 */
export function HrSettingsPage() {
  const { clinicId } = useClinicFilter();
  const [params, setParams] = useSearchParams();
  const setup = useHrSetup();
  const attendance = useAttendancePolicy(clinicId);
  const leave = useLeavePolicies();
  const [advanced, setAdvanced] = useState(false);
  const { steps, facts, employerRows, componentRows, holidaysThisYear, thisYear } = setup;
  const leaveRule = (leave.data ?? []).find((row) => row.active) ?? null;
  const missing = companyMissing(employerRows);
  const companyDone = steps.filter((step) => step.key === 'company' || step.key === 'bank').every((step) => step.done);

  const complete = setup.complete;
  const loading = setup.loading;
  const reviewing = params.has('setup');
  // Every Settings card stays reachable while setup is unfinished (UAT, 15 October 2026).
  const showAll = params.has('all');
  const requested = params.get('step') as SetupStepKey | null;
  const openStep: SetupStepKey =
    requested && steps.some((step) => step.key === requested) ? requested : (steps.find((step) => !step.done)?.key ?? 'company');

  const error = setup.error;

  if (loading) {
    return (
      <HrPage title="Settings" error={error instanceof Error ? error.message : null}>
        <WakingNote />
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
      chip: companyDone ? { tone: 'done', label: 'Complete' } : { tone: 'attn', label: `${missing.length + (steps.find((step) => step.key === 'bank')?.done ? 0 : 1)} missing` },
      facts: [
        {
          label: employerRows.length === 1 ? 'Employer' : 'Employers',
          value: employerRows.length === 1 ? employerRows[0].name : employerRows.length,
        },
        { label: 'Numbers and bank', value: companyDone ? 'All on file' : 'Some missing' },
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
      facts: facts.payRules ?? [],
    },
    {
      title: 'Payroll items',
      description: 'What the clinic pays and deducts',
      to: '/admin/hr/settings/payroll-items',
      icon: <IconList />,
      tone: 'teal',
      chip: { tone: 'info', label: `${componentRows.length} in use` },
      facts: facts.items ?? [],
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
          // No policy yet means Kuwick's default, which is the Act's (new-clinic UAT #2, item 74).
          value: !leaveRule || leaveRule.payUntakenLeaveOnExit ? 'Paid out' : 'Not paid out',
        },
        {
          label: `Public holidays ${thisYear}`,
          value: `${holidaysThisYear} days`,
        },
      ],
    },
  ];

  /** The month Kuwick first paid anybody here — what "opening balances" is measured against. */
  const firstRunPeriod = setup.runs
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
          {complete ? '✓' : '!'}
        </span>
        <b>{complete ? 'Setup complete' : `Setup: ${steps.filter((step) => step.done).length} of ${steps.length} steps done`}</b>
        <span className="hr-sub">{complete ? `${steps.length} of ${steps.length} steps` : 'Finish the rest to start payroll'}</span>
        <span className="hr-setupDone__link">{complete ? 'Review setup' : 'Continue setup'}</span>
      </Link>
      {/* Setup is the way to the first payroll (new-clinic UAT #2, item 75). */}
      {complete && !setup.runs.some((row) => row.status !== 'CANCELLED') ? (
        <div className="hr-actions hr-mb">
          <Link className="hr-btn hr-btn--primary" to="/admin/hr/payroll">
            Run your first payroll →
          </Link>
        </div>
      ) : null}

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
