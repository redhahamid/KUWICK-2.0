import { useState } from 'react';
import { Button, Card, Divider, Empty, Input, InputNumber, List, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined, DeleteOutlined, FileDoneOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useStaff } from '../hr/hooks/useStaff';
import {
  useAddInvoiceLine,
  useCancelInvoice,
  useCreateInvoice,
  useInvoices,
  usePayInvoice,
  useRemoveInvoiceLine,
} from './hooks/useInvoices';
import { useOrderServices } from './hooks/useOrderServices';
import { usePrescriptions } from './hooks/usePrescriptions';
import { useServices } from './hooks/useServices';
import { usePanelClinics } from './hooks/usePanelClinics';
import { usePanelExclusions, usePanelPriceOverrides } from './hooks/usePanelPricing';
import { useItems } from '../inventory/hooks/useItems';
import { Invoice, InvoiceLine, InvoiceStatus, OrderService, PanelExclusion, PanelPriceOverride, PaymentMethod, Prescription, Visit } from './types';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const STATUS_COLOR: Record<InvoiceStatus, string> = {
  UNPAID: 'gold',
  PAID: 'green',
  CANCELLED: 'default',
};

// Cash/Card/QR/Bank Transfer — the real staff-facing option set (Cash,
// Credit/Debit Card, QR Payment e.g. DuitNow, Bank Transfer). PANEL is
// handled by a separate "Mark Fully Covered" action, never shown here.
const PATIENT_PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Credit / Debit Card' },
  { value: 'QR', label: 'QR Payment' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
];

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Credit / Debit Card',
  QR: 'QR Payment',
  BANK_TRANSFER: 'Bank Transfer',
  PANEL: 'Panel (Fully Covered)',
};

interface InvoiceTabProps {
  visit: Visit;
}

interface AddLineFormProps {
  invoiceId: string;
  visitId: string;
}

function AddLineForm({ invoiceId, visitId }: AddLineFormProps) {
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState<number>();
  const addLine = useAddInvoiceLine(visitId);

  const handleAdd = async () => {
    if (!description.trim() || !unitPrice) return;
    try {
      await addLine.mutateAsync({ invoiceId, dto: { description: description.trim(), quantity, unitPrice } });
      setDescription('');
      setQuantity(1);
      setUnitPrice(undefined);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add line');
    }
  };

  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Input
        placeholder="Description (e.g. Consultation Fee)"
        style={{ width: 240 }}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <InputNumber min={1} value={quantity} onChange={(v) => setQuantity(v ?? 1)} placeholder="Qty" style={{ width: 80 }} />
      <InputNumber
        min={0}
        precision={2}
        value={unitPrice}
        onChange={(v) => setUnitPrice(v ?? undefined)}
        placeholder="Unit Price (RM)"
        style={{ width: 140 }}
      />
      <Button
        icon={<PlusOutlined />}
        loading={addLine.isPending}
        disabled={!description.trim() || !unitPrice}
        onClick={handleAdd}
      >
        Add Line
      </Button>
    </Space>
  );
}

interface QuickAddProps {
  invoice: Invoice;
  visit: Visit;
}

