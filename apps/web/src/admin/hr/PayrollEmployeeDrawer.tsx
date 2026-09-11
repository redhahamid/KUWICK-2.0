import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, DatePicker, Input, InputNumber, Select, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { DetailDrawer, DrawerSection, LineItem, LineTotal } from '../components/DetailDrawer';
import { StatusChip } from '../components/Chip';
import { ringgit } from '../components/DataTable';
import { usePayComponents, useUpsertPayrollInput } from '../hooks/useAdmin';
import type { PayrollJourney } from '../types';

type PayRow = PayrollJourney['pay']['rows'][number];
type Attendance = PayrollJourney['attendance']['rows'][number];
type Item = PayRow['items'][number];

/**
 * ONE PERSON'S PAYSLIP, AS A RIGHT-HAND DRAWER.
 *
 * A drawer and not an expanded row, for a reason worth writing down: an
 * expanded row pushes every other row down the screen, so the moment you open
 * one you lose the register you were reading it against. A drawer keeps the
 * register in place behind it, which is exactly the comparison somebody
 * checking one person's net pay is trying to make.
 *
 * FOUR SECTIONS, in the order a payslip is read: what they earned, what came
 * off, what the statutory schemes took, and what they are actually paid. Net
 * pay is pinned to the bottom because it is the number the drawer was opened
 * for.
 *
 * PROVENANCE IS NOT DECORATION. Every derived amount carries the sentence the
 * materialiser wrote when it pulled the upstream fact into this period.
 * "Overtime RM180.00" means one thing if somebody typed it and another if it
 * was computed from twelve approved hours; only one of those is worth arguing
 * with, and the reader cannot tell which without being told. A derived figure
 * is corrected where it was RECORDED — the timesheet, the leave record, the
 * claim — never here, because editing it would leave the payslip and its own
 * source disagreeing. The server refuses such an edit anyway; this screen does
 * not offer one, so nobody discovers the rule by being rejected.
 *
 * EVERY FIGURE IS THE SERVER'S. The row is `journey.pay.rows[]` — the same
 * object the register renders — so the drawer and the register cannot
 * disagree. Nothing here adds or subtracts.
 *
 * A BLANK IS NOT A ZERO. Nullable statutory figures mean "not worked out" —
 * no rates configured, or a fact missing — and rendering one as 0.00 tells a
 * clinic it owes nothing, which is the one wrong answer that gets acted on.
 */

/** Statutory deductions get their own section, not the "other" list. */
const STATUTORY_CODES = new Set(['EPF', 'SOCSO', 'EIS', 'LINDUNG', 'PCB', 'SKBBK']);
const EARNING_CODES = new Set([
  'BASIC',
  'ALLOWANCE',
  'ATTENDANCE_ALLOWANCE',
  'OVERTIME',
  'INCENTIVE',
  'COMMISSION',
  'BONUS',
  'MILEAGE',
  'CLAIM_REIMBURSEMENT',
  'LOCUM',
]);

/** Where a derived figure is corrected — the sentence, and the place. */
const UPSTREAM: Record<string, { where: string; to: string }> = {
  ATTENDANCE: { where: 'Attendance', to: '/admin/hr/time' },
  TIMESHEET: { where: 'Attendance', to: '/admin/hr/time' },
  LEAVE: { where: 'Leave', to: '/admin/hr/time/leave' },
  CLAIM: { where: 'Claims', to: '/admin/hr/time/claims' },
  INCENTIVE: { where: 'Doctor incentives', to: '/admin/hr/incentives' },
  LOCUM: { where: 'Locum sessions', to: '/admin/hr/locum' },
};

function dash(value: string | null, hint: string) {
  if (value === null || value === undefined) {
    return (
      <Tooltip title={hint}>
        <span className="kw-muted">—</span>
      </Tooltip>
    );
  }
  return ringgit(value);
}

