import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { App, Input, Modal } from 'antd';
import dayjs from 'dayjs';
import { ringgit } from '../components/DataTable';
import { humanise } from '../components/Chip';
import { downloadFile } from '../../core/api-client';
import { useAuthStore } from '../../core/auth-store';
import { useCan } from '../../core/hooks/useCan';
import {
  payslipPdfPath,
  useEmployeeRecord,
  useEmployeeYtd,
  useOverrideException,
  usePayrollExceptions,
  usePayrollJourney,
  usePayrollRun,
  usePayrollVariance,
  useUpsertPayrollInput,
} from '../hooks/useAdmin';
import { PayrollInputsDrawer } from './PayrollInputsDrawer';
import { HrPage, Panel, PanelHead, StatusChip } from './ui';
import { IconDownload, IconPlus } from './ui/icons';
import { initialsOf } from './ui/who';
import type { PayrollJourney } from '../types';

/** The query's own error, as a sentence, or nothing. */
const errorText = (query: { error: unknown }) => (query.error instanceof Error ? query.error.message : null);

type PayRow = PayrollJourney['pay']['rows'][number];
type Item = PayRow['items'][number];

/**
 * ONE PERSON'S PAYROLL FOR THE MONTH — employee-payroll.html.
 *
 * Earnings on the left, deductions on the right, and every line says where
 * it came from: a source tag that goes back to Attendance, Leave, Claims,
 * Incentives or the person's own record. "How did this person get this net
 * salary?" is answered here, without leaving the page.
 *
 * EVERY FIGURE IS THE SERVER'S. The row is `journey.pay.rows[]` — the same
 * object the grid renders — so this page and the grid cannot disagree. The
 * formulas beside a deduction (11% of 9,500.00) read the run line's own
 * breakdown, which the engine wrote when it priced the month. Nothing here
 * adds or subtracts.
 *
 * A DERIVED FIGURE IS CORRECTED WHERE IT WAS RECORDED — the timesheet, the
 * leave record, the claim, the recurring item — never here, because editing
 * it would leave the payslip and its own source disagreeing. `UPSTREAM` turns
 * "you cannot edit this" into "edit this in Attendance". What CAN change here
 * is what is this month's alone: a one-off item, and the monthly tax figure,
 * both with a reason that is logged with the person's name.
 *
 * "MARK AS CHECKED" is the existing override, applied to this person's
 * warnings with one reason. A warning never blocks approval; checking it says
 * somebody looked, and the run's review lists who.
 */
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
  'DIRECTOR_FEE',
  'LOCUM_FEE',
  'CLAIM_REIMBURSEMENT',
  'LOCUM',
]);

/** Where a derived figure is corrected — the tag on the line, and the place. */
const UPSTREAM: Record<string, { where: string; to: (staffId: string) => string }> = {
  ATTENDANCE: { where: 'Attendance', to: (staffId) => `/admin/hr/attendance?staffId=${staffId}` },
  LEAVE: { where: 'Leave', to: (staffId) => `/admin/hr/leave?staffId=${staffId}` },
  CLAIM: { where: 'Claims', to: (staffId) => `/admin/hr/claims?staffId=${staffId}` },
  INCENTIVE: { where: 'Incentives', to: () => '/admin/hr/incentives' },
  RECURRING: { where: 'Recurring', to: (staffId) => `/admin/hr/employees/${staffId}?tab=employment` },
};

const TYPE_LABEL: Record<string, string> = { PERMANENT: 'Permanent', CONTRACT: 'Contract', LOCUM: 'Locum', PART_TIME: 'Part-time', INTERN: 'Intern' };

