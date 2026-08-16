import { Visit } from '../types';
import { DiagnosisRail } from './DiagnosisRail';
import { MedicationsRail } from './MedicationsRail';
import { OrdersRail } from './OrdersRail';
import { ServicesRail } from './ServicesRail';

interface ClinicalRailProps {
  visit: Visit;
}

/**
 * G4.5a–c (D-071) — the clinical action rail, beside the note.
 *
 * The four things a doctor DOES during a consultation, out from under the
 * note and next to it, so documenting and prescribing are visible together
 * instead of separated by a scroll.
 *
 * Every panel is always open. There is no toggle state left in this file:
 * with G4.5b and G4.5c the last collapsible section is gone, so a doctor
 * reaches the record and can already see the diagnoses, the prescription,
 * the outstanding investigations and the services on the bill.
 *
 * Order is clinical, not alphabetical — what you conclude, what you give,
 * what you send away for, what you charge.
 */
export function ClinicalRail({ visit }: ClinicalRailProps) {
  return (
    <div className="kw-clinical-rail">
      <DiagnosisRail visitId={visit.id} />
      <MedicationsRail visitId={visit.id} />
      <OrdersRail visitId={visit.id} clinicId={visit.clinicId} />
      <ServicesRail visitId={visit.id} />
    </div>
  );
}
