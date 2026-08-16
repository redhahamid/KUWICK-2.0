import { useEffect, useState } from 'react';
import { Alert, Button, Col, Input, InputNumber, Radio, Row, Select, Space, Tag, Typography, message } from 'antd';
import { KuwickFormSection, KuwickModal, KuwickModalActionBar } from '../../design-system/kuwick';
import { ApiError } from '../../core/api-client';
import { useCreateOrderService } from '../hooks/useOrderServices';
import { useRooms } from '../hooks/useQueueTickets';
import { CreateOrderServiceDto, OrderUrgency, Service } from '../types';
import { orderTypeLabel, priceLabel } from './orderPicker';

const { Text } = Typography;

/**
 * b2 PHASE E — ordering ONE service or procedure.
 *
 * The service is chosen in the rail's search box, so it is this modal's TITLE
 * rather than a second question. Two search boxes onto one decision is the
 * attachments defect in a different costume — the doctor has already said
 * which service, and being asked again invites a second, different answer.
 *
 * TWO SHAPES, ONE MODAL, decided by the STORED order type:
 *
 *   TASK ORDER — somebody has to carry this out, so it asks where, how
 *   urgently, and what they need to know. Those three become the task in the
 *   Tasks queue; the order IS the task, which is why there is no second record
 *   to create and nothing to keep in step.
 *
 *   STANDARD SERVICE — nobody is waiting on it and no result comes back.
 *   Adding it is the delivery, so it asks only how many and an optional
 *   remark. The quantity is what the invoice multiplies the price by.
 *
 * Fields the model does not have are deliberately absent. There is no
 * scheduled time and no assignee, because `OrderService` carries neither and
 * inventing them here would be inventing a workflow nobody works.
 */
export interface AddOrderModalProps {
  open: boolean;
  visitId: string;
  clinicId?: string;
  /** The service chosen in the rail. Absent means the modal is closed. */
  service?: Service;
  onClose: () => void;
  /** Called instead of onClose after "Add & Add Another", so the rail refocuses. */
  onAddAnother?: () => void;
  restoreFocusTo?: () => HTMLElement | null;
}