const rm = (value: string | null | undefined) => (value === null || value === undefined ? '—' : ringgit(value).replace('RM', 'RM '));
const cents = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `RM ${(value / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const firstName = (name: string) => initialsOfName(name);
function initialsOfName(name: string) {
  const parts = name.replace(/^(Dr|Mr|Mrs|Ms|Puan|Encik|Cik)\.?\s+/i, '').split(/\s+/);
  return parts[0] ?? name;
}

interface Breakdown {
  bases?: { epf?: number; socso?: number; eis?: number };
  ordinaryRateOfPay?: { hoursPerDay?: number; overtimeDays?: number; overtimeHourly?: number };
  overtimePolicy?: { ruleSet: string | null; mode: string; how: string };
  statutoryNotes?: { epf?: string | null; socso?: string | null; eis?: string | null; pcb?: string | null; lindung?: string | null };
  pcbSource?: 'CALCULATED' | 'ENTERED' | null;
  age?: number | null;
}

export function PayrollEmployeePage() {
  const { id: runId, staffId } = useParams<{ id: string; staffId: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const journey = usePayrollJourney(runId);
  const detail = usePayrollRun(runId);
  const record = useEmployeeRecord(staffId);
  const variance = usePayrollVariance(runId);
  const exceptions = usePayrollExceptions(runId);
  const taxYear = journey.data ? Number(journey.data.run.period.slice(0, 4)) : dayjs().year();
  const ytd = useEmployeeYtd(staffId, taxYear);
  const override = useOverrideException();
  const upsert = useUpsertPayrollInput();
  const mayApprove = useCan('hr.payroll.approve');
  const mayRun = useCan('hr.payroll.run');
  const me = useAuthStore((state) => state.staff?.fullName ?? null);

  const [inputsOpen, setInputsOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkReason, setCheckReason] = useState('');
  const [pcbOpen, setPcbOpen] = useState(false);
  const [pcbAmount, setPcbAmount] = useState('');
  const [pcbReason, setPcbReason] = useState('');
  const [pcbProblem, setPcbProblem] = useState<string | null>(null);

  const data = journey.data;
  const rows = data?.pay.rows ?? [];
  const index = rows.findIndex((row) => row.staffId === staffId);
  const row = index >= 0 ? rows[index] : null;
  const previous = index > 0 ? rows[index - 1] : null;
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : null;
  const attendance = data?.attendance.rows.find((r) => r.staffId === staffId);
  const line = detail.data?.lines.find((l) => l.staffId === staffId);
  const breakdown = (line?.breakdown ?? {}) as Breakdown;
  const snapshot = line?.snapshot ?? null;
  const classification = (snapshot?.statutoryClassification ?? {}) as Record<string, unknown>;
  const locked = data?.run.status === 'APPROVED' || data?.run.status === 'PAID';
  const move = variance.data?.rows.find((r) => r.staffId === staffId);
  const ownWarnings = (exceptions.data?.exceptions ?? []).filter((e) => e.staffId === staffId && e.severity === 'WARNING');
  const uncheckedWarnings = ownWarnings.filter((e) => e.overridable && !e.overriddenBy);
  const checkedBy = ownWarnings.find((e) => e.overriddenBy)?.overriddenBy ?? null;

  const periodLabel = data?.run.periodLabel ?? '';
  const monthStart = data ? dayjs(`${data.run.period}-01`) : null;
  const monthEnd = monthStart ? monthStart.endOf('month') : null;
  const previousMonth = monthStart ? monthStart.subtract(1, 'month').format('MMMM') : '';

  const items = row?.items ?? [];
  const overtimeItems = items.filter((item) => item.componentCode === 'OVERTIME');
  const earningItems = items.filter(
    (item) => EARNING_CODES.has(item.componentCode) && item.componentCode !== 'OVERTIME' && item.componentCode !== 'BASIC',
  );
  const unpaidItems = items.filter((item) => item.componentCode === 'UNPAID_LEAVE');
  const deductionItems = items.filter(
    (item) => !EARNING_CODES.has(item.componentCode) && !STATUTORY_CODES.has(item.componentCode) && item.componentCode !== 'UNPAID_LEAVE',
  );
  const claimItems = items.filter((item) => item.source === 'CLAIM');
  const pcbEntered = items.find((item) => item.componentCode === 'PCB' && item.source === 'MANUAL') ?? null;

  const srcTag = (item: Item) => {
    const upstream = item.editable ? null : UPSTREAM[item.source];
    if (!upstream || !staffId) return null;
    return (
      <Link className="hr-src" to={upstream.to(staffId)} title={item.provenance ?? `Edit in ${upstream.where}`}>
        {upstream.where}
      </Link>
    );
  };

  const markChecked = async () => {
    try {
      for (const exception of uncheckedWarnings) {
        await override.mutateAsync({ id: exception.id, reason: checkReason.trim() || `Checked by ${me ?? 'payroll'}` });
      }
      message.success(`Checked. ${uncheckedWarnings.length} ${uncheckedWarnings.length === 1 ? 'warning' : 'warnings'} recorded as looked at.`);
      setChecking(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'The server refused the override.');
    }
  };

  const savePcb = async () => {
    const cleaned = pcbAmount.trim().replace(/^RM\s*/i, '').replace(/,/g, '');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(cleaned)) {
      setPcbProblem('Enter the tax as a number with at most two decimal places.');
      return;
    }
    if (pcbReason.trim().length < 3) {
      setPcbProblem('Say why the calculated figure is being replaced. The reason is logged with your name.');
      return;
    }
    if (!data || !staffId) return;
    try {
      await upsert.mutateAsync({
        staffId,
        period: `${data.run.period}-01`,
        componentCode: 'PCB',
        amount: cleaned,
        label: 'PCB (entered by hand)',
        reason: pcbReason.trim(),
      });
      message.success('PCB recorded. Save the draft on the payroll grid to work the month out again.');
      setPcbOpen(false);
    } catch (error) {
      setPcbProblem(error instanceof Error ? error.message : 'The server refused the figure.');
    }
  };

  const facts = [
    row?.position ?? snapshot?.position ?? null,
    record.data ? (TYPE_LABEL[record.data.employment.employmentType] ?? humanise(record.data.employment.employmentType)) : null,
    record.data?.employment.startDate ? `Joined ${dayjs(record.data.employment.startDate).format('D MMM YYYY')}` : null,
    classification.epfApplicable === false ? 'No EPF' : `EPF ${(classification.epfEmployeeRate as number | null) ?? 11}%`,
    classification.socsoApplicable === false ? 'No SOCSO' : `SOCSO Cat ${(breakdown.age ?? 0) >= 60 ? 2 : 1}`,
    classification.taxResidence ? `PCB ${String(classification.taxResidence).toLowerCase().replace('_', '-')}` : null,
  ].filter(Boolean);

  return (
    <HrPage
      crumb={
        runId ? (
          <>
            <Link className="hr-crumb__back" to={`/admin/hr/payroll/${runId}?step=prepare`}>
              Payroll · {periodLabel}
            </Link>{' '}
            &nbsp;/&nbsp; {row?.name ?? ''}
          </>
        ) : null
      }
      title={
        <span className="hr-who hr-who--head">
          <span className="hr-who__avatar hr-who__avatar--lg">{initialsOf(row?.name ?? '')}</span>
          <span>
            {row?.name ?? 'Payroll'}
            <span className="hr-facts" style={{ display: 'block', fontWeight: 400, marginTop: 2 }}>
              {facts.join(' · ')}
            </span>
          </span>
        </span>
      }
      error={errorText(journey) ?? errorText(detail)}
      actions={
        row && runId && staffId ? (
          <>
            <div className="hr-seg" role="group" aria-label="Employee">
              <button type="button" disabled={!previous} onClick={() => previous && navigate(`/admin/hr/payroll/${runId}/employees/${previous.staffId}`)}>
                ‹ {previous ? firstName(previous.name) : 'First'}
              </button>
              <button type="button" className="is-active">
                {index + 1} of {rows.length}
              </button>
              <button type="button" disabled={!next} onClick={() => next && navigate(`/admin/hr/payroll/${runId}/employees/${next.staffId}`)}>
                {next ? firstName(next.name) : 'Last'} ›
              </button>
            </div>
            <button
              type="button"
              className="hr-btn"
              disabled={!locked}
              title={locked ? undefined : 'The payslip is issued from the approved month.'}
              onClick={() =>
                downloadFile(payslipPdfPath(runId, staffId), `payslip-${data?.run.period}-${row.name.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`).catch(
                  (error: Error) => message.error(error.message),
                )
              }
            >
              <IconDownload />
              Payslip PDF
            </button>
            {checkedBy && uncheckedWarnings.length === 0 ? (
              <StatusChip tone="done">Checked by {checkedBy}</StatusChip>
            ) : (
              <button
                type="button"
                className="hr-btn hr-btn--primary"
                disabled={!mayApprove || uncheckedWarnings.length === 0 || locked}
                title={uncheckedWarnings.length === 0 ? 'Nothing on this person needs checking.' : undefined}
                onClick={() => {
                  setCheckReason(`Checked by ${me ?? 'payroll'}`);
                  setChecking(true);
                }}
              >
                Mark as checked
              </button>
            )}
          </>
        ) : null
      }
    >
      {data && row && runId && staffId ? (
        <div className="hr-two">
          <div>
            <Panel>
              <PanelHead
                title={periodLabel}
                sub={`${monthStart?.format('D')} – ${monthEnd?.format('D MMM')} · ${breakdown.ordinaryRateOfPay?.overtimeDays ?? 26}-day divisor · ${breakdown.ordinaryRateOfPay?.hoursPerDay ?? 7.5}-hour day${
                  breakdown.overtimePolicy?.ruleSet ? ` · ${breakdown.overtimePolicy.ruleSet} rule set` : ''
                }`}
                actions={
                  row.blockers > 0 ? (
                    <StatusChip tone="block">Blocked</StatusChip>
                  ) : row.warnings > 0 && uncheckedWarnings.length > 0 ? (
                    <StatusChip tone="attn">Needs attention</StatusChip>
                  ) : (
                    <StatusChip tone="done">Ready</StatusChip>
                  )
                }
              />
              <div className="hr-slip">
                <div>
                  <h4>
                    <span>Earnings</span>
                    <span>RM</span>
                  </h4>
                  <Line label="Basic pay" value={row.basicSalary} />
                  {overtimeGroups(overtimeItems, row.overtimeHours).map((group) => (
                    <Line key={group.label} label={group.label} value={group.amount} tag={srcTag(group.first)} />
                  ))}
                  {earningItems.map((item) => (
                    <Line
                      key={item.id}
                      label={item.label}
                      value={item.amount}
                      tag={srcTag(item)}
                      note={item.componentCode === 'CLAIM_REIMBURSEMENT' || item.componentCode === 'MILEAGE' ? 'not taxed' : item.editable ? 'added by hand' : undefined}
                    />
                  ))}
                  {/*
                    * LESS UNPAID LEAVE, with the earnings it reduces. s.18A makes an
                    * incomplete month's wages smaller — the deduction is already
                    * inside gross, so listed under Deductions it would be a figure
                    * that never touches net pay. Here the wages are smaller, not
                    * deducted twice.
                    */}
                  {unpaidItems.map((item) => (
                    <Line
                      key={item.id}
                      negative
                      label={`Unpaid leave — ${row.unpaidDays} ${row.unpaidDays === 1 ? 'day' : 'days'}`}
                      value={item.amount}
                      tag={srcTag(item)}
                      note="wages are smaller, not deducted twice"
                    />
                  ))}
                  <div className="hr-tot">
                    <span>Total earnings</span>
                    <span>{grouped(row.grossPay)}</span>
                  </div>
                </div>
                <div>
                  <h4>
                    <span>Deductions</span>
                    <span>RM</span>
                  </h4>
                  <Line
                    label="EPF"
                    value={row.epfEmployee}
                    note={
                      row.epfEmployee === null
                        ? 'not worked out'
                        : `${(classification.epfEmployeeRate as number | null) ?? 11}% of ${breakdown.bases?.epf !== undefined ? grouped(breakdown.bases.epf.toFixed(2)) : '—'}`
                    }
                  />
                  <Line label="SOCSO" value={row.socsoEmployee} note={row.socsoEmployee === null ? 'not worked out' : `Cat ${(breakdown.age ?? 0) >= 60 ? 2 : 1}, ceiling 6,000`} />
                  <Line label="EIS" value={row.eisEmployee} note={row.eisEmployee === null ? 'not worked out' : '0.2%, ceiling 6,000'} />
                  <Line
                    label="PCB"
                    value={row.pcb}
                    note={
                      row.pcb === null
                        ? 'missing'
                        : breakdown.pcbSource === 'ENTERED' || pcbEntered
                          ? 'entered by hand'
                          : `MTD, ${String(classification.taxResidence ?? 'resident').toLowerCase().replace('_', '-')}, category ${String(classification.pcbCategory ?? '').replace('CATEGORY_', '') || '1'}`
                    }
                  />
                  {row.lindungEmployee !== null && Number(row.lindungEmployee) > 0 ? <Line label="LINDUNG 24 JAM" value={row.lindungEmployee} note="employee-borne" /> : null}
                  {deductionItems.map((item) => (
                    <Line key={item.id} label={item.label} value={item.amount} tag={srcTag(item)} note={item.editable ? 'added by hand' : undefined} />
                  ))}
                  {deductionItems.length === 0 ? <Line label="Other deductions" value={row.otherDeductions} /> : null}
                  <div className="hr-tot">
                    <span>Total deductions</span>
                    <span>{grouped(row.deductionTotal)}</span>
                  </div>
                </div>
              </div>
              <div className="hr-netBox">
                <div>
                  <div className="hr-netBox__l">Net pay{snapshot?.bankName ? ` · to ${snapshot.bankName}` : ''}</div>
                  <div className="hr-netBox__big">{rm(row.netPay)}</div>
                </div>
                <div className="hr-netBox__prev">
                  {move && move.previousNetCents !== null ? (
                    <>
                      {previousMonth} net pay {cents(move.previousNetCents)}
                      <br />
                      {move.percent !== null ? (
                        <StatusChip tone={Math.abs(move.percent) >= (variance.data?.thresholdPercent ?? 20) ? 'attn' : 'muted'}>
                          {move.percent > 0 ? '+' : ''}
                          {move.percent.toFixed(1)}% vs {previousMonth}
                        </StatusChip>
                      ) : null}
                    </>
                  ) : (
                    <span className="hr-muted">No {previousMonth} payroll to compare with</span>
                  )}
                </div>
              </div>
              <div className="hr-emp">
                <div>
                  <div className="hr-emp__l">Employer EPF</div>
                  <div className="hr-emp__v">{rm(row.epfEmployer)}</div>
                </div>
                <div>
                  <div className="hr-emp__l">Employer SOCSO</div>
                  <div className="hr-emp__v">{rm(row.socsoEmployer)}</div>
                </div>
                <div>
                  <div className="hr-emp__l">Employer EIS</div>
                  <div className="hr-emp__v">{rm(row.eisEmployer)}</div>
                </div>
                <div>
                  <div className="hr-emp__l">Total cost to clinic</div>
                  <div className="hr-emp__v" style={{ color: 'var(--hr-teal)' }}>
                    {rm(row.employerCost)}
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          <div>
            <Panel>
              <PanelHead title="What fed this month" />
              <div className="hr-kv">
                <span className="hr-kv__k">Days worked</span>
                <span className="hr-kv__v">{attendance?.daysWorked ?? 0}</span>
                <span className="hr-kv__k">Unpaid leave</span>
                <span className="hr-kv__v">
                  {attendance && attendance.unpaidLeaveDays > 0
                    ? `${attendance.unpaidLeaveDays} ${attendance.unpaidLeaveDays === 1 ? 'day' : 'days'}${
                        attendance.unpaidLeaveRequests.length > 0 ? ` (${attendance.unpaidLeaveRequests.map((r) => dayjs(r.from).format('ddd D')).join(', ')})` : ''
                      }`
                    : '0'}
                </span>
                <span className="hr-kv__k">Paid leave</span>
                <span className="hr-kv__v">{attendance?.paidLeaveDays ?? 0}</span>
                <span className="hr-kv__k">Overtime approved</span>
                <span className="hr-kv__v">{(attendance?.approvedOvertimeHours ?? 0).toFixed(1)} h</span>
                <span className="hr-kv__k">Overtime pending</span>
                <span className={`hr-kv__v${(attendance?.unapprovedOvertimeHours ?? 0) > 0 ? ' hr-kv__v--gold' : ''}`}>
                  {(attendance?.unapprovedOvertimeHours ?? 0).toFixed(1)} h
                </span>
                <span className="hr-kv__k">Claims approved</span>
                <span className="hr-kv__v">
                  {claimItems.length} · {rm(row.claims)}
                </span>
              </div>
              {attendance && attendance.unapprovedOvertimeHours > 0 ? (
                <div className="hr-warn">
                  <span>!</span>
                  <span>
                    <b>{attendance.unapprovedOvertimeHours.toFixed(1)} h overtime still pending</b> — approve it in{' '}
                    <Link className="hr-link" to={`/admin/hr/attendance?staffId=${staffId}`}>
                      Attendance
                    </Link>{' '}
                    before this run is locked, or it rolls into {monthStart?.add(1, 'month').format('MMMM')}.
                  </span>
                </div>
              ) : null}
            </Panel>

            <Panel className="hr-mt">
              <PanelHead title="Year to date" actions={<span className="hr-eff">Jan – {monthStart?.format('MMM YYYY')}</span>} />
              {ytd.data && ytd.data.months.length > 0 ? (
                <div className="hr-kv">
                  <span className="hr-kv__k">Gross</span>
                  <span className="hr-kv__v">{cents(ytd.data.total.grossCents)}</span>
                  <span className="hr-kv__k">EPF (employee)</span>
                  <span className="hr-kv__v">{cents(ytd.data.total.epfEmployeeCents)}</span>
                  <span className="hr-kv__k">PCB paid</span>
                  <span className="hr-kv__v">{cents(ytd.data.total.pcbCents)}</span>
                  <span className="hr-kv__k">Months on record</span>
                  <span className="hr-kv__v">{ytd.data.months.length}</span>
                </div>
              ) : (
                <div className="hr-panelNote">No approved month on record for {taxYear} yet. The year to date fills in as months are approved.</div>
              )}
            </Panel>

            <Panel className="hr-mt">
              <PanelHead title="Adjust this month" />
              <div className="hr-adjust">
                <button type="button" className="hr-btn" disabled={!mayRun || locked} onClick={() => setInputsOpen(true)}>
                  <IconPlus />
                  This month’s items
                </button>
                <button
                  type="button"
                  className="hr-btn"
                  disabled={!mayRun || locked}
                  onClick={() => {
                    setPcbAmount(pcbEntered?.amount ?? row.pcb ?? '');
                    setPcbReason('');
                    setPcbProblem(null);
                    setPcbOpen(true);
                  }}
                >
                  Override PCB
                </button>
              </div>
              <div className="hr-panelNote">
                Changes here apply to {periodLabel} only and are logged with your name. A payslip note is not on the record yet;
                the run's own note is on the History page.
              </div>
            </Panel>
          </div>
        </div>
      ) : data && !row ? (
        <Panel>
          <PanelHead title="Not on this run" sub="This person has no payroll line for the month. The grid says why, beside their name." />
        </Panel>
      ) : null}

      {data && staffId ? (
        <PayrollInputsDrawer
          open={inputsOpen}
          onClose={() => setInputsOpen(false)}
          period={`${data.run.period}-01`}
          staffId={staffId}
          staffName={row?.name}
          canEdit={mayRun && !locked}
          runId={runId}
          cell={row ? { otherIncome: row.otherIncome, otherDeductions: row.otherDeductions } : null}
        />
      ) : null}

      <Modal
        open={checking}
        title="Mark as checked"
        okText="Mark as checked"
        confirmLoading={override.isPending}
        onCancel={() => setChecking(false)}
        onOk={() => void markChecked()}
      >
        <p className="hr-muted">
          {uncheckedWarnings.length} {uncheckedWarnings.length === 1 ? 'warning' : 'warnings'} on {row?.name} will be recorded as looked at, with your name and this reason. Nothing changes in the figures.
        </p>
        <ul className="hr-small">
          {uncheckedWarnings.map((warning) => (
            <li key={warning.id}>{warning.cause}</li>
          ))}
        </ul>
        <div className="hr-form">
          <div>
            <label htmlFor="check-reason">Reason</label>
            <Input id="check-reason" value={checkReason} onChange={(e) => setCheckReason(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        open={pcbOpen}
        title="Override PCB"
        okText="Record"
        confirmLoading={upsert.isPending}
        onCancel={() => setPcbOpen(false)}
        onOk={() => void savePcb()}
      >
        {pcbProblem ? <div className="hr-notice hr-notice--attn" style={{ margin: '0 0 12px' }}>{pcbProblem}</div> : null}
        <div className="hr-form">
          <div>
            <label htmlFor="pcb-amount">Monthly tax for {periodLabel}</label>
            <Input id="pcb-amount" prefix="RM" inputMode="decimal" value={pcbAmount} onChange={(e) => setPcbAmount(e.target.value)} />
            <div className="hr-form__help">
              {row?.pcb !== null && row?.pcb !== undefined ? `Kuwick worked out ${rm(row.pcb)}. ` : ''}A figure entered here replaces it for this month only.
            </div>
          </div>
          <div>
            <label htmlFor="pcb-reason">Reason</label>
            <Input.TextArea id="pcb-reason" rows={2} value={pcbReason} onChange={(e) => setPcbReason(e.target.value)} placeholder="CP38 instruction, TP1 relief not yet recorded…" />
            <div className="hr-form__help">Required. Logged with your name against this run.</div>
          </div>
        </div>
      </Modal>
    </HrPage>
  );
}

const grouped = (value: string | null | undefined) => (value === null || value === undefined ? '—' : ringgit(value).replace('RM', ''));

function Line({ label, value, note, tag, negative }: { label: string; value: string | null; note?: string; tag?: React.ReactNode; negative?: boolean }) {
  return (
    <div className={`hr-li${negative ? ' hr-li--neg' : ''}`}>
      <span className="hr-li__n">
        {label}
        {tag}
        {note ? <span className="hr-li__m"> · {note}</span> : null}
      </span>
      <span className="hr-li__v">
        {negative ? '−' : ''}
        {grouped(value)}
      </span>
    </div>
  );
}

/**
 * The priced days, one line per kind: "Overtime — 6.5 h", "Public holiday
 * pay — 1 day", "Rest day pay — 2 days". The amounts are the server's per-day
 * inputs added within their kind; the hours come from the line.
 */
function overtimeGroups(items: Item[], overtimeHours: number): { label: string; amount: string; first: Item }[] {
  const byLabel = new Map<string, { first: Item; cents: number; days: number }>();
  for (const item of items) {
    const key = item.label || 'Overtime';
    const entry = byLabel.get(key) ?? { first: item, cents: 0, days: 0 };
    entry.cents += Math.round(Number(item.amount) * 100);
    entry.days += 1;
    byLabel.set(key, entry);
  }
  return [...byLabel.entries()].map(([label, entry]) => ({
    label:
      label === 'Overtime'
        ? `Overtime — ${overtimeHours.toFixed(1)} h`
        : `${label} — ${entry.days} ${entry.days === 1 ? 'day' : 'days'}`,
    amount: (entry.cents / 100).toFixed(2),
    first: entry.first,
  }));
}
