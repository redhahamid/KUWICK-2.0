import { Button, Card, Input, InputNumber, Select, Space, Switch, Typography } from 'antd';
import { CloseOutlined, CopyOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { FormField, FormFieldType } from './types';

const { Text } = Typography;

const TYPE_OPTIONS: { value: FormFieldType; label: string }[] = [
  { value: 'TEXT', label: 'Short Answer' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'TEXTAREA', label: 'Paragraph' },
  { value: 'RADIO', label: 'Multiple choice' },
  { value: 'CHECKBOX', label: 'Checkboxes' },
  { value: 'SELECT', label: 'Drop-down' },
  { value: 'DATE', label: 'Date' },
  { value: 'TIME', label: 'Time' },
];

const HAS_OPTIONS: FormFieldType[] = ['RADIO', 'CHECKBOX', 'SELECT'];

function newField(): FormField {
  return { id: crypto.randomUUID(), label: '', type: 'TEXT', required: false };
}

interface FormFieldBuilderProps {
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
}

// Google-Forms-style question builder — matches the owner's audited
// kuwick.com "Result Form Builder" (Clinic Settings > Services &
// Procedures > a TASK_ORDER service's edit drawer): question title + type
// picker, type-specific options (choice list for Multiple choice/
// Checkboxes/Drop-down, unit + normal range for Number), duplicate/
// delete/Required footer per question.
export function FormFieldBuilder({ fields, onChange }: FormFieldBuilderProps) {
  const updateField = (index: number, patch: Partial<FormField>) => {
    const next = [...fields];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  const duplicateField = (index: number) => {
    const copy = { ...fields[index], id: crypto.randomUUID() };
    onChange([...fields.slice(0, index + 1), copy, ...fields.slice(index + 1)]);
  };

  const addOption = (index: number) => {
    const options = fields[index].options ?? [];
    updateField(index, { options: [...options, `Option ${options.length + 1}`] });
  };

  const updateOption = (index: number, optionIndex: number, value: string) => {
    const options = [...(fields[index].options ?? [])];
    options[optionIndex] = value;
    updateField(index, { options });
  };

  const removeOption = (index: number, optionIndex: number) => {
    const options = (fields[index].options ?? []).filter((_, i) => i !== optionIndex);
    updateField(index, { options });
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {fields.map((field, index) => (
        <Card key={field.id} size="small" style={{ borderLeft: '3px solid #4338ca' }}>
          <Space style={{ width: '100%' }} align="start">
            <Input
              placeholder="Question Title"
              value={field.label}
              onChange={(e) => updateField(index, { label: e.target.value })}
              style={{ flex: 1 }}
            />
            <Select
              value={field.type}
              onChange={(type: FormFieldType) => updateField(index, { type })}
              options={TYPE_OPTIONS}
              style={{ width: 160 }}
            />
          </Space>

          {HAS_OPTIONS.includes(field.type) && (
            <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size={6}>
              {(field.options ?? []).map((option, optionIndex) => (
                <Space key={optionIndex} style={{ width: '100%' }}>
                  <Input
                    value={option}
                    onChange={(e) => updateOption(index, optionIndex, e.target.value)}
                    style={{ width: 280 }}
                  />
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => removeOption(index, optionIndex)}
                  />
                </Space>
              ))}
              <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => addOption(index)}>
                Add option
              </Button>
            </Space>
          )}

          {field.type === 'NUMBER' && (
            <Space style={{ marginTop: 12 }} wrap>
              <Input
                placeholder="Unit (e.g. g/dL)"
                value={field.unit}
                onChange={(e) => updateField(index, { unit: e.target.value })}
                style={{ width: 140 }}
              />
              <InputNumber
                placeholder="Normal min"
                value={field.normalRangeMin}
                onChange={(value) => updateField(index, { normalRangeMin: value ?? undefined })}
                style={{ width: 120 }}
              />
              <InputNumber
                placeholder="Normal max"
                value={field.normalRangeMax}
                onChange={(value) => updateField(index, { normalRangeMax: value ?? undefined })}
                style={{ width: 120 }}
              />
            </Space>
          )}

          <Space
            style={{ width: '100%', justifyContent: 'flex-end', marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}
          >
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => duplicateField(index)} />
            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeField(index)} />
            <Text type="secondary" style={{ fontSize: 13 }}>
              Required
            </Text>
            <Switch
              size="small"
              checked={field.required ?? false}
              onChange={(checked) => updateField(index, { required: checked })}
            />
          </Space>
        </Card>
      ))}

      <Button type="dashed" icon={<PlusOutlined />} onClick={() => onChange([...fields, newField()])} block>
        Add Question
      </Button>
    </Space>
  );
}