export function AddOrderModal({
  open,
  visitId,
  clinicId,
  service,
  onClose,
  onAddAnother,
  restoreFocusTo,
}: AddOrderModalProps) {
  const createOrder = useCreateOrderService(visitId);
  const { data: rooms } = useRooms(clinicId, true);

  const isTask = service?.orderType === 'TASK_ORDER';

  const [roomId, setRoomId] = useState<string>();
  const [urgency, setUrgency] = useState<OrderUrgency>('ROUTINE');
  const [instruction, setInstruction] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRoomId(undefined);
    setUrgency('ROUTINE');
    setInstruction('');
    setQuantity(1);
    setRemark('');
    setError(null);
  };

  useEffect(() => {
    if (open) reset();
  }, [open, service?.id]);

  /**
   * Anything typed. Drives the discard guard inherited from `KuwickModal`, so
   * a room and a set of instructions are not lost to a stray backdrop click.
   */
  const dirty = Boolean(roomId || instruction.trim() || remark.trim() || quantity !== 1 || urgency !== 'ROUTINE');

  // Same rule as medications: the primary is live as soon as the decision has
  // been made. Choosing the service WAS the decision — a room and an urgency
  // are refinements, and requiring them would block an urgent order behind a
  // dropdown.
  const canSubmit = Boolean(service) && (!isTask || quantity >= 1);

  const submit = async (thenAddAnother: boolean) => {
    if (!service) return;
    setError(null);
    const dto: CreateOrderServiceDto = {
      visitId,
      serviceCatalogId: service.id,
      // The server drops whichever of these does not apply to the stored order
      // type, so the browser does not have to model that rule twice.
      instruction: (isTask ? instruction : remark).trim() || undefined,
      roomId: isTask ? roomId : undefined,
      urgency: isTask ? urgency : undefined,
      quantity: isTask ? undefined : quantity,
    };
    try {
      await createOrder.mutateAsync(dto);
      if (thenAddAnother && onAddAnother) {
        message.success(`${service.name} added — search for the next one`);
        onAddAnother();
        return;
      }
      message.success(`${service.name} added`);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The order could not be added.');
    }
  };

  return (
    <KuwickModal
      open={open}
      // The SERVICE is the title. A modal headed "Add order" while a specific
      // procedure is being ordered makes the doctor look for confirmation of
      // which one; the title is the confirmation.
      title={service ? (service.code ? `${service.code} — ${service.name}` : service.name) : 'Add order'}
      subtitle={
        service
          ? [service.category, priceLabel(service.price), orderTypeLabel(service.orderType)]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      size="medium"
      dirty={dirty}
      loading={createOrder.isPending}
      error={error}
      onClose={onClose}
      restoreFocusTo={restoreFocusTo}
      dataTestId="add-order-modal"
      footer={
        <KuwickModalActionBar
          cancel={
            <Button onClick={onClose} disabled={createOrder.isPending}>
              Cancel
            </Button>
          }
          secondary={
            <Button onClick={() => void submit(true)} disabled={!canSubmit || createOrder.isPending}>
              Add &amp; Add Another
            </Button>
          }
          primary={
            <Button
              type="primary"
              loading={createOrder.isPending}
              disabled={!canSubmit}
              onClick={() => void submit(false)}
            >
              Add Order
            </Button>
          }
        />
      }
    >
      {isTask ? (
        <KuwickFormSection title="Who carries this out" hint="Becomes the task in the Tasks queue">
          <Row gutter={[12, 8]}>
            <Col xs={24} md={12}>
              <label htmlFor="kw-order-room">
                <Text type="secondary" style={{ fontSize: 12 }}>Room / station</Text>
              </label>
              <Select
                id="kw-order-room"
                style={{ width: '100%' }}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Treatment Room 1…"
                value={roomId}
                onChange={setRoomId}
                options={(rooms ?? []).map((room) => ({ value: room.id, label: room.name }))}
              />
              {(rooms ?? []).length === 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  No rooms set up yet — add them in Settings › Rooms &amp; Stations.
                </Text>
              )}
            </Col>
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>Urgency</Text>
              {/* Two values, both visible. A dropdown would hide "Urgent"
                  behind a click on the one order where seconds matter. */}
              <Radio.Group
                value={urgency}
                onChange={(event) => setUrgency(event.target.value as OrderUrgency)}
                optionType="button"
                aria-label="Urgency"
                options={[
                  { value: 'ROUTINE', label: 'Routine' },
                  { value: 'URGENT', label: 'Urgent' },
                ]}
              />
            </Col>
          </Row>
          <div style={{ marginTop: 8 }}>
            <label htmlFor="kw-order-instruction">
              <Text type="secondary" style={{ fontSize: 12 }}>Instructions for staff</Text>
            </label>
            <Input.TextArea
              id="kw-order-instruction"
              rows={2}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="e.g. Left forearm, PA view, fasting"
            />
          </div>
        </KuwickFormSection>
      ) : (
        <KuwickFormSection title="Billing" hint="Added to this visit's invoice">
          <Row gutter={[12, 8]}>
            <Col xs={12} md={6}>
              <label htmlFor="kw-order-quantity">
                <Text type="secondary" style={{ fontSize: 12 }}>Quantity</Text>
              </label>
              <InputNumber
                id="kw-order-quantity"
                min={1}
                max={999}
                style={{ width: '100%' }}
                value={quantity}
                onChange={(value) => setQuantity(value ?? 1)}
              />
            </Col>
            <Col xs={24} md={18}>
              <label htmlFor="kw-order-remark">
                <Text type="secondary" style={{ fontSize: 12 }}>Remark (optional)</Text>
              </label>
              <Input
                id="kw-order-remark"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
              />
            </Col>
          </Row>
          {service && quantity > 1 && (
            <Space style={{ marginTop: 8 }}>
              <Tag>{quantity} ×</Tag>
              <Text type="secondary">
                {priceLabel(service.price)} each — {priceLabel(Number(service.price) * quantity)} on the invoice
              </Text>
            </Space>
          )}
        </KuwickFormSection>
      )}

      {isTask && (
        <Alert
          type="info"
          showIcon
          message="This goes to the Tasks queue as PENDING. It comes back here as COMPLETED once staff record the result."
        />
      )}
    </KuwickModal>
  );
}
