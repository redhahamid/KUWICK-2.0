import { AutoComplete } from 'antd';

/**
 * A reason box with the common reasons one tap away. It is an AutoComplete,
 * not a Select: picking fills the box, and the box can still be finished or
 * replaced by hand, so "Other" needs no separate option. The `id` binds the
 * form's label, exactly as the text area it replaces did.
 */
export function ReasonPicker({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <AutoComplete
      id={id}
      value={value}
      onChange={(next) => onChange(String(next ?? ''))}
      options={options.map((label) => ({ value: label }))}
      placeholder={placeholder ?? 'Pick a common reason, or write your own'}
      style={{ width: '100%' }}
      filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
    />
  );
}
