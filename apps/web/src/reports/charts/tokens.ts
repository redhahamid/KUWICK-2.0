// Chart design tokens for the Executive Dashboard — validated categorical
// palette (dataviz skill reference instance), used for chart series only.
// UI chrome (buttons, active states) stays on the app's own brand blue
// (design-system/tokens.ts colors.primary) so chart color never doubles as
// an interactive-affordance color.
export const SERIES = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  yellow: '#eda100',
  magenta: '#e87ba4',
  green: '#008300',
  violet: '#4a3aa7',
  red: '#e34948',
};

export const SERIES_ORDER = [
  SERIES.blue,
  SERIES.orange,
  SERIES.aqua,
  SERIES.yellow,
  SERIES.magenta,
  SERIES.green,
  SERIES.violet,
  SERIES.red,
];

export const INK = {
  primary: 'rgba(0,0,0,0.88)',
  secondary: 'rgba(0,0,0,0.65)',
  muted: 'rgba(0,0,0,0.45)',
  gridline: '#f0f0f0',
  baseline: '#d9d9d9',
  surface: '#ffffff',
};

export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatRM(value: number): string {
  return `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatRMCompact(value: number): string {
  return `RM ${formatCompact(value)}`;
}
