import { MouseEvent } from 'react';
import { Button } from 'antd';

// Short labels exist for the two names that crowd a 390px row. The FULL name
// stays the accessible name on every button — assistive tech always hears
// "Medications", never "Meds".
const TARGETS = [
  { label: 'Note', short: null, id: 'kw-anchor-note' },
  { label: 'Diagnosis', short: 'Dx', id: 'kw-anchor-diagnosis' },
  { label: 'Medications', short: 'Meds', id: 'kw-anchor-medications' },
  { label: 'Orders', short: null, id: 'kw-anchor-orders' },
  { label: 'Services', short: null, id: 'kw-anchor-services' },
];

/**
 * G4.5c (D-071) — the mobile quick-nav.
 *
 * On a phone the two-zone Canvas collapses to one column, so the five
 * surfaces become a long scroll. This bar moves the viewport, it does not
 * open or close anything — every panel stays open at every width.
 *
 * `scrollIntoView` is used rather than a hash link because a hash would push a
 * history entry, and C1's unsaved-note guard keys on navigation. Moving the
 * viewport must never look like leaving the record.
 *
 * G4.5d3c-3a1 (D-091) — the row scrolls horizontally when it must, and says
 * so: a right-edge fade (CSS) marks that more tabs exist, and a tapped tab
 * scrolls itself fully into view instead of staying half-clipped at the
 * edge, which read as broken layout rather than as an overflow.
 */
export function CanvasQuickNav() {
  const jump = (id: string, event: MouseEvent<HTMLElement>) => {
    // The tapped tab first — fully visible in the bar, so the doctor can see
    // what they chose. `nearest` keeps this a no-op when it already is.
    event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="kw-quick-nav" aria-label="Jump to a section of this record">
      {TARGETS.map((target) => (
        <Button
          key={target.id}
          size="small"
          aria-label={target.label}
          onClick={(event) => jump(target.id, event)}
        >
          {target.short ? (
            <>
              {/* CSS swaps which span shows; the aria-label above never changes. */}
              <span className="kw-qn-full" aria-hidden>
                {target.label}
              </span>
              <span className="kw-qn-short" aria-hidden>
                {target.short}
              </span>
            </>
          ) : (
            target.label
          )}
        </Button>
      ))}
    </nav>
  );
}
