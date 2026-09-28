import { Link } from 'react-router-dom';
import { usePayrollReadiness } from '../hooks/useAdmin';
import { Panel, PanelHead, StatusChip } from './ui';
import { Table } from './ui/Table';
import type { PayrollReadiness } from '../types';

type ReadinessRow = PayrollReadiness['employees'][number];

/**
 * WHETHER THIS MONTH CAN START AT ALL.
 *
 * The owner's question was "why can I continue through payroll when nobody is
 * ready?" — and the answer was that nothing stopped them. The button ran a
 * month for zero eligible employees, produced a RM0.00 run, and carried it
 * through six steps to a finalise screen. A payroll that pays nobody is not a
 * payroll; offering to run one is the software agreeing to waste somebody's
 * afternoon.
 *
 * So: if not one employee is payroll-ready, the month cannot start, and this
 * says who is missing what. Every name links to the person, not to a
 * directory — the remedy is on their record.
 *
 * NOT A WARNING. A warning that can be clicked past is how the RM0.00 run
 * happened. The button is disabled and says why.
 */
export function PayrollStartGate({
  period,
  clinicId,
  /** How many employees have a salary in force — see the note below. */
  salaryOnRecord,
  children,
}: {
  period: string;
  clinicId?: string;
  salaryOnRecord: number;
  children: (gate: { canStart: boolean; reason: string | null }) => React.ReactNode;
}) {
  const { data } = usePayrollReadiness({ period, clinicId });

  /*
   * WHAT STOPS A MONTH STARTING IS NOT WHAT STOPS IT BEING APPROVED, and
   * conflating the two would replace one wrong answer with another.
   *
   *   `setup.ready`     the STANDING facts — a salary, a bank account, a date
   *                     of birth. Set once, true until somebody changes them.
   *   `readiness.ready` nothing blocking THIS MONTH, which also counts the
   *                     monthly tax figure — outstanding on the first of every
   *                     month for everybody, by design, because Kuwick does
   *                     not always work PCB out.
   *
   * Gating the START on the second would refuse to open a month that only
   * needs its PCB entering — which is work you do INSIDE the run. So the gate
   * asks the narrower question the run itself asks: is there anybody whose pay
   * can be computed at all, meaning anybody with a salary in force.
   */
  const canStart = salaryOnRecord > 0;
  const blocked = data?.employees.filter((row) => !row.readiness.ready) ?? [];

  return (
    <>
      {children({
        canStart,
        reason: canStart ? null : 'Nobody has a salary on record, so there is no pay to work out. Set at least one salary first.',
      })}

      {!canStart ? (
        <Panel className="hr-mt">
          <PanelHead title={`${data?.periodLabel ?? 'This month'} cannot start`} sub="Payroll needs at least one employee with a salary in force." />
          {blocked.length > 0 ? <BlockedList rows={blocked} /> : null}
        </Panel>
      ) : null}

      {canStart && blocked.length > 0 ? (
        <Panel className="hr-mt">
          <PanelHead
            title={`${blocked.length} ${blocked.length === 1 ? 'person' : 'people'} will hold up approval`}
            sub="The month can be worked out now; it cannot be approved until these are sorted."
          />
          <BlockedList rows={blocked} />
        </Panel>
      ) : null}
    </>
  );
}

function BlockedList({ rows }: { rows: ReadinessRow[] }) {
  return (
    <Table<ReadinessRow>
      rowKey="staffId"
      rows={rows}
      columns={[
        {
          title: 'Employee',
          dataIndex: 'name',
          render: (value: string, row) => (
            <span>
              <Link className="hr-link hr-strong" to={`/admin/hr/employees/${row.staffId}`}>
                {value}
              </Link>
              <span className="hr-faint"> · {row.position ?? 'No position recorded'}</span>
            </span>
          ),
        },
        {
          title: 'Missing',
          key: 'missing',
          render: (_: unknown, row) => (
            <span className="hr-dots">
              {/* Each chip is the way to the field it names, not a label. */}
              {row.readiness.items
                .filter((item) => !item.done)
                .map((item) => (
                  <Link key={item.key} className="hr-chipLink" to={`/admin/hr/employees/${row.staffId}${item.link}`} title={item.detail}>
                    <StatusChip tone={item.severity === 'BLOCKING' ? 'block' : 'attn'}>{item.label}</StatusChip>
                  </Link>
                ))}
            </span>
          ),
        },
        {
          title: '',
          key: 'go',
          width: 150,
          render: (_: unknown, row) => (
            <Link
              className="hr-btn hr-btn--sm"
              to={`/admin/hr/employees/${row.staffId}${(row.readiness.items.find((item) => !item.done && item.severity === 'BLOCKING') ?? row.readiness.items.find((item) => !item.done))?.link ?? '?tab=employment'}`}
            >
              Complete setup
            </Link>
          ),
        },
      ]}
    />
  );
}
