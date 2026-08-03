import { useState } from 'react';
import { Button, Popconfirm, Select, Space, Tag, Typography, message } from 'antd';
import { useServices } from '../hooks/useServices';
import { useCancelOrderService, useCreateOrderService, useOrderServices } from '../hooks/useOrderServices';
import { ApiError } from '../../core/api-client';
import { RailPanel } from './RailPanel';

const { Text } = Typography;

interface ServicesRailProps {
  visitId: string;
}

/**
 * G4.5c (D-071) — Direct Services, its own visible panel.
 *
 * Until now a consultation fee and a chest X-ray sat in one "Orders /
 * Procedures" list, because `OrdersSection` called `useOrderServices(visitId)`
 * with no filter. They are already distinguishable — `OrderService.orderType`
 * is snapshotted from the catalogue as `STANDARD_SERVICE` or `TASK_ORDER`,
 * and the standalone Procedure Queue already filters to TASK_ORDER only — so
 * this panel is the same hook with the filter the model always supported.
 *
 * NO new model, and no duplicated business logic: adding a service is the
 * same `useCreateOrderService` the orders panel uses.
 *
 * Start and Complete are deliberately NOT offered here. The backend still
 * creates a STANDARD_SERVICE as PENDING and would still accept those
 * transitions — that lifecycle is meaningless for a service and correcting
 * it is G4.5s, not this checkpoint. Hiding controls is not the fix, so this
 * panel says plainly what a service's state means rather than pretending the
 * workflow does not exist; cancel remains available because it is the only
 * transition that is genuinely useful for a mis-added line.
 */
export function ServicesRail({ visitId }: ServicesRailProps) {
  const [serviceCatalogId, setServiceCatalogId] = useState<string>();

  const { data: services } = useServices();
  const { data: added, isLoading, error } = useOrderServices(visitId, { orderType: 'STANDARD_SERVICE' });
  const createService = useCreateOrderService(visitId);
  const cancelService = useCancelOrderService(visitId);

  const report = (err: unknown, fallback: string) =>
    message.error(err instanceof ApiError ? err.message : fallback);

  const list = added ?? [];
  const addable = (services ?? []).filter((service) => service.orderType === 'STANDARD_SERVICE');

  const add = async () => {
    if (!serviceCatalogId) return;
    try {
      await createService.mutateAsync({ visitId, serviceCatalogId });
      setServiceCatalogId(undefined);
    } catch (err) {
      report(err, 'Failed to add the service');
    }
  };

  return (
    <RailPanel
      title="Direct Services"
      count={list.length}
      isLoading={isLoading}
      error={error ?? undefined}
      emptyText="No direct services added to this visit"
      previewLimit={3}
      addControl={
        <Space.Compact style={{ width: '100%' }}>
          <Select
            showSearch
            allowClear
            style={{ width: '100%' }}
            placeholder="Search services…"
            value={serviceCatalogId}
            onChange={setServiceCatalogId}
            filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
            options={addable.map((service) => ({
              value: service.id,
              label: service.code ? `${service.code} — ${service.name}` : service.name,
            }))}
          />
          <Button type="primary" loading={createService.isPending} disabled={!serviceCatalogId} onClick={add}>
            Add Service
          </Button>
        </Space.Compact>
      }
      items={list.map((service) => (
        <div key={service.id} className="kw-rail-row">
          <div className="kw-rail-row-main">
            <Space size={4} wrap>
              <Text strong style={{ fontSize: 13 }}>
                {service.procedureName}
              </Text>
              {service.code && <Tag>{service.code}</Tag>}
              {/* Charge state only where an invoice line genuinely links to
                  it — nothing is inferred when there is none (G2b). */}
              {(service._count?.invoiceLines ?? 0) > 0 ? (
                <Tag color="purple">On invoice</Tag>
              ) : (
                <Tag>Not yet billed</Tag>
              )}
              {service.status === 'CANCELLED' && <Tag color="default">Cancelled</Tag>}
            </Space>
          </div>
          <Space size={4} className="kw-rail-row-actions">
            {service.status !== 'CANCELLED' && (
              <Popconfirm
                title="Remove this service from the visit?"
                okText="Cancel service"
                okButtonProps={{ danger: true }}
                onConfirm={() =>
                  cancelService.mutateAsync({ id: service.id }).catch((e) => report(e, 'Failed to cancel'))
                }
              >
                <Button size="small" danger>
                  Cancel
                </Button>
              </Popconfirm>
            )}
          </Space>
        </div>
      ))}
    />
  );
}
