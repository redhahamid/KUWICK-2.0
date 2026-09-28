import { useMemo, useState } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { clinicDayjs } from '../../clinical/clinicTime';
import { useCan, permissionHint } from '../../core/hooks/useCan';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import {
  uploadStaffFileFor,
  useClaimPolicy,
  useCreateStaffClaim,
  useDecideStaffClaim,
  useEmployees,
  useSettleStaffClaim,
  useStaffBenefits,
  useStaffClaimHistory,
  useStaffClaims,
} from '../hooks/useAdmin';
import { ApiError } from '../../core/api-client';
import { CLAIM_TYPES, DEFAULT_MILEAGE_RATE_RM, mileageAmount, type ClaimTypeValue } from '../../me/claim-form';
import { AuthImage, Drawer, HrPage, Panel, SegControl, StatCard, StatRow, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconDoc } from './ui/icons';
import { initialsOf } from './ui/who';
import type { PaymentRoute, StaffClaimRow } from '../types';

const CATEGORY: Record<string, string> = {
  MEDICAL: 'Medical',
  TRAVEL: 'Travel',
  MEAL: 'Meals',
  TRAINING: 'Training',
  EQUIPMENT: 'Equipment',
  PROFESSIONAL_FEE: 'Professional fee',
  OTHER: 'Other',
};

type Filter = 'ALL' | 'WAITING' | 'APPROVED' | 'PAID';

/** What HR keys for a paper receipt: the portal form's fields, plus who it is for. */
interface RecordForm {
  staffId: string;
  type: ClaimTypeValue;
  claimDate: string;
  fromPlace: string;
  toPlace: string;
  distance: string;
  amount: string;
  purpose: string;
}
const emptyRecord = (): RecordForm => ({
  staffId: '',
  type: 'MEAL',
  claimDate: dayjs().format('YYYY-MM-DD'),
  fromPlace: '',
  toPlace: '',
  distance: '',
  amount: '',
  purpose: '',
});

