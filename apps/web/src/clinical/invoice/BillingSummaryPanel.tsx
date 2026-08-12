import { useState } from 'react';
import { Alert, Button, Card, Divider, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { ApiError } from '../../core/api-client';
import { Invoice, PaymentMethod, Visit } from '../types';
import { useApplyInvoiceDiscount, useSettleInvoice } from '../hooks/useInvoices';
import { money } from './invoicePresentation';
import { PATIENT_PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from './billingReviewPresentation';

const { Text, Title } = Typography;

interface Props {
  invoice: Invoice;
  visit: Visit;
  canDiscount: boolean;
  canPay: boolean;
  /** Server-side blockers that must clear before settlement is offered. */
  settlementBlockedReason: string | null;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '2px 0' }}>
      <Text type={strong ? undefined : 'secondary'} strong={strong}>
        {label}
      </Text>
      <Text strong={strong}>{value}</Text>
    </div>
  );
}

/**
 * G4.5d3c-3b2 (D-094) — AREA C: the billing summary and the payment surface.
 *
 * Responsibility is READ from the server's persisted calculation — never
 * recomputed here. An unresolved split says so in words rather than showing a
 * zero, and payment is unavailable until the server would accept it.
 */
export function BillingSummaryPanel({ invoice, visit, canDiscount, canPay, settlementBlockedReason }: Props) {
  const [discountOpen, setDiscountOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const settle = useSettleInvoice(invoice.visitId);

  const patient = invoice.patientResponsibilityAmount;
  const panel = invoice.panelResponsibilityAmount;
  const resolved = patient != null;
  const paid = Number(invoice.patientPaidAmount ?? 0);
  const remaining = resolved ? Math.max(Number(patient) - paid, 0) : null;
  const settled = invoice.status !== 'UNPAID';
  const panelAmount = Number(panel ?? 0);

  // PANEL is offered only where it means something: the patient owes nothing
  // and the panel carries a positive amount. It never claims the panel paid.
  const panelSettlementAvailable = resolved && Number(patient) === 0 && panelAmount > 0;
  const methodOptions = [
    ...PATIENT_PAYMENT_METHODS.map((value) => ({
      value,
      label: PAYMENT_METHOD_LABEL[value],
      disabled: remaining != null && remaining <= 0,
    })),
    { value: 'PANEL', label: PAYMENT_METHOD_LABEL.PANEL, disabled: !panelSettlementAvailable },
  ];

  const payDisabledReason = settled
    ? `This invoice is already ${invoice.status.toLowerCase()}.`
    : !resolved
      ? 'Billing responsibility has not been confirmed.'
      : settlementBlockedReason
        ? settlementBlockedReason
        : method === 'PANEL'
          ? panelSettlementAvailable
            ? null
            : 'Panel — No Patient Payment applies only when the patient owes nothing and the panel carries a positive amount.'
          : remaining && remaining > 0
            ? null
            : 'There is no patient balance to collect.';

  const pay = async () => {
    try {
      await settle.mutateAsync({ invoiceId: invoice.id, dto: { paymentMethod: method } });
      message.success(
        method === 'PANEL' ? 'Recorded — the patient owes nothing.' : 'Payment recorded. The patient balance is resolved.',
      );
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to record the payment');
    }
  };

  return (
    <Card
      size="small"
      title="Billing summary"
      extra={
        canDiscount && !settled ? (
          <Button size="small" onClick={() => setDiscountOpen(true)} style={{ minHeight: 44 }}>
            Overall discount
          </Button>
        ) : undefined
      }
    >
      <Row label="Subtotal" value={money(invoice.subtotalAmount ?? invoice.totalAmount)} />
      {invoice.invoiceDiscountAmount && Number(invoice.invoiceDiscountAmount) > 0 && (
        <Row label={`Overall discount${invoice.invoiceDiscountReason ? ` — ${invoice.invoiceDiscountReason}` : ''}`} value={`−${money(invoice.invoiceDiscountAmount)}`} />
      )}
      <Row label="Grand total" value={money(invoice.totalAmount)} strong />

      <Divider style={{ margin: '10px 0' }} />

      {resolved ? (
        <>
          <Row label="Panel responsibility" value={money(panel ?? 0)} />
          <Row label="Patient responsibility" value={money(patient)} />
          <Row label="Patient paid" value={money(paid)} />
          <Row label="Remaining patient balance" value={money(remaining ?? 0)} strong />
        </>
      ) : (
        <Alert
          type="warning"
          showIcon
          role="status"
          message="Billing responsibility has not been confirmed."
          description="Panel and patient responsibility cannot be calculated until the panel benefit is recorded."
        />
      )}

      {invoice.paidAt && (
        <div style={{ marginTop: 10 }}>
          <Tag color="green">Settled</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {invoice.paymentMethod ? PAYMENT_METHOD_LABEL[invoice.paymentMethod] ?? invoice.paymentMethod : ''}
          </Text>
          {invoice.paymentMethod === 'PANEL' && (
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              The patient owed nothing. The panel receivable is collected under Finance → Panel &amp; Claims.
            </Text>
          )}
        </div>
      )}

      {canPay && !settled && (
        <>
          <Divider style={{ margin: '10px 0' }} />
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <label htmlFor="billing-payment-method">
              <Text strong>Record payment</Text>
            </label>
            <Select
              id="billing-payment-method"
              value={method}
              onChange={setMethod}
              options={methodOptions}
              style={{ width: '100%' }}
              aria-label="Payment method"
            />
            <Button
              type="primary"
              block
              disabled={Boolean(payDisabledReason)}
              loading={settle.isPending}
              onClick={pay}
              style={{ minHeight: 44 }}
              aria-description={payDisabledReason ?? undefined}
            >
              {method === 'PANEL'
                ? 'Record — no patient payment'
                : `Collect ${money(remaining ?? 0)}`}
            </Button>
            {payDisabledReason && (
              <Text type="secondary" role="status" style={{ fontSize: 12 }}>
                {payDisabledReason}
              </Text>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              The full remaining balance is recorded in one payment. Partial payment and split tender are not
              supported yet.
            </Text>
          </Space>
        </>
      )}

      {discountOpen && <OverallDiscountModal invoice={invoice} visit={visit} onClose={() => setDiscountOpen(false)} />}

      <Title level={5} style={{ display: 'none' }} aria-hidden>
        {invoice.invoiceNumber}
      </Title>
    </Card>
  );
}

/**
 * A child on purpose (A1): `Form.useForm` and its `<Form>` mount and unmount
 * together with the modal, so the instance is never left connected to
 * nothing, and every open starts from clean fields without a manual reset.
 */
function OverallDiscountModal({ invoice, visit, onClose }: { invoice: Invoice; visit: Visit; onClose: () => void }) {
  const [discountForm] = Form.useForm<{ type: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number; reason: string }>();
  const invoiceDiscount = useApplyInvoiceDiscount(invoice.visitId);
  const patientPortion = Number(invoice.patientResponsibilityAmount ?? 0);

  const submitDiscount = async (values: { type: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number; reason: string }) => {
    try {
      await invoiceDiscount.mutateAsync({ invoiceId: invoice.id, dto: values });
      message.success('Overall discount applied to the patient portion.');
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to apply the discount');
    }
  };

  return (
      <Modal
        title="Overall invoice discount"
        open
        onCancel={onClose}
        onOk={() => discountForm.submit()}
        okText="Apply discount"
        confirmLoading={invoiceDiscount.isPending}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="An overall discount reduces the patient portion only."
          description={
            visit.panelClinicId
              ? 'The panel’s contractual receivable is never reduced by a counter discount.'
              : 'On a self-pay visit the patient carries the whole bill, so the discount applies to all of it.'
          }
        />
        <Form
          form={discountForm}
          layout="vertical"
          onFinish={submitDiscount}
          initialValues={{ type: 'PERCENTAGE' }}
        >
          <Form.Item name="type" label="Discount type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'PERCENTAGE', label: 'Percentage of the subtotal' },
                { value: 'FIXED_AMOUNT', label: 'Fixed amount (RM)' },
              ]}
            />
          </Form.Item>
          <Form.Item name="value" label="Value" rules={[{ required: true }]}>
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              const type = getFieldValue('type');
              const value = Number(getFieldValue('value') ?? 0);
              const subtotal = Number(invoice.subtotalAmount ?? invoice.totalAmount ?? 0);
              const computed = type === 'PERCENTAGE' ? (subtotal * value) / 100 : value;
              return value > 0 ? (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Discount {money(computed)} · patient pays {money(Math.max(patientPortion - computed, 0))}
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
  );
}
