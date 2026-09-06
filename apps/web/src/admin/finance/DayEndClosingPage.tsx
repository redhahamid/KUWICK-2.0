import { useEffect, useMemo, useState } from 'react';
import { App, Button, DatePicker, Input, InputNumber, Modal, Tag } from 'antd';
import dayjs from 'dayjs';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money, moneyOrDash } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCan } from '../../core/hooks/useCan';
import { useCloseDayEnd, useCountDayEnd, useDayEnd, useReopenDayEnd } from '../hooks/useAdmin';
import type { DayEndView } from '../types';

/**
 * DAY-END CLOSING — a workflow, not a report.
 *
 * The screen is arranged as the act is performed: what the ledger expects, what
 * a person counted, what the difference is, and then — only once there is a
 * count — the button that signs it off. A variance with no explanation cannot
 * get past the server, and the form says so before the click rather than after.
 */
export function DayEndClosingPage() {
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const { clinicId: filterClinicId, clinics } = useClinicFilter();
  const date = params.get('date') ?? dayjs().format('YYYY-MM-DD');
  // A DRAWER BELONGS TO A BRANCH. The Finance overview links here with the
  // branch already named, because "close the 3rd" is not an instruction until
  // somebody says whose 3rd. A named branch in the URL wins over the header
  // filter for exactly that reason.
  const clinicId = params.get('clinicId') ?? filterClinicId;
  const branchName = clinics?.find((clinic) => clinic.id === clinicId)?.name;

  // A multi-branch group looking at "All branches" has not named a drawer.
  // The screen must ASK for one rather than fire a request that cannot be
  // answered and then paint the refusal red over a set of zeros.
  //
  // Nothing is asked until the branch list has actually arrived. Firing on the
  // first render and apologising once `clinics` resolves is how the red banner
  // got here in the first place, and a race that happens to lose today is not
  // a fix.
  const branchesKnown = clinics !== undefined;
  const needsBranch = !clinicId && branchesKnown && clinics.length > 1;
  const mayAsk = Boolean(clinicId) || (branchesKnown && clinics.length <= 1);
  const { data, isLoading, isError, error } = useDayEnd(date, clinicId, { enabled: mayAsk });
  const count = useCountDayEnd(date, clinicId);
  const close = useCloseDayEnd(date, clinicId);
  const reopen = useReopenDayEnd(date, clinicId);

  const mayReopen = useCan('dayEnd.reopen');
  const mayClose = useCan('dayEnd.close');

  const [counted, setCounted] = useState<{ cash?: number; card?: number; qr?: number; other?: number }>({});
  const [reason, setReason] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  // Pre-fill from whatever was counted before, so a re-count edits rather than
  // starts again. An empty box means NOT COUNTED, which is why undefined is
  // preserved rather than defaulted to zero.
  useEffect(() => {
    if (!data) return;
    setCounted({
      cash: data.counted.cash ?? undefined,
      card: data.counted.card ?? undefined,
      qr: data.counted.qr ?? undefined,
      other: data.counted.other ?? undefined,
    });
    setReason(data.varianceReason ?? '');
  }, [data]);

  const countedTotal = useMemo(
    () => Object.values(counted).reduce<number>((total, value) => total + (value ?? 0), 0),
    [counted],
  );
  const anyCounted = Object.values(counted).some((value) => value !== undefined);
  const variance = anyCounted ? countedTotal - (data?.expected.total ?? 0) : null;
  const closed = data?.status === 'CLOSED';

  const buckets: { key: 'cash' | 'card' | 'qr' | 'other'; label: string; hint: string }[] = [
    { key: 'cash', label: 'Cash', hint: 'Notes and coins in the drawer' },
    { key: 'card', label: 'Card', hint: 'Terminal settlement total' },
    { key: 'qr', label: 'QR', hint: 'QR provider’s daily total' },
    { key: 'other', label: 'Other', hint: 'Transfers, cheques, e-wallets' },
  ];

  if (!mayAsk) {
    return (
      <AdminShell
        title="Day-End Closing"
        subtitle="What the ledger expects, what a person counted, and the difference explained before anyone signs it off."
      >
        {needsBranch ? (
          <>
            <AdminNotice tone="warn">
              Closing a day counts one branch’s drawer, so this screen needs to know whose. Choose a branch in the
              header — or open the day from Finance ▸ Overview, where each unclosed day already carries its branch.
            </AdminNotice>
            <p className="kw-adminSection__desc">
              <Link to="/admin/finance">Back to the Finance overview →</Link>
            </p>
          </>
        ) : null}
      </AdminShell>
    );
  }

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Day-End Closing"
      subtitle={
        branchName
          ? `${branchName} — what the ledger expects, what a person counted, and the difference explained before anyone signs it off.`
          : 'What the ledger expects, what a person counted, and the difference explained before anyone signs it off.'
      }
      actions={
        <DatePicker
          allowClear={false}
          size="small"
          value={dayjs(date)}
          onChange={(value) =>
            value && setParams(clinicId ? { date: value.format('YYYY-MM-DD'), clinicId } : { date: value.format('YYYY-MM-DD') })
          }
        />
      }
    >
      <StatStrip
        stats={[
          { label: 'Expected total', value: money(data?.expected.total ?? 0), hint: `${data?.paymentCount ?? 0} movements` },
          { label: 'Counted total', value: anyCounted ? money(countedTotal) : '—', hint: anyCounted ? undefined : 'Not counted yet' },
          {
            label: 'Variance',
            value: variance === null ? '—' : money(variance),
            tone: variance === null ? 'neutral' : variance === 0 ? 'good' : 'bad',
            // Once the day is closed the difference has BEEN explained — the
            // server refuses the close otherwise — so telling the reader it
            // still needs explaining is the screen contradicting itself.
            hint:
              variance === null
                ? 'Appears once counted'
                : variance === 0
                  ? 'Reconciled'
                  : closed
                    ? 'Explained and signed off'
                    : 'Needs an explanation',
          },
          {
            label: 'Refunded',
            value: money(data?.refunds ?? 0),
            hint: (data?.refunds ?? 0) > 0 ? 'Already netted off the expected figures' : undefined,
          },
          {
            label: 'Status',
            value: closed ? 'Closed' : data?.status === 'COUNTED' ? 'Counted' : 'Open',
            tone: closed ? 'good' : 'warn',
            hint: closed ? `by ${data?.closedBy ?? '—'}` : undefined,
          },
        ]}
      />

      {closed ? (
        <AdminNotice>
          This day was closed by {data?.closedBy} on {dayjs(data?.closedAt).format('D MMM YYYY, HH:mm')}. The expected
          figures shown are the ones FROZEN at closing — a later correction cannot silently rewrite a signed-off day.
          {data?.reopenCount ? ` Reopened ${data.reopenCount} time(s).` : ''}
        </AdminNotice>
      ) : null}

      <div className="kw-adminGrid kw-adminGrid--sidebar">
        <AdminSection title="Movements on this day" padded={false}>
          <DataTable
            rows={data?.payments}
            loading={isLoading}
            rowKey="id"
            exportName={`day-end-${date}`}
            searchFields={['patientName' as never, 'invoiceNumber' as never, 'receivedBy' as never]}
            searchPlaceholder="Search invoice, receipt or staff…"
            emptyText="No money moved on this day"
            columns={[
              {
                title: 'Time',
                dataIndex: 'receivedAt',
                key: 'receivedAt',
                render: (value: string) => dayjs(value).format('HH:mm'),
              },
              { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber' },
              { title: 'Visit', dataIndex: 'visitNumber', key: 'visitNumber', optional: true },
              {
                title: 'Kind',
                dataIndex: 'kind',
                key: 'kind',
                render: (kind: string, row: DayEndView['payments'][number]) =>
                  row.reversed ? (
                    <Tag>Reversed</Tag>
                  ) : kind === 'REFUND' ? (
                    <Tag color="red">Refund</Tag>
                  ) : (
                    <Tag color="green">Payment</Tag>
                  ),
              },
              { title: 'Tender', dataIndex: 'tender', key: 'tender' },
              {
                title: 'Amount',
                dataIndex: 'amount',
                key: 'amount',
                className: 'kw-num',
                render: (value: number, row: DayEndView['payments'][number]) => (
                  <span className={row.reversed ? 'kw-muted' : row.kind === 'REFUND' ? 'kw-bad' : undefined}>
                    {money(value)}
                  </span>
                ),
              },
              { title: 'Reference', dataIndex: 'referenceNo', key: 'referenceNo', optional: true },
              { title: 'Taken by', dataIndex: 'receivedBy', key: 'receivedBy' },
            ]}
          />
        </AdminSection>

        <AdminSection title="Count the drawer" description="Leave a box empty if you have not counted that tender.">
          <div className="kw-countForm">
            <div className="kw-countHead">
              <span>Expected</span>
              <span>Counted</span>
              <span>Difference</span>
            </div>
            {buckets.map((bucket) => {
              const expected = data?.expected[bucket.key] ?? 0;
              const value = counted[bucket.key];
              const rowVariance = value === undefined ? null : value - expected;
              return (
                <div className="kw-countRow" key={bucket.key}>
                  <div className="kw-countRow__label">
                    <span>{bucket.label}</span>
                    <small>{bucket.hint}</small>
                  </div>
                  <div className="kw-countRow__expected">{money(expected)}</div>
                  <InputNumber
                    size="small"
                    disabled={closed}
                    value={value}
                    min={0}
                    precision={2}
                    placeholder="Not counted"
                    // Named, because a screen reader reading four unlabelled
                    // number boxes in a row cannot tell somebody which drawer
                    // they are counting into — and neither can a test.
                    aria-label={`Counted ${bucket.label}`}
                    onChange={(next) => setCounted((current) => ({ ...current, [bucket.key]: next ?? undefined }))}
                    style={{ width: 118 }}
                  />
                  <div className={`kw-countRow__variance ${rowVariance ? 'kw-bad' : 'kw-muted'}`}>
                    {rowVariance === null ? '—' : money(rowVariance)}
                  </div>
                </div>
              );
            })}
          </div>

          {variance !== null && variance !== 0 ? (
            <>
              {/* PAST TENSE ONCE IT IS DONE.
                  A closed day was still being told "the day cannot be closed
                  until the difference is explained" — a sentence that is false
                  about a day which has been closed, next to a reason box
                  holding the explanation that closed it. */}
              <AdminNotice tone={closed ? 'info' : 'warn'}>
                {closed
                  ? `The drawer differed from the ledger by ${money(variance)}. The explanation below was recorded with the closing.`
                  : `The drawer differs from the ledger by ${money(variance)}. The day cannot be closed until the difference is explained.`}
              </AdminNotice>
              <Input.TextArea
                rows={3}
                disabled={closed}
                value={reason}
                aria-label="Reason for the variance"
                onChange={(event) => setReason(event.target.value)}
                placeholder="What accounts for the difference?"
              />
            </>
          ) : null}

          <div className="kw-countActions">
            <Button
              size="small"
              disabled={closed || !anyCounted}
              loading={count.isPending}
              onClick={() =>
                count.mutate(
                  {
                    cash: counted.cash?.toFixed(2),
                    card: counted.card?.toFixed(2),
                    qr: counted.qr?.toFixed(2),
                    other: counted.other?.toFixed(2),
                    varianceReason: reason || undefined,
                  },
                  {
                    onSuccess: () => message.success('Count recorded'),
                    onError: (error: Error) => message.error(error.message),
                  },
                )
              }
            >
              Save count
            </Button>
            <Button
              size="small"
              type="primary"
              disabled={closed || !mayClose || data?.countedAt === null}
              loading={close.isPending}
              onClick={() =>
                close.mutate(
                  { varianceReason: reason || undefined },
                  {
                    onSuccess: () => message.success('Day closed'),
                    onError: (error: Error) => message.error(error.message),
                  },
                )
              }
            >
              Close the day
            </Button>
            {closed ? (
              <Button size="small" danger disabled={!mayReopen} onClick={() => setReopenOpen(true)}>
                Reopen
              </Button>
            ) : null}
          </div>
          {closed && !mayReopen ? (
            <p className="kw-adminSection__desc">Reopening a closed day needs the day-end reopen permission.</p>
          ) : null}
        </AdminSection>
      </div>

      <AdminSection title="What kind of day was it" description="Frozen alongside the money when the day is closed.">
        <StatStrip
          stats={[
            { label: 'Visits', value: data?.operational?.visitCount ?? 0 },
            { label: 'Invoices', value: data?.operational?.invoiceCount ?? 0 },
            { label: 'Billed', value: moneyOrDash(data?.operational?.billed) },
            { label: 'Patient portion', value: moneyOrDash(data?.operational?.patientPortion) },
            { label: 'Panel portion', value: moneyOrDash(data?.operational?.panelPortion) },
            { label: 'Tax', value: moneyOrDash(data?.operational?.tax) },
          ]}
        />
      </AdminSection>

      <Modal
        open={reopenOpen}
        title="Reopen this day"
        okText="Reopen"
        okButtonProps={{ danger: true, disabled: reopenReason.trim().length < 5 }}
        confirmLoading={reopen.isPending}
        onCancel={() => setReopenOpen(false)}
        onOk={() =>
          reopen.mutate(
            { reason: reopenReason },
            {
              onSuccess: () => {
                message.success('Day reopened');
                setReopenOpen(false);
                setReopenReason('');
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <p>
          Reopening makes a signed-off statement provisional again. The reason is recorded against the closing and the
          number of times this day has been reopened is kept.
        </p>
        <Input.TextArea
          rows={3}
          value={reopenReason}
          onChange={(event) => setReopenReason(event.target.value)}
          placeholder="Why does this day need to be reopened?"
        />
      </Modal>
    </AdminShell>
  );
}
