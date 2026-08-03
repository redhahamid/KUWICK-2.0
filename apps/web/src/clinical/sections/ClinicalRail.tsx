import { useState } from 'react';
import { Visit } from '../types';
import { DiagnosisRail } from './DiagnosisRail';
import { OrdersSection } from './OrdersSection';
import { MedicationsRail } from './MedicationsRail';

type RailKey = 'orders';

interface ClinicalRailProps {
  visit: Visit;
}

/**
 * G4.5a (D-071) — the clinical action rail, beside the note.
 *
 * This is the structural half of the change: the four things a doctor DOES
 * during a consultation move out from under the note and sit next to it, so
 * documenting and prescribing are visible together instead of separated by a
 * scroll. Diagnosis, Medications, Orders and Services all live here.
 *
 * In G4.5a the panels are still the existing collapsible sections — the
 * layout moves first, deliberately, so the shell can be reviewed on its own.
 * G4.5b and G4.5c replace them with always-open panels that need no reveal
 * click; nothing below this file changes when they do.
 */
export function ClinicalRail({ visit }: ClinicalRailProps) {
  const [open, setOpen] = useState<Set<RailKey>>(new Set());

  const toggle = (key: RailKey) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="kw-clinical-rail">
      <DiagnosisRail visitId={visit.id} />
      <MedicationsRail visitId={visit.id} />
      <OrdersSection visitId={visit.id} expanded={open.has('orders')} onToggle={() => toggle('orders')} />
    </div>
  );
}