// Phase A8 — staff-reviewed auto-pull. Completed services/dispensed
// medications not yet on THIS invoice are suggested with a one-click Add;
// nothing is added silently. Suggested price uses the panel's negotiated
// override when one exists for that item/service, else the self-pay
// catalog price. The server independently re-checks the exclusion list at
// add-time (InvoiceService.addLine), so a stale suggestion here can never
// under-flag a copay.
function QuickAddSuggestions({ invoice, visit }: QuickAddProps) {
  const { data: orderServices } = useOrderServices(visit.id, { status: 'COMPLETED' });
  const { data: prescriptions } = usePrescriptions(visit.id);
  const { data: services } = useServices();
  const { data: items } = useItems();
  const { data: overrides } = usePanelPriceOverrides(visit.panelClinicId ?? undefined);
  const { data: exclusions } = usePanelExclusions(visit.panelClinicId ?? undefined);
  const addLine = useAddInvoiceLine(visit.id);

  const linkedOrderServiceIds = new Set(invoice.lines.map((l) => l.sourceOrderServiceId).filter(Boolean));
  const linkedPrescriptionIds = new Set(invoice.lines.map((l) => l.sourcePrescriptionId).filter(Boolean));

  const dispensedPrescriptions = (prescriptions ?? []).filter((p) => p.status === 'DISPENSED');
  const pendingServices = (orderServices ?? []).filter((os) => !linkedOrderServiceIds.has(os.id));
  const pendingPrescriptions = dispensedPrescriptions.filter((p) => !linkedPrescriptionIds.has(p.id));

  if (pendingServices.length === 0 && pendingPrescriptions.length === 0) {
    return null;
  }

  const overrideFor = (target: { itemId?: string; serviceCatalogId?: string }) =>
    overrides?.find(
      (o: PanelPriceOverride) =>
        (target.itemId && o.itemId === target.itemId) || (target.serviceCatalogId && o.serviceCatalogId === target.serviceCatalogId),
    );

  const isExcluded = (target: { itemId?: string; serviceCatalogId?: string }) =>
    exclusions?.some(
      (e: PanelExclusion) =>
        (target.itemId && e.itemId === target.itemId) || (target.serviceCatalogId && e.serviceCatalogId === target.serviceCatalogId),
    ) ?? false;

  const addService = async (order: OrderService) => {
    const service = services?.find((s) => s.id === order.serviceCatalogId);
    const override = overrideFor({ serviceCatalogId: order.serviceCatalogId });
    const unitPrice = override ? Number(override.overridePrice) : Number(service?.price ?? 0);
    try {
      await addLine.mutateAsync({
        invoiceId: invoice.id,
        dto: { description: order.procedureName, quantity: 1, unitPrice, sourceOrderServiceId: order.id },
      });
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add line');
    }
  };

  const addPrescription = async (prescription: Prescription) => {
    const item = prescription.item ?? items?.find((i) => i.id === prescription.itemId);
    const override = overrideFor({ itemId: prescription.itemId });
    const unitPrice = override ? Number(override.overridePrice) : Number(item?.sellPrice ?? 0);
    try {
      await addLine.mutateAsync({
        invoiceId: invoice.id,
        dto: {
          description: item?.name ?? 'Medication',
          quantity: prescription.quantity,
          unitPrice,
          sourcePrescriptionId: prescription.id,
        },
      });
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add line');
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Quick Add — completed services & dispensed medications not yet on this invoice
      </Text>
      <List
        size="small"
        dataSource={[
          ...pendingServices.map((order) => ({ kind: 'service' as const, order })),
          ...pendingPrescriptions.map((prescription) => ({ kind: 'prescription' as const, prescription })),
        ]}
        renderItem={(row) => {
          if (row.kind === 'service') {
            const excluded = isExcluded({ serviceCatalogId: row.order.serviceCatalogId });
            const override = overrideFor({ serviceCatalogId: row.order.serviceCatalogId });
            return (
              <List.Item
                actions={[
                  <Button key="add" size="small" icon={<PlusOutlined />} loading={addLine.isPending} onClick={() => addService(row.order)}>
                    Add
                  </Button>,
                ]}
              >
                <Space wrap>
                  <Text>{row.order.procedureName}</Text>
                  {override && <Tag color="blue">Panel Rate</Tag>}
                  {excluded && <Tag color="red">Not Covered</Tag>}
                </Space>
              </List.Item>
            );
          }
          const item = row.prescription.item;
          const excluded = isExcluded({ itemId: row.prescription.itemId });
          const override = overrideFor({ itemId: row.prescription.itemId });
          return (
            <List.Item
              actions={[
                <Button key="add" size="small" icon={<PlusOutlined />} loading={addLine.isPending} onClick={() => addPrescription(row.prescription)}>
                  Add
                </Button>,
              ]}
            >
              <Space wrap>
                <Text>{item?.name ?? 'Medication'}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  x{row.prescription.quantity}
                </Text>
                {override && <Tag color="blue">Panel Rate</Tag>}
                {excluded && <Tag color="red">Not Covered</Tag>}
              </Space>
            </List.Item>
          );
        }}
      />
      <Divider style={{ margin: '12px 0' }} />
    </div>
  );
}

interface InvoiceCardProps {
  invoice: Invoice;
  visit: Visit;
}

function InvoiceCard({ invoice, visit }: InvoiceCardProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const removeLine = useRemoveInvoiceLine(visit.id);
  const cancelInvoice = useCancelInvoice(visit.id);
  const payInvoice = usePayInvoice(visit.id);
  const { data: panels } = usePanelClinics();
  const isUnpaid = invoice.status === 'UNPAID';
  const hasLines = invoice.lines.length > 0;
  const isPanelVisit = Boolean(visit.panelClinicId);
  const panel = panels?.find((p) => p.id === visit.panelClinicId);

  const excludedTotal = round2(invoice.lines.filter((l) => l.excludedFromPanel).reduce((sum, l) => sum + Number(l.amount), 0));
  const coveredTotal = round2(Number(invoice.totalAmount) - excludedTotal);
  const limit = panel?.limitAmount != null ? Number(panel.limitAmount) : undefined;
  const panelCovers = round2(limit != null ? Math.min(coveredTotal, limit) : coveredTotal);
  const patientCopay = round2(coveredTotal - panelCovers + excludedTotal);
  const fullyCovered = isPanelVisit && patientCopay <= 0 && hasLines;

  const handlePay = () =>
    payInvoice
      .mutateAsync({ invoiceId: invoice.id, dto: { paymentMethod } })
      .catch((e) => message.error(e instanceof ApiError ? e.message : 'Failed to record payment'));

  const handleMarkFullyCovered = () =>
    payInvoice
      .mutateAsync({ invoiceId: invoice.id, dto: { paymentMethod: 'PANEL' } })
      .catch((e) => message.error(e instanceof ApiError ? e.message : 'Failed to record payment'));

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Space wrap>
          <Text strong>{invoice.invoiceNumber}</Text>
          <Tag color={STATUS_COLOR[invoice.status]}>{invoice.status}</Tag>
          <Tag color={isPanelVisit ? 'purple' : 'default'}>{isPanelVisit ? `Panel — ${panel?.name ?? visit.billingType}` : 'Cash'}</Tag>
          {invoice.paymentMethod && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              via {PAYMENT_METHOD_LABEL[invoice.paymentMethod] ?? invoice.paymentMethod}
            </Text>
          )}
        </Space>
      }
      extra={
        isUnpaid && (
          <Space>
            {fullyCovered ? (
              <Button
                size="small"
                type="primary"
                icon={<SafetyCertificateOutlined />}
                loading={payInvoice.isPending}
                onClick={handleMarkFullyCovered}
              >
                Mark Fully Covered by Panel
              </Button>
            ) : (
              <>
                <Select
                  size="small"
                  style={{ width: 170 }}
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  options={PATIENT_PAYMENT_METHOD_OPTIONS}
                />
                <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={payInvoice.isPending} disabled={!hasLines} onClick={handlePay}>
                  {isPanelVisit ? `Collect Copay RM ${patientCopay.toFixed(2)}` : 'Mark as Paid'}
                </Button>
              </>
            )}
            <Popconfirm
              title="Cancel this invoice?"
              onConfirm={() =>
                cancelInvoice
                  .mutateAsync({ invoiceId: invoice.id, dto: {} })
                  .catch((e) => message.error(e instanceof ApiError ? e.message : 'Failed to cancel'))
              }
            >
              <Button size="small" danger>
                Cancel Invoice
              </Button>
            </Popconfirm>
          </Space>
        )
      }
    >
      {isUnpaid && <QuickAddSuggestions invoice={invoice} visit={visit} />}
      {isUnpaid && <AddLineForm invoiceId={invoice.id} visitId={visit.id} />}
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={invoice.lines}
        locale={{ emptyText: 'No line items yet' }}
        columns={[
          {
            title: 'Description',
            dataIndex: 'description',
            render: (v: string, line: InvoiceLine) => (
              <Space>
                {v}
                {line.excludedFromPanel && <Tag color="red">Not Covered by Panel</Tag>}
              </Space>
            ),
          },
          { title: 'Qty', dataIndex: 'quantity', width: 60 },
          { title: 'Unit Price (RM)', dataIndex: 'unitPrice', width: 130 },
          { title: 'Amount (RM)', dataIndex: 'amount', width: 130 },
          ...(isUnpaid
            ? [
                {
                  title: '',
                  width: 40,
                  render: (_: unknown, line: InvoiceLine) => (
                    <Popconfirm
                      title="Remove this line?"
                      onConfirm={() =>
                        removeLine
                          .mutateAsync({ invoiceId: invoice.id, lineId: line.id })
                          .catch((e) => message.error(e instanceof ApiError ? e.message : 'Failed to remove'))
                      }
                    >
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  ),
                },
              ]
            : []),
        ]}
        summary={() => (
          <>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3}>
                <Text strong>Total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} colSpan={isUnpaid ? 2 : 1}>
                <Text strong>RM {invoice.totalAmount}</Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
            {isPanelVisit && hasLines && (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={isUnpaid ? 5 : 4}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Panel Covers: RM {panelCovers.toFixed(2)}
                    {limit != null && ` (limit RM ${limit.toFixed(2)})`} · Patient Copay: RM {patientCopay.toFixed(2)}
                    {excludedTotal > 0 && ` (incl. RM ${excludedTotal.toFixed(2)} not covered by panel)`}
                  </Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          </>
        )}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        Created {dayjs(invoice.createdAt).format('YYYY-MM-DD HH:mm')}
        {invoice.paidAt && ` · Paid ${dayjs(invoice.paidAt).format('YYYY-MM-DD HH:mm')}`}
      </Text>
    </Card>
  );
}

