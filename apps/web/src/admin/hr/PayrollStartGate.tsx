import { Link } from 'react-router-dom';
import { Button, Tag } from 'antd';
import { AdminSection } from '../components/AdminShell';
import { usePayrollReadiness } from '../hooks/useAdmin';
import type { PayrollReadiness } from '../types';

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
  children,
}: {
  period: string;
  clinicId?: string;
  children: (gate: { canStart: boolean; reason: string | null }) => React.ReactNode;
}) {
  const { data } = usePayrollReadiness({ period, clinicId });

  // FAIL CLOSED WHILE UNKNOWN is wrong here, and fail open is wrong too. Until
  // the read lands there is nothing to gate ON, so the button stays enabled and
  // the server refuses anything genuinely impossible — the gate is a courtesy
  // ahead of a refusal, not the refusal itself.
  if (!data) return <>{children({ canStart: true, reason: null })}</>;

  const blocked = data.employees.filter((row) => !row.readiness.ready);
  const canStart = data.summary.ready > 0;

  return (
    <>
      {children({
        canStart,
        reason: canStart ? null : `No employee is ready to be paid for ${data.periodLabel}.`,
      })}

      {!canStart && data.summary.total > 0 ? (
        <AdminSection
          title={`${data.periodLabel} payroll cannot start`}
          description={`${blocked.length} ${blocked.length === 1 ? 'person needs' : 'people need'} setting up before anybody can be paid.`}
        >
          <BlockedList rows={blocked} />
        </AdminSection>
      ) : null}

      {canStart && blocked.length > 0 ? (
        <AdminSection
          title={`${blocked.length} ${blocked.length === 1 ? 'person' : 'people'} will be left out`}
          description="The month can run without them. They are not refused — they are simply absent from it, which is much harder to notice later."
        >
          <BlockedList rows={blocked} />
        </AdminSection>
      ) : null}
    </>
  );
}

function BlockedList({ rows }: { rows: PayrollReadiness['employees'] }) {
  return (
    <div className="kw-blockedList">
      {rows.slice(0, 8).map((row) => {
        const missing = row.readiness.items.filter((item) => !item.done);
        return (
          <div className="kw-blockedList__row" key={row.staffId}>
            <div className="kw-blockedList__who">
              <Link to={`/admin/hr/employees/${row.staffId}`} className="kw-blockedList__name">
                {row.name}
              </Link>
              <span className="kw-muted">{row.position ?? 'No position recorded'}</span>
            </div>
            <div className="kw-blockedList__missing">
              {missing.map((item) => (
                <Tag key={item.key} color={item.severity === 'BLOCKING' ? 'red' : 'gold'}>
                  {item.label}
                </Tag>
              ))}
            </div>
            <Link to={`/admin/hr/employees/${row.staffId}`}>
              <Button size="small">Complete setup</Button>
            </Link>
          </div>
        );
      })}
      {rows.length > 8 ? (
        <p className="kw-adminSection__desc">
          <Link to="/admin/hr/payroll/readiness">and {rows.length - 8} more →</Link>
        </p>
      ) : null}
    </div>
  );
}