const rm = (value: string | number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : `RM ${Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The file id inside `/me/files/<id>`, read back by HR from its own route. */
function staffFilePath(filePath: string): string | null {
  const id = filePath.startsWith('/me/files/') ? filePath.slice('/me/files/'.length) : null;
  return id ? `/workforce/staff-files/${id}` : null;
}

/** Where the money is, in one word or two — the same vocabulary the portal uses. */
function chipFor(row: StaffClaimRow): { tone: 'attn' | 'done' | 'block' | 'muted' | 'info'; label: string } {
  if (row.status === 'SUBMITTED') return { tone: 'attn', label: 'Waiting' };
  if (row.status === 'REJECTED') return { tone: 'block', label: 'Rejected' };
  if (row.status === 'CANCELLED') return { tone: 'muted', label: 'Withdrawn' };
  if (row.status === 'DRAFT') return { tone: 'muted', label: 'Draft' };
  if (row.payoutStatus === 'PAID') return { tone: 'muted', label: 'Paid' };
  return { tone: 'done', label: 'Approved' };
}

/**
 * CLAIMS, after `claims.html` — the queue, then the decision.
 *
 * THE DECISION IS THREE ANSWERS AT ONCE and the drawer asks them together:
 * how much (the claimed amount, or a different one), from where (with the
 * salary, or separately by Finance — the answer a duplicate payment turns
 * on, and not changeable once the money has moved), and why, when the answer
 * is not "all of it".
 *
 * THE RECEIPT IS IN THE DRAWER. Before Piece 3g the clinic kept a receipt's
 * name and size and nothing else, so approving meant trusting a filename.
 * The bytes are stored now and read back with the manager's own token.
 *
 * A MILEAGE CLAIM SAYS WHAT IT WAS PRICED AT — the kilometres and the rate
 * frozen on the claim when it was sent, so a later change to the clinic's
 * rate cannot quietly rewrite what was approved.
 */
export function ClaimsPage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  // THE SELECTED BRANCH'S CLAIMS, from the query rather than from a filter
  // applied after they arrive. The cards, the month buttons and the four tabs
  // all read `rows`, so scoping the fetch settles every one of them at once.
  const claims = useStaffClaims({ clinicId });
  const employees = useEmployees({ clinicId });
  const benefits = useStaffBenefits({ year: clinicDayjs(new Date()).year(), clinicId });
  const decide = useDecideStaffClaim();
  /*
   * THE BUTTON USED TO LIE. There was no permission check on this screen at
   * all, so Review opened for anyone who could reach Claims and the decision
   * failed at the server — which UAT found as a clinic manager pressing
   * Approve and being refused after the fact. `hr.claim.approve` is its own
   * permission now; a reader still sees every claim and every receipt.
   */
  const canDecide = useCan('hr.claim.approve');
  const settle = useSettleStaffClaim();
  /*
   * A CLAIM RECORDED FROM A PAPER RECEIPT, for somebody without a portal
   * login or with the receipt in their hand. The same claim the portal
   * sends — priced, receipted and queued the same way — with who keyed it
   * on the row. The server refuses it for anybody outside the branches this
   * account manages.
   */
  const mayRecord = useCan('hr.employee.manage');
  const policy = useClaimPolicy();
  const createClaim = useCreateStaffClaim();
  const [recording, setRecording] = useState(false);
  const [recordForm, setRecordForm] = useState<RecordForm>(emptyRecord);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [filter, setFilter] = useState<Filter>('ALL');
  const [month, setMonth] = useState<string>('ALL');
  const [reviewing, setReviewing] = useState<StaffClaimRow | null>(null);
  const [amount, setAmount] = useState('');
  const [route, setRoute] = useState<PaymentRoute>('PAYROLL');
  const [note, setNote] = useState('');
  const history = useStaffClaimHistory(reviewing?.id);

  const rows = useMemo(() => claims.data ?? [], [claims.data]);

  const positionOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of employees.data ?? []) if (row.position) map.set(row.staffId, row.position);
    return map;
  }, [employees.data]);

  /** The two most recent months anything was claimed for, plus All. */
  const months = useMemo(() => {
    const seen = [...new Set(rows.map((row) => row.claimDate.slice(0, 7)))].sort().reverse().slice(0, 2);
    return seen;
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (month !== 'ALL' && row.claimDate.slice(0, 7) !== month) return false;
        if (filter === 'WAITING') return row.status === 'SUBMITTED';
        if (filter === 'APPROVED') return row.status === 'APPROVED' && row.payoutStatus !== 'PAID';
        if (filter === 'PAID') return row.payoutStatus === 'PAID';
        return true;
      }),
    [rows, filter, month],
  );

  const waiting = rows.filter((row) => row.status === 'SUBMITTED');
  const waitingTotal = waiting.reduce((total, row) => total + Number(row.amountClaimed), 0);
  const approvedUnpaid = rows.filter((row) => row.status === 'APPROVED' && row.payoutStatus !== 'PAID');
  const approvedTotal = approvedUnpaid.reduce((total, row) => total + Number(row.amountApproved ?? row.amountClaimed), 0);
  const intoPayroll = approvedUnpaid.find((row) => row.paymentRoute === 'PAYROLL' && row.payrollPeriod);
  const thisYear = clinicDayjs(new Date()).format('YYYY');
  const paidThisYear = rows.filter((row) => row.payoutStatus === 'PAID' && (row.paidAt ?? '').slice(0, 4) === thisYear);
  const paidTotal = paidThisYear.reduce((total, row) => total + Number(row.amountApproved ?? row.amountClaimed), 0);
  const benefitAllowance = (benefits.data?.accounts ?? []).reduce((total, row) => total + row.allowance, 0);
  const benefitUsed = (benefits.data?.accounts ?? []).reduce((total, row) => total + row.used, 0);
  const benefitShare = benefitAllowance > 0 ? Math.round((benefitUsed / benefitAllowance) * 100) : null;

  const open = (row: StaffClaimRow) => {
    setReviewing(row);
    setAmount(row.amountApproved ?? row.amountClaimed);
    setRoute(row.paymentRoute ?? 'PAYROLL');
    setNote('');
  };

  const claimed = reviewing ? Number(reviewing.amountClaimed) : 0;
  const typed = Number(amount);
  const changedAmount = reviewing !== null && Number.isFinite(typed) && typed.toFixed(2) !== claimed.toFixed(2);

  const record = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!reviewing) return;
    if (decision === 'REJECTED' && note.trim().length < 3) {
      message.error('A refusal carries its reason. The employee sees it.');
      return;
    }
    if (decision === 'APPROVED') {
      if (!Number.isFinite(typed) || typed <= 0) {
        message.error('An approved amount is needed.');
        return;
      }
      if (typed > claimed) {
        message.error('More than was claimed cannot be approved.');
        return;
      }
      if (changedAmount && note.trim().length < 3) {
        message.error('Say why the amount is different. The employee sees it.');
        return;
      }
    }
    try {
      await decide.mutateAsync(
        decision === 'APPROVED'
          ? { id: reviewing.id, decision, amountApproved: typed.toFixed(2), paymentRoute: route, reason: note.trim() || undefined }
          : { id: reviewing.id, decision, reason: note.trim() },
      );
      message.success(decision === 'APPROVED' ? `Approved ${rm(typed)}.` : 'Rejected, and the reason is on the record.');
      setReviewing(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not record that.');
    }
  };

  const recordPayment = async () => {
    if (!reviewing) return;
    if (note.trim().length < 3) {
      message.error("Finance's own reference for this payment is required.");
      return;
    }
    try {
      await settle.mutateAsync({ id: reviewing.id, financeReference: note.trim() });
      message.success('Recorded as reimbursed.');
      setReviewing(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not record that.');
    }
  };

  const recordMileage = recordForm.type === 'MILEAGE';
  const recordKm = Number(recordForm.distance);
  const ratePerKm = policy.data ? Number(policy.data.mileageRatePerKm) : DEFAULT_MILEAGE_RATE_RM;
  const receiptRequired = policy.data?.receiptRequired ?? true;
  const recordComputed = recordMileage && Number.isFinite(recordKm) && recordKm > 0 ? mileageAmount(recordKm, ratePerKm) : null;
  const recordAmount = recordComputed ?? Number(recordForm.amount);
  const canRecord =
    Boolean(recordForm.staffId) &&
    (Boolean(receipt) || !receiptRequired) &&
    recordForm.purpose.trim().length >= 3 &&
    Number.isFinite(recordAmount) &&
    recordAmount > 0 &&
    (!recordMileage || (recordForm.fromPlace.trim() !== '' && recordForm.toPlace.trim() !== ''));
  const claimants = (employees.data ?? []).filter((row) => row.hasProfile && row.active);
  const setRecord = (patch: Partial<RecordForm>) => setRecordForm((current) => ({ ...current, ...patch }));

  const recordClaim = async () => {
    if (!canRecord) return;
    const category = CLAIM_TYPES.find((row) => row.value === recordForm.type)?.category ?? 'OTHER';
    const description = recordMileage
      ? `Mileage ${recordKm} km, ${recordForm.fromPlace.trim()} to ${recordForm.toPlace.trim()}: ${recordForm.purpose.trim()}`
      : recordForm.purpose.trim();
    const claimant = claimants.find((row) => row.staffId === recordForm.staffId)?.fullName ?? 'them';
    setSaving(true);
    try {
      // The receipt goes up first, as the employee's own file; a failed upload leaves no claim behind.
      const uploaded = receipt ? await uploadStaffFileFor(recordForm.staffId, receipt, receipt.name) : null;
      const claim = await createClaim.mutateAsync({
        staffId: recordForm.staffId,
        category,
        amountClaimed: recordAmount.toFixed(2),
        claimDate: recordForm.claimDate,
        description,
        distanceKm: recordMileage ? recordKm : undefined,
        receiptFileId: uploaded?.id,
      });
      message.success(`Recorded ${rm(claim.amountClaimed)} for ${claimant}. It joins the queue like any other claim.`);
      setRecording(false);
      setRecordForm(emptyRecord());
      setReceipt(null);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not record that claim.');
    } finally {
      setSaving(false);
    }
  };

  /** The journey, when the portal priced one. */
  const journey = (row: StaffClaimRow) =>
    row.distanceKm && row.mileageRate
      ? `${Number(row.distanceKm)} km × ${rm(row.mileageRate)}`
      : null;

  return (
    <HrPage
      title="Claims"
      sub="Staff submit claims with receipts from the portal; HR can record one from a paper receipt. Approved claims pay out with the next payroll."
      error={claims.isError ? 'Claims could not be loaded.' : null}
      actions={
        mayRecord ? (
          <button type="button" className="hr-btn hr-btn--primary" onClick={() => setRecording(true)}>
            + Record claim
          </button>
        ) : undefined
      }
    >
      <StatRow>
        <StatCard
          label="Waiting for decision"
          value={waiting.length}
          tone={waiting.length > 0 ? 'gold' : 'plain'}
          sub={waiting.length > 0 ? rm(waitingTotal) : 'Nothing waiting'}
        />
        <StatCard
          label="Approved, not yet paid"
          value={approvedUnpaid.length}
          sub={
            approvedUnpaid.length > 0
              ? `${rm(approvedTotal)}${intoPayroll ? ` · into ${dayjs(intoPayroll.payrollPeriod ?? undefined).format('MMM')} payroll` : ''}`
              : 'Everything approved has been paid'
          }
        />
        <StatCard
          label={`Paid in ${thisYear}`}
          value={rm(paidTotal)}
          tone="teal"
          sub={`${paidThisYear.length} claim${paidThisYear.length === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Medical benefit used"
          value={benefitShare === null ? '—' : `${benefitShare}%`}
          sub={benefitAllowance > 0 ? `${rm(benefitUsed)} of ${rm(benefitAllowance)}` : 'No benefit accounts this year'}
        />
      </StatRow>

      <Panel className="hr-mt">
        <Table<StaffClaimRow>
          rows={filtered}
          loading={claims.isLoading}
          rowKey="id"
          searchFields={['staffName', 'description']}
          searchPlaceholder="Search employee or claim"
          searchLabel="Search employee or claim"
          emptyText="No claims to show"
          emptyHint="Staff send claims with their receipts from the portal, or HR records one from a paper receipt."
          toolbar={
            <SegControl<Filter>
              label="Status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'ALL', label: `All ${rows.length}` },
                { value: 'WAITING', label: `Waiting ${waiting.length}` },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'PAID', label: 'Paid' },
              ]}
            />
          }
          toolbarRight={
            <SegControl<string>
              label="Month"
              value={month}
              onChange={setMonth}
              options={[
                ...months.map((value) => ({ value, label: dayjs(`${value}-01`).format('MMM YYYY') })),
                { value: 'ALL', label: 'All' },
              ]}
            />
          }
          columns={[
            {
              title: 'Employee',
              dataIndex: 'staffName',
              render: (value: string, row) => (
                <div className="hr-who">
                  <span className="hr-who__avatar">{initialsOf(value)}</span>
                  <div>
                    <div className="hr-who__name">{value}</div>
                    <div className="hr-who__role">{positionOf.get(row.staffId) ?? 'No position recorded'}</div>
                  </div>
                </div>
              ),
            },
            {
              title: 'Type',
              dataIndex: 'category',
              width: 120,
              render: (value: string, row) => (row.distanceKm ? 'Mileage' : (CATEGORY[value] ?? value)),
            },
            {
              title: 'Detail',
              dataIndex: 'description',
              render: (value: string) => <span title={value}>{value}</span>,
            },
            {
              title: 'Submitted',
              key: 'submitted',
              width: 110,
              render: (_: unknown, row) => dayjs(row.submittedAt ?? row.claimDate).format('D MMM'),
            },
            {
              title: 'Expense date',
              dataIndex: 'claimDate',
              width: 120,
              render: (value: string) => dayjs(value).format('D MMM'),
            },
            {
              title: 'Receipts',
              key: 'receipts',
              num: true,
              width: 95,
              render: (_: unknown, row) =>
                row.attachments.length === 0 ? <span className="hr-tn">None</span> : row.attachments.length,
            },
            {
              title: 'Amount',
              key: 'amount',
              num: true,
              width: 130,
              render: (_: unknown, row) => (
                <span>
                  <b>{rm(row.amountApproved ?? row.amountClaimed)}</b>
                  {row.amountApproved && row.amountApproved !== row.amountClaimed ? (
                    <div className="hr-tdSub">of {rm(row.amountClaimed)} claimed</div>
                  ) : null}
                </span>
              ),
            },
            {
              title: 'Status',
              key: 'status',
              width: 130,
              render: (_: unknown, row) => {
                const chip = chipFor(row);
                return <StatusChip tone={chip.tone}>{chip.label}</StatusChip>;
              },
            },
            {
              title: '',
              key: 'review',
              width: 90,
              render: (_: unknown, row) => (
                <button
                  type="button"
                  className="hr-btn hr-btn--sm"
                  onClick={() => open(row)}
                  title={canDecide ? undefined : permissionHint('decide staff expense claims')}
                >
                  {canDecide ? 'Review' : 'View'}
                </button>
              ),
            },
          ]}
        />
      </Panel>

      <Drawer
        open={reviewing !== null}
        title={
          <span className="hr-who">
            <span className="hr-who__avatar">{initialsOf(reviewing?.staffName ?? '—')}</span>
            <span>
              <span className="hr-who__name">{reviewing?.staffName ?? '—'}</span>
              <span className="hr-who__role">
                {reviewing ? (positionOf.get(reviewing.staffId) ?? 'No position recorded') : ''}
              </span>
            </span>
          </span>
        }
        sub={reviewing ? chipFor(reviewing).label : undefined}
        onClose={() => setReviewing(null)}
        footer={
          reviewing?.status === 'SUBMITTED' ? (
            <>
              <button type="button" className="hr-btn" disabled={decide.isPending} onClick={() => record('REJECTED')}>
                Reject
              </button>
              <button
                type="button"
                className="hr-btn hr-btn--primary"
                disabled={decide.isPending}
                onClick={() => record('APPROVED')}
              >
                {changedAmount ? `Approve ${rm(typed)}` : `Approve ${rm(claimed)}`}
              </button>
            </>
          ) : reviewing?.status === 'APPROVED' && reviewing.paymentRoute === 'FINANCE' && reviewing.payoutStatus !== 'PAID' ? (
            <>
              <button type="button" className="hr-btn" onClick={() => setReviewing(null)}>
                Close
              </button>
              <button type="button" className="hr-btn hr-btn--primary" disabled={settle.isPending} onClick={recordPayment}>
                Record as reimbursed
              </button>
            </>
          ) : (
            <button type="button" className="hr-btn" onClick={() => setReviewing(null)}>
              Close
            </button>
          )
        }
      >
        {reviewing ? (
          <>
            <div className="hr-kv2">
              <span className="hr-kv2__k">Type</span>
              <span className="hr-kv2__v">{reviewing.distanceKm ? 'Mileage' : (CATEGORY[reviewing.category] ?? reviewing.category)}</span>
              <span className="hr-kv2__k">Amount</span>
              <span className="hr-kv2__v">{rm(reviewing.amountApproved ?? reviewing.amountClaimed)}</span>
              <span className="hr-kv2__k">Claim submitted</span>
              <span className="hr-kv2__v">
                {dayjs(reviewing.submittedAt ?? reviewing.claimDate).format('D MMM YYYY, HH:mm')} · {reviewing.submittedBy}
                {reviewing.enteredOnBehalf ? ` (entered on ${reviewing.staffName}’s behalf)` : ''}
              </span>
              <span className="hr-kv2__k">Expense date</span>
              <span className="hr-kv2__v">{dayjs(reviewing.claimDate).format('D MMM YYYY')}</span>
              {journey(reviewing) ? (
                <>
                  <span className="hr-kv2__k">Priced at</span>
                  <span className="hr-kv2__v">{journey(reviewing)}</span>
                </>
              ) : null}
              <span className="hr-kv2__k">Purpose</span>
              <span className="hr-kv2__v">{reviewing.description}</span>
              <span className="hr-kv2__k">Where it is paid</span>
              <span className="hr-kv2__v">{reviewing.routeExplanation}</span>
            </div>

            {reviewing.attachments.length > 0 ? (
              <>
                <h3 className="hr-drawer__h3">Attachments</h3>
                {reviewing.attachments.map((file) => {
                  const path = staffFilePath(file.filePath);
                  return (
                    <div className="hr-rcpt" key={file.id}>
                      {path && file.mimeType.startsWith('image/') ? (
                        <AuthImage path={path} alt={file.fileName} className="hr-rcpt__th" />
                      ) : (
                        <span className="hr-rcpt__th" aria-hidden="true" />
                      )}
                      <div>
                        <span className="hr-rcpt__name">{file.fileName}</span>
                        <span className="hr-rcpt__meta">
                          {dayjs(reviewing.claimDate).format('D MMM')} · {(file.fileSize / (1024 * 1024)).toFixed(1)} MB
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="hr-notice hr-notice--attn">
                <IconDoc /> Nothing was attached to this claim.
              </div>
            )}

            <div className="hr-tl">
              {(history.data ?? []).map((event) => (
                <div key={event.id} className="hr-tl__row is-done">
                  <b style={{ textTransform: 'capitalize' }}>{event.event.toLowerCase().replace(/_/g, ' ')}</b> ·{' '}
                  {dayjs(event.at).format('D MMM, HH:mm')} · {event.actor}
                  {event.detail ? <div>{event.detail}</div> : null}
                </div>
              ))}
              {reviewing.status === 'SUBMITTED' ? (
                <div className="hr-tl__row">
                  <b>Decision</b> · pending — you
                </div>
              ) : null}
            </div>

            {reviewing.status === 'SUBMITTED' ? (
              <div className="hr-pform">
                <div>
                  <label htmlFor="claim-amount">Approve how much</label>
                  <input
                    id="claim-amount"
                    className="hr-f"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                  />
                </div>
                <div>
                  <label htmlFor="claim-route">Paid from</label>
                  <select
                    id="claim-route"
                    className="hr-f"
                    value={route}
                    onChange={(event) => setRoute(event.target.value as PaymentRoute)}
                  >
                    <option value="PAYROLL">With their salary</option>
                    <option value="FINANCE">Separately, by Finance</option>
                  </select>
                </div>
                <div className="hr-pform__full">
                  <label htmlFor="claim-note">Note (required if rejecting or changing the amount)</label>
                  <textarea id="claim-note" className="hr-f" value={note} onChange={(event) => setNote(event.target.value)} />
                </div>
              </div>
            ) : reviewing.status === 'APPROVED' && reviewing.paymentRoute === 'FINANCE' && reviewing.payoutStatus !== 'PAID' ? (
              <div className="hr-pform">
                <div className="hr-pform__full">
                  <label htmlFor="claim-ref">Finance's reference for this payment</label>
                  <input
                    id="claim-ref"
                    className="hr-f"
                    placeholder="e.g. PV-2026-0043"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
              </div>
            ) : reviewing.decisionReason ? (
              <div className="hr-notice hr-notice--info">{reviewing.decisionReason}</div>
            ) : null}

            {reviewing.status === 'SUBMITTED' ? (
              <div className="hr-notice hr-notice--info">
                Where a claim is paid from cannot be changed once the money has moved. Kuwick refuses a second payment
                rather than relying on somebody noticing.
              </div>
            ) : null}
          </>
        ) : null}
      </Drawer>

      {/* A CLAIM FROM A PAPER RECEIPT — keyed by HR for the person it belongs to. */}
      <Drawer
        open={recording}
        title="Record a claim"
        sub="For a paper receipt, or somebody without a portal login. It joins the queue like any other claim."
        onClose={() => setRecording(false)}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={() => setRecording(false)}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={recordClaim} disabled={!canRecord || saving || createClaim.isPending}>
              Record it
            </button>
          </>
        }
      >
        <div className="hr-pform">
          <div className="hr-pform__full">
            <label htmlFor="rec-claim-staff">Employee</label>
            <select id="rec-claim-staff" className="hr-f" value={recordForm.staffId} onChange={(event) => setRecord({ staffId: event.target.value })}>
              <option value="">Choose…</option>
              {claimants.map((person) => (
                <option key={person.staffId} value={person.staffId}>
                  {person.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rec-claim-type">Type</label>
            <select id="rec-claim-type" className="hr-f" value={recordForm.type} onChange={(event) => setRecord({ type: event.target.value as ClaimTypeValue })}>
              {CLAIM_TYPES.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rec-claim-date">Expense / travel date</label>
            <input
              id="rec-claim-date"
              type="date"
              className="hr-f"
              value={recordForm.claimDate}
              max={dayjs().format('YYYY-MM-DD')}
              onChange={(event) => setRecord({ claimDate: event.target.value })}
            />
          </div>
          {recordMileage ? (
            <>
              <div>
                <label htmlFor="rec-claim-from">From</label>
                <input id="rec-claim-from" className="hr-f" value={recordForm.fromPlace} onChange={(event) => setRecord({ fromPlace: event.target.value })} />
              </div>
              <div>
                <label htmlFor="rec-claim-to">To</label>
                <input id="rec-claim-to" className="hr-f" value={recordForm.toPlace} onChange={(event) => setRecord({ toPlace: event.target.value })} />
              </div>
              <div>
                <label htmlFor="rec-claim-km">Distance</label>
                <input
                  id="rec-claim-km"
                  className="hr-f"
                  inputMode="decimal"
                  placeholder="km"
                  value={recordForm.distance}
                  onChange={(event) => setRecord({ distance: event.target.value.replace(/[^\d.]/g, '') })}
                />
              </div>
              <div>
                <label htmlFor="rec-claim-amount">Amount</label>
                <div id="rec-claim-amount" className="hr-f hr-f--auto" aria-live="polite">
                  {recordComputed !== null ? (
                    <>
                      {rm(recordComputed)} <small>· {recordKm} × RM {ratePerKm.toFixed(2)}</small>
                    </>
                  ) : (
                    <small>Worked out from the distance</small>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div>
              <label htmlFor="rec-claim-amount">Amount (RM)</label>
              <input
                id="rec-claim-amount"
                className="hr-f"
                inputMode="decimal"
                placeholder="45.50"
                value={recordForm.amount}
                onChange={(event) => setRecord({ amount: event.target.value.replace(/[^\d.]/g, '') })}
              />
            </div>
          )}
          <div className="hr-pform__full">
            <label htmlFor="rec-claim-purpose">Purpose</label>
            <input
              id="rec-claim-purpose"
              className="hr-f"
              placeholder={recordMileage ? 'Deliver vaccine stock' : 'What it was for'}
              value={recordForm.purpose}
              onChange={(event) => setRecord({ purpose: event.target.value })}
            />
          </div>
          <div className="hr-pform__full">
            <label htmlFor="rec-claim-receipt">Receipt / photo</label>
            <label className={receiptRequired ? 'hr-drop is-required' : 'hr-drop'} htmlFor="rec-claim-receipt">
              <IconDoc />
              {receiptRequired ? 'Photograph or scan of the paper receipt — required' : 'Photograph or scan of the paper receipt'}
              <input
                id="rec-claim-receipt"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
              />
            </label>
            {receipt ? (
              <div className="hr-rcpt">
                <span className="hr-rcpt__th" aria-hidden="true" />
                <div>
                  <span className="hr-rcpt__name">{receipt.name}</span>
                  <span className="hr-rcpt__meta">{(receipt.size / (1024 * 1024)).toFixed(1)} MB</span>
                </div>
                <button type="button" className="hr-btn hr-btn--sm hr-btn--ghost" style={{ marginLeft: 'auto' }} onClick={() => setReceipt(null)}>
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </Drawer>
    </HrPage>
  );
}
