import { useState } from 'react';
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ApiError } from '../../core/api-client';
import { Invoice, InvoiceLine } from '../types';
import { useApplyLineDiscount, useCancelInvoiceLine } from '../hooks/useInvoices';
import { money } from './invoicePresentation';
import { OTHER_REASON, WAIVER_REASONS } from './billingReviewPresentation';

const { Text } = Typography;

interface Props {
  invoice: Invoice;
  canEdit: boolean;
  canCancelLine: boolean;
  canDiscount: boolean;
  /** A self-pay visit has no panel split worth a column of zeroes. */
  isPanelVisit: boolean;
}

/** A consultation line is the one the tariff produced for this visit. */
function isConsultationLine(line: InvoiceLine): boolean {
  return Boolean(line.sourceConsultationVisitId);
}

/**
 * G4.5d3c-3b2 (D-094) — AREA B: the current invoice.
 *
 * Shows the FINAL charge and the responsibility split, and nothing about how
 * the price was derived: no cash/base price, no panel markup, no price-rule
 * name, no margin. That provenance is persisted for audit and management
 * surfaces and is deliberately absent here.
 */
export function BillingInvoicePanel({ invoice, canEdit, canCancelLine, canDiscount, isPanelVisit }: Props) {
  const [cancelling, setCancelling] = useState<InvoiceLine | null>(null);
  const [discounting, setDiscounting] = useState<InvoiceLine | null>(null);
  const [cancelForm] = Form.useForm<{ reason: string; freeText?: string }>();
  const [discountForm] = Form.useForm<{ type: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number; reason: string }>();
  const cancelLine = useCancelInvoiceLine(invoice.visitId);
  const lineDiscount = useApplyLineDiscount(invoice.visitId);

  const activeLines = invoice.lines.filter((line) => !line.cancelledAt);
  const cancelledLines = invoice.lines.filter((line) => line.cancelledAt);
  const settled = invoice.status !== 'UNPAID';
  const waiving = cancelling ? isConsultationLine(cancelling) : false;

  const submitCancel = async (values: { reason: string; freeText?: string }) => {
    if (!cancelling) return;
    const reason = values.reason === OTHER_REASON ? (values.freeText ?? '').trim() : values.reason;
    try {
      await cancelLine.mutateAsync({
        invoiceId: invoice.id,
        lineId: cancelling.id,
        dto: { cancelReason: reason },
      });
      message.success(
        waiving
          ? 'Consultation charge waived. It stays in the invoice history.'
          : 'Line cancelled. It stays in the invoice history.',
      );
      setCancelling(null);
      cancelForm.resetFields();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to cancel the line');
    }
  };

  const submitDiscount = async (values: { type: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number; reason: string }) => {
    if (!discounting) return;
    try {
      await lineDiscount.mutateAsync({ invoiceId: invoice.id, lineId: discounting.id, dto: values });
      message.success('Line discount applied.');
      setDiscounting(null);
      discountForm.resetFields();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to apply the discount');
    }
  };

  // Columns that would carry no information are not rendered: an all-dashes
  // Discount column and an all-zero Panel column on a self-pay bill are noise
  // that costs the Item column the width it needs to be readable.
  const anyDiscount = activeLines.some((line) => Number(line.lineDiscountAmount ?? 0) > 0);

  const columns = [
    {
      title: 'Item',
      dataIndex: 'description',
      key: 'description',
      render: (_: unknown, line: InvoiceLine) => (
        <Space direction="vertical" size={0}>
          <Text>{line.description}</Text>
          <Space size={6} wrap>
            {isConsultationLine(line) && <Tag>Consultation</Tag>}
            {line.excludedFromPanel && (
              <Tag color="orange">{line.panelExclusionReason ?? 'Not covered by panel'}</Tag>
            )}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Qty',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 64,
      render: (_: unknown, line: InvoiceLine) => (
        <Text>
          {line.quantity}
          {line.unit ? ` ${line.unit}` : ''}
        </Text>
      ),
    },
    {
      title: 'Unit price',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 100,
      align: 'right' as const,
      render: (value: string) => money(value),
    },
    ...(anyDiscount ? [{
      title: 'Discount',
      key: 'discount',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, line: InvoiceLine) =>
        line.lineDiscountAmount ? (
          <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
            <Text>−{money(line.lineDiscountAmount)}</Text>
            {line.lineDiscountReason && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {line.lineDiscountReason}
              </Text>
            )}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    }] : []),
    {
      title: 'Line total',
      key: 'total',
      width: 104,
      align: 'right' as const,
      render: (_: unknown, line: InvoiceLine) => (
        <Text strong>{money(Number(line.amount) - Number(line.lineDiscountAmount ?? 0))}</Text>
      ),
    },
    ...(isPanelVisit ? [{
      title: 'Panel',
      key: 'panel',
      width: 96,
      align: 'right' as const,
      render: (_: unknown, line: InvoiceLine) =>
        line.panelResponsibilityAmount == null ? (
          <Text type="secondary">Unresolved</Text>
        ) : (
          money(line.panelResponsibilityAmount)
        ),
    }] : []),
    {
      title: 'Patient',
      key: 'patient',
      width: 96,
      align: 'right' as const,
      render: (_: unknown, line: InvoiceLine) =>
        line.patientResponsibilityAmount == null ? (
          <Text type="secondary">Unresolved</Text>
        ) : (
          money(line.patientResponsibilityAmount)
        ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 104,
      // Pinned: the row's only controls must never end up off-screen behind
      // the table's own horizontal scroll.
      fixed: 'right' as const,
      render: (_: unknown, line: InvoiceLine) => (
        <Space size={4} direction="vertical" style={{ width: '100%' }}>
          {canDiscount && !settled && (
            <Button size="small" block onClick={() => setDiscounting(line)} style={{ minHeight: 44 }}>
              Discount
            </Button>
          )}
          {canCancelLine && !settled && (
            <Button size="small" block danger onClick={() => setCancelling(line)} style={{ minHeight: 44 }}>
              {isConsultationLine(line) ? 'Waive' : 'Cancel'}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card size="small" title={`Invoice ${invoice.invoiceNumber}`}>
      {activeLines.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            canEdit
              ? 'No charges on this invoice yet. Add ready items from the worklist.'
              : 'No charges on this invoice yet.'
          }
        />
      ) : (
        // Wide content scrolls inside its own container; the page never
        // scrolls sideways.
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={activeLines}
          columns={columns}
          scroll={{ x: 'max-content' }}
        />
      )}

      {cancelledLines.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Cancelled ({cancelledLines.length}) — retained in financial history, excluded from totals:
          </Text>
          <ul style={{ margin: '4px 0 0', paddingInlineStart: 20 }}>
            {cancelledLines.map((line) => (
              <li key={line.id}>
                <Text delete type="secondary" style={{ fontSize: 12 }}>
                  {line.description} · {money(line.amount)}
                </Text>
                {line.cancelReason && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {' '}
                    — {line.cancelReason}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        title={waiving ? 'Waive consultation charge' : 'Cancel this line'}
        open={Boolean(cancelling)}
        onCancel={() => setCancelling(null)}
        onOk={() => cancelForm.submit()}
        okText={waiving ? 'Waive charge' : 'Cancel line'}
        okButtonProps={{ danger: true }}
        confirmLoading={cancelLine.isPending}
        destroyOnHidden
      >
        <Text>
          {cancelling?.description} · {money(cancelling?.amount)}
        </Text>
        <Text type="secondary" style={{ display: 'block', margin: '8px 0 12px' }}>
          The charge leaves the totals but stays in this invoice&rsquo;s history, with your name, the time and your
          reason. Responsibility is recalculated.
        </Text>
        <Form form={cancelForm} layout="vertical" onFinish={submitCancel}>
          <Form.Item name="reason" label="Reason" rules={[{ required: true, message: 'A reason is required.' }]}>
            <Select options={WAIVER_REASONS.map((reason) => ({ value: reason, label: reason }))} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.reason !== next.reason}>
            {({ getFieldValue }) =>
              getFieldValue('reason') === OTHER_REASON ? (
                <Form.Item
                  name="freeText"
                  label="Explain"
                  rules={[{ required: true, min: 3, message: 'Explain the reason.' }]}
                >
                  <Input.TextArea rows={2} maxLength={300} showCount />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Apply a line discount"
        open={Boolean(discounting)}
        onCancel={() => setDiscounting(null)}
        onOk={() => discountForm.submit()}
        okText="Apply discount"
        confirmLoading={lineDiscount.isPending}
        destroyOnHidden
      >
        <Text>
          {discounting?.description} · {money(discounting?.amount)}
        </Text>
        <Form
          form={discountForm}
          layout="vertical"
          style={{ marginTop: 12 }}
          onFinish={submitDiscount}
          initialValues={{ type: 'PERCENTAGE' }}
        >
          <Form.Item name="type" label="Discount type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'PERCENTAGE', label: 'Percentage of the line' },
                { value: 'FIXED_AMOUNT', label: 'Fixed amount (RM)' },
              ]}
            />
          </Form.Item>
          <Form.Item name="value" label="Value" rules={[{ required: true }]}>
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          {/* The calculated amount is shown BEFORE confirmation. */}
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              const type = getFieldValue('type');
              const value = Number(getFieldValue('value') ?? 0);
              const amount = Number(discounting?.amount ?? 0);
              const computed = type === 'PERCENTAGE' ? (amount * value) / 100 : value;
              return value > 0 ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Discount {money(computed)} · line becomes {money(Math.max(amount - computed, 0))}
                </Text>
              ) : null;
            }}
          </Form.Item>
          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, min: 3, message: 'A reason is required for every discount.' }]}
          >
            <Input.TextArea rows={2} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
