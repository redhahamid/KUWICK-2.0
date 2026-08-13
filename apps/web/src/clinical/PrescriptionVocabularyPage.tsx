import { useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { LockOutlined, PlusOutlined } from '@ant-design/icons';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';
import {
  ReferenceCatalogName,
  ReferenceCatalogRow,
  useCreateCatalogEntry,
  useReferenceCatalog,
  useSetCatalogEntryActive,
  useUpdateCatalogEntry,
} from './hooks/useReferenceCatalogs';

const { Text, Title, Paragraph } = Typography;

/**
 * b1 PHASE 1G — Settings › Prescription Vocabulary.
 *
 * The five reference catalogues (1A–1E) the prescribing form is built out of,
 * one section each. The API already refuses to touch a SYSTEM row; this screen
 * has to make that visible BEFORE the click, because a refusal the clinic could
 * have predicted is a screen that wasted their time.
 *
 * ONE component for five catalogues, declared as data below. Same reason the
 * API has one service: the five differ only in their columns, and the rules
 * around them — standard rows are locked, nothing is deleted, retiring is
 * reversible — are identical and must not drift apart.
 *
 * NOTHING HERE DELETES. Retiring sets `active = false`, which takes the entry
 * off future prescribing forms and leaves every prescription already printed
 * exactly as it was printed.
 */

/** One editable column of one catalogue. */
interface CatalogField {
  key: string;
  label: string;
  /** Shown under the input. What this field is FOR, in the clinic's terms. */
  help?: string;
  placeholder?: string;
  type?: 'text' | 'number';
  required?: boolean;
  /** Column width in the 24-unit grid inside the add/edit form. */
  span?: number;
  /** Column width in the table, if it needs pinning. */
  columnWidth?: number;
}

interface CatalogSectionSpec {
  name: ReferenceCatalogName;
  title: string;
  /** Why this list exists, for someone who has not read the schema. */
  purpose: string;
  fields: CatalogField[];
  /**
   * Set when the clinic may not add its own entries, and it is the REASON,
   * shown on the screen. A control that cannot work must say why rather than
   * sit there looking clickable.
   */
  platformOnly?: string;
}

const CATALOG_SECTIONS: CatalogSectionSpec[] = [
  {
    name: 'frequencies',
    title: 'Frequencies',
    purpose:
      'How often a dose is taken. The code is what you prescribe by; the Malay label is what prints on the patient’s medicine.',
    fields: [
      { key: 'code', label: 'Code', placeholder: 'OD, BD, TDS', required: true, span: 6, columnWidth: 110 },
      {
        key: 'doctorDisplay',
        label: 'Meaning (English)',
        placeholder: 'Once daily',
        required: true,
        span: 9,
      },
      {
        key: 'patientLabelBm',
        label: 'Patient label (BM)',
        placeholder: 'Sekali sehari',
        required: true,
        span: 9,
      },
      {
        key: 'timesPerDay',
        label: 'Doses per day',
        help: 'Leave empty if it cannot be counted — PRN and STAT have no daily count, and quantity is then never auto-calculated for them.',
        type: 'number',
        span: 24,
        columnWidth: 130,
      },
    ],
  },
  {
    name: 'dosage-units',
    title: 'Dose units',
    purpose: 'What one dose is measured in — tablets, millilitres, puffs.',
    fields: [
      { key: 'systemNameEn', label: 'Unit (English)', placeholder: 'Tablet', required: true, span: 8 },
      { key: 'patientLabelBm', label: 'Patient label (BM)', placeholder: 'BIJI', required: true, span: 8 },
      {
        key: 'useCase',
        label: 'Used for',
        help: 'Guidance only — nothing is blocked by it.',
        placeholder: 'syrup / liquid',
        span: 8,
      },
    ],
  },
  {
    name: 'consumption-methods',
    title: 'Consumption methods',
    purpose:
      'How the medicine is taken, and the sentence that prints on the label telling the patient how to take it.',
    fields: [
      {
        key: 'methodBilingual',
        label: 'Method',
        help: 'Both languages in one entry, the way the clinic says it.',
        placeholder: 'ORAL (MAKAN/MINUM)',
        required: true,
        span: 12,
      },
      {
        key: 'patientInstructionBm',
        label: 'Patient instruction (BM)',
        placeholder: 'Ambil melalui mulut',
        required: true,
        span: 12,
      },
    ],
  },
  {
    name: 'indications',
    title: 'Indications',
    purpose:
      'What a medicine is for. A starting list, not a closed one — you can always type something that is not here.',
    fields: [
      { key: 'labelEn', label: 'Indication (English)', placeholder: 'Fever', required: true, span: 12 },
      { key: 'labelBm', label: 'Indication (BM)', placeholder: 'Demam', required: true, span: 12 },
    ],
  },
  {
    name: 'stock-units',
    title: 'Stock units',
    purpose: 'How stock is counted on the shelf.',
    platformOnly:
      'This list is fixed because stock deduction arithmetic depends on it: the number you enter beside a stock unit is what quantities are multiplied by, so the word has to mean the same thing in every clinic. Choose the closest entry and set the quantity on the medicine.',
    fields: [{ key: 'name', label: 'Stock unit', placeholder: 'TABLET PER STRIP', required: true, span: 24 }],
  },
];

export function PrescriptionVocabularyPage() {
  return (
    <>
      <PageHeader title="Prescription Vocabulary" />
      <Paragraph type="secondary" style={{ maxWidth: 760 }}>
        The lists the prescribing form is built from. Entries marked{' '}
        <Tag icon={<LockOutlined />}>Standard</Tag> come with Kuwick and cannot be changed — add your
        own alongside them. Nothing here is ever deleted: retiring an entry takes it off future
        prescriptions and leaves everything already printed exactly as it was.
      </Paragraph>
      {CATALOG_SECTIONS.map((section) => (
        <CatalogSection key={section.name} spec={section} />
      ))}
    </>
  );
}

function CatalogSection({ spec }: { spec: CatalogSectionSpec }) {
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<'new' | ReferenceCatalogRow | null>(null);

  const { data: rows, isLoading } = useReferenceCatalog(spec.name, showRetired);
  const createEntry = useCreateCatalogEntry(spec.name);
  const updateEntry = useUpdateCatalogEntry(spec.name);
  const setActive = useSetCatalogEntryActive(spec.name);

  const custom = (rows ?? []).filter((row) => row.origin === 'CUSTOM').length;

  const retire = async (row: ReferenceCatalogRow, active: boolean) => {
    try {
      await setActive.mutateAsync({ id: row.id, active });
      message.success(active ? 'Entry restored' : 'Entry retired');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not update the entry');
    }
  };

  return (
    <section style={{ marginBottom: 40 }} data-testid={`catalog-${spec.name}`}>
      <Row justify="space-between" align="middle" gutter={[12, 8]} style={{ marginBottom: 4 }}>
        <Col>
          <Title level={5} style={{ margin: 0 }}>
            {spec.title}
          </Title>
        </Col>
        <Col>
          <Space size="middle" wrap>
            <Space size="small">
              <Switch size="small" checked={showRetired} onChange={setShowRetired} />
              <Text type="secondary">Show retired</Text>
            </Space>
            {spec.platformOnly ? (
              // Honest-disabled: the control is visible so the shape of the
              // screen is the same as every other section, and it says why it
              // cannot be used instead of failing after the click.
              <Tooltip title={spec.platformOnly}>
                <span>
                  <Button icon={<PlusOutlined />} disabled>
                    Add custom
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button icon={<PlusOutlined />} onClick={() => setEditing('new')}>
                Add custom
              </Button>
            )}
          </Space>
        </Col>
      </Row>
      <Paragraph type="secondary" style={{ maxWidth: 760 }}>
        {spec.purpose}
      </Paragraph>
      {spec.platformOnly && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={spec.platformOnly} />
      )}

      <Table<ReferenceCatalogRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`No ${spec.title.toLowerCase()} yet. Kuwick's standard list should be here — if it is empty, the clinic has not been set up.`}
            />
          ),
        }}
        rowClassName={(row) => (row.active ? '' : 'kw-catalog-row-retired')}
        columns={[
          ...spec.fields.map((field) => ({
            title: field.label,
            dataIndex: field.key,
            width: field.columnWidth,
            render: (value: unknown) =>
              value === null || value === undefined || value === '' ? (
                <Text type="secondary">—</Text>
              ) : (
                String(value)
              ),
          })),
          {
            title: 'Origin',
            dataIndex: 'origin',
            width: 130,
            render: (origin: string, row: ReferenceCatalogRow) => (
              <Space size={4} wrap>
                {origin === 'SYSTEM' ? (
                  <Tag icon={<LockOutlined />}>Standard</Tag>
                ) : (
                  <Tag color="blue">Your entry</Tag>
                )}
                {!row.active && <Tag>Retired</Tag>}
              </Space>
            ),
          },
          {
            title: '',
            width: 170,
            render: (_: unknown, row: ReferenceCatalogRow) =>
              row.origin === 'SYSTEM' ? (
                // No buttons at all, rather than three disabled ones. The row
                // says what it is and the page header says what that means;
                // a control that can never do anything is not worth the pixel.
                <Text type="secondary">Locked — add your own instead</Text>
              ) : (
                <Space size="small">
                  <Button size="small" onClick={() => setEditing(row)}>
                    Edit
                  </Button>
                  <Button size="small" onClick={() => retire(row, !row.active)}>
                    {row.active ? 'Retire' : 'Restore'}
                  </Button>
                </Space>
              ),
          },
        ]}
      />
      <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        {custom === 0
          ? 'No entries of your own in this list yet.'
          : `${custom} of your own ${custom === 1 ? 'entry' : 'entries'} in this list.`}
      </Text>

      <CatalogEntryModal
        spec={spec}
        editing={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (values) => {
          if (editing === 'new') {
            await createEntry.mutateAsync(values);
            message.success('Entry added');
          } else if (editing) {
            await updateEntry.mutateAsync({ id: editing.id, body: values });
            message.success('Entry updated');
          }
          setEditing(null);
        }}
        saving={createEntry.isPending || updateEntry.isPending}
      />
    </section>
  );
}

