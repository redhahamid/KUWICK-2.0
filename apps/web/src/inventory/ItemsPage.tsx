import { useEffect, useState } from 'react';
import {
  Button,
  Col,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Row,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCreateItem, useItemSearch, useUpdateItem } from './hooks/useItems';
import { useCreateItemAgeDosage, useItemAgeDosages, useRemoveItemAgeDosage } from './hooks/useItemAgeDosages';
import { CreateItemAgeDosageDto, CreateItemDto, Item } from './types';
import { standardPrescriptionValues, withClearedDefaults } from './standardPrescriptionForm';
import { useReferenceCatalog } from '../clinical/hooks/useReferenceCatalogs';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';

const { Text } = Typography;

// Field layout mirrors the audited kuwick.com Edit Inventory screen
// exactly (docs/DECISIONS.md D-027/D-028): Code/Ref, Product Name,
// Category, Conc. Vol (mL)/Strength (mg), then the "Dispensing &
// Prescription Details" section (Stock Unit, Consumption Method, Default
// Dispense Quantity, Dosage Instructions box, Indication, Prescription
// Reference (Dr's Note), Remark). Pricing/Panel Pricing/Stock Control
// sections from the reference aren't built yet — sellPrice/cost only.
export function ItemsPage() {
  const [search, setSearch] = useState('');
  const { data: items, isLoading } = useItemSearch(search);
  const createItem = useCreateItem();
  const updateItem = useUpdateItem();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form] = Form.useForm<CreateItemDto>();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (item: Item) => {
    setEditing(item);
    form.setFieldsValue({
      code: item.code ?? undefined,
      name: item.name,
      category: item.category ?? undefined,
      unitOfMeasure: item.unitOfMeasure ?? undefined,
      doseDefault: item.doseDefault ?? undefined,
      doseUnitDefault: item.doseUnitDefault ?? undefined,
      frequencyDefault: item.frequencyDefault ?? undefined,
      durationDefault: item.durationDefault ?? undefined,
      instruction: item.instruction ?? undefined,
      indication: item.indication ?? undefined,
      concVolMl: item.concVolMl ? Number(item.concVolMl) : undefined,
      strengthMg: item.strengthMg ? Number(item.strengthMg) : undefined,
      consumptionMethod: item.consumptionMethod ?? undefined,
      defaultDispenseQuantity: item.defaultDispenseQuantity ?? undefined,
      prescriptionReference: item.prescriptionReference ?? undefined,
      remark: item.remark ?? undefined,
      sellPrice: Number(item.sellPrice),
      cost: item.cost ? Number(item.cost) : undefined,
      ...standardPrescriptionValues(item),
    });
    setOpen(true);
  };

  const handleSubmit = async (raw: CreateItemDto) => {
    // An emptied dropdown must reach the API as `null`, not vanish from the
    // payload — see `withClearedDefaults`. Without this, clearing a default
    // looks like it saved and silently did nothing.
    const values = withClearedDefaults(raw);
    try {
      if (editing) {
        await updateItem.mutateAsync({ id: editing.id, dto: values });
        message.success('Item updated');
      } else {
        await createItem.mutateAsync(values);
        message.success('Item created');
      }
      form.resetFields();
      setOpen(false);
      setEditing(null);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save item');
    }
  };

  return (
    <>
      <PageHeader
        title="Items"
        extra={
          <>
            <Space wrap>
              {/* PHASE 1G — 236 medicines, ten to a page. Editing one's standard
                  prescription meant finding it first, and there was no way to.
                  The server matches the code and the clinic's own Malay group
                  tag as well as the name, so "BATUK" finds the cough shelf. */}
              <Input.Search
                allowClear
                placeholder="Search name, code or group…"
                aria-label="Search items"
                style={{ width: 280 }}
                onSearch={setSearch}
                onChange={(event) => {
                  if (event.target.value === '') setSearch('');
                }}
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                Add Item
              </Button>
            </Space>
          </>
        }
      />
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={items}
        columns={[
          { title: 'Code', dataIndex: 'code', render: (value: string | null) => value ?? '—' },
          { title: 'Name', dataIndex: 'name' },
          { title: 'Category', dataIndex: 'category', render: (value: string | null) => value ?? '—' },
          { title: 'Unit', dataIndex: 'unitOfMeasure', render: (value: string | null) => value ?? '—' },
          { title: 'Sell Price (RM)', dataIndex: 'sellPrice' },
          { title: 'Cost (RM)', dataIndex: 'cost', render: (value: string | null) => value ?? '—' },
          { title: 'Active', dataIndex: 'active', render: (value: boolean) => (value ? 'Yes' : 'No') },
          {
            title: 'Actions',
            render: (_: unknown, record: Item) => (
              <Button size="small" onClick={() => openEdit(record)}>
                Edit
              </Button>
            ),
          },
        ]}
      />
      <Drawer
        title={editing ? `Edit Item — ${editing.name}` : 'Add Item'}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnHidden
        width={480}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="code" label="Code / Ref">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category" label="Category">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="name" label="Product Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="unitOfMeasure" label="Stock Unit (Form)">
                <Input placeholder="e.g. Bottle, Box" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="doseUnitDefault" label="Dose Unit (free text)">
                <Input placeholder="e.g. ml, tablet" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="concVolMl" label="Conc. Vol (mL)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="strengthMg" label="Strength (mg)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider titlePlacement="left" plain>
            Dispensing &amp; Prescription Details
          </Divider>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="consumptionMethod" label="Consumption Method (free text)">
                <Input placeholder="e.g. Oral" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="defaultDispenseQuantity" label="Default Dispense Quantity">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="doseDefault" label="Dosage (free text)">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="frequencyDefault" label="Frequency (free text)">
                <Input placeholder="e.g. BD" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="durationDefault" label="Duration (free text)">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="instruction" label="Instruction">
            <Input />
          </Form.Item>
          <Form.Item name="indication" label="Indication">
            <Input />
          </Form.Item>
          <Form.Item
            name="prescriptionReference"
            label="Prescription Reference (Dr's Note)"
            tooltip="Free-text guidance shown to the doctor, e.g. 25-40MG/KG — not auto-filled into the calculator."
          >
            <Input placeholder="e.g. 25-40MG/KG" />
          </Form.Item>
          <Form.Item name="remark" label="Remark">
            <Input.TextArea rows={2} />
          </Form.Item>

          <StandardPrescriptionSection />

          <Divider titlePlacement="left" plain>
            Pricing
          </Divider>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="sellPrice" label="Sell Price (RM)" rules={[{ required: true }]}>
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="cost" label="Cost (RM)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Button
            type="primary"
            htmlType="submit"
            loading={createItem.isPending || updateItem.isPending}
            block
            style={{ marginBottom: 16 }}
          >
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </Form>

        {editing && <AgeDosageBracketEditor itemId={editing.id} unitOfMeasure={editing.doseUnitDefault} />}
      </Drawer>
    </>
  );
}

