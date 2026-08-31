import { useState } from 'react';
import { App, Button, Checkbox, Input, InputNumber, Modal, Select, Tag, Tooltip } from 'antd';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { DataTable, money } from '../components/DataTable';
import { usePanelConfigs, useUpdatePanelConfig } from '../hooks/useAdmin';
import type { PanelConfigRow } from '../types';

/**
 * HOW A PANEL'S PAYMENT TERM READS BACK.
 *
 * The clinic's workbook writes these as sentences — "60 - 90 DAYS",
 * "30 WORKING DAYS", "90 DAYS from Invoice date", "VARY BASED ON COMPANY" —
 * and nothing can compute against a sentence. Here the sentence is GENERATED
 * from the fields, so the words and the arithmetic can never drift apart.
 */
function termLabel(row: PanelConfigRow) {
  if (row.paymentTermVariesByPayer) return 'varies by employer';
  if (row.paymentTermDays === null) return null;
  const unit = row.paymentTermUnit === 'WORKING_DAYS' ? 'working days' : 'days';
  const span =
    row.paymentTermMaxDays !== null && row.paymentTermMaxDays > row.paymentTermDays
      ? `${row.paymentTermDays}–${row.paymentTermMaxDays} ${unit}`
      : `${row.paymentTermDays} ${unit}`;
  const anchor =
    row.paymentTermAnchor === 'SERVICE_DATE'
      ? ' from service'
      : row.paymentTermAnchor === 'INVOICE_DATE'
        ? ' from invoice'
        : '';
  return `${span}${anchor}`;
}

const TERM_UNITS = [
  { value: 'CALENDAR_DAYS', label: 'Calendar days' },
  { value: 'WORKING_DAYS', label: 'Working days (Mon–Fri)' },
];

const TERM_ANCHORS = [
  { value: 'SUBMISSION_DATE', label: 'When we submitted the claim' },
  { value: 'SERVICE_DATE', label: 'The service date' },
  { value: 'INVOICE_DATE', label: 'The invoice date' },
];

const SUBMISSION_METHODS = ['PORTAL', 'EMAIL', 'COURIER', 'IN_PERSON', 'OTHER'].map((value) => ({
  value,
  label: value,
}));

/** The editable shape. Every field is nullable — NULL means nobody has said. */
interface Draft {
  feeDirection: 'ADDED' | 'WITHHELD' | null;
  paymentTermDays: number | null;
  paymentTermMaxDays: number | null;
  paymentTermUnit: 'CALENDAR_DAYS' | 'WORKING_DAYS' | null;
  paymentTermAnchor: 'SERVICE_DATE' | 'SUBMISSION_DATE' | 'INVOICE_DATE' | null;
  paymentTermVariesByPayer: boolean;
  resubmissionWindowDays: number | null;
  portalUrl: string;
  submissionMethod: string | null;
}

function draftOf(row: PanelConfigRow): Draft {
  return {
    feeDirection: row.feeDirection,
    paymentTermDays: row.paymentTermDays,
    paymentTermMaxDays: row.paymentTermMaxDays,
    paymentTermUnit: row.paymentTermUnit,
    paymentTermAnchor: row.paymentTermAnchor,
    paymentTermVariesByPayer: row.paymentTermVariesByPayer,
    resubmissionWindowDays: row.resubmissionWindowDays,
    portalUrl: row.portalUrl ?? '',
    submissionMethod: row.submissionMethod,
  };
}

/**
 * PANEL CONFIGURATION.
 *
 * The operational half — where the portal is, how claims go out, what has to be
 * in hand first, who to ring. Commercial terms (limit, fee, markups) are shown
 * beside it but are edited where pricing owns them, so an admin changing a
 * phone number cannot accidentally change what a panel is billed.
 */
