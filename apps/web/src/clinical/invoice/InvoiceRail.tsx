import { useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { ApiError } from '../../core/api-client';
import { RailPanel } from '../sections/RailPanel';
import { useApplyDraftDiscount, useInvoiceDraft } from '../hooks/useInvoiceDraft';
import { InvoiceDiscountType, InvoiceDraftDiscount, Visit } from '../types';
import {
  consultationGap,
  discountAvailability,
  draftBarSummary,
  groupDraftLines,
  lineNote,
  money,
} from './invoiceDraftPresentation';

const { Text } = Typography;

/**
 * b4 PIECE C — THE INVOICE IS THE LAST CARD IN THE RIGHT RAIL.
 *
 * It was the sticky bottom bar (Piece B). The owner's layout decision moved it
 * into the column with the work it prices: Direct Services → Orders /
 * Procedures → Medications → Documents → Invoice, so the bill is read in the
 * same direction, and the same order, as the cards that fill it.
 *
 * WHAT MOVED IS THE SURFACE, AND ONLY THE SURFACE. Every number, every state
 * and every refusal is exactly what Piece B built and is still the server's:
 * the draft is composed by `invoice-draft.ts` from the visit's own sources,
 * the consultation charge is `consultation-tariff.ts`'s answer arriving as a
 * line with a state and a reason, `resolveSourcedPrice` prices it and a BILLED
 * line is read rather than re-priced. This component sums nothing.
 *
 * WHAT IS NOT HERE ANY MORE: the completion action. It went back to the
 * header band, where the mockup puts it — one completion action on the page,
 * still `ConsultationFooter`, still one set of rules.
 *
 * TWO DEPTHS, BECAUSE THE RAIL HAS A BUDGET. At rest the card is one row per
 * GROUP (Consultation, Direct Services, Orders / Procedures, Medications) and
 * the total: the four figures a doctor checks continuously, in about 110px.
 * "Details" opens every line WITH the server's reason for the ones that carry
 * no charge — in place, the way every other rail card discloses, because a
 * scroller inside a rail beside a scrolling page hides clinical content behind
 * a gesture nobody makes.
 *
 * AN UNPRICED ITEM IS SAID AT REST. `unpricedCount` chargeable items have no
 * price, so the total is incomplete by an unknown amount; the chip is on the
 * card header, not inside the disclosure. UNRESOLVED_SUPPLY lines are listed,
 * unpriced and uncounted — never RM 0.00, which reads as free.
 *
 * LIVE. The draft is derived on every read and the rail's mutations invalidate
 * `invoiceDraftKey`, so adding a medicine moves the total without a remount.
 */
export function InvoiceRail({ visit }: { visit: Visit }) {
  const { data: draft, isLoading, error } = useInvoiceDraft(visit.id);
  const [detailed, setDetailed] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);

  const summary = draftBarSummary(draft);
  const groups = groupDraftLines(draft);
  const availability = discountAvailability(draft);
  const discount = draft?.discount ?? null;
  const gap = consultationGap(draft);

  return (
    <>
      <RailPanel
        anchorId="canvas-invoice"
        title="Invoice"
        isLoading={isLoading}
        error={error}
        // A visit with nothing on it yet, said the way the breakdown said it.
        emptyText="Nothing chargeable added to this visit yet."
        // Every group, always. There are at most four and they are the point
        // of the card — a "+1 more" over four rows would hide a charge to save
        // a line.
        previewLimit={groups.length}
        // THE TOTAL IS THE HEADLINE, on the header line, and so is the way in.
        // The two things that change what the number MEANS travel with it
        // rather than waiting inside the disclosure: a discount is in force,
        // and some chargeable work has no price yet.
        //
        // "N items" is NOT here. It cost the header a second line at 457px —
        // 22px of a rail that is already over its window — for a number the
        // itemised detail states by listing them.
        status={
          <Space size={6} align="center" wrap>
            <Text strong style={{ fontSize: 14 }} data-testid="invoice-total">
              {summary.total}
            </Text>
            {groups.length > 0 && (
              <Button
                type="link"
                size="small"
                className="kw-rail-more"
                onClick={() => setDetailed((open) => !open)}
                aria-expanded={detailed}
                data-testid="invoice-details-toggle"
              >
                {detailed ? 'Hide details' : 'Details'}
              </Button>
            )}
            {summary.discountLabel && (
              <Tag className="kw-chip-progress" data-testid="invoice-discount-chip">
                {summary.discountLabel}
              </Tag>
            )}
            {/* b4 PIECE C (2b) — TWO DIFFERENT FACTS, NAMED, and BOTH shown
                when both are true. "N items not priced" means the total beside
                it is incomplete; "N medicines to dispense" means the patient
                has not received something they are being charged for. A single
                "N items outstanding" made a doctor guess which they had. */}
            {summary.unpricedLabel && (
              <Tag color="warning" data-testid="invoice-unpriced">
                {summary.unpricedLabel}
              </Tag>
            )}
            {summary.toDispenseLabel && (
              <Tag className="kw-chip-pending" data-testid="invoice-to-dispense">
                {summary.toDispenseLabel}
              </Tag>
            )}
            {/* b4 PIECE C (2a) — a consultation fee the clinic meant to charge
                and is not charging, said at rest. Never shown for an OTC visit
                or a waiver: those are decisions, and a chip that fires on every
                OTC visit is a chip nobody reads. */}
            {gap && (
              <Tag color="warning" data-testid="invoice-consultation-gap">
                {gap}
              </Tag>
            )}
          </Space>
        }
        items={groups.map((group) => (
          // Deliberately NOT `.kw-rail-row`: the density measurement counts
          // that class as a clinical row and asserts exact numbers about the
          // disclosure, and a group subtotal is not one of those. The text
          // still carries `.kw-rail-row-main`, so the no-truncation assertion
          // covers it.
          <div
            className="kw-invoice-group-row"
            key={group.key}
            data-group={group.key}
            data-charged={group.charged ? 'true' : 'false'}
          >
            <span className="kw-rail-row-main">
              <Text style={{ fontSize: 13 }}>{group.title}</Text>
            </span>
            {/* NEVER RM 0.00 for a group that charges nothing — that reads as
                a thing the clinic gave away. The reason for each line is in
                Details, in the server's own words. */}
            {group.charged ? (
              <Text style={{ fontSize: 13 }}>{money(group.amount)}</Text>
            ) : (
              <Text type="secondary" style={{ fontSize: 13 }}>
                No charge
              </Text>
            )}
          </div>
        ))}
      >
        {groups.length > 0 && (
          <>
            {discount && (
              <div className="kw-invoice-group-row" data-testid="invoice-discount-row">
                <span className="kw-rail-row-main">
                  <Text style={{ fontSize: 13 }}>
                    Discount{discount.type === 'PERCENTAGE' ? ` (${discount.value}%)` : ''}
                  </Text>
                  {/* The REASON is part of the line, not a tooltip. A discount
                      whose reason has to be hunted for is a discount nobody
                      audits. */}
                  <Text type="secondary" className="kw-invoice-line-note">
                    {discount.reason}
                  </Text>
                </span>
                <Text style={{ fontSize: 13 }}>− {money(discount.amount)}</Text>
              </div>
            )}

            <div className="kw-invoice-group-row kw-invoice-total-grand">
              <span className="kw-rail-row-main">
                <Text strong style={{ fontSize: 13 }}>
                  Total
                </Text>
              </span>
              <Text strong style={{ fontSize: 13 }}>
                {money(draft?.total ?? 0)}
              </Text>
            </div>

            {detailed && (
              <div
                className="kw-invoice-detail"
                role="region"
                aria-label="Draft invoice detail"
                data-testid="invoice-breakdown"
              >
                {draft?.invoiceNumber ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {draft.invoiceNumber}
                  </Text>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Not yet raised — this is what the visit currently comes to
                  </Text>
                )}
                {summary.unpricedLabel && (
                  <Text type="warning" style={{ fontSize: 12 }}>
                    {summary.unpricedLabel} — the total is incomplete until they are.
                  </Text>
                )}
                {summary.toDispenseLabel && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {summary.toDispenseLabel} — priced and in the total, not yet handed over.
                  </Text>
                )}
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
                            {/* The server's own wording for why a line carries
                                no charge, rendered as given rather than
                                re-phrased. */}
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
                <div className="kw-invoice-total-row">
                  <span>Subtotal</span>
                  <span>{money(draft?.subtotal ?? 0)}</span>
                </div>
                {/* THE DISCOUNT LIVES WITH THE BILL IT CHANGES.
                    Not at rest: changing a bill is a deliberate act and the
                    doctor opening the itemised detail is the moment they are
                    looking at what they would change. THE SERVER'S REFUSAL, IN
                    THE SERVER'S TERMS, takes its place when there is no open
                    invoice to reduce — a stated reason rather than a missing
                    button (D-093 owner decision 5 still decides WHO may). */}
                {availability.available ? (
                  <Button
                    size="small"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => setDiscountOpen(true)}
                    data-testid="invoice-discount-button"
                  >
                    {discount ? 'Change discount' : 'Apply discount'}
                  </Button>
                ) : (
                  availability.reason && (
                    <Text type="secondary" style={{ fontSize: 12 }} data-testid="invoice-discount-unavailable">
                      {availability.reason}
                    </Text>
                  )
                )}
              </div>
            )}
          </>
        )}
      </RailPanel>

      <DiscountModal open={discountOpen} visitId={visit.id} onClose={() => setDiscountOpen(false)} />
    </>
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
 * server's own refusal, in the server's own words (D-093 owner decision 5
 * gives `APPLY_DISCOUNT` to `billing.corrections`, and that gate was not
 * changed by a layout piece).
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
