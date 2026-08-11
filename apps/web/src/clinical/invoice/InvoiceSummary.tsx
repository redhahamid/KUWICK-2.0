import { Alert, Button, Empty, Grid, Space, Tag, Typography } from 'antd';
import { ExportOutlined, FileTextOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useInvoices } from '../hooks/useInvoices';
import { Invoice, Visit } from '../types';
import {
  CLAIM_STATUS_COLOR,
  CLAIM_STATUS_LABEL,
  INVOICE_STATUS_COLOR,
  INVOICE_STATUS_LABEL,
  billingClassification,
  currentClaim,
  invoiceMoney,
  lineSource,
  money,
} from './invoicePresentation';

const { Text } = Typography;

interface InvoiceSummaryProps {
  visit: Visit;
}

/**
 * G3c (D-065) — the Clinical Workspace's READ-ONLY view of the money.
 *
 * A doctor mid-consultation needs to understand what the patient is being
 * charged and whether it has been settled. They do not need — and should not
 * be handed — Pay, Cancel, Refund, Quick Add, add/remove line, change price,
 * change panel or apply a discount. Those live in the billing workflow.
 *
 * This is a genuinely read-only component, not the mutable tab with its
 * buttons hidden: it imports `useInvoices` and nothing else. There is no
 * `useCreateInvoice`, `useAddInvoiceLine`, `useRemoveInvoiceLine`,
 * `useCancelInvoice` or `usePayInvoice` anywhere in this file or the ones it
 * pulls in — CSS-hiding a live mutation control would have been theatre, and
 * the backend RBAC that would make it safe does not exist yet (D-056).
 *
 * Every figure shown is the backend's. Nothing is recomputed here.
 */
export function InvoiceSummary({ visit }: InvoiceSummaryProps) {
  const screens = Grid.useBreakpoint();
  const compact = !screens.md;
  const { data: invoices, isLoading, error } = useInvoices(visit.id);
  const list = invoices ?? [];

  // 44px targets on small screens — the same rule G3b had to fix after the
  // live check caught 24px buttons.
  const touch = compact ? { minHeight: 44, paddingInline: 14 } : undefined;

  const openFullInvoice = (invoice: Invoice) => {
    // A new tab, deliberately: leaving the record mid-consultation would
    // interrupt it, and C1's unsaved-note protection should never have to
    // fire because a doctor glanced at a bill.
    window.open(`/billing/visits/${visit.id}?invoiceId=${invoice.id}`, '_blank', 'noopener');
  };

  if (error) {
    return <Alert type="error" showIcon message="The invoice for this visit could not be loaded" />;
  }

  // §3 — an empty state that says so, rather than RM0.00 dressed as a bill.
  if (!isLoading && list.length === 0) {
    return (
      <Empty
        image={<FileTextOutlined style={{ fontSize: 36, opacity: 0.25 }} />}
        description="No invoice has been created for this visit."
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          Invoicing is done in the billing workflow.
        </Text>
      </Empty>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {list.map((invoice) => {
        const billing = billingClassification(invoice, visit);
        const amounts = invoiceMoney(invoice);
        const claim = currentClaim(invoice);

        return (
          <div
            key={invoice.id}
            className="kw-invoice-card"
            data-invoice-status={invoice.status}
            style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}
          >
            {/* --- header ------------------------------------------------ */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Space wrap size={4} style={{ marginBottom: 4 }}>
                  <Text strong>Invoice {invoice.invoiceNumber}</Text>
                  {/* Payment state and claim state are separate facts and
                      are shown as separate badges, never merged. */}
                  <Tag color={INVOICE_STATUS_COLOR[invoice.status]}>
                    {INVOICE_STATUS_LABEL[invoice.status]}
                  </Tag>
                  <Tag color={billing.isPanel ? 'purple' : 'default'}>{billing.label}</Tag>
                  {claim && <Tag color={CLAIM_STATUS_COLOR[claim.status]}>{CLAIM_STATUS_LABEL[claim.status]}</Tag>}
                </Space>
                <div style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.7 }}>
                  <div>
                    Raised by {invoice.createdBy?.fullName ?? 'Not recorded'} ·{' '}
                    {dayjs(invoice.createdAt).format('D MMM YYYY, HH:mm')}
                  </div>
                  {invoice.status === 'PAID' && invoice.paidAt && (
                    <div>
                      Paid {dayjs(invoice.paidAt).format('D MMM YYYY, HH:mm')}
                      {invoice.paymentMethod ? ` · ${invoice.paymentMethod}` : ''}
                    </div>
                  )}
                  {invoice.status === 'CANCELLED' && invoice.cancelReason && (
                    <div>Cancelled — {invoice.cancelReason}</div>
                  )}
                </div>
              </div>

              <Button
                size={compact ? 'middle' : 'small'}
                style={touch}
                icon={<ExportOutlined />}
                onClick={() => openFullInvoice(invoice)}
              >
                Open Full Invoice
              </Button>
            </div>

            {/* --- lines -------------------------------------------------
                Rows, not a table: a desktop financial table squeezed into
                375px is unreadable, and this has to work on a phone. */}
            {invoice.lines.filter((line) => !line.cancelledAt).length > 0 && (
              <div style={{ borderTop: '1px solid #f5f5f5', paddingTop: 8 }}>
                {invoice.lines.filter((line) => !line.cancelledAt).map((line) => {
                  const source = lineSource(line);
                  return (
                    <div
                      key={line.id}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        justifyContent: 'space-between',
                        padding: '4px 0',
                        fontSize: 13,
                      }}
                    >
                      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                        <Space wrap size={4}>
                          <Text>{line.description}</Text>
                          {source.label && (
                            <Tag color={source.color ?? undefined} style={{ marginInlineEnd: 0 }}>
                              {source.label}
                            </Tag>
                          )}
                          {line.excludedFromPanel && <Tag color="orange">Not covered by panel</Tag>}
                        </Space>
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                          {line.quantity} × {money(line.unitPrice)}
                        </div>
                      </div>
                      <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{money(line.amount)}</Text>
                    </div>
                  );
                })}
              </div>
            )}

            {/* --- totals -------------------------------------------------
                Only what the model stores. There are no tax/SST or discount
                columns in this schema, so no such line is shown. */}
            <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 8, paddingTop: 8 }}>
              <TotalRow label="Total" value={money(amounts.total)} strong />
              {amounts.split && (
                <>
                  <TotalRow label="Panel covered" value={money(amounts.split.panelCovered)} />
                  <TotalRow label="Patient paid" value={money(amounts.split.patientPaid)} />
                </>
              )}
              <TotalRow label="Received" value={money(amounts.received)} />
              <TotalRow
                label="Outstanding"
                value={money(amounts.outstanding)}
                strong
                danger={amounts.outstanding > 0}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
      <Text type={strong ? undefined : 'secondary'} strong={strong}>
        {label}
      </Text>
      <Text strong={strong} type={danger ? 'danger' : undefined} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
    </div>
  );
}
