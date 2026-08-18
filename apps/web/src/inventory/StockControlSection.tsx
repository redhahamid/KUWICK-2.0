import { useEffect, useState } from 'react';
import { Alert, Button, Form, InputNumber, message, Space, Switch, Typography } from 'antd';
import { useSetStockMinThreshold, useStockLevels } from './hooks/useStock';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

/**
 * STOCK CONTROL — the batch/expiry toggle, and the low-stock level.
 *
 * These two sit on DIFFERENT rows and the screen has to be honest about that.
 * "Track batch & expiry" is a fact about the ITEM and saves with the form.
 * The low-stock level is a fact about the ITEM AT A BRANCH — `StockLevel`
 * is keyed by clinic — so it has its own control and its own save, and it says
 * which branch it is setting. A single number that silently applied to one
 * branch while looking like it applied to the item would be a reorder alert
 * that never fires where it is needed.
 */
export function StockControlSection({ itemId }: { itemId: string | null }) {
  const { clinicId, clinics } = useClinicFilter();
  const { data: levels } = useStockLevels(clinicId);
  const setThreshold = useSetStockMinThreshold();
  const [draft, setDraft] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);

  const level = levels?.find((row) => row.itemId === itemId);
  const stored = level?.minThreshold ?? null;

  useEffect(() => {
    setDraft(stored);
    setTouched(false);
  }, [stored, itemId]);

  const branchName = clinics?.find((clinic) => clinic.id === clinicId)?.name;

  const save = async () => {
    if (!itemId || !clinicId) return;
    try {
      await setThreshold.mutateAsync({ clinicId, itemId, minThreshold: draft ?? 0 });
      message.success('Low-stock level saved');
      setTouched(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save the low-stock level');
    }
  };

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Form.Item
        name="tracksBatchExpiry"
        label="Track batch & expiry"
        valuePropName="checked"
        tooltip="On, receiving this item asks for a batch number and an expiry date, and it appears on the near-expiry screen."
        extra="Turn this off only for things that genuinely do not expire — slings, containers, equipment."
      >
        <Switch />
      </Form.Item>

      {itemId === null ? (
        <Alert
          type="info"
          showIcon
          message="Low-stock level is set after the item exists"
          description="It belongs to a branch's shelf rather than to the item, so it is saved separately once there is an item to attach it to."
        />
      ) : (
        <Form.Item
          label="Low-stock level"
          // Named on the label, not implied. The threshold is per branch, and a
          // number that looked item-wide would leave every other branch with no
          // reorder alert at all.
          extra={
            branchName
              ? `Reorder alert for ${branchName}. Each branch keeps its own level.`
              : 'Reorder alert for the selected branch. Each branch keeps its own level.'
          }
        >
          <Space>
            <InputNumber
              min={0}
              precision={0}
              value={draft}
              placeholder="—"
              aria-label="Low-stock level"
              style={{ width: 120 }}
              onChange={(value) => {
                setDraft(value as number | null);
                setTouched(true);
              }}
            />
            {touched && (
              <Button size="small" type="primary" loading={setThreshold.isPending} onClick={save}>
                Save level
              </Button>
            )}
            {!clinicId && <Text type="danger">Pick a branch first — a low-stock level belongs to one.</Text>}
          </Space>
        </Form.Item>
      )}
    </Space>
  );
}
