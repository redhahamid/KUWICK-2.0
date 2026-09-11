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
   * There are two honest readings of "ready", and Kuwick keeps both on
   * purpose:
   *
   *   `setup.ready`     the STANDING facts — a salary, a bank account, a date
   *                     of birth. Set once, true until somebody changes them.
   *   `readiness.ready` nothing blocking THIS MONTH, which also counts the
   *                     monthly tax figure — outstanding on the first of every
   *                     month for everybody, by design, because Kuwick does
   *                     not work PCB out.
   *
   * Gating the START on the second would refuse to open a month that only
   * needs its PCB entering — which is work you do INSIDE the run. So the gate
   * asks the narrower question the run itself asks: is there anybody whose pay
   * can be computed at all, meaning anybody with a salary in force.
   *
   * The list below still uses the fuller reading, because "who will block
   * approval" is exactly what somebody wants to see before they start.
   */
  const canStart = salaryOnRecord > 0;
  const blocked = data?.employees.filter((row) => !row.readiness.ready) ?? [];

  return (
    <>
      {children({
        canStart,
        reason: canStart
          ? null
          : 'Nobody has a salary on record, so there is no pay to work out. Set at least one salary first.',
      })}

      {!canStart ? (
        <AdminSection
          title={`${data?.periodLabel ?? 'This month'} cannot start`}
          description="Payroll needs at least one employee with a salary in force."
        >
          {blocked.length > 0 ? <BlockedList rows={blocked} /> : <span />}
        </AdminSection>
      ) : null}

      {canStart && blocked.length > 0 ? (
        <AdminSection
          title={`${blocked.length} ${blocked.length === 1 ? 'person' : 'people'} will hold up approval`}
          description="The month can be worked out now; it cannot be approved until these are sorted."
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
      {/* No link on the overflow. Readiness used to have a page of its own; it
          now sits on each person's register row, so there is nowhere further
          to send somebody than the month itself — which is the screen they are
          already on. */}
      {rows.length > 8 ? (
        <p className="kw-adminSection__desc kw-muted">and {rows.length - 8} more</p>
      ) : null}
    </div>
  );
}
