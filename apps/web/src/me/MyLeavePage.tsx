import { useMemo, useState } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { ApiError } from '../core/api-client';
import { Panel, PanelHead, StatusChip } from '../admin/hr/ui';
import { IconDoc } from '../admin/hr/ui/icons';
import { AuthImage } from '../admin/hr/ui';
import { myFilePath, uploadMyFile, useMyLeave, useMyLeaveBalances, useMyLeavePreview, useRequestLeave } from './hooks/useMe';
import { IconCheckCircle, PortalEmpty, dayRange } from './portal';

/** Shown until the clinic's own list arrives (Section D: the types are the clinic's). */
const LEAVE_TYPES = [
  { value: 'ANNUAL', label: 'Annual leave' },
  { value: 'MEDICAL', label: 'Medical leave' },
  { value: 'EMERGENCY', label: 'Emergency leave' },
  { value: 'UNPAID', label: 'Unpaid leave' },
  { value: 'OTHER', label: 'Other' },
];

const TYPE_WORD: Record<string, string> = {
  ANNUAL: 'Annual',
  MEDICAL: 'Medical',
  EMERGENCY: 'Emergency',
  UNPAID: 'Unpaid',
  OTHER: 'Other',
};

/** A stored file's id from the path the API keeps on the attachment (`/me/files/<id>`). */
function fileIdOf(filePath: string): string | null {
  return filePath.startsWith('/me/files/') ? filePath.slice('/me/files/'.length) : null;
}

const STATUS: Record<string, { tone: 'attn' | 'done' | 'block' | 'muted'; label: string }> = {
  PENDING: { tone: 'attn', label: 'Waiting' },
  APPROVED: { tone: 'done', label: 'Approved' },
  REJECTED: { tone: 'block', label: 'Not approved' },
};

/**
 * LEAVE, after `portal-leave.html`: the form on the left with what the
 * request would mean under it — the days, the balance after, who else is
 * away, a public holiday inside the dates — and on the right the balances by
 * type and every request with its decision.
 *
 * The days shown are the days the balance engine deducts (calendar days over
 * the range), so the figure here is the figure that comes off. A half day is
 * recorded on the request and still counts as one day in the balance; the
 * strip says so rather than pretending otherwise.
 */
