import { Button, Card, Empty, List, Space, Tag, Tooltip, Typography } from 'antd';
import { BillingWorklistItem } from '../types';
import {
  SOURCE_TYPE_LABEL,
  SUPPLY_MODE_LABEL,
  sourceStatusLabel,
  worklistDetail,
  worklistState,
} from './billingReviewPresentation';

const { Text } = Typography;

interface Props {
  items: BillingWorklistItem[];
  loading?: boolean;
  /** Absent when the counter may not edit lines — the action is then hidden. */
  onAdd?: (item: BillingWorklistItem) => void;
  addingSourceId?: string | null;
  /** Why adding is unavailable at all (no invoice yet, invoice settled, ...). */
  addDisabledReason?: string | null;
}

/**
 * G4.5d3c-3b2 (D-094) — AREA A: the billing worklist.
 *
 * Every source the visit produced, with the server's state and the reason for
 * it. "Add to invoice" appears only where the SERVER says the item is ready;
 * everywhere else the row says plainly why there is nothing to add. The
 * browser does not decide chargeability, and it never sends a quantity or a
 * price for a sourced item.
 */
export function BillingWorklistPanel({ items, loading, onAdd, addingSourceId, addDisabledReason }: Props) {
  return (
    <Card
      size="small"
      title="Billing worklist"
      loading={loading}
      styles={{ body: { padding: items.length ? 0 : undefined } }}
    >
      {items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Nothing chargeable has been recorded for this visit yet."
        />
      ) : (
        <List
          dataSource={items}
          rowKey={(item) => `${item.sourceType}:${item.sourceId}`}
          renderItem={(item) => {
            const state = worklistState(item);
            const detail = worklistDetail(item);
            const status = sourceStatusLabel(item);
            const canAdd = state.actionable && Boolean(onAdd) && !addDisabledReason;
            const addTitle = addDisabledReason ?? (state.actionable ? undefined : detail ?? state.label);
            return (
              <List.Item
                style={{ padding: '12px 16px', flexWrap: 'wrap', rowGap: 8 }}
                actions={
                  onAdd && state.actionable
                    ? [
                        <Tooltip key="add" title={addTitle}>
                          {/* A disabled control always says WHY, via both the
                              tooltip and an aria-description, never by colour. */}
                          <Button
                            type="primary"
                            size="small"
                            disabled={!canAdd}
                            loading={addingSourceId === item.sourceId}
                            aria-label={`Add ${item.description} to invoice`}
                            aria-description={addTitle}
                            onClick={() => onAdd(item)}
                            style={{ minHeight: 44 }}
                          >
                            Add to invoice
                          </Button>
                        </Tooltip>,
                      ]
                    : undefined
                }
              >
                <List.Item.Meta
                  title={
                    <Space size={8} wrap>
                      <Text strong>{item.description}</Text>
                      {/* State is carried by TEXT, not colour alone. */}
                      <Tag color={state.color}>{state.label}</Tag>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {SOURCE_TYPE_LABEL[item.sourceType]}
                        {status ? ` · ${status}` : ''}
                        {item.supplyMode ? ` · ${SUPPLY_MODE_LABEL[item.supplyMode]}` : ''}
                        {item.quantity != null ? ` · Quantity ${item.quantity}` : ''}
                      </Text>
                      {detail && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {detail}
                        </Text>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
}
