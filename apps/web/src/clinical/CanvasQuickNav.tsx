import { Button } from 'antd';

const TARGETS = [
  { label: 'Note', id: 'kw-anchor-note' },
  { label: 'Diagnosis', id: 'kw-anchor-diagnosis' },
  { label: 'Medications', id: 'kw-anchor-medications' },
  { label: 'Orders', id: 'kw-anchor-orders' },
  { label: 'Services', id: 'kw-anchor-services' },
];

/**
 * G4.5c (D-071) — the mobile quick-nav.
 *
 * On a phone the two-zone Canvas collapses to one column, so the four panels
 * that a desktop doctor reads at a glance become a long scroll. The rule the
 * Canvas is built on still holds — nothing is collapsed behind a reveal click,
 * every panel stays open — so this bar moves the viewport, it does not open
 * or close anything. Scrolling past it and reading a section directly works
 * exactly as before; this is a shortcut, not a gate.
 *
 * `scrollIntoView` is used rather than a hash link because a hash would push a
 * history entry, and C1's unsaved-note guard keys on navigation. Moving the
 * viewport must never look like leaving the record.
 */
export function CanvasQuickNav() {
  const jump = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="kw-quick-nav" aria-label="Jump to a section of this record">
      {TARGETS.map((target) => (
        <Button key={target.id} size="small" onClick={() => jump(target.id)}>
          {target.label}
        </Button>
      ))}
    </nav>
  );
}