export function PayrollEmployeeDrawer({
  row,
  attendance,
  period,
  open,
  onClose,
  onAddItem,
  canEdit,
}: {
  row: PayRow | null;
  /** This person's month from the timesheet, for the header chips. */
  attendance?: Attendance;
  /** `YYYY-MM` — what a manually added item is dated to. */
  period: string;
  open: boolean;
  onClose: () => void;
  /** Legacy escape hatch to the full inputs drawer. Undefined = read-only. */
  onAddItem?: (staffId: string, staffName: string) => void;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState<'ADDITION' | 'DEDUCTION' | null>(null);

  if (!row) {
    return (
      <DetailDrawer open={open} onClose={onClose} name="" width={520}>
        <span />
      </DetailDrawer>
    );
  }

  const items = row.items ?? [];
  const otherDeductions = items.filter(
    (item) => !EARNING_CODES.has(item.componentCode) && !STATUTORY_CODES.has(item.componentCode),
  );

  /*
   * THE DRAWER EXPLAINS THE REGISTER — every column of it.
   *
   * This listed only the itemised `items` rows, which meant an employee whose
   * overtime was materialised from an approved timesheet — with no manual
   * input row behind it — showed OVERTIME 98.48 on the register and NOTHING
   * about overtime in the drawer. The drawer's one job is to answer "how did
   * this person get this net salary?", and it was silently skipping figures.
   *
   * So the earnings lines are the register's own COLUMNS, which cannot
   * disagree with it, and the itemised rows supply each column's provenance.
   */
  const itemsFor = (...codes: string[]) => items.filter((item) => codes.includes(item.componentCode));
  const provenanceOf = (matching: Item[]) => {
    if (matching.length === 0) return undefined;
    if (matching.length === 1) return matching[0].provenance ?? matching[0].label;
    return matching.map((item) => `${item.label} ${ringgit(item.amount)}`).join(' · ');
  };
  const upstreamOf = (matching: Item[]) => {
    const derived = matching.find((item) => !item.editable && UPSTREAM[item.source]);
    return derived ? UPSTREAM[derived.source] : null;
  };

  const earningLines: { label: string; amount: string; matching: Item[] }[] = [
    { label: 'Allowances', amount: row.allowances, matching: itemsFor('ALLOWANCE', 'ATTENDANCE_ALLOWANCE', 'MILEAGE') },
    { label: 'Overtime', amount: row.overtimePay, matching: itemsFor('OVERTIME') },
    { label: 'Incentive', amount: row.incentive, matching: itemsFor('INCENTIVE', 'COMMISSION', 'BONUS') },
    {
      label: 'Claims and other',
      amount: row.otherEarnings,
      matching: itemsFor('CLAIM_REIMBURSEMENT', 'LOCUM_FEE', 'DIRECTOR_FEE'),
    },
  ].filter((line) => Number(line.amount) !== 0);
  // ZAKAT is an ordinary deduction component here rather than a column on the
  // payroll line, so it appears only when somebody actually has one. An empty
  // "Zakat — 0.00" on every payslip would be a claim about a deduction nobody
  // made.
  const zakat = otherDeductions.find((item) => item.componentCode === 'ZAKAT');

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      name={row.name}
      subtitle={row.position ?? undefined}
      width={520}
      tags={
        <>
          {row.state === 'READY' ? (
            <StatusChip tone="ok" dot>
              Ready
            </StatusChip>
          ) : null}
          {row.blockers > 0 ? (
            <StatusChip tone="blocked" dot>
              {row.blockers === 1 ? 'Blocked' : `${row.blockers} blockers`}
            </StatusChip>
          ) : null}
          {row.warnings > 0 ? (
            <StatusChip tone="attention" dot>
              {row.warnings === 1 ? 'Worth a look' : `${row.warnings} to check`}
            </StatusChip>
          ) : null}
          {/* A chip reading "0 days worked" beside a full month's salary says
              only that this clinic does not keep a timesheet for this person —
              which is not a fact about their pay, and reads as a fault. */}
          {attendance && attendance.daysWorked > 0 ? (
            <StatusChip tone="neutral" dot>
              {attendance.daysWorked} {attendance.daysWorked === 1 ? 'day' : 'days'} worked
            </StatusChip>
          ) : null}
          {attendance?.approvedOvertimeHours ? (
            <StatusChip tone="info" dot>
              {attendance.approvedOvertimeHours}h overtime
            </StatusChip>
          ) : null}
          {attendance?.unpaidLeaveDays ? (
            <StatusChip tone="attention" dot>
              {attendance.unpaidLeaveDays} unpaid {attendance.unpaidLeaveDays === 1 ? 'day' : 'days'}
            </StatusChip>
          ) : null}
        </>
      }
      footer={
        <>
          <span className="kw-netLabel">Net pay</span>
          <span className="kw-netValue">{ringgit(row.netPay)}</span>
        </>
      }
    >
      {/* ---------------------------------------------------------------- A */}
      <DrawerSection
        title="Earnings"
        action={
          canEdit ? (
            <button type="button" className="kw-rowAction" onClick={() => setAdding('ADDITION')}>
              + Add earning
            </button>
          ) : null
        }
      >
        <LineItem label="Basic salary" value={ringgit(row.basicSalary)} source="The salary in force this month" />

        {/*
          * UNPAID LEAVE BELONGS TO THE EARNINGS, not the deductions.
          *
          * s.18A makes an incomplete month's WAGES smaller: `grossPay` is
          * already basic less this figure. Listed under Deductions it was
          * counted twice by the reader — a "Total deductions −RM135.48" that
          * never touches net pay, over a gross that had already absorbed it.
          */}
        {Number(row.unpaidLeaveDeduction) > 0 ? (
          <LineItem
            label="Less unpaid leave"
            value={`−${ringgit(row.unpaidLeaveDeduction)}`}
            tone="deduct"
            source={
              attendance?.unpaidLeaveDays
                ? `${attendance.unpaidLeaveDays} approved unpaid day${
                    attendance.unpaidLeaveDays === 1 ? '' : 's'
                  } — wages are smaller, not deducted twice`
                : 'Wages are smaller, not deducted twice'
            }
          />
        ) : null}

        {earningLines.map((line) => {
          const upstream = upstreamOf(line.matching);
          return (
            <LineItem
              key={line.label}
              label={line.label}
              value={ringgit(line.amount)}
              source={provenanceOf(line.matching)}
              action={
                upstream ? (
                  <Link to={upstream.to} className="kw-lineItem__link">
                    Edit in {upstream.where}
                  </Link>
                ) : null
              }
            />
          );
        })}

        {adding === 'ADDITION' ? (
          <AddPayItem
            staffId={row.staffId}
            staffName={row.name}
            period={period}
            side="ADDITION"
            onDone={() => setAdding(null)}
            onFullEditor={onAddItem}
          />
        ) : null}

        <LineTotal label="Gross pay" value={ringgit(row.grossPay)} />
      </DrawerSection>

      {/* ---------------------------------------------------------------- B */}
      <DrawerSection
        title="Deductions"
        action={
          canEdit ? (
            <button type="button" className="kw-rowAction" onClick={() => setAdding('DEDUCTION')}>
              + Add deduction
            </button>
          ) : null
        }
      >
        {/* No placeholder row: the total below already says RM0.00, and two
            lines saying "nothing" is one more than the reader needs. */}
        {otherDeductions.length > 0
          ? otherDeductions.map((item) => <ItemLine key={item.id} item={item} deduct />)
          : null}

        {adding === 'DEDUCTION' ? (
          <AddPayItem
            staffId={row.staffId}
            staffName={row.name}
            period={period}
            side="DEDUCTION"
            onDone={() => setAdding(null)}
            onFullEditor={onAddItem}
          />
        ) : null}

        <LineTotal
          label="Other deductions"
          value={
            Number(row.otherDeductions) > 0 ? `−${ringgit(row.otherDeductions)}` : ringgit('0.00')
          }
          tone={Number(row.otherDeductions) > 0 ? 'deduct' : undefined}
        />
      </DrawerSection>

      {/* ---------------------------------------------------------------- C */}
      <DrawerSection title="Statutory">
        <EpfBasis row={row} />
        {/*
          * WHAT COMES OFF THEIR PAY — and only that.
          *
          * The employer's own EPF share was listed here, among the employee's
          * deductions, and then the section totalled EPF + SOCSO + EIS while
          * showing six lines including LINDUNG and PCB. A section that lists
          * six figures and adds up three of them is one nobody can check. The
          * employer's side is in Result, where the rest of the employer's
          * money is, and the one total is "Employee deductions" below.
          */}
        <LineItem
          label="EPF"
          value={dash(row.epfEmployee, 'Not worked out — no rates configured, or a fact is missing.')}
        />
        <LineItem label="SOCSO" value={dash(row.socsoEmployee, 'Not worked out — SOCSO needs a date of birth and rates.')} />
        <LineItem label="EIS" value={dash(row.eisEmployee, 'Not worked out — EIS needs a date of birth and rates.')} />
        <LineItem
          label="LINDUNG 24 JAM"
          value={dash(
            row.lindungEmployee,
            'Whether this employee joined has not been recorded, so nothing can be worked out.',
          )}
        />
        <LineItem
          label="Monthly tax (PCB)"
          value={dash(
            row.pcb,
            'Not entered. Record a tax residence and MTD category, or key this month’s figure by hand.',
          )}
        />
        {zakat ? (
          <LineItem label="Zakat" value={`−${ringgit(zakat.amount)}`} tone="deduct" source={zakat.provenance ?? undefined} />
        ) : null}
      </DrawerSection>

      {/* ---------------------------------------------------------------- D */}
      <DrawerSection title="Result">
        <LineItem label="Gross pay" value={ringgit(row.grossPay)} />
        <LineItem label="Employee deductions" value={`−${ringgit(row.deductionTotal)}`} tone="deduct" />
        <LineTotal label="Net pay" value={ringgit(row.netPay)} />

        {/* THE EMPLOYER'S SIDE, under its own components rather than above
            them — a total printed before the figures it sums is a total the
            reader has to scroll back up to check. */}
        <LineItem label="EPF (employer)" value={dash(row.epfEmployer, 'Not worked out.')} />
        <LineItem label="SOCSO (employer)" value={dash(row.socsoEmployer, 'Not worked out.')} />
        <LineItem label="EIS (employer)" value={dash(row.eisEmployer, 'Not worked out.')} />
        <LineItem label="HRD levy" value={dash(row.hrdLevy, 'Not worked out — the employer’s HRD registration is not recorded.')} />
        <LineItem label="Employer contributions" value={ringgit(row.employerContributions)} />
        <LineTotal label="Cost to the clinic" value={ringgit(row.employerCost)} />
      </DrawerSection>
    </DetailDrawer>
  );
}

