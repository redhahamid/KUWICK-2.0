import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { ApiError } from '../core/api-client';
import { useAuthStore } from '../core/auth-store';
import { canAccessBilling, canPerformBilling } from '../core/billing-access';
import { formatClinicDateTime } from './clinicTime';
import { useVisit } from './hooks/useVisits';
import {
  useAddConsultationCharge,
  useAddInvoiceLine,
  useBillingWorklist,
  useCompletionBlockers,
  useCreateInvoice,
  useEnsureConsultation,
  useInvoices,
  useSetVisitClassification,
} from './hooks/useInvoices';
import { BillingWorklistItem, Invoice, VisitClassification } from './types';
import { BillingWorklistPanel } from './invoice/BillingWorklistPanel';
import { BillingInvoicePanel } from './invoice/BillingInvoicePanel';
import { BillingSummaryPanel } from './invoice/BillingSummaryPanel';
import { BillingBlockersPanel } from './invoice/BillingBlockersPanel';
import { PanelBenefitPanel } from './invoice/PanelBenefitPanel';
import { CLASSIFICATION_LABEL } from './invoice/billingReviewPresentation';

const { Title, Text } = Typography;

/**
 * G4.5d3c-3b2 (D-094) — COUNTER BILLING REVIEW.
 *
 * The workspace that resolves the billing blockers 3b1 enforces. Three areas:
 * the billing worklist (every source and its server-decided state), the
 * current invoice (final charges and the responsibility split), and the
 * billing summary (totals, benefit, blockers, payment).
 *
 * The server stays authoritative for source chargeability, sourced quantity,
 * price, panel pricing precedence, benefit terms, discounts, responsibility
 * and payment eligibility. Nothing financial is re-derived in the browser: it
 * renders what the API returned and refuses what the API would refuse.
 */
