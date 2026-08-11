import { useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { Empty } from 'antd';
import { INK } from './tokens';

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  area?: boolean;
  /** value at each date in the shared `dates` array; null = no data that day */
  values: (number | null)[];
}

interface Props {
  dates: string[];
  series: TrendSeries[];
  height?: number;
  valueFormatter?: (value: number) => string;
}

const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

/**
 * Which x positions get a date label: first, middle, last — deduplicated and
 * bounded. The naive `[0, mid, last]` collapses to `[0, 0, -1]` on a 0-1 day
 * range, which rendered duplicate React keys (dropped/duplicated children on
 * a finance surface) and put dayjs(undefined) — today — under an empty chart.
 */
export function axisLabelIndices(length: number): number[] {
  return [...new Set([0, Math.floor(length / 2), length - 1])].filter((i) => i >= 0 && i < length);
}

// Multi-series line/area chart with a crosshair + shared tooltip, following
// the dataviz skill's mark spec (2px lines, 8px end-marker with surface
// ring, ~10% opacity area fill, hairline recessive gridlines) and
// interaction spec (crosshair snaps to nearest X, one tooltip lists every
// series, hit target is the full plot height not the 2px line).
export function TrendChart({ dates, series, height = 260, valueFormatter = (v) => `${v}` }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 720;

  const { yMin, yMax, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
    const max = all.length > 0 ? Math.max(...all, 0) : 1;
    const niceMax = max === 0 ? 1 : Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)));
    const stepCount = 4;
    const ticks = Array.from({ length: stepCount + 1 }, (_, i) => (niceMax / stepCount) * i);
    return { yMin: 0, yMax: niceMax || 1, ticks };
  }, [series]);

  if (dates.length === 0) {
    return <Empty description="No data in this range yet" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '32px 0' }} />;
  }

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const xFor = (i: number) => PAD.left + (dates.length === 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
  const yFor = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const linePath = (values: (number | null)[]) => {
    let d = '';
    let started = false;
    values.forEach((v, i) => {
      if (v == null) {
        started = false;
        return;
      }
      d += `${started ? 'L' : 'M'}${xFor(i)},${yFor(v)} `;
      started = true;
    });
    return d.trim();
  };

  const areaPath = (values: (number | null)[]) => {
    const line = linePath(values);
    if (!line) return '';
    const firstIdx = values.findIndex((v) => v != null);
    const lastIdx = values.length - 1 - [...values].reverse().findIndex((v) => v != null);
    return `${line} L${xFor(lastIdx)},${PAD.top + plotH} L${xFor(firstIdx)},${PAD.top + plotH} Z`;
  };

  const handleMove = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((clientX - rect.left) / rect.width) * width;
    const nearest = Math.round(((relX - PAD.left) / plotW) * (dates.length - 1));
    setHoverIndex(Math.min(Math.max(nearest, 0), dates.length - 1));
  };

  const tooltipRows = hoverIndex != null ? series.map((s) => ({ ...s, value: s.values[hoverIndex] })) : [];
  const tooltipLeft = hoverIndex != null ? (xFor(hoverIndex) / width) * 100 : 0;
  const flipTooltip = tooltipLeft > 62;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
          {series.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: INK.secondary }}>
              <span style={{ width: 12, height: 2, background: s.color, display: 'inline-block', borderRadius: 1 }} />
              {s.label}
            </div>
          ))}
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        onPointerMove={(e) => handleMove(e.clientX)}
        onPointerLeave={() => setHoverIndex(null)}
        style={{ display: 'block', touchAction: 'none' }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yFor(t)} y2={yFor(t)} stroke={INK.gridline} strokeWidth={1} />
            <text x={PAD.left - 8} y={yFor(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={INK.muted}>
              {valueFormatter(t)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke={INK.baseline} strokeWidth={1} />

        {series.map((s) =>
          s.area ? <path key={`${s.key}-area`} d={areaPath(s.values)} fill={s.color} opacity={0.1} stroke="none" /> : null,
        )}
        {series.map((s) => (
          <path key={s.key} d={linePath(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {axisLabelIndices(dates.length).map((i) => (
          <text key={i} x={xFor(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={INK.muted}>
            {dayjs(dates[i]).format('D MMM')}
          </text>
        ))}

        {hoverIndex != null && (
          <>
            <line x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={PAD.top} y2={PAD.top + plotH} stroke={INK.baseline} strokeWidth={1} />
            {series.map((s) => {
              const v = s.values[hoverIndex];
              if (v == null) return null;
              return (
                <circle key={s.key} cx={xFor(hoverIndex)} cy={yFor(v)} r={4} fill={s.color} stroke={INK.surface} strokeWidth={2} />
              );
            })}
          </>
        )}
      </svg>

      {hoverIndex != null && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: `${tooltipLeft}%`,
            transform: flipTooltip ? 'translateX(-100%)' : 'none',
            background: INK.surface,
            border: `1px solid ${INK.gridline}`,
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            padding: '8px 10px',
            fontSize: 12,
            pointerEvents: 'none',
            zIndex: 1,
            minWidth: 140,
          }}
        >
          <div style={{ color: INK.muted, marginBottom: 4 }}>{dayjs(dates[hoverIndex]).format('D MMM YYYY')}</div>
          {tooltipRows.map((row) => (
            <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: INK.secondary }}>
                <span style={{ width: 10, height: 2, background: row.color, display: 'inline-block', borderRadius: 1 }} />
                {row.label}
              </span>
              <strong style={{ color: INK.primary }}>{row.value != null ? valueFormatter(row.value) : '—'}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