/**
 * ONE ITEMISED COMPONENT, WITH WHERE IT CAME FROM.
 *
 * A figure Kuwick pulled from an approved upstream record says so and offers
 * the place it is corrected. A figure somebody typed says nothing extra — its
 * provenance is that a person entered it, which the absence of a source line
 * already conveys.
 */
function ItemLine({ item, deduct }: { item: Item; deduct?: boolean }) {
  const upstream = item.editable ? null : UPSTREAM[item.source];
  return (
    <LineItem
      label={item.label}
      value={deduct ? `−${ringgit(item.amount)}` : ringgit(item.amount)}
      tone={deduct ? 'deduct' : undefined}
      source={item.provenance ?? undefined}
      action={
        upstream ? (
          <Link to={upstream.to} className="kw-lineItem__link">
            Edit in {upstream.where}
          </Link>
        ) : null
      }
    />
  );
}

/**
 * THE EMPLOYER'S EPF BASIS BESIDE KUWICK'S OWN ASSESSMENT.
 *
 * An employer may contribute EPF on a narrower wage than Kuwick assesses as
 * EPF-liable, and that is a decision the product supports. What it must never
 * do is HIDE the gap: the clinic is choosing to contribute on less than the
 * statutory assessment, and the figure they are choosing against has to be on
 * the same screen as the choice.
 *
 * Advisory, not a blocker — that product decision stands. Rendered only when a
 * selection is actually in force; a clinic that has not narrowed anything sees
 * nothing, because "EPF basis: all applicable wages" is a sentence about the
 * system, not about them.
 */
