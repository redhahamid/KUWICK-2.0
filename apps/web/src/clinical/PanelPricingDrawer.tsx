import { useState } from 'react';
import { Button, Drawer, Empty, Input, InputNumber, Popconfirm, Select, Space, Table, Tabs, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  useCreatePanelExclusion,
  useCreatePanelPriceOverride,
  useDeletePanelExclusion,
  useDeletePanelPriceOverride,
  usePanelExclusions,
  usePanelPriceOverrides,
} from './hooks/usePanelPricing';
import { useServices } from './hooks/useServices';
import { useItems } from '../inventory/hooks/useItems';
import { PanelClinic, PanelExclusion, PanelPriceOverride } from './types';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

// "type:id" — one Select covering both Services and Medications/Items, so
// staff don't need a separate type toggle before searching.
function parseTarget(target: string): { itemId?: string; serviceCatalogId?: string } {
  const [kind, id] = target.split(':');
  return kind === 'item' ? { itemId: id } : { serviceCatalogId: id };
}

function targetLabel(row: { item?: { name: string } | null; serviceCatalog?: { name: string } | null }): string {
  return row.item?.name ?? row.serviceCatalog?.name ?? '—';
}

interface DrawerProps {
  panel: PanelClinic | null;
  onClose: () => void;
}

// Clinical Operations, Phase A8 (owner request — settle panel settings
// together: list, price overrides, exclusion rules, all reflecting
// automatically in the invoice). One drawer per panel, two tabs.
export function PanelPricingDrawer({ panel, onClose }: DrawerProps) {
  const { data: services } = useServices();
  const { data: items } = useItems();
  const targetOptions = [
    { label: 'Services & Procedures', options: services?.map((s) => ({ value: `service:${s.id}`, label: s.name })) ?? [] },
    { label: 'Medications & Items', options: items?.map((i) => ({ value: `item:${i.id}`, label: i.name })) ?? [] },
  ];

  return (
    <Drawer title={panel ? `Pricing & Exclusions — ${panel.name}` : ''} open={Boolean(panel)} onClose={onClose} width={640} destroyOnHidden>
      {panel && (
        <Tabs
          items={[
            {
              key: 'overrides',
              label: 'Price Overrides',
              children: <OverridesPanel panelId={panel.id} targetOptions={targetOptions} />,
            },
            {
              key: 'exclusions',
              label: 'Exclusions',
              children: <ExclusionsPanel panelId={panel.id} targetOptions={targetOptions} />,
            },
          ]}
        />
      )}
    </Drawer>
  );
}

interface PanelProps {
  panelId: string;
  targetOptions: { label: string; options: { value: string; label: string }[] }[];
}

function OverridesPanel({ panelId, targetOptions }: PanelProps) {
  const { data: overrides, isLoading } = usePanelPriceOverrides(panelId);
  const createOverride = useCreatePanelPriceOverride(panelId);
  const deleteOverride = useDeletePanelPriceOverride(panelId);
  const [target, setTarget] = useState<string>();
  const [price, setPrice] = useState<number>();

  const handleAdd = async () => {
    if (!target || price == null) return;
    try {
      await createOverride.mutateAsync({ ...parseTarget(target), overridePrice: price });
      setTarget(undefined);
      setPrice(undefined);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add price override');
    }
  };

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Negotiated rate this panel pays for a specific service or medication — used to suggest the invoice line
        price instead of the self-pay rate.
      </Text>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          showSearch
          placeholder="Search service or medication..."
          style={{ width: 280 }}
          value={target}
          onChange={setTarget}
          options={targetOptions}
          filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
        />
        <InputNumber min={0} precision={2} placeholder="Panel Price (RM)" value={price} onChange={(v) => setPrice(v ?? undefined)} style={{ width: 160 }} />
        <Button icon={<PlusOutlined />} loading={createOverride.isPending} disabled={!target || price == null} onClick={handleAdd}>
          Add Override
        </Button>
      </Space>
      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        pagination={false}
        dataSource={overrides}
        locale={{ emptyText: <Empty description="No price overrides yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        columns={[
          { title: 'Service / Medication', render: (_: unknown, r: PanelPriceOverride) => targetLabel(r) },
          { title: 'Panel Price (RM)', dataIndex: 'overridePrice', width: 130 },
          {
            title: '',
            width: 40,
            render: (_: unknown, r: PanelPriceOverride) => (
              <Popconfirm title="Remove this override?" onConfirm={() => deleteOverride.mutate(r.id)}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  );
}

function ExclusionsPanel({ panelId, targetOptions }: PanelProps) {
  const { data: exclusions, isLoading } = usePanelExclusions(panelId);
  const createExclusion = useCreatePanelExclusion(panelId);
  const deleteExclusion = useDeletePanelExclusion(panelId);
  const [target, setTarget] = useState<string>();
  const [reason, setReason] = useState('');

  const handleAdd = async () => {
    if (!target) return;
    try {
      await createExclusion.mutateAsync({ ...parseTarget(target), reason: reason || undefined });
      setTarget(undefined);
      setReason('');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add exclusion');
    }
  };

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Services or medications this panel does NOT cover — automatically flagged as patient-payable on the
        invoice, on top of the per-visit limit, whenever Quick-Added to a visit under this panel.
      </Text>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          showSearch
          placeholder="Search service or medication..."
          style={{ width: 280 }}
          value={target}
          onChange={setTarget}
          options={targetOptions}
          filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
        />
        <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 180 }} />
        <Button icon={<PlusOutlined />} loading={createExclusion.isPending} disabled={!target} onClick={handleAdd}>
          Add Exclusion
        </Button>
      </Space>
      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        pagination={false}
        dataSource={exclusions}
        locale={{ emptyText: <Empty description="No exclusions yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        columns={[
          { title: 'Service / Medication', render: (_: unknown, r: PanelExclusion) => targetLabel(r) },
          { title: 'Reason', dataIndex: 'reason', render: (v: string | null) => v ?? '—' },
          {
            title: '',
            width: 40,
            render: (_: unknown, r: PanelExclusion) => (
              <Popconfirm title="Remove this exclusion?" onConfirm={() => deleteExclusion.mutate(r.id)}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  );
}
