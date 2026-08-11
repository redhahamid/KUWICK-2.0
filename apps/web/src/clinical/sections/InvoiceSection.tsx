import { Space, Tag } from 'antd';
import { useInvoices } from '../hooks/useInvoices';
import { InvoiceSummary } from '../invoice/InvoiceSummary';
import {
  CLAIM_STATUS_COLOR,
  CLAIM_STATUS_LABEL,
  INVOICE_STATUS_COLOR,
  INVOICE_STATUS_LABEL,
  collapsedSummary,
  currentClaim,
} from '../invoice/invoicePresentation';
import { Visit } from '../types';
import { ClinicalSection } from './ClinicalSection';

interface InvoiceSectionProps {
  visit: Visit;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * G1 (D-058) — Invoice is its own section. G3c (D-065) made it read-only.
 *
 * G1 mounted the full mutable `InvoiceTab` here under a parity rule, and said
 * outright that turning it into a genuine read-only summary was G3's job.
 * This is that: the body is `InvoiceSummary`, which imports no mutation hook
 * at all. Pay, Cancel, Quick Add, add/remove line, change price and change
 * panel are gone from the Clinical Workspace — not hidden, absent — and live
 * on the billing page the primary action opens.
 */
export function InvoiceSection({ visit, expanded, onToggle }: InvoiceSectionProps) {
  const { data: invoices, isLoading, error } = useInvoices(visit.id);
  const list = invoices ?? [];
  const latest = list[0];
  const claim = latest ? currentClaim(latest) : null;

  // Payment state and panel-claim state are separate lifecycles. Two tags,
  // never one blended badge, and each carries its own words as well as
  // colour so nothing depends on colour alone.
  const status = latest ? (
    <Space size={4}>
      <Tag color={INVOICE_STATUS_COLOR[latest.status]}>{INVOICE_STATUS_LABEL[latest.status]}</Tag>
      {claim && <Tag color={CLAIM_STATUS_COLOR[claim.status]}>{CLAIM_STATUS_LABEL[claim.status]}</Tag>}
    </Space>
  ) : undefined;

  return (
    <ClinicalSection
      title="Invoice"
      summary={collapsedSummary(list, visit)}
      status={status}
      isLoading={isLoading}
      error={error ?? undefined}
      isEmpty={!isLoading && list.length === 0}
      emptyText="No invoice has been created for this visit"
      primaryAction={
        latest
          ? {
              label: 'Open Full Invoice',
              // A new tab: billing is a different job from the consultation,
              // and navigating away mid-note is how work gets lost.
              onClick: () =>
                window.open(`/billing/visits/${visit.id}?invoiceId=${latest.id}`, '_blank', 'noopener'),
            }
          : {
              label: 'Open Billing',
              onClick: () => window.open(`/billing/visits/${visit.id}`, '_blank', 'noopener'),
            }
      }
      expanded={expanded}
      onToggle={onToggle}
    >
      <InvoiceSummary visit={visit} />
    </ClinicalSection>
  );
}
