import { Link, useSearchParams } from 'react-router-dom';
import { Button, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { usePayrollReadiness } from '../hooks/useAdmin';
import type { PayrollReadiness, PayrollReadinessItem } from '../types';

/**
 * GET READY FOR PAYROLL — the screen before the run.
 *
 * The run's exception centre says what stopped a CALCULATION. This screen
 * answers the question the administrator has on the 25th, before any run
 * exists: who cannot be paid yet, and what exactly to do about each of them.
 * Every row is the same checklist the employee's own record shows, built by
 * the same server code the run blocks with — so "ready here, blocked there"
 * cannot happen.
 */
export function PayrollReadinessPage() {
  const [search, setSearch] = useSearchParams();
  const period = search.get('period') ?? dayjs().format('YYYY-MM');
  const query = usePayrollReadiness({ period });
  const data = query.data;

  return (
    <AdminShell
      error={firstError(query)}
      title={data ? `Get ready — ${data.periodLabel}` : 'Get ready for payroll'}
      subtitle="Who can be paid, who cannot yet, and what to do about each — before the run exists."
      actions={
        <>
          <Button
            size="small"
            onClick={() => {
              search.set('period', dayjs(`${period}-01`).subtract(1, 'month').format('YYYY-MM'));
              setSearch(search, { replace: true });
            }}
          >
            ← {dayjs(`${period}-01`).subtract(1, 'month').format('MMM YYYY')}
          </Button>
          <Button
            size="small"
            onClick={() => {
              search.set('period', dayjs(`${period}-01`).add(1, 'month').format('YYYY-MM'));
              setSearch(search, { replace: true });
            }}
          >
            {dayjs(`${period}-01`).add(1, 'month').format('MMM YYYY')} →
          </Button>
          <Link to="/admin/hr/payroll/ytd-opening">
            <Button size="small">Opening balances</Button>
          </Link>
          <Link to="/admin/hr/payroll">
            <Button size="small">Payroll home</Button>
          </Link>
        </>
      }
    >
      {data ? (
        <>
          <StatStrip
            stats={[
              { label: 'Employees', value: data.summary.total },
              {
                label: 'Ready to pay',
                value: data.summary.ready,
                tone: data.summary.ready === data.summary.total ? 'good' : 'neutral',
              },
              {
                label: 'Blocked',
                value: data.summary.withBlockers,
                tone: data.summary.withBlockers > 0 ? 'bad' : 'good',
              },
              {
                label: 'Ready, with notes',
                value: data.summary.withAdvisories,
                tone: data.summary.withAdvisories > 0 ? 'warn' : 'neutral',
              },
            ]}
          />

          {data.summary.withoutEmployer > 0 ? (
            <AdminNotice tone="warn">
              <strong>
                {data.summary.withoutEmployer} employee{data.summary.withoutEmployer === 1 ? ' has' : 's have'} no
                employing company.
              </strong>{' '}
              A payroll run belongs to one legal employer, and EPF, SOCSO and tax are all filed under it — nothing can
              be calculated for these people until it is set on their employment record.
            </AdminNotice>
          ) : null}

          <AdminSection
            title="The employing companies"
            description="Registrations gate the filings, not the calculation — payroll can run while a SOCSO code is still in the post, but nothing can be submitted under a number that is not on file."
          >
            <DataTable<PayrollReadiness['employers'][number]>
              rowKey="id"
              rows={data.employers}
              emptyText="No legal employer employs anybody in this view. Set the employing company on each employment record."
              columns={[
                {
                  title: 'Legal employer',
                  dataIndex: 'name',
                  render: (name: string, row) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>{name}</div>
                      {row.registrationNo ? <div className="kw-provenance">{row.registrationNo}</div> : null}
                    </div>
                  ),
                },
                { title: 'Employees', dataIndex: 'employees', width: 110, align: 'right' as const },
                {
                  title: 'Filing identities',
                  key: 'filing',
                  render: (_: unknown, row) =>
                    row.ready ? (
                      <span className="kw-good">EPF, SOCSO, LHDN and the paying account are on file.</span>
                    ) : (
                      <span>
                        Missing: <strong>{row.missing.join(' · ')}</strong>
                      </span>
                    ),
                },
                {
                  title: '',
                  key: 'go',
                  width: 90,
                  render: () => <Link to="/admin/hr/employers">Open</Link>,
                },
              ]}
            />
          </AdminSection>

          <AdminSection
            title="Employee by employee"
            description="Open a row for the checklist. Blocking items are the ones the run itself will refuse on; advisory items are real work that does not stop anybody being paid."
          >
            <DataTable<PayrollReadiness['employees'][number]>
              rowKey="staffId"
              rows={[...data.employees].sort(
                (a, b) => a.readiness.blockersOutstanding - b.readiness.blockersOutstanding === 0
                  ? a.name.localeCompare(b.name)
                  : b.readiness.blockersOutstanding - a.readiness.blockersOutstanding,
              )}
              emptyText="No employees are in scope for this month."
              expandable={{
                expandedRowRender: (row: PayrollReadiness['employees'][number]) => (
                  <ReadinessChecklist items={row.readiness.items} />
                ),
              }}
              columns={[
                {
                  title: 'Employee',
                  dataIndex: 'name',
                  render: (name: string, row) => (
                    <div>
                      <Link to={`/admin/hr/employees/${row.staffId}`} style={{ fontWeight: 600 }}>
                        {name}
                      </Link>
                      {row.position ? <div className="kw-provenance">{row.position}</div> : null}
                    </div>
                  ),
                },
                {
                  title: 'Employer',
                  dataIndex: 'employerName',
                  width: 220,
                  render: (value: string | null) =>
                    value ?? <span style={{ color: '#b42318', fontWeight: 600 }}>Not set</span>,
                },
                {
                  title: 'Status',
                  key: 'status',
                  width: 180,
                  render: (_: unknown, row) =>
                    row.readiness.ready ? (
                      row.readiness.done === row.readiness.total ? (
                        <Tag color="green">Ready</Tag>
                      ) : (
                        <Tooltip title="Payable — the outstanding items are advisory and do not stop the run.">
                          <Tag color="gold">Ready, with notes</Tag>
                        </Tooltip>
                      )
                    ) : (
                      <Tag color="red">
                        {row.readiness.blockersOutstanding} blocking item
                        {row.readiness.blockersOutstanding === 1 ? '' : 's'}
                      </Tag>
                    ),
                },
                {
                  title: 'Checklist',
                  key: 'done',
                  width: 110,
                  align: 'right' as const,
                  render: (_: unknown, row) => (
                    <span className="kw-muted">
                      {row.readiness.done} / {row.readiness.total}
                    </span>
                  ),
                },
              ]}
            />
          </AdminSection>
        </>
      ) : null}
    </AdminShell>
  );
}

function ReadinessChecklist({ items }: { items: PayrollReadinessItem[] }) {
  return (
    <div className="kw-readyList">
      {items.map((item) => (
        <div key={item.key} className="kw-readyList__row">
          <span
            className={`kw-readyList__mark${item.done ? ' kw-readyList__mark--done' : item.severity === 'BLOCKING' ? ' kw-readyList__mark--blocking' : ' kw-readyList__mark--advisory'}`}
          >
            {item.done ? '✓' : item.severity === 'BLOCKING' ? '✕' : '!'}
          </span>
          <div>
            <div className="kw-readyList__label">
              {item.label}
              {!item.done ? (
                <span className={`kw-sev kw-sev--${item.severity === 'BLOCKING' ? 'blocking' : 'warning'}`}>
                  {item.severity === 'BLOCKING' ? 'Blocks the run' : 'Advisory'}
                </span>
              ) : null}
            </div>
            <div className="kw-readyList__detail">{item.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