function EpfBasis({ row }: { row: PayRow }) {
  const basis = row.epfBasis;
  if (!basis || basis.mode === 'ALL_APPLICABLE') return null;

  const applied = Number(basis.applied);
  const assessed = Number(basis.assessed);
  const short = assessed - applied;

  return (
    <div className={`kw-epfBasis${short > 0 ? ' kw-epfBasis--short' : ''}`}>
      <div className="kw-epfBasis__row">
        <span>Kuwick assesses EPF wages at</span>
        <strong className="kw-num">{ringgit(basis.assessed)}</strong>
      </div>
      <div className="kw-epfBasis__row">
        <span>You contribute on</span>
        <strong className="kw-num">{ringgit(basis.applied)}</strong>
      </div>
      {short > 0 ? (
        <p className="kw-epfBasis__note">
          {ringgit(short.toFixed(2))} lower than the statutory assessment.
          {basis.excluded.length > 0 ? ` Excluded: ${basis.excluded.map((e) => e.label).join(', ')}.` : ''}
        </p>
      ) : null}
    </div>
  );
}

/**
 * THE COMPACT EDITOR — type, amount, note.
 *
 * Adding an earning used to open a SECOND drawer over this one, carrying the
 * whole payroll-inputs surface for that person. Four fields is what the job
 * needs, so four fields is what it asks for; the full surface is still one
 * click away for anybody who wants the month's whole input list.
 *
 * ONLY MANUAL COMPONENTS ARE OFFERED. The component list is filtered to the
 * side being added and to what a person may key — the server refuses to
 * overwrite a figure that came from attendance or a claim, and a form that
 * offers the choice teaches the rule by rejection.
 */
