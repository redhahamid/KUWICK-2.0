import { Input, Select, Space } from 'antd';

/**
 * A PHONE NUMBER WITH ITS COUNTRY, stored as one string the way it is dialled
 * from abroad: `+60123456789`. The field shows the country code beside the
 * local number, defaults to Malaysia, and drops the local trunk zero for
 * Malaysia so "012-345 6789" and "+60 12 345 6789" are the same number. A
 * number saved before this field existed ("013-2000000") reads back as a
 * Malaysian local number and is stored the new way the next time it is saved.
 */
export const COUNTRY_CODES = [
  { code: '+60', label: 'MY +60' },
  { code: '+65', label: 'SG +65' },
  { code: '+62', label: 'ID +62' },
  { code: '+880', label: 'BD +880' },
  { code: '+95', label: 'MM +95' },
  { code: '+977', label: 'NP +977' },
  { code: '+91', label: 'IN +91' },
  { code: '+63', label: 'PH +63' },
  { code: '+84', label: 'VN +84' },
  { code: '+86', label: 'CN +86' },
  { code: '+44', label: 'UK +44' },
  { code: '+61', label: 'AU +61' },
];

const TRUNK_ZERO = new Set(['+60', '+62', '+880', '+95', '+977', '+91', '+63', '+84', '+86', '+44', '+61']);

export function splitPhone(value: string | undefined | null): { code: string; local: string } {
  const text = (value ?? '').trim();
  if (text.startsWith('+')) {
    const match = COUNTRY_CODES.map((entry) => entry.code)
      .filter((code) => text.startsWith(code))
      .sort((a, b) => b.length - a.length)[0];
    if (match) return { code: match, local: text.slice(match.length) };
  }
  return { code: '+60', local: text };
}

export function joinPhone(code: string, local: string): string {
  let digits = local.replace(/\D/g, '');
  if (TRUNK_ZERO.has(code)) digits = digits.replace(/^0+/, '');
  return digits ? `${code}${digits}` : '';
}

export function PhoneField({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}) {
  const { code, local } = splitPhone(value);
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Select
        value={code}
        aria-label="Country code"
        style={{ width: 112 }}
        options={COUNTRY_CODES.map((entry) => ({ value: entry.code, label: entry.label }))}
        onChange={(next) => onChange?.(joinPhone(next, local))}
      />
      <Input
        id={id}
        value={local}
        inputMode="tel"
        placeholder={placeholder ?? '12-345 6789'}
        onChange={(event) => onChange?.(joinPhone(code, event.target.value))}
      />
    </Space.Compact>
  );
}
