import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { ApiError } from '../../core/api-client';
import { ConsultationFooter } from '../ConsultationFooter';
import { CanvasAnchor } from '../doctorPhasePresentation';
import { useApplyDraftDiscount, useInvoiceDraft } from '../hooks/useInvoiceDraft';
import { InvoiceDiscountType, InvoiceDraftDiscount, Visit } from '../types';
import {
  discountAvailability,
  draftBarSummary,
  groupDraftLines,
  lineNote,
  money,
} from './invoiceDraftPresentation';

const { Text } = Typography;

interface InvoiceBottomBarProps {
  visit: Visit;
  /** Passed through to the completion action. Never opens a form. */
  onReview: (anchor: CanvasAnchor) => void;
}

/**
 * b4 PIECE B — THE STICKY BOTTOM BAR.
 *
 * The invoice is NOT a fifth card in the scrolling rail. It is this bar:
 * slim at rest (~44px), carrying the running total and Complete Consultation,
 * always visible and never scrolled away. Clicking the total expands the
 * itemised breakdown OVER the canvas; collapsing returns to the slim bar. The
 * expansion is an overlay and takes no layout space, so the bar never
 * permanently occupies more than its slim height — which is what lets the
 * rail's vertical budget survive it.
 *
 * WHY A BAR AND NOT A CARD. A fifth card would be below Documents, which at
 * 1366×768 is already 131px past the fold: an invoice a doctor has to scroll
 * to is an invoice they check at the end, once, instead of while they are
 * making the decisions that change it. And the total is the one figure that
 * is relevant continuously.
 *
 * EVERY NUMBER HERE IS THE SERVER'S. The draft is built by
 * `invoice-draft.ts` from the visit's own sources; this component sums
 * nothing, prices nothing, and decides nothing about whether the visit
 * carries a consultation charge — that answer arrives as a line with a state
 * and a reason, from `consultation-tariff.ts` via the billing worklist.
 *
 * LIVE. The draft is derived on every read and the source hooks invalidate
 * its query key, so adding a medicine or cancelling an order moves the total
 * without a remount and without this component watching anything.
 */
