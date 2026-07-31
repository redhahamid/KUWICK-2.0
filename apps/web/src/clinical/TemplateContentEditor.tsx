import { useRef } from 'react';
import { Input, Select, Space, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { MERGE_FIELD_OPTIONS } from './mergeFields';

const { Text } = Typography;

// Document builder (D-040) — plain-text template editor with a merge-field
// picker that inserts {{placeholders}} at the cursor. Shared by the clinic
// template page and the platform defaults page so the placeholder
// vocabulary can never drift between the two.
export function TemplateContentEditor({
  value,
  onChange,
  rows = 14,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}) {
  const textAreaRef = useRef<TextAreaRef>(null);

  const insertField = (field: string) => {
    const textarea = textAreaRef.current?.resizableTextArea?.textArea;
    const placeholder = `{{${field}}}`;
    if (!textarea) {
      onChange(value + placeholder);
      return;
    }
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const next = value.slice(0, start) + placeholder + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={4}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Text type="secondary">Content</Text>
        <Select
          size="small"
          style={{ width: 220 }}
          placeholder="+ Insert merge field"
          value={null}
          onChange={(field) => field && insertField(field)}
          options={MERGE_FIELD_OPTIONS.map((option) => ({ value: option.field, label: option.label }))}
          showSearch
          optionFilterProp="label"
        />
      </Space>
      <Input.TextArea
        ref={textAreaRef}
        style={{ fontFamily: 'monospace' }}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'e.g.\n{{clinic.name}}\n{{clinic.address}}\n\nMEDICAL CERTIFICATE\n\nDate: {{date}}\n\nThis is to certify that {{patient.name}} ({{patient.nric}}) ...'}
      />
    </Space>
  );
}
