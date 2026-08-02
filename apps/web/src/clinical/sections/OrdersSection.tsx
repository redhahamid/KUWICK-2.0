import { Tag } from 'antd';
import { useOrderServices } from '../hooks/useOrderServices';
import { OrdersServicesTab } from '../OrdersServicesTab';
import { OrderServiceStatus } from '../types';
import { ClinicalSection } from './ClinicalSection';

// G1 (D-058) — human labels for the collapsed summary ONLY. The enum, the
// API and the expanded tab are untouched; "IN_PROGRESS" is a database value,
// not something to show a doctor mid-consultation. The richer order UX,
// including any approval workflow, is G2 and a later approved phase.
const STATUS_LABEL: Record<OrderServiceStatus, string> = {
  PENDING: 'Ordered',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// Reported in clinical order, not enum order: what is outstanding first.
const STATUS_ORDER: OrderServiceStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

interface OrdersSectionProps {
  visitId: string;
  expanded: boolean;
  onToggle: () => void;
}

export function OrdersSection({ visitId, expanded, onToggle }: OrdersSectionProps) {
  const { data: orders, isLoading, error } = useOrderServices(visitId);
  const list = orders ?? [];

  const counts = STATUS_ORDER.map((status) => ({
    status,
    n: list.filter((order) => order.status === status).length,
  })).filter((entry) => entry.n > 0);

  const summary = counts.map((entry) => `${entry.n} ${STATUS_LABEL[entry.status]}`).join(' · ');

  // Outstanding work is the thing worth surfacing without expanding.
  const outstanding = list.filter((o) => o.status === 'PENDING' || o.status === 'IN_PROGRESS').length;

  return (
    <ClinicalSection
      title="Orders / Procedures"
      count={list.length}
      summary={summary}
      status={outstanding > 0 ? <Tag color="gold">{outstanding} awaiting result</Tag> : undefined}
      isLoading={isLoading}
      error={error ?? undefined}
      isEmpty={!isLoading && list.length === 0}
      emptyText="No orders or procedures for this visit"
      primaryAction={{ label: '+ Add Order', onClick: () => !expanded && onToggle() }}
      expanded={expanded}
      onToggle={onToggle}
    >
      <OrdersServicesTab visitId={visitId} />
    </ClinicalSection>
  );
}