// Clinical Operations, Phase A5, extended Phase A8. Invoice creation is
// deliberately staff-creatable — not gated to the visit's own attending
// doctor — so a locum covering someone else's queue can still bill the
// visit. Phase A8 adds staff-reviewed Quick Add (completed services /
// dispensed medications, never auto-added silently), a Panel-vs-Cash
// badge, and a live (not snapshotted) copay split using the panel's
// per-visit limit + exclusion-flagged lines — same "informational, not
// automatically enforced across visits" status as PanelClinic.limitAmount
// itself.
export function InvoiceTab({ visit }: InvoiceTabProps) {
  const [createdByStaffId, setCreatedByStaffId] = useState<string | undefined>(visit.staffId);
  const { data: staff } = useStaff();
  const { data: invoices, isLoading } = useInvoices(visit.id);
  const createInvoice = useCreateInvoice(visit.id);

  const handleCreate = async () => {
    if (!createdByStaffId) return;
    try {
      await createInvoice.mutateAsync({ visitId: visit.id, createdByStaffId });
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create invoice');
    }
  };

  return (
    <div>
      <Card
        size="small"
        title={
          <Space>
            <FileDoneOutlined /> New Invoice
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Space wrap>
          <div>
            <Text type="secondary">Created By</Text>
            <Select
              showSearch
              style={{ width: 220, display: 'block' }}
              placeholder="Select staff"
              value={createdByStaffId}
              onChange={setCreatedByStaffId}
              filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
              options={staff?.map((s) => ({ value: s.id, label: s.fullName }))}
            />
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={createInvoice.isPending}
            disabled={!createdByStaffId}
            onClick={handleCreate}
            style={{ marginTop: 20 }}
          >
            Create Invoice
          </Button>
        </Space>
      </Card>

      {!isLoading && (!invoices || invoices.length === 0) ? (
        <Empty image={<FileDoneOutlined style={{ fontSize: 40, opacity: 0.3 }} />} description="No invoices yet" />
      ) : (
        invoices?.map((invoice) => <InvoiceCard key={invoice.id} invoice={invoice} visit={visit} />)
      )}
    </div>
  );
}
