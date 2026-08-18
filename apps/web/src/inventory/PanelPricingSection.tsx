import { useState } from 'react';
import { Alert, Button, InputNumber, message, Space, Table, Tag, Typography } from 'antd';
import { useItemPanelPricing, useSetItemPanelPrice } from './hooks/useItemPanelPricing';
import { ItemPanelPrice } from './types';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

const RULE_WORDS: Record<string, string> = {
  SPECIFIC_PANEL_PRICE: 'this panel’s own price',
  CASH_PLUS_MARKUP: 'cash + panel markup',
  CASH: 'cash price',
};

/**
 * PANEL PRICING OVERRIDES — and what each panel actually charges.
 *
 * ON D2. The decision says panel pricing is stored ahead of billing logic and
 * the screen must say "recorded — not yet used in billing" until a bill
 * consumes it. For ITEM overrides that is not the case:
 * `resolveSourcedPrice` (D-093) reads `PanelPriceOverride` today for any
 * prescription line on a panel visit, so a price set here changes what a panel
 * patient is billed on the next invoice raised. Printing the caveat would be a
 * false reassurance about money — which is the failure D2 exists to prevent —
 * so the screen says the true thing instead, including the one real limit:
 * lines already billed keep the price they were billed at.
 *
 * THE EFFECTIVE COLUMN IS WHY THIS TABLE IS WORTH ITS SPACE. An override box
 * on its own leaves the clinic to work out what a panel patient pays when
 * there is no override and the panel carries a blanket markup. The server
 * answers that with `resolveContractualPrice` — the invoice line's own
 * function — so the number here is the number that will be charged.
 */
export function PanelPricingSection({ itemId }: { itemId: string }) {
  const { data: panels, isLoading } = useItemPanelPricing(itemId);
  const setPrice = useSetItemPanelPrice(itemId);
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});

  const save = async (row: ItemPanelPrice) => {
    const next = drafts[row.panelClinicId];
    try {
      await setPrice.mutateAsync({ panelClinicId: row.panelClinicId, overridePrice: next ?? null });
      message.success(
        next == null
          ? `${row.panelName} is back on the panel's standard pricing.`
          : `${row.panelName} price saved.`,
      );
      setDrafts((current) => {
        const { [row.panelClinicId]: _removed, ...rest } = current;
        return rest;
      });
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save that price');
    }
  };

  if (!isLoading && (panels ?? []).length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="No panels set up yet"
        description="Panel prices are per panel. Add panels under Panel Management first."
      />
    );
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Text type="secondary">
        What a patient on each panel is charged for this item. Applies to invoices raised from now on — lines already
        billed keep the price they were billed at.
      </Text>
      <Table<ItemPanelPrice>
        rowKey="panelClinicId"
        size="small"
        pagination={false}
        loading={isLoading}
        dataSource={panels}
        columns={[
          { title: 'Panel', dataIndex: 'panelName' },
          {
            title: 'Panel price (RM)',
            width: 190,
            render: (_: unknown, row: ItemPanelPrice) => {
              const touched = row.panelClinicId in drafts;
              const value = touched ? drafts[row.panelClinicId] : row.overridePrice ? Number(row.overridePrice) : null;
              return (
                <Space size={4}>
                  <InputNumber
                    min={0}
                    precision={2}
                    value={value}
                    placeholder="—"
                    aria-label={`Panel price for ${row.panelName}`}
                    style={{ width: 110 }}
                    onChange={(next) =>
                      setDrafts((current) => ({ ...current, [row.panelClinicId]: next as number | null }))
                    }
                  />
                  {touched && (
                    <Button
                      size="small"
                      type="primary"
                      loading={setPrice.isPending}
                      aria-label={`Save price for ${row.panelName}`}
                      onClick={() => save(row)}
                    >
                      Save
                    </Button>
                  )}
                </Space>
              );
            },
          },
          {
            title: 'Charged',
            width: 190,
            render: (_: unknown, row: ItemPanelPrice) => (
              <Space direction="vertical" size={0}>
                <Text strong>RM {row.effectivePrice}</Text>
                {/* Never colour alone — the rule is named in words, and the
                    markup case says the number it is adding. */}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {RULE_WORDS[row.priceRule] ?? row.priceRule}
                  {row.priceRule === 'CASH_PLUS_MARKUP' && row.markupAmount ? ` (+RM ${row.markupAmount})` : ''}
                </Text>
              </Space>
            ),
          },
          {
            title: '',
            width: 90,
            render: (_: unknown, row: ItemPanelPrice) =>
              row.overrideId ? (
                <Button
                  size="small"
                  aria-label={`Clear panel price for ${row.panelName}`}
                  onClick={() => {
                    setDrafts((current) => ({ ...current, [row.panelClinicId]: null }));
                    void save(row);
                  }}
                >
                  Clear
                </Button>
              ) : (
                <Tag>standard</Tag>
              ),
          },
        ]}
      />
    </Space>
  );
}
