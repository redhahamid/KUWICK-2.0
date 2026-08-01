import { ReactNode } from 'react';
import { Card, Skeleton } from 'antd';
import { INK, STATUS } from './tokens';

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 72;
  const height = 24;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${height - ((v - min) / span) * height}`);
  const last = points[points.length - 1].split(',').map(Number);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.55} />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}

export interface KpiTileProps {
  label: string;
  value: string;
  subtitle?: string;
  icon?: ReactNode;
  deltaPercent?: number | null;
  /** true when an increase in value is the desirable direction (e.g. revenue); false when a decrease is desirable (e.g. wait time) */
  higherIsBetter?: boolean;
  sparkline?: number[];
  loading?: boolean;
}

// KPI tile: label + big number + optional delta (vs the prior period of
// equal length) + optional sparkline (from a real per-day series). Both are
// omitted rather than faked when the backend has no comparable series —
// see ReportsPage.tsx for which KPIs carry which.
export function KpiTile({ label, value, subtitle, icon, deltaPercent, higherIsBetter = true, sparkline, loading }: KpiTileProps) {
  if (loading) {
    return (
      <Card size="small" style={{ height: '100%' }}>
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: '60%' }} />
      </Card>
    );
  }

  const deltaGood = deltaPercent == null ? null : higherIsBetter ? deltaPercent >= 0 : deltaPercent <= 0;
  const deltaColor = deltaGood == null ? INK.muted : deltaGood ? STATUS.good : STATUS.critical;

  return (
    <Card size="small" style={{ height: '100%' }} styles={{ body: { padding: '14px 16px' } }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: INK.muted, fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {icon}
            <span>{label}</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, color: INK.primary, marginTop: 4, lineHeight: 1.2 }}>{value}</div>
          <div style={{ marginTop: 4, fontSize: 12, minHeight: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
            {deltaPercent != null && (
              <span style={{ color: deltaColor, fontWeight: 600 }}>
                {deltaPercent > 0 ? '▲' : deltaPercent < 0 ? '▼' : '—'} {Math.abs(deltaPercent).toFixed(1)}%
              </span>
            )}
            {subtitle && <span style={{ color: INK.muted }}>{subtitle}</span>}
          </div>
        </div>
        {sparkline && sparkline.length > 1 && (
          <div style={{ flexShrink: 0, marginTop: 4 }}>
            <Sparkline values={sparkline} color={deltaColor === INK.muted ? INK.secondary : deltaColor} />
          </div>
        )}
      </div>
    </Card>
  );
}