export function MyLeavePage() {
  const { message } = App.useApp();
  const { data: requests, isLoading } = useMyLeave();
  const { data: balances } = useMyLeaveBalances();
  const request = useRequestLeave();

  const today = dayjs().format('YYYY-MM-DD');
  const [leaveType, setLeaveType] = useState('ANNUAL');
  const [halfDay, setHalfDay] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const validRange = Boolean(startDate && endDate && endDate >= startDate);
  const preview = useMyLeavePreview(validRange ? { leaveType, startDate, endDate, halfDay } : null);
  const p = validRange ? preview.data : undefined;

  const reset = () => {
    setLeaveType('ANNUAL');
    setHalfDay(false);
    setStartDate(today);
    setEndDate(today);
    setReason('');
    setAttachment(null);
  };

  // [D] The leave policy says which kinds need a certificate (the
  // entitlement's requiresAttachment); the server refuses a request without
  // one, so the button waits for the file rather than letting the refusal
  // be the first anyone hears of it.
  const typeOptions = balances?.types?.map((type) => ({ value: type.code, label: type.name })) ?? LEAVE_TYPES;
  const nameOf = (code: string) => balances?.types?.find((type) => type.code === code)?.name ?? TYPE_WORD[code] ?? code;
  const needsAttachment =
    balances?.balances.find((row) => row.leaveType === leaveType)?.requiresAttachment ??
    balances?.types?.find((type) => type.code === leaveType)?.documentRequired ??
    false;
  const attachmentOffered = needsAttachment || leaveType === 'MEDICAL';

  const submit = async () => {
    if (!validRange) {
      message.error('Leave cannot end before it starts.');
      return;
    }
    if (needsAttachment && !attachment) {
      message.error('This kind of leave needs the MC attached.');
      return;
    }
    setSending(true);
    try {
      // The certificate goes up first, as the person's own file; the request
      // then points at it. A failed upload leaves no request behind.
      const uploaded = attachment ? await uploadMyFile('MEDICAL_CERTIFICATE', attachment, attachment.name) : null;
      await request.mutateAsync({
        leaveType,
        startDate,
        endDate,
        reason: reason.trim() || undefined,
        halfDay: halfDay || undefined,
        attachmentFileId: uploaded?.id,
      });
      message.success('Sent to your manager.');
      reset();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not send that.');
    } finally {
      setSending(false);
    }
  };

  const balanceRows = useMemo(() => {
    const rows = (balances?.balances ?? []).filter((row) => row.leaveType !== 'UNPAID');
    return rows;
  }, [balances]);

  return (
    <>
      <div className="hr-pageHead">
        <div>
          <h1>Apply for leave</h1>
          <div className="hr-sub">Your manager gets it straight away. You'll see the decision here and by email.</div>
        </div>
      </div>

      <div className="hr-grid2 hr-grid2--wide">
        <Panel>
          <div style={{ padding: '20px 22px' }}>
            <div className="hr-pform">
              <div>
                <label htmlFor="leave-type">Type</label>
                <select id="leave-type" className="hr-f" value={leaveType} onChange={(event) => setLeaveType(event.target.value)}>
                  {typeOptions.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="leave-half">Half day?</label>
                <select
                  id="leave-half"
                  className="hr-f"
                  value={halfDay ? 'half' : 'full'}
                  onChange={(event) => setHalfDay(event.target.value === 'half')}
                >
                  <option value="full">Full day</option>
                  <option value="half">Half day</option>
                </select>
              </div>
              <div>
                <label htmlFor="leave-from">From</label>
                <input
                  id="leave-from"
                  type="date"
                  className="hr-f"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    if (endDate < event.target.value) setEndDate(event.target.value);
                  }}
                />
              </div>
              <div>
                <label htmlFor="leave-to">To</label>
                <input
                  id="leave-to"
                  type="date"
                  className="hr-f"
                  value={endDate}
                  min={startDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
              <div className="hr-pform__full">
                <label htmlFor="leave-reason">Reason</label>
                <textarea
                  id="leave-reason"
                  className="hr-f"
                  placeholder="Optional"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="hr-pform__full">
                <label htmlFor="leave-attachment">Attachment (needed for medical leave)</label>
                {attachmentOffered ? (
                  <label className={needsAttachment ? 'hr-drop is-required' : 'hr-drop'} htmlFor="leave-attachment">
                    <IconDoc />
                    {attachment ? attachment.name : needsAttachment ? 'Drop MC or photo here — required' : 'Drop MC or photo here'}
                    <input
                      id="leave-attachment"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      hidden
                      onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
                    />
                  </label>
                ) : (
                  <div className="hr-drop" aria-disabled="true" style={{ cursor: 'default' }}>
                    <IconDoc />
                    Not needed for this kind of leave
                  </div>
                )}
              </div>
            </div>

            {p ? (
              <div className={p.balanceAfter?.overdrawn || p.ownClash ? 'hr-preview hr-preview--attn' : 'hr-preview'}>
                <span>
                  <b>
                    {p.days} {p.days === 1 ? 'day' : 'days'}
                  </b>
                  {p.halfDay ? ' (half day, counted as one)' : ''}
                </span>
                {p.balanceAfter ? (
                  <span>
                    Balance after:{' '}
                    <b>
                      {p.balanceAfter.remaining} of {p.balanceAfter.available}
                    </b>
                  </span>
                ) : (
                  <span>No balance for this kind of leave</span>
                )}
                {p.ownClash ? (
                  <span className="hr-preview__block">
                    You already have leave over {dayRange(p.ownClash.startDate, p.ownClash.endDate)}
                  </span>
                ) : null}
                {p.clashes.map((clash) => (
                  <span key={`${clash.name}-${clash.firstDay}`} className="hr-preview__warn">
                    {clash.name} is also away on {dayjs(clash.firstDay).format('D MMM')}
                  </span>
                ))}
                {p.publicHolidays.map((holiday) => (
                  <span key={holiday.date}>
                    {holiday.name} ({dayjs(holiday.date).format('D MMM')}) is a public holiday
                  </span>
                ))}
              </div>
            ) : null}

            <div className="hr-formFoot">
              <button type="button" className="hr-btn" onClick={reset}>
                Cancel
              </button>
              <button
                type="button"
                className="hr-btn hr-btn--primary"
                onClick={submit}
                disabled={sending || request.isPending || !validRange || Boolean(p?.ownClash) || (needsAttachment && !attachment)}
              >
                <IconCheckCircle />
                Submit request
              </button>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Balances" />
          {balances && balanceRows.length === 0 ? (
            <PortalEmpty title="No leave policy yet">HR assigns your leave policy; the balances appear here once they have.</PortalEmpty>
          ) : (
            <div className="hr-kv">
              {balanceRows.map((row) => (
                <span key={row.leaveType} style={{ display: 'contents' }}>
                  <span className="hr-kv__k">{nameOf(row.leaveType)}</span>
                  <span className="hr-kv__v">
                    {row.remaining} of {row.available} left
                  </span>
                </span>
              ))}
              {balances ? (
                <>
                  <span className="hr-kv__k">Unpaid taken</span>
                  <span className="hr-kv__v">
                    {balances.unpaidTaken.days} {balances.unpaidTaken.days === 1 ? 'day' : 'days'}
                    {balances.unpaidTaken.lastMonth ? ` (${balances.unpaidTaken.lastMonth})` : ''}
                  </span>
                </>
              ) : null}
            </div>
          )}

          <div className="hr-panelHead--top">
            <PanelHead title="My requests" />
          </div>
          {isLoading ? null : (requests?.length ?? 0) === 0 ? (
            <PortalEmpty title="You have not asked for any leave">When you do, it appears here with its decision.</PortalEmpty>
          ) : (
            <table className="hr-table">
              <tbody>
                {requests?.map((row) => {
                  const days = dayjs(row.endDate).diff(dayjs(row.startDate), 'day') + 1;
                  const status = STATUS[row.status] ?? { tone: 'muted' as const, label: row.status };
                  return (
                    <tr key={row.id}>
                      <td>
                        <b>{nameOf(row.leaveType)}</b> · {dayRange(row.startDate, row.endDate)}
                        {row.decidedBy ? <div className="hr-tdSub">Decided by {row.decidedBy}</div> : null}
                        {row.attachments.length > 0 ? (
                          <div className="hr-tdSub hr-dots">
                            {row.attachments.map((file) =>
                              file.mimeType.startsWith('image/') ? (
                                <AuthImage key={file.id} path={myFilePath(fileIdOf(file.filePath) ?? file.id)} alt={file.fileName} className="hr-proof" />
                              ) : (
                                <span key={file.id}>
                                  <IconDoc /> {file.fileName}
                                </span>
                              ),
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="hr-num">{days}</td>
                      <td>
                        <StatusChip tone={status.tone}>{status.label}</StatusChip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
