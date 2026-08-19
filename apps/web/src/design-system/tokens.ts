import type { StatusTone } from '@kuwick/shared';

/**
 * Design tokens — see docs/UI_DESIGN_SYSTEM.md.
 *
 * G4.5d5b-1 — ONE source of truth, at last.
 *
 * There were two. This file declared a generic Ant Design blue (#1677ff) and
 * fed antd's ThemeConfig; `index.css` declared the real Kuwick palette as
 * custom properties (navy #184a6b, teal #0f766e) and then had to fight the
 * result back with `!important` overrides on every workspace surface. Any
 * component built outside those overrides came out the wrong colour, which is
 * why "raw Ant Design defaults" was a fair description of anything new.
 *
 * The values below are now the Kuwick palette itself, so antd's own
 * components come out navy without being overridden, and the CSS custom
 * properties are generated FROM these tokens rather than duplicating them.
 *
 * Deliberately NOT a repaint of every module: the palette was already the one
 * in `index.css`, so existing workspace surfaces look the same. What changes
 * is that everything else stops looking different.
 */

/**
 * The brand and semantic palette.
 *
 * Each status colour is a PAIR — foreground and background — because colour
 * alone never carries meaning (WCAG, and a colour-blind GP reading a result at
 * 7pm). Every consumer renders the word too.
 */
export const colors = {
  // --- Brand ---------------------------------------------------------------
  /** Primary action, identity. */
  primary: '#184a6b',
  primaryHover: '#123a55',
  /** The CLINICAL accent: selected state, positive clinical status. Never
   *  decoration, and never a second primary. */
  teal: '#0f766e',
  tealHover: '#0b5f59',

  // --- Semantic (foreground) ----------------------------------------------
  success: '#166534',
  /** In progress / awaiting action. */
  active: '#1d4ed8',
  /** Review required, low stock, documentation pending. */
  attention: '#92400e',
  warning: '#92400e',
  /** Blocking, unsafe, out of stock, failed. */
  error: '#b42318',
  /** Not applicable, not chargeable, inactive. */
  neutral: '#475467',

  // --- Semantic (background) ----------------------------------------------
  successBg: '#dcfce7',
  activeBg: '#dbeafe',
  attentionBg: '#fef3c7',
  warningBg: '#fef3c7',
  errorBg: '#fee4e2',
  neutralBg: '#f2f4f7',
  /** In the building: waiting, checked in, in consultation. The clinical
   *  teal worn softly — the state a receptionist scans the room for. */
  clinical: '#0f766e',
  clinicalBg: '#eaf5f6',
  /** Asked-for but not yet real: requests, planned leave. */
  planned: '#6941c6',
  plannedBg: '#f4ebff',

  // --- Semantic (base hue, for antd's own derivation) ----------------------
  /**
   * G4.5d5b-3 — the mid-tone each semantic colour is BUILT from.
   *
   * The foreground values above are deliberately dark, because they are read
   * as text on a pale chip. Handing those same values to antd as its base
   * `colorWarning` / `colorSuccess` was a mistake: antd derives a whole ramp
   * from the base — border, background, hover — and deriving a background
   * from a near-brown #92400e produced the muddy tan every warning Alert in
   * the application was rendering as.
   *
   * So antd gets the hue at its natural mid saturation and derives a sensible
   * pale background from it; KuwickStatusTag keeps using the explicit fg/bg
   * pair above, where the contrast has actually been chosen rather than
   * calculated.
   */
  successBase: '#16a34a',
  warningBase: '#d97706',
  attentionBase: '#d97706',
  errorBase: '#dc2626',

  // --- Surfaces ------------------------------------------------------------
  pageBg: '#f4f7fa',
  card: '#ffffff',
  railBg: '#f8fafc',
  border: '#dce4ea',
  text: '#17212b',
  textSecondary: '#667085',
  textMuted: '#98a2b3',
} as const;

/** 4 / 8 / 12 / 16 / 24 / 32 / 48 — nothing between. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const breakpoints = {
  mobile: 768,
  tablet: 1200,
} as const;

/**
 * G4.5d5b-1 — the shared modal size ladder.
 *
 * Declared here rather than typed into each call site, because "roughly 700"
 * written twenty times is how twenty different widths appear. Tablet and
 * mobile behaviour is handled by KuwickModal itself.
 */
export const modalWidths = {
  small: 560,
  medium: 760,
  large: 900,
} as const;

export type ModalSize = keyof typeof modalWidths;

export type { StatusTone };

/**
 * The semantic status groups, as the owner approved them.
 *
 * A tone is chosen by MEANING, never by how alarming it should look — that is
 * how red came to mean both "you cannot proceed" and "you have not finished
 * writing", after which a doctor reads neither.
 *
 *   success   completed, resolved, dispensed, in stock
 *   active    in progress, awaiting action
 *   attention review required, low stock, documentation pending
 *   warning   an alias of attention, kept because `@kuwick/shared` already
 *             maps several lifecycle enums to it; the two render identically
 *             on purpose rather than inventing a sixth colour
 *   error     blocking, unsafe, out of stock, failed
 *   neutral   not applicable, not chargeable, inactive
 *
 * The tone union is REUSED from `@kuwick/shared` rather than redeclared, so a
 * status mapping written for the appointment or procurement lifecycle can be
 * handed straight to KuwickStatusTag.
 */
export const statusPalette: Record<StatusTone, { fg: string; bg: string }> = {
  success: { fg: colors.success, bg: colors.successBg },
  active: { fg: colors.active, bg: colors.activeBg },
  attention: { fg: colors.attention, bg: colors.attentionBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  error: { fg: colors.error, bg: colors.errorBg },
  neutral: { fg: colors.neutral, bg: colors.neutralBg },
  clinical: { fg: colors.clinical, bg: colors.clinicalBg },
  planned: { fg: colors.planned, bg: colors.plannedBg },
};