export function BillingVisitPage() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedInvoiceId = searchParams.get('invoiceId');
  const staff = useAuthStore((state) => state.staff);
  const allowed = canAccessBilling(staff);

  const canEdit = canPerformBilling(staff, 'EDIT_LINES');
  const canCreate = canPerformBilling(staff, 'CREATE_INVOICE');
  const canDiscount = canPerformBilling(staff, 'APPLY_DISCOUNT');
  const canCancelLine = canPerformBilling(staff, 'CANCEL_LINE');
  const canPay = canPerformBilling(staff, 'MARK_PAID');
  const canClassify = canPerformBilling(staff, 'CLASSIFY_VISIT');
  // Ordinary verification is counter work; an override is a financial
  // correction — the same tier as a discount.
  const canVerify = canCancelLine;

  // The access check runs BEFORE any billing data is requested (D-066).
  const { data: visit, isLoading, error } = useVisit(allowed ? visitId : undefined);
  const { data: invoices } = useInvoices(allowed ? visitId : undefined);
  const { data: worklist = [], isLoading: worklistLoading } = useBillingWorklist(allowed ? visitId : undefined);
  const { data: blockers = [] } = useCompletionBlockers(allowed ? visitId : undefined);

  const createInvoice = useCreateInvoice(visitId);
  const addLine = useAddInvoiceLine(visitId);
  const ensureConsultation = useEnsureConsultation(visitId);
  const addConsultation = useAddConsultationCharge(visitId);
  const setClassification = useSetVisitClassification(visitId);
  const [addingSourceId, setAddingSourceId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);

  const activeInvoice: Invoice | undefined =
    invoices?.find((invoice) => invoice.id === requestedInvoiceId && invoice.status !== 'CANCELLED') ??
    invoices?.find((invoice) => invoice.status === 'UNPAID') ??
    invoices?.find((invoice) => invoice.status !== 'CANCELLED');

  // ---------------------------------------------------------------------
  // Consultation auto-add.
  //
  // A dedicated IDEMPOTENT server operation, invoked once per invoice when
  // the workspace opens — never a read with a side effect, and never a
  // browser-only effect deciding money. The server locks the visit and
  // enforces one active consultation line, so a double render, a refetch or
  // two counter staff opening the page at once cannot double-charge.
  // ---------------------------------------------------------------------
  const ensuredFor = useRef<string | null>(null);
  const ensureMutate = ensureConsultation.mutate;
  useEffect(() => {
    if (!activeInvoice || activeInvoice.status !== 'UNPAID' || !canEdit) return;
    if (ensuredFor.current === activeInvoice.id) return;
    ensuredFor.current = activeInvoice.id;
    ensureMutate(activeInvoice.id);
  }, [activeInvoice, canEdit, ensureMutate]);

  if (!allowed) {
    return (
      <Result
        status="403"
        title="You do not have access to billing"
        subTitle={
          'Raising, editing, paying and cancelling invoices is restricted to billing roles. ' +
          'You can still see this visit’s charges in the patient’s medical record.'
        }
      />
    );
  }

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

  const mismatched =
    Boolean(requestedInvoiceId) && Boolean(invoices) && !invoices!.some((invoice) => invoice.id === requestedInvoiceId);

  const consultationItem = worklist.find((item) => item.sourceType === 'CONSULTATION');
  const tariffReview = consultationItem?.state === 'TARIFF_REVIEW' ? consultationItem : null;
  const consultationWaived = consultationItem?.state === 'WAIVED';
  const consultationExempt =
    consultationItem?.sourceType === 'CONSULTATION' && consultationItem.state === 'NOT_CHARGEABLE';
  const unbilledReady = worklist.filter((item) => item.state === 'READY' && !item.billed);

  // Payment is refused server-side while billing work is knowably incomplete;
  // the screen says so instead of letting the counter discover it.
  const settlementBlockedReason =
    unbilledReady.length > 0
      ? `Add the remaining ready ${unbilledReady.length === 1 ? 'item' : 'items'} before settling: ${unbilledReady
          .map((item) => item.description)
          .join(', ')}.`
      : tariffReview
        ? 'Consultation tariff requires review.'
        : null;

  const addFromWorklist = async (item: BillingWorklistItem) => {
    if (!activeInvoice) return;
    setAddingSourceId(item.sourceId);
    try {
      if (item.sourceType === 'CONSULTATION') {
        await addConsultation.mutateAsync(activeInvoice.id);
      } else {
        // No price and no quantity are sent for a sourced line: both are the
        // server's, from the source record.
        await addLine.mutateAsync({
          invoiceId: activeInvoice.id,
          dto: {
            description: item.description,
            ...(item.sourceType === 'PRESCRIPTION'
              ? { sourcePrescriptionId: item.sourceId }
              : { sourceOrderServiceId: item.sourceId }),
          },
        });
      }
      message.success(`${item.description} added to the invoice.`);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Failed to add this item');
    } finally {
      setAddingSourceId(null);
    }
  };

  const createForVisit = async () => {
    if (!staff?.id) return;
    try {
      await createInvoice.mutateAsync({ visitId: visit.id, createdByStaffId: staff.id });
      message.success('Invoice created.');
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Failed to create the invoice');
    }
  };

  const submitManual = async (values: { description: string; quantity: number; unit?: string; unitPrice: number }) => {
    if (!activeInvoice) return;
    // Closing unmounts ManualLineModal and its form with it — no reset needed.
    try {
      await addLine.mutateAsync({ invoiceId: activeInvoice.id, dto: values });
      message.success('Manual line added.');
      setManualOpen(false);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Failed to add the line');
    }
  };

  const submitClassification = async (classification: VisitClassification) => {
    try {
      await setClassification.mutateAsync(classification);
      message.success('Visit classification updated.');
      setClassifyOpen(false);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Failed to update the classification');
    }
  };

  return (
    // kw-operational-surface — this page owns its bottom-right corner, so the
    // floating chat launcher stands down here rather than sitting on top of
    // "Add to invoice" or the payment button (D-095).
    <div className="kw-operational-surface">
      <Space direction="vertical" size={4} style={{ marginBottom: 16, width: '100%' }}>
        <Title level={4} style={{ margin: 0 }}>
          Billing review — {visit.patient?.name ?? 'Patient'}
        </Title>
        <Space size={8} wrap>
          <Text type="secondary">
            Visit {visit.visitNumber} · {formatClinicDateTime(visit.checkInAt)}
            {visit.clinic?.name ? ` · ${visit.clinic.name}` : ''}
          </Text>
          {/* D-095 — a real control, not a bare text link. Once a type is
              recorded the value is stated and the action becomes Change, so
              the current setting is readable at a glance. */}
          {visit.classification ? (
            <Space size={6}>
              <Text type="secondary">Visit type:</Text>
              <Tag>{CLASSIFICATION_LABEL[visit.classification]}</Tag>
              {canClassify && !visit.checkOutAt && (
                <Button
                  size="small"
                  onClick={() => setClassifyOpen(true)}
                  aria-label={`Change visit type — currently ${CLASSIFICATION_LABEL[visit.classification]}`}
                  style={{ minHeight: 44 }}
                >
                  Change
                </Button>
              )}
            </Space>
          ) : (
            canClassify &&
            !visit.checkOutAt && (
              <Button
                size="small"
                onClick={() => setClassifyOpen(true)}
                aria-label="Set visit type for billing"
                style={{ minHeight: 44 }}
              >
                Set visit type
              </Button>
            )
          )}
        </Space>
      </Space>

      {mismatched && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="That invoice does not belong to this visit"
          description="Showing this visit's own invoices instead. Nothing has been created or changed."
        />
      )}

      {tariffReview && (
        <Alert
          type="error"
          showIcon
          role="alert"
          style={{ marginBottom: 12 }}
          message="Consultation tariff requires review."
          description={`${tariffReview.stateReason ?? ''} Configure a tariff covering this time in Clinic Settings → Consultation Tariffs, or record the visit as exempt. No consultation charge has been guessed.`}
        />
      )}

      {consultationWaived && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="The consultation charge was waived for this visit."
          description="It stays in the invoice history and will not be added again automatically."
        />
      )}

      {consultationExempt && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="This kind of visit carries no consultation charge."
          description="If a real consultation did take place, add it from the worklist."
        />
      )}

      <Row gutter={[16, 16]}>
        {/* Desktop splits worklist and invoice; below lg they stack, and no
            section ever forces the document to scroll sideways. */}
        <Col xs={24} lg={10}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <BillingWorklistPanel
              items={worklist}
              loading={worklistLoading}
              onAdd={canEdit ? addFromWorklist : undefined}
              addingSourceId={addingSourceId}
              addDisabledReason={
                !activeInvoice
                  ? 'Create an invoice for this visit first.'
                  : activeInvoice.status !== 'UNPAID'
                    ? `This invoice is already ${activeInvoice.status.toLowerCase()}.`
                    : null
              }
            />
            <PanelBenefitPanel visit={visit} canVerify={canVerify} canOverride={canDiscount} />
          </Space>
        </Col>

        <Col xs={24} lg={14}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {!activeInvoice ? (
              <Card size="small" title="Invoice">
                <Space direction="vertical" size={8}>
                  <Text type="secondary">No invoice has been raised for this visit yet.</Text>
                  {canCreate && (
                    <Button type="primary" loading={createInvoice.isPending} onClick={createForVisit} style={{ minHeight: 44 }}>
                      Create invoice
                    </Button>
                  )}
                </Space>
              </Card>
            ) : (
              <>
                <BillingInvoicePanel
                  invoice={activeInvoice}
                  canEdit={canEdit}
                  canCancelLine={canCancelLine}
                  canDiscount={canDiscount}
                  isPanelVisit={Boolean(visit.panelClinicId)}
                />
                {canEdit && activeInvoice.status === 'UNPAID' && (
                  <Card size="small">
                    <Space direction="vertical" size={4}>
                      <Button onClick={() => setManualOpen(true)} style={{ minHeight: 44 }}>
                        Add a manual line
                      </Button>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        For legitimate operational charges with no clinical source. Medication, procedures, services
                        and the consultation fee must come from the worklist so their price and quantity stay the
                        server&rsquo;s.
                      </Text>
                    </Space>
                  </Card>
                )}
                <BillingSummaryPanel
                  invoice={activeInvoice}
                  visit={visit}
                  canDiscount={canDiscount}
                  canPay={canPay}
                  settlementBlockedReason={settlementBlockedReason}
                />
              </>
            )}
            <BillingBlockersPanel blockers={blockers} worklist={worklist} />
            {/* D-095 — Billing Review RESOLVES billing; Queue Management
                closes the visit. There is deliberately no second Complete
                Visit button here. */}
            {blockers.length === 0 && (
              <Card size="small">
                <Space direction="vertical" size={6}>
                  <Text strong>Billing resolved.</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Completing the visit itself is done from Queue Management.
                  </Text>
                  <Button type="primary" onClick={() => navigate('/queue')} style={{ minHeight: 44 }}>
                    Return to Queue
                  </Button>
                </Space>
              </Card>
            )}
          </Space>
        </Col>
      </Row>

      {manualOpen && (
        <ManualLineModal onCancel={() => setManualOpen(false)} onSubmit={submitManual} pending={addLine.isPending} />
      )}

      <Modal
        title="Visit type for billing"
        open={classifyOpen}
        onCancel={() => setClassifyOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Text type="secondary">
          This decides whether a consultation fee applies. It is an operational record, never a clinical judgement.
        </Text>
        <Select
          style={{ width: '100%', marginTop: 12 }}
          placeholder="Select the visit type"
          defaultValue={visit.classification ?? undefined}
          onChange={submitClassification}
          aria-label="Visit type for billing"
          options={(Object.keys(CLASSIFICATION_LABEL) as VisitClassification[]).map((value) => ({
            value,
            label: CLASSIFICATION_LABEL[value],
          }))}
        />
      </Modal>
    </div>
  );
}

