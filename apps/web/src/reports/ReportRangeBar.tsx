import { DatePicker, Radio, Space } from 'antd';
import dayjs, { Dayjs } from 'dayjs';

export interface ReportRange {
  from: string;
  to: string;
}

export function defaultRange(days = 30): ReportRange {
  return { from: dayjs().subtract(days, 'day').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') };
}

const PRESETS: { label: string; days?: number; startOf?: 'month' | 'year' }[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'This Month', startOf: 'month' },
  { label: 'This Year', startOf: 'year' },
];

// D-039 — the report suite's shared daily/monthly/quarterly/yearly/custom
// range control ("daily sale report / monthly / quarterly / yearly / date
// range" in the owner's requirements — quarterly is just a custom range).
export function ReportRangeBar({ value, onChange }: { value: ReportRange; onChange: (range: ReportRange) => void }) {
  const activePreset = PRESETS.find((preset) => {
    const from = preset.days ? dayjs().subtract(preset.days, 'day') : dayjs().startOf(preset.startOf!);
    return value.from === from.format('YYYY-MM-DD') && value.to === dayjs().format('YYYY-MM-DD');
  });

  return (
    <Space wrap>
      <Radio.Group
        optionType="button"
        value={activePreset?.label}
        onChange={(e) => {
          const preset = PRESETS.find((p) => p.label === e.target.value)!;
          const from = preset.days ? dayjs().subtract(preset.days, 'day') : dayjs().startOf(preset.startOf!);
          onChange({ from: from.format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') });
        }}
        options={PRESETS.map((preset) => ({ label: preset.label, value: preset.label }))}
      />
      <DatePicker.RangePicker
        allowClear={false}
        value={[dayjs(value.from), dayjs(value.to)]}
        onChange={(dates) => {
          const [from, to] = dates as [Dayjs, Dayjs];
          onChange({ from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') });
        }}
      />
    </Space>
  );
}
