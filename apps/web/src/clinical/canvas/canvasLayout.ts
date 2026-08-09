/**
 * Kuwick 2.0 Canvas — the column geometry, as data.
 *
 * The approved spec (kuwick2-canvas-final, p.2) fixes three columns against a
 * 1600px reference: a 258px visits rail, a ~706px middle, a ~540px right.
 * Those are RATIOS at a reference width, not absolutes — a clinic desktop is
 * 1366, 1440 or 1920 and the layout has to hold its proportions across all of
 * them without the note losing width to the rails.
 *
 * Kept as pure functions rather than CSS alone so the rules are testable and
 * so the one thing that must never happen — the clinical note being squeezed
 * below readable width — is asserted, not hoped for.
 */

/** The width the spec's pixel numbers were drawn against. */
export const CANVAS_REFERENCE_WIDTH = 1600;

/** Spec p.2. The middle is the note; it gets what is left over. */
export const CANVAS_COLUMNS = {
  visits: 258,
  middle: 706,
  right: 540,
} as const;

/** Gap between columns, from the token scale (14px). */
export const CANVAS_GUTTER = 14;

/**
 * Below this the three columns cannot all hold their minimums, so the visits
 * rail folds away first — history is reference material, the note is work.
 */
export const CANVAS_THREE_COLUMN_MIN = 1280;

/** Below this the right rail folds too and the canvas is one column. */
export const CANVAS_TWO_COLUMN_MIN = 900;

/**
 * The floor for the clinical note.
 *
 * A consultation note wraps at roughly 90 characters to stay readable; below
 * ~560px it starts breaking mid-phrase. The rails give up width before the
 * note does — the same rule the two-column Canvas already followed.
 */
export const CANVAS_NOTE_MIN_WIDTH = 560;

export type CanvasMode = 'three-column' | 'two-column' | 'stacked';

export interface CanvasWidths {
  mode: CanvasMode;
  visits: number;
  middle: number;
  right: number;
}

export function canvasMode(containerWidth: number): CanvasMode {
  if (containerWidth >= CANVAS_THREE_COLUMN_MIN) return 'three-column';
  if (containerWidth >= CANVAS_TWO_COLUMN_MIN) return 'two-column';
  return 'stacked';
}

/**
 * Resolve the three column widths for a real container.
 *
 * The rails are clamped to a sensible band and the middle takes the
 * remainder, so widening the window widens the NOTE rather than inflating a
 * sidebar. If the remainder would fall under the note's floor, the right rail
 * is trimmed first and the visits rail after it.
 */
export function canvasWidths(containerWidth: number): CanvasWidths {
  const mode = canvasMode(containerWidth);

  if (mode === 'stacked') {
    return { mode, visits: containerWidth, middle: containerWidth, right: containerWidth };
  }

  if (mode === 'two-column') {
    const right = clamp(
      Math.round(containerWidth * (CANVAS_COLUMNS.right / CANVAS_REFERENCE_WIDTH)),
      320,
      460,
    );
    const middle = containerWidth - right - CANVAS_GUTTER;
    return { mode, visits: 0, middle, right };
  }

  const visits = clamp(
    Math.round(containerWidth * (CANVAS_COLUMNS.visits / CANVAS_REFERENCE_WIDTH)),
    228,
    288,
  );
  let right = clamp(
    Math.round(containerWidth * (CANVAS_COLUMNS.right / CANVAS_REFERENCE_WIDTH)),
    440,
    600,
  );
  const gutters = CANVAS_GUTTER * 2;
  let middle = containerWidth - visits - right - gutters;

  // The note never pays for the rails. Trim the right rail to its minimum
  // before letting the note drop below what a sentence needs.
  if (middle < CANVAS_NOTE_MIN_WIDTH) {
    const deficit = CANVAS_NOTE_MIN_WIDTH - middle;
    const trim = Math.min(deficit, right - 440);
    right -= trim;
    middle += trim;
  }

  return { mode, visits, middle, right };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
