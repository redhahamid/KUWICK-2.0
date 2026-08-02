import { Tag } from 'antd';
import { useInvoices } from '../hooks/useInvoices';
import { InvoiceTab } from '../InvoiceTab';
import { Invoice, InvoiceStatus, Visit } from '../types';
import { ClinicalSection } from './ClinicalSection';

const STATUS_COLOR: Record<InvoiceStatus, string> = {
  UNPAID: 'gold',
  PAID: 'green',
  CANCELLED: 'default',
};

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  UNPAID: 'Unpaid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

interface InvoiceSectionProps {
  visit: Visit;
  expanded: boolean;
  onToggle: () => void;
}

// G1 (D-058) — Invoice is now its own section, separate from Documents.
//
// The expanded body is the EXISTING InvoiceTab. G1's rule is parity — every
// current action preserved, nothing added — so this neither introduces new
// financial controls nor removes the ones the old modal already exposed.
// Turning this into a genuinely read-only summary is G3, and the real gap
// behind it is that no server-side RBAC exists yet (D-056); hiding buttons
// here would be cosmetic, so it is not pretended.
export function InvoiceSection({ visit, expanded, onToggle }: InvoiceSectionProps) {
  const { data: invoices, isLoading, error } = useInvoices(visit.id);
  const list = invoices ?? [];

  const active = list.filter((inv: Invoice) => inv.status !== 'CANCELLED');
  const total = active.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
  const outstanding = active.filter((inv) => inv.status === 'UNPAID');
  const isPanel = Boolean(visit.panelClinicId);

  const parts: string[] = [];
  if (active.length > 0) parts.push(`RM ${total.toFixed(2)}`);
  parts.push(isPanel ? `Panel — ${visit.billingType}` : 'Cash');
  if (list.length > 1) parts.push(`${list.length} invoices`);

  const statusTag =
    active.length === 0 ? undefined : (
      <Tag color={STATUS_COLOR[outstanding.length > 0 ? 'UNPAID' : 'PAID']}>
        {STATUS_LABEL[outstanding.length > 0 ? 'UNPAID' : 'PAID']}
      </Tag>
    );

  return (
    <ClinicalSection
      title="Invoice"
      summary={parts.join(' · ')}
      status={statusTag}
      isLoading={isLoading}
      error={error ?? undefined}
      isEmpty={!isLoading && list.length === 0}
      emptyText="No invoice raised for this visit"
      primaryAction={{ label: 'Open Invoice', onClick: () => !expanded && onToggle() }}
      expanded={expanded}
      onToggle={onToggle}
    >
      <InvoiceTab visit={visit} />
    </ClinicalSection>
  );
}
