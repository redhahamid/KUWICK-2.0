import { useState } from 'react';
import { Button, Empty, Input, InputNumber, message, Modal, Space, Switch, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { MinusOutlined, PlusOutlined, SettingOutlined, UploadOutlined, WarningFilled } from '@ant-design/icons';
import { CatalogueRow, ItemCategory } from './types';
import { useAdjustStock, useItemCatalogue, useItemCategories } from './hooks/useItemCatalogue';
import { useUpdateItem } from './hooks/useItems';
import { ManageCategoriesModal } from './ManageCategoriesModal';
import { ImportInventoryModal } from './ImportInventoryModal';
import { stockBalanceLabel } from './stockUnitLabel';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

/** The one tab that is not a category. */
const ALL = '__all__';

export function attentionWords(row: CatalogueRow): string | null {
  if (row.attention === null) return null;
  return row.attention === 'NO_DIVISOR'
    ? 'No quantity per stock unit. This item cannot be priced per dispense until somebody states how many are in a pack.'
    : 'Quantity per stock unit is 1, and nobody has confirmed this item is dispensed whole. Confirm it on the item, or state the real count.';
}

interface InventoryListProps {
  onEdit: (itemId: string) => void;
  onAdd: () => void;
}

/**
 * THE INVENTORY LIST (Piece 1) — Kuwick 1.0's screen, on 2.0's model.
 *
 * Three things here are decisions rather than layout:
 *
 * 1. THE NEEDS ATTENTION FILTER IS THE PRICING WORKLIST. The audit found 149
 *    of 242 medicines with no divisor, which means `ceil(clinical ÷ divisor)`
 *    cannot price the majority of the catalogue. The filter and its count are
 *    how that gets worked through, so the count is the CLINIC'S total and does
 *    not move when somebody types in the search box — a worklist that shrank
 *    as you searched would be answering a different question every keystroke.
 *
 * 2. THE ACTIVE TOGGLE IS THE ONLY WAY OFF THE LIST (D3). There is no delete,
 *    and no server route to add one to: items are referenced by prescriptions
 *    and invoice lines, and a row that vanished would take a dispensed
 *    medicine's name off a bill somebody has already paid.
 *
 * 3. THE QUICK +/- IS AN ADJUSTMENT AND ASKS WHY. Not a goods receipt — see
 *    `AdjustStockDto`. The reason is required by the server; asking for it in
 *    the modal is how the person gets to answer rather than be refused.
 */
export function InventoryList({ onEdit, onAdd }: InventoryListProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>(ALL);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<{ row: CatalogueRow; sign: 1 | -1 } | null>(null);

  const { clinicId } = useClinicFilter();
  const { data, isLoading } = useItemCatalogue({
    search,
    category: category === ALL ? undefined : category,
    attentionOnly,
    activeOnly: false,
    clinicId,
  });
  const { data: categories } = useItemCategories();
  const updateItem = useUpdateItem();

  const rows = data?.rows ?? [];
  const outstanding = data?.counts.needsAttention ?? 0;

  const toggleActive = async (row: CatalogueRow) => {
    try {
      await updateItem.mutateAsync({ id: row.id, dto: { active: !row.active } });
      message.success(
        row.active
          ? `${row.name} deactivated. It stays on every prescription and invoice that already names it.`
          : `${row.name} is back on the list.`,
      );
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not change this item');
    }
  };

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="Search name, code or group…"
          aria-label="Search inventory"
          style={{ width: 300 }}
          onSearch={setSearch}
          onChange={(event) => {
            if (event.target.value === '') setSearch('');
          }}
        />
        <Button icon={<PlusOutlined />} type="primary" onClick={onAdd}>
          Add Item
        </Button>
        <Button icon={<SettingOutlined />} onClick={() => setManageOpen(true)}>
          Manage Categories
        </Button>
        {/* The onboarding path. 149 of 242 medicines need a divisor stated;
            one at a time through the form is 149 form opens. */}
        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
          Import / Template
        </Button>
        {/*
          The worklist, at rest, whether or not the filter is on. A clinic that
          has never opened this filter still has to be told the number: 149 of
          242 medicines cannot be priced, and a chip that only appeared once you
          went looking would let that ship silently.
        */}
        <Button
          danger={outstanding > 0}
          type={attentionOnly ? 'primary' : 'default'}
          icon={<WarningFilled />}
          aria-pressed={attentionOnly}
          onClick={() => setAttentionOnly((on) => !on)}
        >
          {outstanding === 0
            ? 'Nothing needs attention'
            : `${outstanding} ${outstanding === 1 ? 'item needs' : 'items need'} attention`}
        </Button>
      </Space>

      <Tabs
        activeKey={category}
        onChange={setCategory}
        items={[
          { key: ALL, label: `All (${data?.counts.items ?? 0})` },
          ...(categories ?? []).map((c: ItemCategory) => ({
            key: c.name,
            label: `${c.name} (${c.count})`,
          })),
        ]}
      />

      <Table<CatalogueRow>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        locale={{
          emptyText: (
            <Empty
              description={
                attentionOnly
                  ? 'Nothing in this category needs attention.'
                  : 'No items match. Try a different search or category.'
              }
            />
          ),
        }}
        // A deactivated row stays visible and reads as deactivated. Hiding it
        // would make the toggle look like a delete, which is exactly what D3
        // says it is not.
        rowClassName={(row) => (row.active ? '' : 'kw-inventory-row-inactive')}
        columns={[
          { title: 'Code', dataIndex: 'code', width: 110, render: (v: string | null) => v ?? '—' },
          {
            title: 'Name',
            dataIndex: 'name',
            render: (_: unknown, row: CatalogueRow) => (
              <Space direction="vertical" size={0}>
                <Text strong={row.active}>{row.name}</Text>
                {row.attention && (
                  <Tooltip title={attentionWords(row)}>
                    <Tag color="error" icon={<WarningFilled />} aria-label={`Needs attention: ${row.name}`}>
                      {row.attention === 'NO_DIVISOR' ? 'Needs attention — no pack quantity' : 'Needs attention — unconfirmed 1'}
                    </Tag>
                  </Tooltip>
                )}
              </Space>
            ),
          },
          { title: 'Category', dataIndex: 'category', width: 130, render: (v: string | null) => v ?? '—' },
          {
            title: 'Stock balance',
            dataIndex: 'quantityOnHand',
            width: 170,
            render: (_: unknown, row: CatalogueRow) => (
              <Space size={4}>
                <Text type={row.quantityOnHand < 0 ? 'danger' : undefined}>
                  {stockBalanceLabel(row.quantityOnHand, row.stockUnit)}
                </Text>
                {row.belowThreshold && <Tag color="warning">Low</Tag>}
              </Space>
            ),
          },
          {
            title: 'Expiry',
            dataIndex: 'earliestExpiry',
            width: 120,
            render: (v: string | null) => v ?? '—',
          },
          {
            title: 'Cost (RM)',
            dataIndex: 'cost',
            width: 110,
            align: 'right' as const,
            render: (v: string | null) => v ?? '—',
          },
          {
            title: 'Price to patient (RM)',
            dataIndex: 'sellPrice',
            width: 150,
            align: 'right' as const,
          },
          {
            title: 'Active',
            dataIndex: 'active',
            width: 90,
            render: (_: unknown, row: CatalogueRow) => (
              <Switch
                size="small"
                checked={row.active}
                loading={updateItem.isPending}
                aria-label={`${row.active ? 'Deactivate' : 'Reactivate'} ${row.name}`}
                onChange={() => toggleActive(row)}
              />
            ),
          },
          {
            title: 'Stock',
            width: 100,
            render: (_: unknown, row: CatalogueRow) => (
              <Space size={4}>
                <Button
                  size="small"
                  icon={<MinusOutlined />}
                  aria-label={`Take stock off ${row.name}`}
                  onClick={() => setAdjusting({ row, sign: -1 })}
                />
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  aria-label={`Add stock to ${row.name}`}
                  onClick={() => setAdjusting({ row, sign: 1 })}
                />
              </Space>
            ),
          },
          {
            title: '',
            width: 80,
            render: (_: unknown, row: CatalogueRow) => (
              <Button size="small" onClick={() => onEdit(row.id)}>
                Edit
              </Button>
            ),
          },
        ]}
      />

      <ManageCategoriesModal open={manageOpen} onClose={() => setManageOpen(false)} />
      <ImportInventoryModal open={importOpen} onClose={() => setImportOpen(false)} />
      <QuickAdjustModal state={adjusting} clinicId={clinicId} onClose={() => setAdjusting(null)} />
    </>
  );
}