function CatalogEntryModal({
  spec,
  editing,
  onClose,
  onSubmit,
  saving,
}: {
  spec: CatalogSectionSpec;
  editing: 'new' | ReferenceCatalogRow | null;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}) {
  const [form] = Form.useForm<Record<string, unknown>>();
  const isNew = editing === 'new';

  const handleFinish = async (values: Record<string, unknown>) => {
    try {
      await onSubmit(values);
      form.resetFields();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save the entry');
    }
  };

  return (
    <Modal
      title={isNew ? `Add to ${spec.title}` : `Edit ${spec.title.replace(/ies$/, 'y').replace(/s$/, '')}`}
      open={editing !== null}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        // `initialValues` on a destroyed-on-close Modal is enough: the form is
        // remounted each time it opens, so an edit never shows the previous
        // row's values.
        initialValues={isNew || !editing ? {} : (editing as unknown as Record<string, unknown>)}
      >
        <Row gutter={12}>
          {spec.fields.map((field) => (
            <Col span={field.span ?? 24} key={field.key}>
              <Form.Item
                name={field.key}
                label={field.label}
                extra={field.help}
                rules={field.required ? [{ required: true, message: `${field.label} is required` }] : []}
              >
                {field.type === 'number' ? (
                  <InputNumber min={0} placeholder={field.placeholder} style={{ width: '100%' }} />
                ) : (
                  <Input placeholder={field.placeholder} />
                )}
              </Form.Item>
            </Col>
          ))}
        </Row>
        <Button type="primary" htmlType="submit" loading={saving} block>
          {isNew ? 'Add' : 'Save changes'}
        </Button>
      </Form>
    </Modal>
  );
}
