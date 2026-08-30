import { Tag, Tooltip } from 'antd';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { DataTable, money } from '../components/DataTable';
import { usePanelConfigs } from '../hooks/useAdmin';

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

  const withoutPortal = data?.filter((panel) => panel.active && !panel.portalUrl) ?? [];

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Panel Configuration"
      subtitle="What the claim workspace needs to know about each panel: where to submit, what they require, and how long they take to pay."
    >
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
              dataIndex: 'paymentTermDays',
              key: 'paymentTermDays',
              className: 'kw-num',
              render: (value: number | null) => (value === null ? <span className="kw-muted">none</span> : `${value}d`),
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
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