/**
 * The quick +/-, and the reason it asks for.
 *
 * The server requires a reason (`AdjustStockDto`), so the choice here is
 * between asking for one and being refused with one. A stock number is
 * something the clinic counts money against; "the shelf said 41" is the
 * difference between a correction and an unexplained change.
 */
function QuickAdjustModal({
  state,
  clinicId,
  onClose,
}: {
  state: { row: CatalogueRow; sign: 1 | -1 } | null;
  clinicId?: string;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState<number>(1);
  const [reason, setReason] = useState('');
  const adjust = useAdjustStock();

  const submit = async () => {
    if (!state || !clinicId) return;
    try {
      await adjust.mutateAsync({
        clinicId,
        itemId: state.row.id,
        quantityDelta: state.sign * quantity,
        reason: reason.trim(),
      });
      message.success('Stock adjusted');
      setQuantity(1);
      setReason('');
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not adjust stock');
    }
  };

  const adding = state?.sign === 1;

  return (
    <Modal
      open={state !== null}
      title={state ? `${adding ? 'Add stock to' : 'Take stock off'} ${state.row.name}` : ''}
      okText={adding ? 'Add' : 'Take off'}
      okButtonProps={{ disabled: !reason.trim() || !clinicId, loading: adjust.isPending }}
      onOk={submit}
      onCancel={onClose}
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Text type="secondary">
          This records a stock ADJUSTMENT, not a delivery. Received goods go through Purchase Orders or Stock In, where
          the supplier, batch and expiry are captured.
        </Text>
        <InputNumber
          min={1}
          value={quantity}
          onChange={(value) => setQuantity(value ?? 1)}
          aria-label="Quantity"
          addonAfter={state?.row.stockUnit ? stockBalanceLabel(0, state.row.stockUnit).replace('0 ', '') : undefined}
          style={{ width: '100%' }}
        />
        <Input
          placeholder="Why did the count change? e.g. shelf count, breakage"
          aria-label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {!clinicId && <Text type="danger">Pick a clinic before adjusting stock — a balance belongs to a branch.</Text>}
      </Space>
    </Modal>
  );
}
