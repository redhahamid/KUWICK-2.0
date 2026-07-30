import { Button, Drawer, Form, InputNumber, Select, Space, message } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useClinics } from '../core/hooks/useClinics';
import { useSuppliers } from './hooks/useSuppliers';
import { useItems } from './hooks/useItems';
import { useCreatePurchaseOrder } from './hooks/usePurchaseOrders';
import { CreatePurchaseOrderDto } from './types';
import { ApiError } from '../core/api-client';

interface CreatePurchaseOrderDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function CreatePurchaseOrderDrawer({ open, onClose }: CreatePurchaseOrderDrawerProps) {
  const { data: clinics } = useClinics();
  const { data: suppliers } = useSuppliers();
  const { data: items } = useItems();
  const createPurchaseOrder = useCreatePurchaseOrder();
  const [form] = Form.useForm<CreatePurchaseOrderDto>();

  const handleSubmit = async (values: CreatePurchaseOrderDto) => {
    try {
      await createPurchaseOrder.mutateAsync(values);
      message.success('Purchase order created');
      form.resetFields();
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create purchase order');
    }
  };

  return (
    <Drawer
      title="New Purchase Order"
      open={open}
      onClose={onClose}
      destroyOnHidden
      width={480}
      afterOpenChange={(isOpen) => !isOpen && form.resetFields()}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item name="clinicId" label="Clinic" rules={[{ required: true }]}>
          <Select options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))} />
        </Form.Item>
        <Form.Item name="supplierId" label="Supplier" rules={[{ required: true }]}>
          <Select options={suppliers?.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
        </Form.Item>
        <Form.List name="lines" initialValue={[{}]}>
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                  <Form.Item
                    {...rest}
                    name={[name, 'itemId']}
                    rules={[{ required: true, message: 'Item required' }]}
                    style={{ width: 180 }}
                  >
                    <Select
                      placeholder="Item"
                      showSearch
                      optionFilterProp="label"
                      options={items?.map((item) => ({ value: item.id, label: item.name }))}
                    />
                  </Form.Item>
                  <Form.Item
                    {...rest}
                    name={[name, 'orderedQuantity']}
                    rules={[{ required: true, message: 'Qty required' }]}
                  >
                    <InputNumber min={1} placeholder="Qty" />
                  </Form.Item>
                  <Form.Item
                    {...rest}
                    name={[name, 'unitCost']}
                    rules={[{ required: true, message: 'Cost required' }]}
                  >
                    <InputNumber min={0} precision={2} placeholder="Unit Cost" />
                  </Form.Item>
                  {fields.length > 1 && (
                    <MinusCircleOutlined onClick={() => remove(name)} />
                  )}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                Add Line
              </Button>
            </>
          )}
        </Form.List>
        <Button
          type="primary"
          htmlType="submit"
          loading={createPurchaseOrder.isPending}
          block
          style={{ marginTop: 16 }}
        >
          Create Purchase Order
        </Button>
      </Form>
    </Drawer>
  );
}
