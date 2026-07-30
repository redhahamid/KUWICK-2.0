import { useEffect } from 'react';
import { Button, DatePicker, Drawer, Form, Input, InputNumber, Space, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useReceivePurchaseOrder } from './hooks/usePurchaseOrders';
import { PurchaseOrder, ReceivePurchaseOrderDto } from './types';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

interface ReceivePurchaseOrderDrawerProps {
  purchaseOrder: PurchaseOrder | null;
  onClose: () => void;
}

interface ReceiveFormValues {
  lines: { purchaseOrderLineId: string; quantityReceived: number; batchNumber?: string; expiryDate?: dayjs.Dayjs }[];
}

export function ReceivePurchaseOrderDrawer({ purchaseOrder, onClose }: ReceivePurchaseOrderDrawerProps) {
  const receivePurchaseOrder = useReceivePurchaseOrder();
  const [form] = Form.useForm<ReceiveFormValues>();

  const outstandingLines = (purchaseOrder?.lines ?? []).filter(
    (line) => line.receivedQuantity < line.orderedQuantity,
  );

  useEffect(() => {
    if (purchaseOrder) {
      form.setFieldsValue({
        lines: outstandingLines.map((line) => ({ purchaseOrderLineId: line.id, quantityReceived: undefined })),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrder?.id]);

  const handleSubmit = async (values: ReceiveFormValues) => {
    if (!purchaseOrder) return;
    try {
      const dto: ReceivePurchaseOrderDto = {
        clinicId: purchaseOrder.clinicId,
        lines: values.lines
          .filter((line) => line.quantityReceived)
          .map((line) => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            quantityReceived: line.quantityReceived,
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate?.format('YYYY-MM-DD'),
          })),
      };
      await receivePurchaseOrder.mutateAsync({ id: purchaseOrder.id, dto });
      message.success('Goods received');
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to receive goods');
    }
  };

  return (
    <Drawer
      title={purchaseOrder ? `Receive — PO ${purchaseOrder.id.slice(0, 8)}` : 'Receive'}
      open={Boolean(purchaseOrder)}
      onClose={onClose}
      destroyOnHidden
      width={480}
    >
      {purchaseOrder && (
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.List name="lines">
            {(fields) => (
              <>
                {fields.map(({ key, name, ...rest }, index) => (
                  <div key={key} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #f0f0f0' }}>
                    <Text strong>{outstandingLines[index]?.item.name}</Text>
                    <br />
                    <Text type="secondary">
                      Outstanding: {outstandingLines[index]?.orderedQuantity - outstandingLines[index]?.receivedQuantity}
                    </Text>
                    <Form.Item {...rest} name={[name, 'purchaseOrderLineId']} hidden>
                      <Input />
                    </Form.Item>
                    <Space wrap style={{ marginTop: 8 }}>
                      <Form.Item {...rest} name={[name, 'quantityReceived']} label="Quantity Received" noStyle>
                        <InputNumber
                          min={0}
                          max={outstandingLines[index]?.orderedQuantity - outstandingLines[index]?.receivedQuantity}
                          placeholder="Qty"
                        />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'batchNumber']} noStyle>
                        <Input placeholder="Batch number" style={{ width: 140 }} />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'expiryDate']} noStyle>
                        <DatePicker placeholder="Expiry date" />
                      </Form.Item>
                    </Space>
                  </div>
                ))}
              </>
            )}
          </Form.List>
          <Button type="primary" htmlType="submit" loading={receivePurchaseOrder.isPending} block>
            Receive
          </Button>
        </Form>
      )}
    </Drawer>
  );
}
