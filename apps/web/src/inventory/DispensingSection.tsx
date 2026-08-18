import { Alert, Button, Col, Form, InputNumber, Row, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import { useReferenceCatalog } from '../clinical/hooks/useReferenceCatalogs';
import { stockUnitLabel } from './stockUnitLabel';
import { Item } from './types';

const { Text } = Typography;

/**
 * HOW THIS MEDICINE IS COUNTED — the two fields the whole pricing fix waits on.
 *
 * The audit found `quantity_per_stock_unit` set on ZERO of 242 rows, and the
 * reason was that no screen and no endpoint ever accepted it. This is that
 * screen. `ceil(clinical ÷ quantityPerStockUnit)` is the dispense arithmetic,
 * so the number typed here decides what a course of tablets costs.
 *
 * THE "DISPENSED WHOLE" BUTTON IS THE POINT OF THE SECTION (D1). 128 of the
 * 149 divisorless rows name a container and no count — BOX, BOTTLE, AMP — and
 * for many of them the honest answer IS one. Typing 1 records the number and
 * loses the statement; tapping this records both, with an author and a date,
 * and it is the only thing that takes the row off the pricing worklist at a
 * divisor of 1.
 */
export function DispensingSection({ item }: { item?: Item }) {
  const form = Form.useFormInstance();
  // Retired units included so an item still pointing at a withdrawn one
  // renders its NAME marked retired instead of a bare uuid.
  const { data: stockUnits } = useReferenceCatalog('stock-units', true);
  const quantityPerStockUnit = Form.useWatch('quantityPerStockUnit', form) as number | null | undefined;
  const dispensedWhole = Form.useWatch('dispensedWhole', form) as boolean | undefined;

  const declaredAt = item?.dispensedWholeAt ?? null;
  const isOne = quantityPerStockUnit === 1;
  const needsAttention = !quantityPerStockUnit || (isOne && !dispensedWhole);

  return (
    <>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item
            name="stockUnitId"
            label="Stock Unit"
            tooltip="The packaging this item is counted in. From Settings › Prescription Vocabulary."
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="e.g. Tablet per strip"
              options={(stockUnits ?? []).map((unit) => ({
                value: unit.id,
                // Bilingual, because the person counting the shelf reads the
                // Malay half. Retired entries keep their name and say so.
                label: `${unit.name}${unit.nameMs ? ` / ${unit.nameMs}` : ''}${unit.active ? '' : ' (retired)'}`,
              }))}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="quantityPerStockUnit"
            label="Quantity per stock unit"
            tooltip="How many doses are in one of the packages above — 10 tablets in a strip. This is the number the dispense quantity is divided by."
          >
            <InputNumber
              min={1}
              precision={0}
              style={{ width: '100%' }}
              placeholder="e.g. 10"
              onChange={(value) => {
                // The declaration cannot survive a divisor that is not 1. The
                // server clears it either way; clearing the checkbox here is
                // what stops the form claiming otherwise while it is open.
                if (value !== 1) form.setFieldValue('dispensedWhole', false);
              }}
            />
          </Form.Item>
        </Col>
      </Row>

      {/* The one-tap declaration. Hidden field + a real button, because the
          thing being recorded is a sentence ("this goes over the counter
          whole"), not a number, and a bare checkbox beside a number box reads
          as a modifier of it. */}
      <Form.Item name="dispensedWhole" hidden>
        <input type="hidden" />
      </Form.Item>

      <Form.Item>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {dispensedWhole ? (
            <Space>
              <Tag color="success" icon={<CheckCircleFilled />}>
                Dispensed whole
              </Tag>
              <Text type="secondary">
                {declaredAt
                  ? `Recorded ${new Date(declaredAt).toLocaleDateString()}.`
                  : 'Will be recorded against you when you save.'}
              </Text>
              <Button
                size="small"
                onClick={() => form.setFieldValue('dispensedWhole', false)}
                aria-label="Withdraw dispensed whole"
              >
                Undo
              </Button>
            </Space>
          ) : (
            <Button
              onClick={() => {
                form.setFieldValue('quantityPerStockUnit', 1);
                form.setFieldValue('dispensedWhole', true);
              }}
            >
              This item is dispensed whole
            </Button>
          )}

          {needsAttention && (
            <Alert
              type="warning"
              showIcon
              message={
                isOne
                  ? 'A quantity of 1 on its own is not enough'
                  : 'This item cannot be priced per dispense yet'
              }
              description={
                isOne
                  ? 'A 1 nobody has confirmed and a 1 somebody looked at are the same number and opposite facts. Use the button above if this item really is handed over whole — it records who said so.'
                  : 'Say how many are in one stock unit, or record that the item is dispensed whole. Until then a prescription for this item has no dispense quantity to work from.'
              }
            />
          )}
        </Space>
      </Form.Item>
    </>
  );
}

/** The packaging words for a chosen unit id, for use outside the form. */
export function labelForStockUnit(
  stockUnits: Array<{ id: string; name: string; nameMs: string | null }> | undefined,
  stockUnitId: string | null | undefined,
): string | null {
  const unit = stockUnits?.find((row) => row.id === stockUnitId);
  return unit ? stockUnitLabel(unit) : null;
}
