import { getDoctorColor, softTint } from '../calendar/doctor-color';

/**
 * THE avatar. Before the premium pass, four copies of `initialsOf` and three
 * different avatar treatments (antd Avatar, a bare `.kw-provider-avatar`
 * span with inline size overrides, and two bespoke public/flow spans)
 * rendered the same idea. One component now; the CSS sizes live under
 * `.kw-avatar` in appointment-v3.css §13.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const second = words.length > 1 ? (words[1][0] ?? '') : '';
  return `${first}${second}`.toUpperCase() || '?';
}

export interface PersonAvatarProps {
  name: string;
  /**
   * Deterministic identity colour — pass the STAFF ID for providers so the
   * avatar matches the calendar's provider colour everywhere. Omitted (a
   * patient, a guest) renders the neutral slate treatment.
   */
  colorSeed?: string | null;
  /** 'xs' is the in-card size — a 16px identity dot beside a doctor's name;
   *  'xl' is the drawer identity-header size. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function PersonAvatar({ name, colorSeed, size = 'md', className }: PersonAvatarProps) {
  const solid = colorSeed ? getDoctorColor(colorSeed) : '#475467';
  return (
    <span
      className={`kw-avatar${className ? ` ${className}` : ''}`}
      data-size={size}
      style={{ background: softTint(solid), color: solid }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