export function InvoiceBottomBar({ visit, onReview }: InvoiceBottomBarProps) {
  const { data: draft, isLoading, error } = useInvoiceDraft(visit.id);
  const [expanded, setExpanded] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const summary = draftBarSummary(draft);
  const groups = groupDraftLines(draft);
  const availability = discountAvailability(draft);

  // Esc closes the breakdown, the way every other overlay on this page does.
  // Focus goes back to the control that opened it — the bar is the last thing
  // a doctor touches before completing, and losing the focus ring there means
  // tabbing back through the whole rail.
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <>
      {expanded && (
        <InvoiceBreakdown
          groups={groups}
          draftSubtotal={draft?.subtotal ?? 0}
          discount={draft?.discount ?? null}
          total={draft?.total ?? 0}
          unpricedLabel={summary.unpricedLabel}
          invoiceNumber={draft?.invoiceNumber ?? null}
          discountAvailable={availability.available}
          discountUnavailableReason={availability.reason}
          onDiscount={() => setDiscountOpen(true)}
          error={error}
          isLoading={isLoading}
        />
      )}

      <section className="kw-invoice-bar" aria-label="Draft invoice and consultation completion">
        <button
          type="button"
          ref={toggleRef}
          className="kw-invoice-bar-total"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={`${summary.ariaLabel}. ${expanded ? 'Hide' : 'Show'} the itemised breakdown.`}
          data-testid="invoice-bar-total"
        >
          {expanded ? <DownOutlined aria-hidden /> : <UpOutlined aria-hidden />}
          <span className="kw-invoice-bar-amount">{summary.total}</span>
          <span className="kw-invoice-bar-meta">{summary.itemsLabel}</span>
          {summary.discountLabel && (
            <Tag className="kw-chip-progress" data-testid="invoice-bar-discount">
              {summary.discountLabel}
            </Tag>
          )}
          {/* An unpriced chargeable item makes the total incomplete by an
              unknown amount. Said on the bar, not only in the expansion —
              a total that quietly omits something is the failure this chip
              exists to prevent. */}
          {summary.unpricedLabel && (
            <Tag color="warning" data-testid="invoice-bar-unpriced">
              {summary.unpricedLabel}
            </Tag>
          )}
        </button>

        <div className="kw-invoice-bar-action">
          <ConsultationFooter visit={visit} onReview={onReview} variant="bar" />
        </div>
      </section>

      <DiscountModal
        open={discountOpen}
        visitId={visit.id}
        onClose={() => setDiscountOpen(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

interface InvoiceBreakdownProps {
  groups: ReturnType<typeof groupDraftLines>;
  draftSubtotal: number;
  discount: InvoiceDraftDiscount | null;
  total: number;
  unpricedLabel: string | null;
  invoiceNumber: string | null;
  discountAvailable: boolean;
  discountUnavailableReason: string | null;
  onDiscount: () => void;
  error: unknown;
  isLoading: boolean;
}

/**
 * The itemised breakdown, over the canvas.
 *
 * Grouped by the rail card each line came from and in the rail's order, so
 * checking a figure is a matter of looking at the same card twice rather than
 * mapping between two orders. Lines that carry no charge are listed WITH the
 * server's reason — an OTC visit's consultation, a cancelled order, a
 * medication whose supply is undecided — because a bill that silently omits
 * them cannot be checked against the record.
 */
function InvoiceBreakdown({
  groups,
  draftSubtotal,
  discount,
  total,
  unpricedLabel,
  invoiceNumber,
  discountAvailable,
  discountUnavailableReason,
  onDiscount,
  error,
  isLoading,
}: InvoiceBreakdownProps) {
  return (
    <div className="kw-invoice-sheet" role="region" aria-label="Draft invoice breakdown" data-testid="invoice-breakdown">
      <div className="kw-invoice-sheet-head">
        <Text strong>Draft invoice</Text>
        {invoiceNumber ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {invoiceNumber}
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Not yet raised — this is what the visit currently comes to
          </Text>
        )}
      </div>

      {Boolean(error) && (
        <Alert
          type="warning"
          showIcon
          role="alert"
          message="The draft invoice could not be loaded"
          description="Nothing on this record has been changed. The consultation can still be completed."
        />
      )}
      {isLoading && !error ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          Loading the visit's charges…
        </Text>
      ) : null}

      <div className="kw-invoice-sheet-body">
        {groups.map((group) => (
          <div key={group.key} className="kw-invoice-group">
            <div className="kw-invoice-group-head">
              <span>{group.title}</span>
              <span>{money(group.amount)}</span>
            </div>
            {group.lines.map((line) => {
              const note = lineNote(line);
              return (
                <div
                  key={`${line.sourceType}-${line.sourceId}`}
                  className="kw-invoice-line"
                  data-source-type={line.sourceType}
                  data-state={line.state}
                  data-counted={line.counted ? 'true' : 'false'}
                >
                  <span className="kw-invoice-line-desc">
                    {line.description}
                    {line.quantity > 1 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {' '}
                        × {line.quantity}
                        {line.unitPrice != null ? ` @ ${money(line.unitPrice)}` : ''}
                      </Text>
                    )}
                    {/* The server's own wording for why a line carries no
                        charge, rendered as given rather than re-phrased. */}
                    {note && (
                      <Text type="secondary" className="kw-invoice-line-note">
                        {note}
                      </Text>
                    )}
                  </span>
                  <span className="kw-invoice-line-amount">
                    {line.counted ? money(line.amount) : <Text type="secondary">No charge</Text>}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && !isLoading && !error ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Nothing chargeable has been added to this visit yet.
          </Text>
        ) : null}
      </div>

      <div className="kw-invoice-sheet-foot">
        <div className="kw-invoice-total-row">
          <span>Subtotal</span>
          <span>{money(draftSubtotal)}</span>
        </div>
        {discount && (
          <div className="kw-invoice-total-row" data-testid="invoice-discount-row">
            <span>
              Discount
              {discount.type === 'PERCENTAGE' ? ` (${discount.value}%)` : ''}
              {/* The REASON is part of the line, not a tooltip. A discount
                  whose reason has to be hunted for is a discount nobody
                  audits. */}
              <Text type="secondary" className="kw-invoice-line-note">
                {discount.reason}
              </Text>
            </span>
            <span>− {money(discount.amount)}</span>
          </div>
        )}
        <div className="kw-invoice-total-row kw-invoice-total-grand">
          <span>Total</span>
          <span>{money(total)}</span>
        </div>
        {unpricedLabel && (
          <Text type="warning" style={{ fontSize: 12 }}>
            {unpricedLabel} — the total is incomplete until they are.
          </Text>
        )}

        <div className="kw-invoice-sheet-actions">
          {discountAvailable ? (
            <Button size="small" onClick={onDiscount} data-testid="invoice-discount-button">
              {discount ? 'Change discount' : 'Apply discount'}
            </Button>
          ) : (
            discountUnavailableReason && (
              <Text type="secondary" style={{ fontSize: 12 }} data-testid="invoice-discount-unavailable">
                {discountUnavailableReason}
              </Text>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * THE DISCOUNT, WITH ITS REASON.
 *
 * The reason is a required field and the dialog will not submit without it —
 * the same rule the server enforces, stated here so a doctor is told before
 * the round trip rather than by a refusal afterwards. Nothing about the
 * permission is decided here: a staff member who may not discount gets the
 * server's own refusal, in the server's own words.
 */
function DiscountModal({
  open,
  visitId,
  onClose,
}: {
  open: boolean;
  visitId: string;
  onClose: () => void;
}) {
  const [form] = Form.useForm<{ type: InvoiceDiscountType; value: number; reason: string }>();
  const apply = useApplyDraftDiscount(visitId);

  const submit = async () => {
    // antd REJECTS on a failed validation. Caught here so a missing reason
    // surfaces as the field error the doctor is already looking at, rather
    // than as an unhandled rejection in the console.
    let values: { type: InvoiceDiscountType; value: number; reason: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      await apply.mutateAsync({ ...values, reason: values.reason.trim() });
      message.success('Discount applied.');
      form.resetFields();
      onClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'The discount could not be applied.');
    }
  };

  return (
    <Modal
      open={open}
      title="Apply an invoice discount"
      okText="Apply discount"
      onOk={submit}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      confirmLoading={apply.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ type: 'PERCENTAGE' as InvoiceDiscountType }}>
        <Space size={8} align="start">
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select
              style={{ width: 160 }}
              options={[
                { value: 'PERCENTAGE', label: 'Percentage (%)' },
                { value: 'FIXED_AMOUNT', label: 'Fixed amount (RM)' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="value"
            label="Amount"
            rules={[{ required: true, message: 'Enter how much to take off.' }]}
          >
            <InputNumber min={0.01} step={0.5} style={{ width: 140 }} />
          </Form.Item>
        </Space>
        <Form.Item
          name="reason"
          label="Reason"
          extra="Recorded on the invoice with your name and the time. Required."
          rules={[
            { required: true, message: 'A discount must say why.' },
            { min: 3, message: 'Give a reason somebody reading the invoice later would understand.' },
          ]}
        >
          <Input.TextArea rows={2} maxLength={300} placeholder="e.g. Regular dressing patient" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
