import { useState } from 'react';
import { Empty } from 'antd';
import { INK } from './tokens';

export interface DonutSegment {
  key: string;
  label: string;
  color: string;
  value: number;
}

interface Props {
  segments: DonutSegment[];
  centerLabel: string;
  valueFormatter?: (value: number) => string;
  activeKey?: string | null;
  onSegmentClick?: (key: string) => void;
}

// Donut with values in the legend (not just color swatches) per the
// Klinik Hijraa reference and the dataviz skill's "legend always present"
// rule — center shows the total, each row shows name + value + share.
export function DonutChart({ segments, centerLabel, valueFormatter = (v) => `${v}`, activeKey, onSegmentClick }: Props) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);

  if (total <= 0) {
    return <Empty description="No data in this range yet" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '32px 0' }} />;
  }

  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {visible.map((seg) => {
            const fraction = seg.value / total;
            const dash = fraction * circumference;
            const gap = circumference - dash;
            const currentOffset = offset;
            offset += dash;
            const emphasised = hoverKey === seg.key || activeKey === seg.key;
            return (
              <circle
                key={seg.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={emphasised ? strokeWidth + 4 : strokeWidth}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-currentOffset}
                opacity={activeKey && activeKey !== seg.key ? 0.35 : 1}
                style={{ cursor: onSegmentClick ? 'pointer' : 'default', transition: 'stroke-width 0.15s, opacity 0.15s' }}
                onPointerEnter={() => setHoverKey(seg.key)}
                onPointerLeave={() => setHoverKey(null)}
                onClick={() => onSegmentClick?.(seg.key)}
              />
            );
          })}
        </g>
        <text x={size / 2} y={size / 2 - 6} textAnchor="middle" fontSize={11} fill={INK.muted}>
          {centerLabel}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize={16} fontWeight={600} fill={INK.primary}>
          {valueFormatter(total)}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180, flex: 1 }}>
        {segments.map((seg) => {
          const share = total > 0 ? (seg.value / total) * 100 : 0;
          const dim = activeKey && activeKey !== seg.key;
          return (
            <div
              key={seg.key}
              onClick={() => onSegmentClick?.(seg.key)}
              onPointerEnter={() => setHoverKey(seg.key)}
              onPointerLeave={() => setHoverKey(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                cursor: onSegmentClick ? 'pointer' : 'default',
                opacity: dim ? 0.5 : 1,
                borderRadius: 4,
                padding: '2px 4px',
                background: hoverKey === seg.key || activeKey === seg.key ? 'rgba(0,0,0,0.03)' : 'transparent',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ color: INK.secondary, flex: 1 }}>{seg.label}</span>
              <strong style={{ color: INK.primary }}>{valueFormatter(seg.value)}</strong>
              <span style={{ color: INK.muted, width: 44, textAlign: 'right' }}>{share.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