export function PanelConfigPage() {
  const { data, isLoading, isError, error } = usePanelConfigs();
  const update = useUpdatePanelConfig();
  const { message } = App.useApp();
  const [editing, setEditing] = useState<PanelConfigRow | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const withoutPortal = data?.filter((panel) => panel.active && !panel.portalUrl) ?? [];
  const unresolvedFee = data?.filter((panel) => panel.active && panel.feeDirectionUnresolved) ?? [];
  const withoutTerm = data?.filter(
    (panel) => panel.active && panel.paymentTermDays === null && !panel.paymentTermVariesByPayer,
  ) ?? [];

  const open = (row: PanelConfigRow) => {
    setEditing(row);
    setDraft(draftOf(row));
  };

  const save = () => {
    if (!editing || !draft) return;
    update.mutate(
      {
        id: editing.id,
        feeDirection: draft.feeDirection ?? undefined,
        paymentTermDays: draft.paymentTermDays ?? undefined,
        paymentTermMaxDays: draft.paymentTermMaxDays ?? undefined,
        paymentTermUnit: draft.paymentTermUnit ?? undefined,
        paymentTermAnchor: draft.paymentTermAnchor ?? undefined,
        paymentTermVariesByPayer: draft.paymentTermVariesByPayer,
        resubmissionWindowDays: draft.resubmissionWindowDays ?? undefined,
        portalUrl: draft.portalUrl.trim() || undefined,
        submissionMethod: draft.submissionMethod ?? undefined,
      },
      {
        onSuccess: (result: unknown) => {
          const restamped = (result as { unsentClaimsRestamped?: number } | undefined)?.unsentClaimsRestamped ?? 0;
          message.success(
            restamped > 0
              ? `Saved. ${restamped} claim(s) not yet sent were re-stamped with the new fee direction.`
              : 'Saved',
          );
          setEditing(null);
        },
        onError: (mutationError: Error) => message.error(mutationError.message),
      },
    );
  };

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Panel Configuration"
      subtitle="What the claim workspace needs to know about each panel: where to submit, what they require, how long they take to pay, and which way their fee moves."
    >
      {unresolvedFee.length > 0 ? (
        <AdminNotice tone="warn">
          <strong>
            {unresolvedFee.length} active panel(s) charge an admin fee and nobody has recorded which way it moves.
          </strong>{' '}
          Until that is set, every receivable on those panels is computed WITHOUT the fee and shown as unresolved —
          Kuwick will not guess a direction. Set it on each panel below. Panels differ: some add the fee to what they are
          billed, others keep it out of what they pay.
        </AdminNotice>
      ) : null}

      {withoutTerm.length > 0 ? (
        <AdminNotice tone="warn">
          {withoutTerm.length} active panel(s) have no payment term, so no claim on them can ever be shown as overdue.
        </AdminNotice>
      ) : null}

      {withoutPortal.length > 0 ? (
        <AdminNotice tone="warn">
          {withoutPortal.length} active panel(s) have no portal link or submission method recorded. Staff will not get a
          link or a checklist for those claims until one is added.
        </AdminNotice>
      ) : null}

      <AdminSection title="Panels" padded={false}>
        <DataTable
          rows={data}
          loading={isLoading}
          rowKey="id"
          exportName="panel-configuration"
          searchFields={['name' as never, 'code' as never, 'payerName' as never]}
          searchPlaceholder="Search panel or payer…"
          emptyText="No panels configured"
          scrollY={540}
          columns={[
            { title: 'Panel', dataIndex: 'name', key: 'name' },
            { title: 'Code', dataIndex: 'code', key: 'code' },
            {
              title: 'Payer',
              dataIndex: 'payerName',
              key: 'payerName',
              render: (value: string | null) => value ?? <span className="kw-muted">same as panel</span>,
            },
            {
              title: 'Active',
              dataIndex: 'active',
              key: 'active',
              render: (value: boolean) => (value ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>),
            },
            {
              title: 'Submission',
              dataIndex: 'submissionMethod',
              key: 'submissionMethod',
              render: (value: string | null, row) =>
                value ? (
                  <span>
                    {value}
                    {row.portalUrl ? (
                      <>
                        {' · '}
                        <a href={row.portalUrl} target="_blank" rel="noreferrer">
                          portal
                        </a>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span className="kw-warn">not recorded</span>
                ),
            },
            {
              title: 'Payment term',
              key: 'paymentTermDays',
              render: (_: unknown, row) => {
                const label = termLabel(row);
                return label === null ? (
                  <span className="kw-warn">not set</span>
                ) : row.paymentTermVariesByPayer ? (
                  <Tooltip title="The term is set by the employer behind each claim, so no claim on this panel is ever called overdue.">
                    <span className="kw-muted">{label}</span>
                  </Tooltip>
                ) : (
                  label
                );
              },
            },
            {
              title: 'Claim fee',
              key: 'fee',
              render: (_: unknown, row) =>
                row.claimFeeValue === null
                  ? <span className="kw-muted">none</span>
                  : row.claimFeeType === 'PERCENT'
                    ? `${row.claimFeeValue}%`
                    : money(row.claimFeeValue),
            },
            {
              // G-1. The column that decides whether every receivable on this
              // panel is right or wrong by the fee, twice over once it is paid.
              title: 'Fee direction',
              key: 'feeDirection',
              render: (_: unknown, row) =>
                row.feeDirection === 'ADDED' ? (
                  <Tooltip title="We bill claim + fee and expect all of it back.">
                    <Tag color="blue">Added to the bill</Tag>
                  </Tooltip>
                ) : row.feeDirection === 'WITHHELD' ? (
                  <Tooltip title="The panel keeps its fee out of the payment: we bill the claim and bank claim − fee.">
                    <Tag color="purple">Withheld from payment</Tag>
                  </Tooltip>
                ) : row.feeDirectionUnresolved ? (
                  <Tooltip title="This panel charges a fee and nobody has said which way it moves, so the fee is left out of the receivable entirely.">
                    <Tag color="red">Not set</Tag>
                  </Tooltip>
                ) : (
                  <span className="kw-muted">no fee</span>
                ),
            },
            {
              // G-4. The clinic's own rule is two months from the original
              // service date; miss it and the claim is gone.
              title: 'Re-claim window',
              dataIndex: 'resubmissionWindowDays',
              key: 'resubmissionWindowDays',
              className: 'kw-num',
              render: (value: number | null) =>
                value === null ? <span className="kw-muted">not set</span> : `${value}d`,
            },
            {
              title: 'Per-visit limit',
              dataIndex: 'limitAmount',
              key: 'limitAmount',
              className: 'kw-num',
              render: (value: number | null) => (value === null ? <span className="kw-muted">none</span> : money(value)),
            },
            {
              title: 'Itemised bill',
              dataIndex: 'requiresItemisation',
              key: 'requiresItemisation',
              render: (value: boolean) => (value ? <Tag color="blue">Required</Tag> : '—'),
            },
            {
              title: 'Rejections',
              dataIndex: 'resubmitAsNewClaim',
              key: 'resubmitAsNewClaim',
              render: (value: boolean) => (value ? 'Re-claim under a new number' : 'Correct in place'),
            },
            {
              title: 'Requirements',
              dataIndex: 'documentRequirements',
              key: 'documentRequirements',
              optional: true,
              render: (values: string[]) => (values.length === 0 ? '—' : values.join('; ')),
            },
            {
              title: 'Panel share taxable',
              dataIndex: 'panelShareTaxable',
              key: 'panelShareTaxable',
              optional: true,
              render: (value: boolean | null) =>
                value === null ? <span className="kw-muted">not decided</span> : value ? 'Yes' : 'No',
            },
            {
              // CLAIM-NUMBER REQUIREMENTS. Some panels reject a claim keyed
              // without their own reference format; that rule lived in
              // somebody's memory and is a configured field.
              title: 'Claim no format',
              dataIndex: 'claimNumberFormat',
              key: 'claimNumberFormat',
              optional: true,
              render: (value: string | null) =>
                value ? <code>{value}</code> : <span className="kw-muted">no format required</span>,
            },
            {
              title: 'Account ref',
              dataIndex: 'accountReference',
              key: 'accountReference',
              optional: true,
              render: (value: string | null) => value ?? <span className="kw-muted">—</span>,
            },
            {
              // The instruction sheet stuck to the monitor, in the record.
              title: 'Instructions',
              dataIndex: 'notes',
              key: 'notes',
              optional: true,
              ellipsis: true,
              render: (value: string | null) =>
                value ? <Tooltip title={value}>{value}</Tooltip> : <span className="kw-muted">none</span>,
            },
            { title: 'Contact', dataIndex: 'contactName', key: 'contactName', optional: true },
            { title: 'Phone', dataIndex: 'contactPhone', key: 'contactPhone', optional: true },
            { title: 'Claims', dataIndex: 'batches', key: 'batches', className: 'kw-num', optional: true },
            { title: 'Visits', dataIndex: 'visits', key: 'visits', className: 'kw-num', optional: true },
            {
              title: '',
              key: 'edit',
              render: (_: unknown, row) => (
                <Button size="small" onClick={() => open(row)}>
                  Edit terms
                </Button>
              ),
            },
          ]}
        />
      </AdminSection>

      <Modal
        open={editing !== null}
        title={`Contract terms — ${editing?.name ?? ''}`}
        okText="Save"
        width={620}
        confirmLoading={update.isPending}
        onCancel={() => setEditing(null)}
        onOk={save}
      >
        {draft ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Which way does their fee move?</div>
              <Select
                style={{ width: '100%' }}
                value={draft.feeDirection}
                placeholder="Not set — the fee is left out of the receivable"
                allowClear
                onChange={(value) => setDraft({ ...draft, feeDirection: value ?? null })}
                options={[
                  { value: 'ADDED', label: 'Added — we bill claim + fee and expect all of it back' },
                  { value: 'WITHHELD', label: 'Withheld — they keep the fee out of what they pay us' },
                ]}
              />
              <div className="kw-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                Leave this unset and Kuwick will not guess: the receivable is computed without the fee and marked
                unresolved. Check a remittance advice against a claim if you are not sure which one this panel does.
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Payment term</div>
              <Checkbox
                checked={draft.paymentTermVariesByPayer}
                onChange={(event) => setDraft({ ...draft, paymentTermVariesByPayer: event.target.checked })}
              >
                The term is set by the employer behind each claim, not by this panel
              </Checkbox>
              {draft.paymentTermVariesByPayer ? (
                <div className="kw-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                  No claim on this panel will be shown as overdue, because there is no single term to judge it against.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <InputNumber
                      style={{ width: 130 }}
                      min={0}
                      max={365}
                      value={draft.paymentTermDays}
                      placeholder="Days"
                      onChange={(value) => setDraft({ ...draft, paymentTermDays: value ?? null })}
                    />
                    <span className="kw-muted" style={{ fontSize: 12 }}>
                      to (optional, for a range)
                    </span>
                    <InputNumber
                      style={{ width: 130 }}
                      min={0}
                      max={365}
                      value={draft.paymentTermMaxDays}
                      placeholder="Max days"
                      onChange={(value) => setDraft({ ...draft, paymentTermMaxDays: value ?? null })}
                    />
                  </div>
                  <Select
                    style={{ width: '100%' }}
                    value={draft.paymentTermUnit ?? 'CALENDAR_DAYS'}
                    onChange={(value) => setDraft({ ...draft, paymentTermUnit: value })}
                    options={TERM_UNITS}
                  />
                  <Select
                    style={{ width: '100%' }}
                    value={draft.paymentTermAnchor ?? 'SUBMISSION_DATE'}
                    onChange={(value) => setDraft({ ...draft, paymentTermAnchor: value })}
                    options={TERM_ANCHORS}
                  />
                  <div className="kw-muted" style={{ fontSize: 11.5 }}>
                    A range has two edges and they mean different things: the first is when to start chasing, the second
                    is when the panel is genuinely late. Overdue is judged against the second. Working days skip
                    weekends only — public holidays are not configured, so a working-day due date is the earliest the
                    term can expire.
                  </div>
                </div>
              )}
            </div>

            <div>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>
                How long to re-claim a rejection, from the original service date
              </div>
              <InputNumber
                style={{ width: 160 }}
                min={1}
                max={730}
                addonAfter="days"
                value={draft.resubmissionWindowDays}
                placeholder="Not set"
                onChange={(value) => setDraft({ ...draft, resubmissionWindowDays: value ?? null })}
              />
              <div className="kw-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                Miss this and the claim is gone. Leave it unset and no deadline is counted down.
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>How claims go out</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <Select
                  style={{ width: '100%' }}
                  value={draft.submissionMethod}
                  placeholder="Submission method"
                  allowClear
                  onChange={(value) => setDraft({ ...draft, submissionMethod: value ?? null })}
                  options={SUBMISSION_METHODS}
                />
                <Input
                  value={draft.portalUrl}
                  placeholder="https://portal.example.com"
                  onChange={(event) => setDraft({ ...draft, portalUrl: event.target.value })}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </AdminShell>
  );
}