/**
 * PHASE 1G (1F) — what this medicine's prescribing form opens with.
 *
 * Every field optional, and every one of them a STARTING POINT: the doctor can
 * change any of it on the prescription itself. That is why it is safe to fill
 * these in, and why an empty one is not a gap to be closed with a guess — the
 * platform seed deliberately leaves the dose blank on any medicine whose
 * conventional adult dose it does not know, and on weight-based paediatric
 * syrups where a fixed adult dose does not exist at all.
 *
 * The dropdowns come from Settings › Prescription Vocabulary, INCLUDING retired
 * entries. A medicine can legitimately still point at an entry the clinic has
 * since withdrawn, and dropping it from the list would render that value as a
 * bare id — showing the name and marking it retired is the honest version.
 */
function StandardPrescriptionSection() {
  // Retired entries included so an existing reference still renders by name.
  const { data: units } = useReferenceCatalog('dosage-units', true);
  const { data: frequencies } = useReferenceCatalog('frequencies', true);
  const { data: methods } = useReferenceCatalog('consumption-methods', true);

  const label = (text: string, active: boolean) => (active ? text : `${text} (retired)`);

  return (
    <>
      <Divider titlePlacement="left" plain>
        Standard Prescription (default)
      </Divider>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        What the prescribing form opens with for this medicine. Every field is optional and every one
        can be changed while prescribing. Editing these affects FUTURE prescriptions only — anything
        already prescribed or dispensed keeps the values it was written with.
      </Text>
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item name="defaultDoseAmount" label="Dose amount">
            {/* No fixed precision: the column is a 2dp decimal, so `precision`
                renders two tablets as "2.00", which is not how anybody writes a
                dose. Halves and quarters still type in fine without it. */}
            <InputNumber min={0} style={{ width: '100%' }} placeholder="2" />
          </Form.Item>
        </Col>
        <Col span={16}>
          <Form.Item name="defaultDoseUnitId" label="Dose unit">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Tablet, Millilitre, Puff…"
              options={(units ?? []).map((unit) => ({
                value: unit.id,
                label: label(unit.systemNameEn, unit.active),
              }))}
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item
            name="defaultFrequencyId"
            label="Frequency"
            tooltip="PRN and STAT have no doses-per-day, so quantity is never auto-calculated from them."
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="OD, BD, TDS…"
              options={(frequencies ?? []).map((frequency) => ({
                value: frequency.id,
                label: label(`${frequency.code} — ${frequency.doctorDisplay}`, frequency.active),
              }))}
            />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item name="defaultDurationValue" label="Duration">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="5" />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item name="defaultDurationUnit" label="Duration unit">
            <Select
              allowClear
              placeholder="Days"
              options={[
                { value: 'DAY', label: 'Days' },
                { value: 'WEEK', label: 'Weeks' },
                { value: 'MONTH', label: 'Months' },
              ]}
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={16}>
          <Form.Item name="defaultConsumptionMethodId" label="Consumption method">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="ORAL (MAKAN/MINUM)…"
              options={(methods ?? []).map((method) => ({
                value: method.id,
                label: label(method.methodBilingual, method.active),
              }))}
            />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name="defaultQuantity"
            label="Quantity"
            tooltip="Leave empty to let the prescribing form work it out from dose × frequency × duration."
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}

// Age-based dosing is a per-medicine bracket lookup (e.g. "2y-5y: 2.5ml
// OD"), not a formula — no admin screen for this exists in the audited
// kuwick.com reference yet (owner-confirmed it's unfinished there); this
// minimal editor is a genuine addition beyond the reference, built with
// explicit owner approval (docs/DECISIONS.md D-028).
function AgeDosageBracketEditor({ itemId, unitOfMeasure }: { itemId: string; unitOfMeasure: string | null }) {
  const { data: brackets, isLoading } = useItemAgeDosages(itemId);
  const createBracket = useCreateItemAgeDosage(itemId);
  const removeBracket = useRemoveItemAgeDosage(itemId);
  const [form] = Form.useForm<Omit<CreateItemAgeDosageDto, 'itemId'>>();

  useEffect(() => {
    if (unitOfMeasure) {
      form.setFieldValue('unit', unitOfMeasure);
    }
  }, [unitOfMeasure, form]);

  const handleAdd = async (values: Omit<CreateItemAgeDosageDto, 'itemId'>) => {
    try {
      await createBracket.mutateAsync({ ...values, itemId });
      form.resetFields();
      if (unitOfMeasure) {
        form.setFieldValue('unit', unitOfMeasure);
      }
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add bracket');
    }
  };

  return (
    <>
      <Divider titlePlacement="left" plain>
        Age-Based Dosage Brackets
      </Divider>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        e.g. 24-60 months: 2.5ml OD
      </Text>
      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={brackets}
        pagination={false}
        style={{ marginBottom: 16 }}
        columns={[
          { title: 'From (mo)', dataIndex: 'ageFromMonths' },
          { title: 'To (mo)', dataIndex: 'ageToMonths' },
          { title: 'Amount', dataIndex: 'amount' },
          { title: 'Unit', dataIndex: 'unit' },
          { title: 'Frequency', dataIndex: 'frequency' },
          {
            title: '',
            render: (_: unknown, record: { id: string }) => (
              <Button size="small" danger onClick={() => removeBracket.mutate(record.id)}>
                Remove
              </Button>
            ),
          },
        ]}
      />
      <Form form={form} layout="vertical" onFinish={handleAdd}>
        <Row gutter={8}>
          <Col span={5}>
            <Form.Item name="ageFromMonths" label="From (mo)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="ageToMonths" label="To (mo)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="unit" label="Unit" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="frequency" label="Frequency" rules={[{ required: true }]}>
              <Input placeholder="OD" />
            </Form.Item>
          </Col>
        </Row>
        <Button htmlType="submit" loading={createBracket.isPending} block>
          Add Bracket
        </Button>
      </Form>
    </>
  );
}
