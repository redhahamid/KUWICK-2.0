import { Button } from 'antd';
import { Link } from 'react-router-dom';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { StatusChip } from '../components/Chip';
import {
  useLegalEmployers,
  usePayComponents,
  usePayrollApprovalPolicy,
  useStatutoryRuleSets,
} from '../hooks/useAdmin';

/**
 * SETTINGS — a landing, not a wall.
 *
 * What was here was one page carrying the setup checklist, the company
 * registration table, the approval rule, the attendance rules and an
 * "Advanced" list of links — about two thousand pixels of configuration, all
 * of it presented at once to somebody who came to change one thing.
 *
 * Settings sits outside the six workflow sections deliberately: nothing in it
 * is part of paying somebody this month. So the landing answers the two
 * questions somebody actually arrives with — "is this clinic set up?" and
 * "where do I change X?" — and each configuration area keeps its own page.
 *
 * THE CHECKLIST IS THE SCREEN, not a decoration on it. A clinic that cannot
 * see which of the six is outstanding discovers the answer on pay day.
 */
export function HrSettingsPage() {
  const employers = useLegalEmployers();
  const components = usePayComponents();
  const statutory = useStatutoryRuleSets();
  const approval = usePayrollApprovalPolicy();

  const employerRows = employers.data ?? [];
  const componentCount = components.data?.components?.length ?? 0;
  const verified = (statutory.data ?? []).some((set) => set.verified);

  // An employer that cannot file is an employer that cannot pay: EPF, SOCSO,
  // EIS and PCB submissions are all made by an entity, and one missing number
  // stops all four.
  const incompleteEmployers = employerRows.filter(
    (row) => !row.epfEmployerNo || !row.socsoEmployerNo || !row.lhdnEmployerNo,
  );

  /*
   * EVERY STEP OPENS SOMEWHERE, AND ONE OF THEM IS NOT A STEP.
   *
   * Three of the six had no button at all. "What you pay people" had nowhere
   * to go because the pay components had no screen; they have one now. "Check
   * the statutory rates" told a clinic that payroll stays in test mode until
   * somebody checks the tables, without saying where the tables are. And
   * "Bank payment file" is not something this clinic can do: no bank's format
   * is on record, so it was an item nobody could ever tick, sitting in a
   * denominator and making a finished setup read "5 of 6".
   *
   * It stays visible — a clinic asking "can Kuwick write my bank file?"
   * deserves the answer — but as OPTIONAL, outside the count.
   */
  type SetupStep = {
    key: string;
    title: string;
    done: boolean;
    detail: string;
    to: string | null;
    optional?: true;
  };
  const steps: SetupStep[] = [
    {
      key: 'company',
      title: 'Your company',
      done: employerRows.length > 0 && incompleteEmployers.length === 0,
      detail:
        employerRows.length === 0
          ? 'No legal employer is recorded. Nothing can be filed or paid without one.'
          : incompleteEmployers.length > 0
            ? `${incompleteEmployers.map((row) => row.name).join(', ')} ${
                incompleteEmployers.length === 1 ? 'is' : 'are'
              } missing an EPF, SOCSO or LHDN number.`
            : `${employerRows.length} employer${employerRows.length === 1 ? '' : 's'} with registration, EPF, SOCSO and LHDN numbers.`,
      to: '/admin/hr/settings/company',
    },
    {
      key: 'policy',
      title: 'How pay is worked out',
      done: true,
      detail:
        'Overtime on a 26-day month, unpaid leave on calendar days. Frozen onto every run, so a later change cannot reprice a past month.',
      to: '/admin/hr/settings/payroll',
    },
    {
      key: 'components',
      title: 'What you pay people',
      done: componentCount > 0,
      detail:
        componentCount > 0
          ? `${componentCount} kinds of pay and deduction, from basic salary to mileage.`
          : 'No pay components are configured, so payroll cannot classify anything it pays.',
      to: '/admin/hr/settings/payroll-items',
    },
    {
      key: 'employees',
      title: 'Your employees',
      done: true,
      detail: 'Salary, bank account and statutory details, per person.',
      to: '/admin/hr/employees',
    },
    {
      key: 'rates',
      title: 'Check the statutory rates',
      done: verified,
      detail: verified
        ? 'The EPF, SOCSO and EIS tables in force have been checked against KWSP and PERKESO.'
        : 'EPF, SOCSO and EIS tables are loaded but unchecked against KWSP and PERKESO. Until somebody checks them, payroll stays in test mode and no run may be paid or filed.',
      to: '/admin/hr/settings/payroll',
    },
    {
      key: 'bank',
      title: 'Bank payment file',
      done: false,
      detail:
        'Not available. No bank’s format is on record, so what downloads is a listing for keying at the bank’s own portal.',
      to: null,
      optional: true,
    },
  ];

  const required = steps.filter((step) => !step.optional);
  const complete = required.filter((step) => step.done).length;

  /*
   * SIX CARDS, IN THE ORDER A CLINIC SETS THEM UP.
   *
   * The set changed rather than merely being renamed. "Who can do what" left:
   * roles are product-wide, not HR's, and having them in two places meant two
   * screens could disagree about who may approve a payroll. "Leave policies"
   * pointed at the Leave SCREEN, which is where leave is decided, not where
   * its policy is written — it joins Attendance rules, because a clinic sets
   * both on the same afternoon.
   *
   * "Payroll items" is new as a place. The seventeen pay components have
   * existed since the engine was built and had no screen at all: Payroll rules
   * printed the sentence "17 pay components are configured" and stopped.
   */
  const areas = [
    {
      title: 'Company & statutory',
      description: 'The entity that employs, files and pays. A branch is where the work happens; it files nothing.',
      to: '/admin/hr/settings/company',
      state: incompleteEmployers.length > 0 ? ('attention' as const) : ('ok' as const),
    },
    {
      title: 'Payroll items',
      description: 'What the clinic can pay or deduct, and what each one counts towards.',
      to: '/admin/hr/settings/payroll-items',
      state: 'ok' as const,
    },
    {
      title: 'Payroll policies',
      description: 'Who may approve a run, what counts as pay, and how overtime and unpaid leave are priced.',
      to: '/admin/hr/settings/payroll',
      state: 'ok' as const,
    },
    {
      title: 'Attendance & leave policies',
      description: 'The grace period before somebody is late, and what counts as a full day.',
      to: '/admin/hr/settings/attendance-leave',
      state: 'ok' as const,
    },
    {
      title: 'Public holidays',
      description: 'The days the clinic is closed, which attendance and leave both read.',
      to: '/admin/hr/settings/public-holidays',
      state: 'ok' as const,
    },
    {
      title: 'Opening balances',
      description: 'Year-to-date figures for a clinic joining Kuwick part-way through a tax year.',
      to: '/admin/hr/settings/opening-balances',
      state: 'ok' as const,
    },
  ];

  return (
    <AdminShell
      error={firstError(employers, components, statutory, approval)}
      title="Settings"
      subtitle="Set up once, then leave alone. Nothing here is part of running a monthly payroll."
    >
      {!verified ? (
        <AdminNotice tone="warn">
          <strong>Statutory rates are loaded but unchecked</strong> against KWSP's and PERKESO's own schedules. The last thing between this clinic and live payroll.
        </AdminNotice>
      ) : null}

      <StatStrip
        stats={[
          { label: 'Setup complete', value: `${complete} of ${required.length}`, tone: complete === required.length ? 'good' : 'warn' },
          { label: 'Legal employers', value: employerRows.length, tone: incompleteEmployers.length > 0 ? 'warn' : 'good' },
          { label: 'Pay components', value: componentCount },
          {
            label: 'Statutory rates',
            value: <span className="kw-stat__word">{verified ? 'Checked' : 'Unchecked'}</span>,
            tone: verified ? 'good' : 'warn',
          },
        ]}
      />

      <AdminSection
        title={`One-time setup — ${complete} of ${required.length} complete`}
        description="Five things to settle before Kuwick can run live payroll for this clinic, and one that is not this clinic’s to settle."
      >
        <div className="kw-setupList">
          {steps.map((step) => (
            <div key={step.key} className="kw-setupList__row">
              {/* Numbered 1-5 by POSITION AMONG THE REQUIRED, so the optional
                  row does not wear a "6" that nothing counts. */}
              <span className={`kw-setupList__mark kw-setupList__mark--${step.done ? 'done' : 'todo'}`}>
                {step.optional ? '·' : step.done ? '✓' : required.indexOf(step) + 1}
              </span>
              <div className="kw-setupList__body">
                <div className="kw-setupList__title">{step.title}</div>
                <div className="kw-setupList__detail">{step.detail}</div>
              </div>
              <div className="kw-setupList__action">
                {step.optional ? (
                  <StatusChip tone="neutral">Optional</StatusChip>
                ) : step.done ? (
                  <StatusChip tone="ok" dot>
                    Done
                  </StatusChip>
                ) : null}
                {step.to ? (
                  <Link to={step.to}>
                    <Button size="small">Open</Button>
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </AdminSection>

      <AdminSection title="Where things are configured">
        <div className="kw-reportGrid">
          {areas.map((area) => (
            <Link key={area.title} className="kw-reportCard kw-reportCard--link" to={area.to}>
              <span className="kw-reportCard__cat">{area.state === 'attention' ? 'Needs attention' : 'Settings'}</span>
              <span className="kw-reportCard__title">{area.title}</span>
              <span className="kw-reportCard__desc">{area.description}</span>
              <span className="kw-reportCard__scope">Open →</span>
            </Link>
          ))}
        </div>
      </AdminSection>

      <p className="kw-adminSection__desc">
        No bank payment file and no authority submission files. Filings happen at each authority's portal and are recorded here with their reference.
      </p>
    </AdminShell>
  );
}
