import { useState } from 'react';
import { App, Button, Checkbox, DatePicker, Input, InputNumber, Modal, Select, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { DataTable, money } from '../components/DataTable';
import { usePanelConfigs, useUpdatePanelConfig } from '../hooks/useAdmin';
import type { PanelConfigRow, PanelFeeTreatment, PanelType } from '../types';
import { FEE_TREATMENT_HINT, FEE_TREATMENT_LABEL, PANEL_TYPE_HINT, PANEL_TYPE_LABEL } from '../types';

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

const PANEL_TYPES = (['TPA', 'INSURER', 'CORPORATE', 'GOVERNMENT', 'OTHER'] as PanelType[]).map(
  (value) => ({ value, label: PANEL_TYPE_LABEL[value] }),
);

const SUBMISSION_METHODS = ['PORTAL', 'EMAIL', 'COURIER', 'IN_PERSON', 'OTHER'].map((value) => ({
  value,
  label: value,
}));

/** The editable shape. Every field is nullable — NULL means nobody has said. */
interface Draft {
  panelType: PanelType | null;
  feeTreatment: PanelFeeTreatment;
  feeEffectiveFrom: string;
  feeTermNote: string;
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
    panelType: row.panelType,
    feeTreatment: row.feeTreatment,
    feeEffectiveFrom: dayjs().format('YYYY-MM-DD'),
    feeTermNote: '',
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
  const unresolvedFee = data?.filter((panel) => panel.active && panel.feeTreatmentUnresolved) ?? [];
  const unclassified = data?.filter((panel) => panel.active && panel.panelType === null) ?? [];
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
        panelType: draft.panelType ?? undefined,
        feeTreatment: draft.feeTreatment,
        feeEffectiveFrom: draft.feeEffectiveFrom,
        feeTermNote: draft.feeTermNote || undefined,
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
      subtitle="What the claim workspace needs to know about each panel: where to submit, what they require, how long they take to pay, and how their fee is treated."
    >
      {unresolvedFee.length > 0 ? (
        <AdminNotice tone="warn">
          <strong>{unresolvedFee.length} active panel(s) have no established fee treatment.</strong> Every receivable on
          them is computed WITHOUT the fee and shown as unresolved — Kuwick will not guess. The standing rule for
          existing panels is <strong>withheld</strong> (owner decision, 31 Aug 2026); a panel is left here only where
          the evidence genuinely does not settle it, and it needs an answer before its figures can be relied on.
        </AdminNotice>
      ) : null}

      {unclassified.length > 0 ? (
        <AdminNotice tone="info">
          {unclassified.length} active panel(s) have no kind recorded. Saying whether a panel is an administrator, an
          insurer, a company you bill direct or a government body changes none of your figures — it decides what this
          screen asks you for. Kuwick does not guess it from the name.
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
              title: 'Kind',
              dataIndex: 'panelType',
              key: 'panelType',
              render: (value: PanelType | null) =>
                value ? (
                  <Tooltip title={PANEL_TYPE_HINT[value]}>
                    <span>{PANEL_TYPE_LABEL[value]}</span>
                  </Tooltip>
                ) : (
                  <span className="kw-muted">not said</span>
                ),
            },
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
              // D-041 said added; the owner superseded that on 2026-08-31 on
              // the evidence of 2,615 banked payments.
              title: 'Fee treatment',
              key: 'feeTreatment',
              render: (_: unknown, row) => (
                <Tooltip title={FEE_TREATMENT_HINT[row.feeTreatment]}>
                  <Tag
                    color={
                      row.feeTreatment === 'WITHHELD_FROM_CLAIM'
                        ? 'purple'
                        : row.feeTreatment === 'ADDED_TO_RECEIVABLE'
                          ? 'blue'
                          : row.feeTreatment === 'NO_FEE'
                            ? undefined
                            : 'red'
                    }
                  >
                    {FEE_TREATMENT_LABEL[row.feeTreatment]}
                  </Tag>
                </Tooltip>
              ),
            },
            {
              // The effective-dated history. A term is a fact about a period,
              // and "what were we on in March" has to have an answer.
              title: 'Fee terms since',
              key: 'feeTerms',
              optional: true,
              render: (_: unknown, row) =>
                row.feeTerms.length === 0 ? (
                  <span className="kw-muted">—</span>
                ) : (
                  <Tooltip
                    title={row.feeTerms
                      .map(
                        (term) =>
                          `${term.effectiveFrom}: ${FEE_TREATMENT_LABEL[term.feeTreatment]}` +
                          (term.note ? ` — ${term.note}` : ''),
                      )
                      .join('\n')}
                  >
                    <span>
                      {row.feeTerms[0].effectiveFrom}
                      {row.feeTerms.length > 1 ? ` · ${row.feeTerms.length} versions` : ''}
                    </span>
                  </Tooltip>
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
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>What kind of panel is this?</div>
              <Select
                style={{ width: '100%' }}
                placeholder="Nobody has said"
                value={draft.panelType}
                onChange={(value) => setDraft({ ...draft, panelType: value })}
                options={PANEL_TYPES}
              />
              <div className="kw-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                {draft.panelType
                  ? PANEL_TYPE_HINT[draft.panelType]
                  : 'Changes none of your figures — it decides which questions this screen asks you.'}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>How is their fee treated?</div>
              <Select
                style={{ width: '100%' }}
                value={draft.feeTreatment}
                onChange={(value) => setDraft({ ...draft, feeTreatment: value })}
                options={(Object.keys(FEE_TREATMENT_LABEL) as PanelFeeTreatment[]).map((value) => ({
                  value,
                  label: `${FEE_TREATMENT_LABEL[value]} — ${FEE_TREATMENT_HINT[value]}`,
                }))}
              />
              <div className="kw-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                Existing panels here <strong>withhold</strong> their fee: the clinic bills the claim and banks claim −
                fee. That is the standing rule from the owner's decision of 31 Aug 2026, taken on the evidence of the
                clinic's own workbook and 2,615 bank credits. Leave a panel <strong>Not established</strong> only where
                the evidence genuinely does not settle it — its receivables then exclude the fee and say so.
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontSize: 12.5 }}>In force from</span>
                <DatePicker
                  allowClear={false}
                  value={dayjs(draft.feeEffectiveFrom)}
                  onChange={(value) => value && setDraft({ ...draft, feeEffectiveFrom: value.format('YYYY-MM-DD') })}
                />
              </div>
              <Input
                style={{ marginTop: 8 }}
                placeholder="Why — the contract clause, the email, or the evidence"
                value={draft.feeTermNote}
                autoComplete="off"
                aria-label="Why these terms"
                onChange={(event) => setDraft({ ...draft, feeTermNote: event.target.value })}
              />
              <div className="kw-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                Terms are versioned by date, so agreeing new ones next month cannot change what last month's claims were
                worth. Claims already sent keep the treatment they were raised under whatever is recorded here.
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
                {/* N-10 — THE PORTAL ADDRESS, AND NOTHING ELSE.
                    `autoComplete="off"` because a browser that has seen a
                    panel portal login will happily offer the saved username
                    and password into any form it recognises, and the saved
                    password would then be one mis-click from being posted to
                    Kuwick and stored in a column nobody decided to add.
                    There is no password field here and there must not be one;
                    `panel-no-portal-credentials.spec.ts` fails if one
                    appears. */}
                <Input
                  value={draft.portalUrl}
                  placeholder="https://portal.example.com"
                  autoComplete="off"
                  aria-label="Portal address"
                  onChange={(event) => setDraft({ ...draft, portalUrl: event.target.value })}
                />
                <div className="kw-muted" style={{ fontSize: 11.5 }}>
                  The address only. Kuwick never stores a panel portal password — keep those in
                  your password manager, where you can change them without asking us.
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </AdminShell>
  );
}
