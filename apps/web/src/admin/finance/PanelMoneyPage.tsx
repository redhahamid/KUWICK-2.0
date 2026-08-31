import { useState } from 'react';
import { Button, DatePicker, Select, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { usePanelMoney, usePanelReconciliation } from '../hooks/useAdmin';
import { FEE_EVIDENCE_LABELS } from '../types';
import type {
  PanelMoneyExceptionRow,
  PanelMoneyPanelRow,
  PanelMoneyRemittanceRow,
  PanelMoneyUnclaimedRow,
} from '../types';

/**
 * PANEL MONEY — the finance side of the panel relationship.
 *
 * The panel workspace is a work queue: it shows claims that exist. This screen
 * answers the three questions a work queue structurally cannot, because two of
 * them are about something MISSING and the third is about money that has
 * already left the building.
 *
 *  1. BILLED BUT NEVER CLAIMED. An invoice whose panel share was never claimed
 *     appears in no claim listing anywhere — it is invisible by construction.
 *     The clinic finds these today by exporting the billing system every month
 *     and comparing it against the claim workbook by hand
 *     (docs/PANEL_LEGACY_WORKFLOW_AUDIT.md §7).
 *
 *  2. WHAT THE ADMIN FEE COSTS. Only askable since the owner established that
 *     the fee is withheld rather than added (D-112): the clinic bills RM100 and
 *     banks RM92, and that RM8 appeared in no ledger.
 *
 *  3. WHERE THE FEE RULE AND THE MONEY DISAGREE. The two full-amount payments
 *     the owner asked to have investigated were found by a forensic pass over
 *     2,640 rows. This runs that pass continuously.
 *
 * Nothing here is a second formula: every claim figure comes from the same
 * `computeClaimBalance` the claim screen uses.
 */

const BILLING_STATE_TONE: Record<string, string> = {
  UNCLAIMED: 'red',
  UNDER_CLAIMED: 'orange',
  OVER_CLAIMED: 'volcano',
  CLAIMED: 'green',
};

const BILLING_STATE_LABEL: Record<string, string> = {
  UNCLAIMED: 'Never claimed',
  UNDER_CLAIMED: 'Claimed for less',
  OVER_CLAIMED: 'Claimed for more',
  CLAIMED: 'Claimed',
};

type Tab = 'unclaimed' | 'panels' | 'exceptions' | 'receipts';

export function PanelMoneyPage() {
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [panelFilter, setPanelFilter] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>('unclaimed');

  const position = usePanelMoney({ ...range, panelClinicId: panelFilter });
  // Only for the panel picker — the same list the rest of the panel module uses.
  const panels = usePanelReconciliation({});

  const billing = position.data?.billing;
  const feeCost = position.data?.feeCost;
  const banked = position.data?.banked;
  const evidence = position.data?.feeEvidence;

  const panelOptions = (panels.data?.byPanel ?? []).map((row) => ({
    value: row.panelClinicId,
    label: row.panelName,
  }));

  return (
    <AdminShell
      error={firstError(position, panels)}
      title="Panel money"
      subtitle="What we billed panels against what we claimed, what their admin fees cost, and what they actually banked. Chasing a claim is the Panel module's job; this is the money around it."
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <DatePicker.RangePicker
            size="small"
            allowEmpty={[true, true]}
            value={[range.from ? dayjs(range.from) : null, range.to ? dayjs(range.to) : null]}
            onChange={(values) =>
              setRange({
                from: values?.[0]?.format('YYYY-MM-DD'),
                to: values?.[1]?.format('YYYY-MM-DD'),
              })
            }
          />
          <Select
            size="small"
            allowClear
            style={{ minWidth: 220 }}
            placeholder="All panels"
            value={panelFilter}
            onChange={setPanelFilter}
            options={panelOptions}
          />
        </div>
      }
    >
      <StatStrip
        stats={[
          {
            label: 'Billed to panels',
            value: money(billing?.billed ?? 0),
            hint: `${billing?.invoices ?? 0} settled invoices`,
            explain:
              'The panel share of every settled invoice in the period. What the clinic decided the panel owes, at the moment it decided it.',
          },
          {
            label: 'Claimed',
            value: money(billing?.claimed ?? 0),
            hint:
              billing?.claimedRate === null || billing?.claimedRate === undefined
                ? '—'
                : `${billing.claimedRate}% of billed`,
            explain:
              'Claims raised against a Kuwick invoice. Claims imported from the previous system have no invoice behind them, so they are in neither this figure nor "billed" — they are counted in the fee figures below and chased in the Panel module like any other claim.',
          },
          {
            label: 'Billed and never claimed',
            value: money(billing?.unclaimed ?? 0),
            hint: `${billing?.unclaimedInvoices ?? 0} invoice(s)`,
            tone: (billing?.unclaimed ?? 0) > 0 ? 'bad' : 'good',
            explain:
              'Money the clinic is owed and has not asked for. It appears in no claim listing, which is why nobody notices it.',
          },
          {
            label: 'Admin fees borne',
            value: money(feeCost?.borne ?? 0),
            hint: `${money(feeCost?.expected ?? 0)} still to come`,
            tone: 'warn',
            explain:
              'What the panels kept out of claims they have paid. A withheld fee is a cost of doing panel business — see D-112.',
          },
          {
            label: 'Banked from panels',
            value: money(banked?.net ?? 0),
            hint: `${banked?.remittances ?? 0} remittance(s)`,
            explain: 'Net cash received against claims. Kept apart from patient payments, which are counted at the till.',
          },
        ]}
      />

      {(billing?.unclaimed ?? 0) > 0 ? (
        <AdminNotice tone="warn">
          <strong>{money(billing?.unclaimed ?? 0)} was billed to a panel and never claimed</strong>, across{' '}
          {billing?.unclaimedInvoices} invoice(s). Kuwick does not put a deadline on this — no panel in the clinic's
          own records states a submission window, and the two-month rule in the rejection register is about
          re-claiming, not first claims. The age is below; the judgement is yours.
        </AdminNotice>
      ) : null}

      {(billing?.importedClaims ?? 0) > 0 ? (
        <AdminNotice tone="info">
          {billing?.importedClaims} claim(s) here were imported from the previous system. They have
          no Kuwick invoice behind them, so <strong>billed</strong> and <strong>claimed</strong>
          {' '}above exclude them — those two figures compare invoices raised in Kuwick against
          claims made from them. The fee cost, the fee exceptions and the panel receivable all
          include them.
        </AdminNotice>
      ) : null}

      {(billing?.overClaimed ?? 0) > 0 ? (
        <AdminNotice tone="warn">
          {money(billing?.overClaimed ?? 0)} has been claimed BEYOND what was billed, on{' '}
          {billing?.overClaimedInvoices} invoice(s). That is not a windfall — it is a claim a panel can reject in full.
        </AdminNotice>
      ) : null}

      {(feeCost?.unresolvedClaims ?? 0) > 0 ? (
        <AdminNotice tone="warn">
          {feeCost?.unresolvedClaims} claim(s) carry a fee of {money(feeCost?.unresolvedFee ?? 0)} whose direction
          nobody has configured. That fee is in <strong>neither</strong> figure above, so both the cost borne and the
          cost still to come are understated by up to that much. Set the treatment on{' '}
          <strong>Panel → Configuration</strong>.
        </AdminNotice>
      ) : null}

      {(evidence?.notTaken ?? 0) > 0 ? (
        <AdminNotice tone="warn">
          <strong>
            {evidence?.notTaken} settled claim(s) were paid {money(evidence?.notTakenAmount ?? 0)} more than the
            configured fee rule expects
          </strong>{' '}
          — the panel did not deduct its admin fee. Worth establishing whether the fee was waived, the rule has
          changed, or the configuration is wrong. Listed under <strong>Fee exceptions</strong>.
        </AdminNotice>
      ) : null}

      <div style={{ display: 'flex', gap: 8, margin: '4px 0 12px' }}>
        {(
          [
            ['unclaimed', `Never claimed (${billing?.unclaimedInvoices ?? 0})`],
            ['panels', 'By panel'],
            ['exceptions', `Fee exceptions (${(evidence?.notTaken ?? 0) + (evidence?.overpaid ?? 0)})`],
            ['receipts', `Receipts (${banked?.remittances ?? 0})`],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <Button key={key} size="small" type={tab === key ? 'primary' : 'default'} onClick={() => setTab(key)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === 'unclaimed' ? (
        <AdminSection
          title="Billed to a panel, never claimed"
          description="Aged from the day the invoice was settled — the day the money became claimable. Oldest first."
        >
          <DataTable<PanelMoneyUnclaimedRow>
            rows={position.data?.unclaimedInvoiceRows}
            loading={position.isLoading}
            rowKey="invoiceId"
            exportName="panel-money-unclaimed"
            emptyText="Every panel invoice in this period has been claimed"
            searchFields={['invoiceNumber' as never, 'panelName' as never]}
            columns={[
              { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber' },
              { title: 'Visit', dataIndex: 'visitNumber', key: 'visitNumber' },
              { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' },
              { title: 'Panel', dataIndex: 'panelName', key: 'panelName' },
              { title: 'Settled', dataIndex: 'settledAt', key: 'settledAt' },
              {
                title: 'Waiting',
                dataIndex: 'ageDays',
                key: 'ageDays',
                align: 'right',
                render: (days: number) => (
                  <span style={{ color: days > 60 ? '#cf1322' : days > 30 ? '#d46b08' : undefined }}>{days} days</span>
                ),
              },
              { title: 'Billed', dataIndex: 'billed', key: 'billed', align: 'right', render: money },
              { title: 'Claimed', dataIndex: 'claimed', key: 'claimed', align: 'right', render: money },
              {
                title: 'Not claimed',
                dataIndex: 'unclaimed',
                key: 'unclaimed',
                align: 'right',
                render: (value: number) => <strong style={{ color: '#cf1322' }}>{money(value)}</strong>,
              },
              {
                title: 'State',
                dataIndex: 'state',
                key: 'state',
                render: (state: string) => <Tag color={BILLING_STATE_TONE[state]}>{BILLING_STATE_LABEL[state]}</Tag>,
              },
            ]}
          />
        </AdminSection>
      ) : null}

      {tab === 'panels' ? (
        <AdminSection
          title="By panel"
          description="Billed, claimed, banked, and what each panel's admin fee costs the clinic."
        >
          <DataTable<PanelMoneyPanelRow>
            rows={position.data?.byPanel}
            loading={position.isLoading}
            rowKey="panelName"
            exportName="panel-money-by-panel"
            emptyText="No panel activity in this period"
            columns={[
              { title: 'Panel', dataIndex: 'panelName', key: 'panelName' },
              { title: 'Billed', dataIndex: 'billed', key: 'billed', align: 'right', render: money },
              { title: 'Claimed', dataIndex: 'claimed', key: 'claimed', align: 'right', render: money },
              {
                title: 'Not claimed',
                dataIndex: 'unclaimed',
                key: 'unclaimed',
                align: 'right',
                render: (value: number, row: PanelMoneyPanelRow) =>
                  value > 0 ? (
                    <Tooltip title={`${row.unclaimedInvoices} invoice(s)`}>
                      <strong style={{ color: '#cf1322' }}>{money(value)}</strong>
                    </Tooltip>
                  ) : (
                    <span style={{ color: '#8c8c8c' }}>—</span>
                  ),
              },
              { title: 'Banked', dataIndex: 'banked', key: 'banked', align: 'right', render: money },
              {
                title: 'Fee borne',
                dataIndex: 'feeBorne',
                key: 'feeBorne',
                align: 'right',
                render: money,
              },
              {
                title: 'Fee to come',
                dataIndex: 'feeExpected',
                key: 'feeExpected',
                align: 'right',
                render: (value: number) =>
                  value > 0 ? money(value) : <span style={{ color: '#8c8c8c' }}>—</span>,
              },
            ]}
          />
        </AdminSection>
      ) : null}

      {tab === 'exceptions' ? (
        <AdminSection
          title="Where the fee rule and the money disagree"
          description="Every settled claim compared against what its own fee rule says should have arrived. This is the standing version of the forensic pass that found two such payments in the clinic's claim workbook."
        >
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: 12, color: '#595959' }}>
            <span>
              Fee taken as configured: <strong>{evidence?.taken ?? 0}</strong>
            </span>
            <span>
              Still owed: <strong>{evidence?.pending ?? 0}</strong>
            </span>
            <span>
              Closed without payment: <strong>{evidence?.notPaid ?? 0}</strong>
            </span>
            <span>
              Cannot be attributed: <strong>{evidence?.inconclusive ?? 0}</strong>
            </span>
          </div>
          <DataTable<PanelMoneyExceptionRow>
            rows={position.data?.exceptionRows}
            loading={position.isLoading}
            rowKey={(row) => `${row.invoiceNumber}-${row.state}`}
            exportName="panel-money-fee-exceptions"
            emptyText="Every settled claim was paid exactly what its fee rule expects"
            columns={[
              { title: 'Panel', dataIndex: 'panelName', key: 'panelName' },
              { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber' },
              {
                title: 'Finding',
                dataIndex: 'state',
                key: 'state',
                render: (state: keyof typeof FEE_EVIDENCE_LABELS) => (
                  <Tag color={state === 'NOT_TAKEN' ? 'orange' : 'volcano'}>{FEE_EVIDENCE_LABELS[state]}</Tag>
                ),
              },
              { title: 'Claimed', dataIndex: 'claimed', key: 'claimed', align: 'right', render: money },
              {
                title: 'Rule expects',
                dataIndex: 'expected',
                key: 'expected',
                align: 'right',
                render: money,
              },
              { title: 'Received', dataIndex: 'received', key: 'received', align: 'right', render: money },
              {
                title: 'Difference',
                dataIndex: 'difference',
                key: 'difference',
                align: 'right',
                render: (value: number) => <strong style={{ color: '#d46b08' }}>{money(value)}</strong>,
              },
            ]}
          />
        </AdminSection>
      ) : null}

      {tab === 'receipts' ? (
        <AdminSection
          title="What the panels banked"
          description="Cash received against claims, kept apart from patient payments because it arrives by transfer rather than at the till."
        >
          {(banked?.unexplained ?? 0) > 0 ? (
            <AdminNotice tone="warn">
              {money(banked?.unexplained ?? 0)} was deducted beyond the fees Kuwick expected, on{' '}
              {banked?.remittancesThatDisagree} remittance(s). Somebody has to ask why.
            </AdminNotice>
          ) : null}
          <DataTable<PanelMoneyRemittanceRow>
            rows={position.data?.remittanceRows}
            loading={position.isLoading}
            rowKey="remittanceId"
            exportName="panel-money-receipts"
            emptyText="No panel has paid in this period"
            searchFields={['reference' as never, 'panelName' as never]}
            columns={[
              { title: 'Received', dataIndex: 'receivedAt', key: 'receivedAt' },
              { title: 'Panel', dataIndex: 'panelName', key: 'panelName' },
              { title: 'Reference', dataIndex: 'reference', key: 'reference' },
              { title: 'Claims', dataIndex: 'claims', key: 'claims', align: 'right' },
              { title: 'Gross', dataIndex: 'gross', key: 'gross', align: 'right', render: money },
              {
                title: 'Withheld',
                dataIndex: 'withheld',
                key: 'withheld',
                align: 'right',
                render: (value: number, row: PanelMoneyRemittanceRow) =>
                  row.withholdingChecked ? (
                    money(value)
                  ) : (
                    <Tooltip title="This payment was keyed as a net amount, so there is no remittance-level deduction to check. Whether the fee was taken is answered under Fee exceptions.">
                      <span style={{ color: '#8c8c8c' }}>keyed net</span>
                    </Tooltip>
                  ),
              },
              { title: 'Net', dataIndex: 'net', key: 'net', align: 'right', render: money },
              {
                title: 'Unexplained',
                dataIndex: 'unexplained',
                key: 'unexplained',
                align: 'right',
                render: (value: number) =>
                  value > 0 ? (
                    <strong style={{ color: '#cf1322' }}>{money(value)}</strong>
                  ) : (
                    <span style={{ color: '#8c8c8c' }}>—</span>
                  ),
              },
            ]}
          />
        </AdminSection>
      ) : null}

      <AdminSection
        title="How long the unclaimed money has been waiting"
        description="Aged from settlement. Kuwick does not call any of it late — no panel record states a first-submission deadline, and inventing one would be a rule the clinic never agreed."
      >
        <StatStrip
          stats={[
            { label: '0–30 days', value: money(billing?.aging.current ?? 0) },
            { label: '31–60 days', value: money(billing?.aging.d31_60 ?? 0) },
            {
              label: '61–90 days',
              value: money(billing?.aging.d61_90 ?? 0),
              tone: (billing?.aging.d61_90 ?? 0) > 0 ? 'warn' : 'neutral',
            },
            {
              label: 'Over 90 days',
              value: money(billing?.aging.d90_plus ?? 0),
              tone: (billing?.aging.d90_plus ?? 0) > 0 ? 'bad' : 'neutral',
            },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
