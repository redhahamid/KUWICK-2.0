import type { ReactNode } from 'react';
import type { TileTone } from '../tokens';

/**
 * THE ICON TILE — the gradient square beside a card title in the canvas
 * design (October 2026): Visits in indigo, Vitals in rose, Consultation notes
 * in amber, Medications in green, and so on across the clinical workspace,
 * the HR module and the portal.
 *
 * Decorative, and hidden from assistive technology: the title beside it is
 * what says what the card is, so a tile that fails to render costs nothing a
 * reader needs. The gradients are declared once, in `tokens.ts`
 * (`tileGradients`) and `index.css` (`--kw-c-tile-*`); this component only
 * picks one by name.
 */
export function IconTile({
  tone,
  size = 'md',
  children,
  className,
}: {
  tone: TileTone;
  /** `sm` sits inside a one-line card header without making it taller. */
  size?: 'md' | 'sm';
  children: ReactNode;
  className?: string;
}) {
  const classes = ['kw-tile', `kw-tile--${tone}`, size === 'sm' ? 'kw-tile--sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} aria-hidden="true">
      {children}
    </span>
  );
}
