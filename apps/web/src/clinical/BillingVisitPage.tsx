import { useParams } from 'react-router-dom';
import { Alert, Card, Skeleton, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import { useVisit } from './hooks/useVisits';
import { InvoiceTab } from './InvoiceTab';

const { Title, Text } = Typography;

/**
 * G3c (D-065) — the billing workflow's own page.
 *
 * G3c removes every financial mutation control from the Clinical Workspace,
 * on the instruction that "the full billing workflow must remain available in
 * its dedicated billing area". The audit found there wasn't one: `InvoiceTab`
 * — the only place an invoice can be created, lined, paid or cancelled — was
 * mounted *solely* inside the Clinical Workspace. `/management/reports/
 * invoices` is a read-only listing, and the Queue's "Dispensary & Payment"
 * tab is still an empty placeholder.
 *
 * So removing those controls without giving them a home would have left the
 * clinic unable to bill anyone. This page is that home, and it is deliberately
 * the smallest possible move: it mounts the EXISTING `InvoiceTab` unchanged.
 * No billing logic, calculation or rule is altered here — the component is
 * simply reachable at its own URL now, which is also what makes the
 * workspace's "Open Full Invoice" link point somewhere real.
 *
 * Designing the billing workflow properly — and putting real financial RBAC
 * in front of it — is a separate checkpoint (D-056).
 */
export function BillingVisitPage() {
  const { visitId } = useParams<{ visitId: string }>();
  const { data: visit, isLoading, error } = useVisit(visitId);

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }
  if (error || !visit) {
    return (
      <Alert
        type="error"
        showIcon
        message="This visit could not be loaded"
        description="You may not have access to this visit's branch, or the link may be out of date."
      />
    );
  }

  return (
    <div>
      <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          Billing — {visit.patient?.name ?? 'Patient'}
        </Title>
        <Text type="secondary">
          Visit {visit.visitNumber} · {dayjs(visit.checkInAt).format('D MMM YYYY, HH:mm')}
          {visit.clinic?.name ? ` · ${visit.clinic.name}` : ''}
        </Text>
      </Space>

      <Card size="small">
        <InvoiceTab visit={visit} />
      </Card>
    </div>
  );
}
