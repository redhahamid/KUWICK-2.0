import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Typography, message } from 'antd';
import {
  KuwickFormSection,
  KuwickModal,
  KuwickModalActionBar,
  KuwickSearchOption,
  KuwickSearchSelect,
} from '../../design-system/kuwick';
import { apiClient, ApiError } from '../../core/api-client';
import { useCreateOrderService } from '../hooks/useOrderServices';
import { Service } from '../types';

const { Text } = Typography;

/**
 * G4.5d5b-1 — ordering one procedure or investigation.
 *
 * The rail offered a Select holding every service in the catalogue, filtered
 * for TASK_ORDER in the browser, and an Add button. Two problems: the whole
 * catalogue was in the DOM, and `instruction` — a field the model has carried
 * since the order service was written — had nowhere to be typed. A doctor
 * ordering a wound dressing could not say where.
 *
 * So this modal exists for the structured part, and it contains ONLY the
 * order being created. Deliberately absent:
 *
 *   - the historical procedure list. It stays in the rail behind, where it
 *     was; a creation surface that also shows history is the drawer this
 *     checkpoint is replacing.
 *   - any workflow field the model does not have. There is no priority, no
 *     scheduled time and no assignee, because `OrderService` has none of
 *     those and inventing them here would be inventing a workflow.
 *
 * Nothing here reads or invalidates a clinical-note query.
 */
export interface AddProcedureModalProps {
  open: boolean;
  visitId: string;
  onClose: () => void;
  restoreFocusTo?: () => HTMLElement | null;
}

export function AddProcedureModal({ open, visitId, onClose, restoreFocusTo }: AddProcedureModalProps) {
  const createOrder = useCreateOrderService(visitId);
  const [serviceCatalogId, setServiceCatalogId] = useState<string>();
  const [serviceLabel, setServiceLabel] = useState<string>();
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setServiceCatalogId(undefined);
      setServiceLabel(undefined);
      setInstruction('');
      setError(null);
    }
  }, [open]);

  /** TASK_ORDER only, bounded, and filtered by the SERVER. */
  const searchServices = useCallback(async (term: string): Promise<KuwickSearchOption[]> => {
    const services = await apiClient.get<Service[]>(
      `/services?orderType=TASK_ORDER&take=20&search=${encodeURIComponent(term)}`,
    );
    // The row says what the choice is made on: the code that appears on the
    // order form, the clinic's own category, and the price. It said the name
    // alone, which is also the only field the SERVER used to match — so a
    // procedure could not be found by the code printed on its own form.
    return services.map((service) => ({
      value: service.id,
      label: service.name,
      detail: [service.code, service.category, `RM ${Number(service.price ?? 0).toFixed(2)}`]
        .filter(Boolean)
        .join(' · '),
    }));
  }, []);

  const dirty = useMemo(
    () => Boolean(serviceCatalogId || instruction.trim()),
    [instruction, serviceCatalogId],
  );

  const submit = async () => {
    if (!serviceCatalogId) {
      setError('Choose a procedure or investigation.');
      return;
    }
    setError(null);
    try {
      await createOrder.mutateAsync({
        visitId,
        serviceCatalogId,
        instruction: instruction.trim() || undefined,
      });
      message.success(`${serviceLabel ?? 'Order'} added`);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The order could not be added.');
    }
  };

  return (
    <KuwickModal
      open={open}
      title="Order a procedure or investigation"
      subtitle="One order at a time. This visit's existing orders stay behind this window."
      size="small"
      dirty={dirty}
      loading={createOrder.isPending}
      error={error}
      onClose={onClose}
      restoreFocusTo={restoreFocusTo}
      dataTestId="add-procedure-modal"
      footer={
        <KuwickModalActionBar
          cancel={
            <Button onClick={onClose} disabled={createOrder.isPending}>
              Cancel
            </Button>
          }
          primary={
            <Button
              type="primary"
              loading={createOrder.isPending}
              disabled={!serviceCatalogId}
              onClick={() => void submit()}
            >
              Add Order
            </Button>
          }
        />
      }
    >
      <KuwickFormSection title="Procedure or investigation">
        <KuwickSearchSelect
          id="kw-procedure-search"
          ariaLabel="Search procedures and investigations"
          placeholder="Search by name, code or category…"
          value={serviceCatalogId}
          autoFocus
          onSearch={searchServices}
          onSelect={(value, option) => {
            setServiceCatalogId(value);
            setServiceLabel(option.label);
          }}
          onClear={() => {
            setServiceCatalogId(undefined);
            setServiceLabel(undefined);
          }}
          emptyHint="Type to search orderable procedures and investigations."
        />
      </KuwickFormSection>

      <KuwickFormSection
        title="Instruction"
        hint="Optional — what the person performing this needs to know"
      >
        <label htmlFor="kw-procedure-instruction" className="sr-only">
          Instruction for this order
        </label>
        <Input.TextArea
          id="kw-procedure-instruction"
          rows={3}
          value={instruction}
          placeholder="e.g. Dress the left forearm laceration; review in 3 days"
          onChange={(event) => setInstruction(event.target.value)}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          Recorded against the order. It does not change the clinical note.
        </Text>
      </KuwickFormSection>
    </KuwickModal>
  );
}
