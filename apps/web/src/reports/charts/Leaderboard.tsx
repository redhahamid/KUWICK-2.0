import { useState, ReactNode } from 'react';
import { Empty } from 'antd';
import { INK, SERIES_ORDER } from './tokens';

export interface LeaderboardRow {
  id: string;
  name: string;
  value: number;
  secondaryLabel: string;
  secondaryValue: string | number;
}

interface Props<T extends LeaderboardRow> {
  rows: T[];
  valueFormatter?: (value: number) => string;
  renderDetail?: (row: T) => ReactNode;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

// Ranked horizontal-bar leaderboard, click a row to expand detail — the
// pattern from Klinik Hijraa's doctor productivity board. Reads at a
// glance without a legend since identity comes from the name + rank, not
// color (color here is decorative avatar variety, not encoding data).
export function Leaderboard<T extends LeaderboardRow>({ rows, valueFormatter = (v) => `${v}`, renderDetail }: Props<T>) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (rows.length === 0) {
    return <Empty description="No paid invoices in this range yet" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '32px 0' }} />;
  }

  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((r) => r.value), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sorted.map((row, index) => {
        const isOpen = expanded === row.id;
        const color = SERIES_ORDER[index % SERIES_ORDER.length];
        return (
          <div key={row.id}>
            <div
              onClick={() => renderDetail && setExpanded(isOpen ? null : row.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 6px',
                borderRadius: 6,
                cursor: renderDetail ? 'pointer' : 'default',
                background: isOpen ? 'rgba(0,0,0,0.03)' : 'transparent',
              }}
            >
              <span style={{ width: 18, fontSize: 12, color: INK.muted, textAlign: 'right', flexShrink: 0 }}>{index + 1}</span>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: color,
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {initials(row.name)}
              </span>
              <span style={{ width: 140, fontSize: 13, color: INK.primary, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.name}
              </span>
              <div style={{ flex: 1, background: INK.gridline, borderRadius: 3, height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${(row.value / max) * 100}%`, background: color, height: '100%', borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: INK.primary, width: 90, textAlign: 'right', flexShrink: 0 }}>
                {valueFormatter(row.value)}
              </span>
              <span style={{ fontSize: 12, color: INK.muted, width: 90, textAlign: 'right', flexShrink: 0 }}>
                {row.secondaryValue} {row.secondaryLabel}
              </span>
            </div>
            {isOpen && renderDetail && (
              <div style={{ padding: '6px 6px 10px 54px', fontSize: 12, color: INK.secondary }}>{renderDetail(row)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
