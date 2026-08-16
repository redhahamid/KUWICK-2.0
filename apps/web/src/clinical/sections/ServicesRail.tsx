import { useState } from 'react';
import { Button, Dropdown, Popconfirm, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
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
 * G4.5s (D-073) — Start and Complete are not offered here, and now the
 * backend agrees rather than merely being hidden from. A STANDARD_SERVICE is
 * created in its final operational state, and `/start` and `/complete` refuse
 * it outright. So this panel shows no task vocabulary at all: no "awaiting
 * result", no result attachment, no progress. A direct service is added, and
 * then it is either charged or cancelled.
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
        anchorId="kw-anchor-services"
      count={list.length}
      isLoading={isLoading}
      error={error ?? undefined}
      emptyText="No direct services added to this visit"
      previewLimit={5}
      addControl={
        <Space.Compact style={{ width: '100%' }}>
          <Select
            showSearch
            allowClear
            style={{ width: '100%' }}
            placeholder="Search services…"
            value={serviceCatalogId}
            onChange={setServiceCatalogId}
            // Same columns as the server and as the orders tab
            // (service-search.ts): name, code, category.
            filterOption={(input, option) =>
              String(option?.searchText ?? option?.label ?? '')
                .toLowerCase()
                .includes(input.toLowerCase())
            }
            options={addable.map((service) => ({
              value: service.id,
              label: service.code ? `${service.code} — ${service.name}` : service.name,
              searchText: [service.code, service.name, service.category].filter(Boolean).join(' '),
            }))}
          />
          <Button type="primary" loading={createService.isPending} disabled={!serviceCatalogId} onClick={add}>
            Add Service
          </Button>
        </Space.Compact>
      }
      items={list.map((service) => {
        const billed = (service._count?.invoiceLines ?? 0) > 0;
        const cancelled = service.status === 'CANCELLED';
        return (
          <div key={service.id} className="kw-rail-row">
            <div className="kw-rail-row-main">
              <Space size={4} wrap>
                <Text strong style={{ fontSize: 14 }} delete={cancelled}>
                  {service.procedureName}
                </Text>
                {service.code && <Tag>{service.code}</Tag>}
                {/* No status tag for a live service. Every direct service is
                    complete the moment it is added (D-073), so "Completed" on
                    every row would carry no information — what actually varies
                    is whether it has been charged. Cancelled is different: it
                    changes what the row means and is always labelled. */}
                {cancelled ? (
                  <Tag className="kw-chip-neutral">Cancelled</Tag>
                ) : billed ? (
                  <Tag className="kw-chip-clinical">On invoice</Tag>
                ) : (
                  <Tag className="kw-chip-neutral">Not yet billed</Tag>
                )}
              </Space>
              {cancelled && service.cancelReason && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {service.cancelReason}
                </Text>
              )}
            </div>
            <Space size={4} className="kw-rail-row-actions">
              {/* Once charged, cancelling is the biller's call, not a control
                  hidden behind a clinical button: the server refuses it and
                  says which invoice to act on. Offering a button that always
                  fails would be worse than not offering one. */}
              {/* D-077 — a More menu, not a red button on every row. Direct
                  Services still show no Start or Complete (D-073). */}
              {!cancelled &&
                (billed ? (
                  <Tooltip title="Charged on an invoice. Remove the invoice line first, then cancel the service.">
                    <Button size="small" icon={<MoreOutlined />} disabled aria-label="No actions available" />
                  </Tooltip>
                ) : (
                  <Popconfirm
                    title="Remove this service from the visit?"
                    okText="Cancel service"
                    okButtonProps={{ danger: true }}
                    onConfirm={() =>
                      cancelService.mutateAsync({ id: service.id }).catch((e) => report(e, 'Failed to cancel'))
                    }
                  >
                    <Button
                      size="small"
                      icon={<MoreOutlined />}
                      aria-label={`Cancel ${service.procedureName}`}
                    />
                  </Popconfirm>
                ))}
            </Space>
          </div>
        );
      })}
    />
  );
}
