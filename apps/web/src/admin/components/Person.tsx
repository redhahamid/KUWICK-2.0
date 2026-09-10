import { ReactNode } from 'react';
import { Avatar } from 'antd';

/**
 * SOMEBODY'S IDENTITY, rendered the same way everywhere.
 *
 * The directory, the payroll register, the payroll drawer, the leave queue,
 * the claims queue and the attendance sheet all show a person, and before this
 * existed each one drew them differently — a name in a cell here, an avatar
 * plus two lines there. The reference sheet's strongest single instruction is
 * that "employee identity is the visual anchor", and an anchor that changes
 * shape between screens is not one.
 */
export function initials(name: string): string {
  return (
    name
      // "Dr Nurul (Locum)" — a parenthetical is a note about the engagement,
      // not part of what somebody is called, and "DN" beats "DL".
      .replace(/\(.*?\)/g, '')
      .split(/\s+/)
      .filter((part) => /^[A-Za-z]/.test(part))
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/**
 * A DETERMINISTIC TINT PER PERSON.
 *
 * Not decoration: in a 40-row register scrolled sideways, the frozen name
 * column is the only thing telling the reader which row they are on, and a
 * stable colour per person is read faster than two letters. Deterministic from
 * the name so the same person is the same colour on every screen and after
 * every reload.
 *
 * Six low-saturation tints — deliberately quiet, because the brief's warning
 * about "colourful SaaS-dashboard clutter" applies most where the colour is
 * repeated once per row.
 */
const TINTS = [
  { bg: '#e8eef5', fg: '#3a5570' },
  { bg: '#e6f1f0', fg: '#2f6560' },
  { bg: '#f0ecf6', fg: '#59477a' },
  { bg: '#f5edea', fg: '#7a5145' },
  { bg: '#e9f0e9', fg: '#42603f' },
  { bg: '#f2eee4', fg: '#6b5c33' },
];

export function personTint(name: string): { bg: string; fg: string } {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export function PersonAvatar({ name, size = 30, src }: { name: string; size?: number; src?: string | null }) {
  const tint = personTint(name);
  return (
    <Avatar
      size={size}
      src={src || undefined}
      className="kw-person__avatar"
      style={{ background: tint.bg, color: tint.fg, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {initials(name)}
    </Avatar>
  );
}

/**
 * Name over one secondary line, beside a face.
 *
 * `meta` is the line that identifies the person in THIS context — their
 * position in the directory, their employee number on the register, the leave
 * type in the leave queue. One line, never two: the reference sheet's density
 * comes from a cell being one visual object.
 */
export function PersonCell({
  name,
  meta,
  size = 30,
  src,
  trailing,
}: {
  name: ReactNode;
  meta?: ReactNode;
  size?: number;
  src?: string | null;
  trailing?: ReactNode;
}) {
  return (
    <div className="kw-person">
      <PersonAvatar name={typeof name === 'string' ? name : String(name ?? '')} size={size} src={src} />
      <div className="kw-person__text">
        <span className="kw-person__name">{name}</span>
        {meta ? <span className="kw-person__meta">{meta}</span> : null}
      </div>
      {trailing ? <div className="kw-person__trailing">{trailing}</div> : null}
    </div>
  );
}