function AddPayItem({
  staffId,
  staffName,
  period,
  side,
  onDone,
  onFullEditor,
}: {
  staffId: string;
  staffName: string;
  period: string;
  side: 'ADDITION' | 'DEDUCTION';
  onDone: () => void;
  onFullEditor?: (staffId: string, staffName: string) => void;
}) {
  const { message } = App.useApp();
  const components = usePayComponents();
  const upsert = useUpsertPayrollInput();
  const [code, setCode] = useState<string>();
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [earned, setEarned] = useState(dayjs(period));

  const choices = (components.data?.components ?? [])
    .filter((component) => component.active && !component.systemControlled && !component.employerSide)
    .filter((component) => (side === 'DEDUCTION' ? component.type === 'DEDUCTION' : component.type !== 'DEDUCTION'))
    .map((component) => ({ value: component.code, label: component.name }));

  const submit = () => {
    if (!code || amount === null || amount <= 0) {
      message.error('Choose a type and enter an amount.');
      return;
    }
    upsert.mutate(
      {
        staffId,
        period: `${period}-01`,
        componentCode: code,
        amount: amount.toFixed(2),
        kind: 'ADDITIONAL',
        earnedPeriod: `${earned.format('YYYY-MM')}-01`,
        ...(note ? { note } : {}),
      },
      {
        onSuccess: () => {
          message.success('Added. Recalculate the month to see it in the figures.');
          onDone();
        },
        onError: (error: Error) => message.error(error.message),
      },
    );
  };

  return (
    <div className="kw-addItem">
      <div className="kw-addItem__fields">
        <label className="kw-addItem__field">
          <span>Type</span>
          <Select
            size="small"
            showSearch
            optionFilterProp="label"
            placeholder={side === 'DEDUCTION' ? 'Deduction' : 'Earning'}
            value={code}
            onChange={setCode}
            options={choices}
            loading={components.isLoading}
          />
        </label>
        <label className="kw-addItem__field kw-addItem__field--amount">
          <span>Amount</span>
          <InputNumber
            size="small"
            prefix="RM"
            min={0}
            step={0.01}
            precision={2}
            value={amount}
            onChange={setAmount}
          />
        </label>
        <label className="kw-addItem__field">
          <span>Earned in</span>
          <DatePicker
            size="small"
            picker="month"
            allowClear={false}
            value={earned}
            onChange={(value) => value && setEarned(value)}
          />
        </label>
      </div>
      <label className="kw-addItem__field">
        <span>Note (optional)</span>
        <Input size="small" value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
      </label>
      <div className="kw-addItem__actions">
        {onFullEditor ? (
          <button type="button" className="kw-rowAction" onClick={() => onFullEditor(staffId, staffName)}>
            All inputs for this person
          </button>
        ) : (
          <span />
        )}
        <span className="kw-addItem__spacer" />
        <Button size="small" onClick={onDone}>
          Cancel
        </Button>
        <Button size="small" type="primary" loading={upsert.isPending} onClick={submit}>
          Add
        </Button>
      </div>
    </div>
  );
}
