import { Link } from 'react-router-dom';
import { App, Button, Tag } from 'antd';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { DataTable } from '../components/DataTable';
import {
  useLegalEmployers,
  usePayComponents,
  useSeedPayComponents,
  useStatutoryRuleSets,
} from '../hooks/useAdmin';
import type { LegalEmployerRow } from '../types';

/**
 * PAYROLL SETTINGS — set up once, then leave alone.
 *
 * The owner rejected an admin console where running a monthly payroll and
 * configuring one lived in the same navigation. Nothing on this page is part of
 * paying somebody this month: it is the six things that have to be true before
 * Kuwick can run live payroll at all, and after that it is a page nobody opens.
 *
 * The checklist is the screen, not a decoration on it. A clinic that cannot see
 * which of the six is outstanding discovers the answer on pay day.
 */
export function PayrollSettingsPage() {
  const { message } = App.useApp();
  const employers = useLegalEmployers();
  const components = usePayComponents();
  const statutory = useStatutoryRuleSets();
  const seed = useSeedPayComponents();

  const employerRows = employers.data ?? [];
  const componentCount = components.data?.components?.length ?? 0;
  const rateSets = statutory.data ?? [];
  const verified = rateSets.some((set) => set.verified);

  // An employer that cannot file is an employer that cannot pay: EPF, SOCSO,
  // EIS and PCB submissions are all made by an entity, and one missing number
  // stops all four.
  const incompleteEmployers = employerRows.filter(
    (row) => !row.epfEmployerNo || !row.socsoEmployerNo || !row.lhdnEmployerNo,
  );

  type SetupStep = {
    key: string;
    title: string;
    done: boolean;
    detail: string;
    action: { label: string; to: string } | { label: string; onClick: () => void } | null;
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
            ? `${incompleteEmployers.map((e) => e.name).join(', ')} ${incompleteEmployers.length === 1 ? 'is' : 'are'} missing an EPF, SOCSO or LHDN number, so nothing could be filed for the people employed there.`
            : `${employerRows.length} employer${employerRows.length === 1 ? '' : 's'} on file with registration, EPF, SOCSO and LHDN numbers.`,
      action: { label: 'Open', to: '/admin/hr/employers' },
    },
    {
      key: 'policy',
      title: 'How pay is worked out',
      done: true,
      detail: 'Overtime on a 26-day month, unpaid leave on calendar days. Frozen onto every run so a later change cannot reprice a past month.',
      action: null,
    },
    {
      key: 'components',
      title: 'What you pay people',
      done: componentCount > 0,
      detail:
        componentCount > 0
          ? `${componentCount} kinds of pay and deduction set up, from basic salary to mileage.`
          : 'No pay components are configured, so payroll cannot classify anything it pays.',
      action: componentCount > 0 ? null : { label: 'Set up', onClick: () => seed.mutate(undefined, {
        onSuccess: () => message.success('Components created'),
        onError: (error: Error) => message.error(error.message),
      }) },
    },
    {
      key: 'employees',
      title: 'Your employees',
      done: true,
      detail: 'Salary, bank account and statutory details, per person. Their readiness is shown on the payroll run itself.',
      action: { label: 'Open', to: '/admin/hr/employees' },
    },
    {
      key: 'rates',
      title: 'Check the statutory rates',
      done: verified,
      detail: verified
        ? 'The EPF, SOCSO and EIS tables in force have been checked against KWSP and PERKESO.'
        : 'EPF, SOCSO and EIS tables are loaded but nobody has checked them against KWSP and PERKESO. Until somebody does, payroll stays in test mode and no run may be paid or filed.',
      action: null,
    },
    {
      key: 'bank',
      title: 'Bank payment file',
      done: false,
      detail: 'Not available yet. A bank file is generated once the statutory rates are checked and the format is agreed with your bank.',
      action: null,
    },
  ];

  const complete = steps.filter((step) => step.done).length;

  return (
    <AdminShell
      error={firstError(employers, components, statutory)}
      title="Payroll settings"
      subtitle="Set up once, then leave alone. Nothing here is part of running a monthly payroll."
    >
      {!verified ? (
        <AdminNotice tone="warn">
          <strong>Statutory rates are loaded but unchecked.</strong> Kuwick works out EPF, SOCSO and EIS from tables it
          ships with, including the age-60 rules. Nobody has yet opened KWSP's and PERKESO's own published schedules and
          confirmed the figures match. Monthly tax is not worked out at all and has to be entered per employee. This is
          the last thing standing between this clinic and live payroll.
        </AdminNotice>
      ) : null}

      <AdminSection
        title={`Payroll setup — ${complete} of ${steps.length} complete`}
        description="Six things to settle before Kuwick can run live payroll for this clinic."
      >
        <div className="kw-setupList">
          {steps.map((step, index) => (
            <div key={step.key} className="kw-setupList__row">
              <span className={`kw-setupList__mark kw-setupList__mark--${step.done ? 'done' : 'todo'}`}>
                {step.done ? '✓' : index + 1}
              </span>
              <div className="kw-setupList__body">
                <div className="kw-setupList__title">{step.title}</div>
                <div className="kw-setupList__detail">{step.detail}</div>
              </div>
              <div className="kw-setupList__action">
                {step.done ? <Tag color="success">Done</Tag> : null}
                {step.action && 'to' in step.action ? (
                  <Link to={step.action.to}>
                    <Button size="small">{step.action.label}</Button>
                  </Link>
                ) : step.action && 'onClick' in step.action ? (
                  <Button size="small" type="primary" loading={seed.isPending} onClick={step.action.onClick}>
                    {step.action.label}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </AdminSection>

      <AdminSection
        title="Company & statutory registration"
        description="The entity that employs, files and pays. A branch is where the work happens; it files nothing."
      >
        <DataTable<LegalEmployerRow>
          rowKey="id"
          loading={employers.isLoading}
          rows={employerRows}
          emptyText="No legal employer is recorded."
          columns={[
            { title: 'Employer', dataIndex: 'name' },
            { title: 'Registration', dataIndex: 'registrationNo', width: 160 },
            {
              title: 'Can it file?',
              width: 260,
              render: (_: unknown, row: LegalEmployerRow) => {
                const missing = [
                  !row.epfEmployerNo ? 'EPF' : null,
                  !row.socsoEmployerNo ? 'SOCSO' : null,
                  !row.lhdnEmployerNo ? 'LHDN' : null,
                ].filter(Boolean);
                return missing.length === 0 ? (
                  <Tag color="success">All numbers on file</Tag>
                ) : (
                  <Tag color="warning">Missing {missing.join(', ')}</Tag>
                );
              },
            },
            {
              title: '',
              width: 100,
              noExport: true,
              render: () => (
                <Link to="/admin/hr/employers">
                  <Button size="small">Open</Button>
                </Link>
              ),
            },
          ]}
        />
      </AdminSection>

      <AdminSection
        title="Advanced"
        description="Detailed configuration for people who need it. Most clinics never open these after setup."
      >
        <div className="kw-linkRow">
          <Link to="/admin/hr/employers">Legal employers and their statutory numbers</Link>
          <Link to="/admin/hr/access">Who can do what</Link>
          <Link to="/admin/hr/benefits">Staff benefit schemes</Link>
        </div>
        <p className="kw-muted" style={{ marginTop: 12, marginBottom: 0 }}>
          {componentCount} pay components are configured, each carrying what it counts towards. Opening balances,
          year-to-date import and the bank payment format are not implemented yet and are listed here so their absence
          is visible rather than assumed.
        </p>
      </AdminSection>
    </AdminShell>
  );
}