/**
 * A child on purpose (A1): `Form.useForm` and its `<Form>` mount and unmount
 * together with the modal, so the instance is never left connected to
 * nothing, and every open starts from clean fields without a manual reset.
 */
function ManualLineModal({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void;
  onSubmit: (values: { description: string; quantity: number; unit?: string; unitPrice: number }) => void;
  pending: boolean;
}) {
  const [manualForm] = Form.useForm<{ description: string; quantity: number; unit?: string; unitPrice: number }>();
  return (
    <Modal
      title="Add a manual line"
      open
      onCancel={onCancel}
      onOk={() => manualForm.submit()}
      okText="Add line"
      confirmLoading={pending}
      destroyOnHidden
    >
      <Form form={manualForm} layout="vertical" onFinish={onSubmit} initialValues={{ quantity: 1 }}>
        <Form.Item name="description" label="Description" rules={[{ required: true }]}>
          <Input maxLength={200} placeholder="e.g. Dressing set" />
        </Form.Item>
        <Form.Item name="quantity" label="Quantity" rules={[{ required: true }]}>
          <InputNumber min={1} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="unit" label="Unit">
          <Input maxLength={20} placeholder="e.g. set" />
        </Form.Item>
        <Form.Item name="unitPrice" label="Unit price (RM)" rules={[{ required: true }]}>
          <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
