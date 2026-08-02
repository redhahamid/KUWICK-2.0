import { DocumentsWorkspace } from './documents/DocumentsWorkspace';
import { Visit } from './types';

interface DocumentsTabProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
}

/**
 * G3b — DocumentsTab is now the thin entry point onto one workspace.
 *
 * Three surfaces render documents: the Canvas section, the Flow layout's tab,
 * and the patient dashboard. They previously all rendered this file's own
 * form-plus-list. Keeping the implementation in one place is the same rule
 * G2 closure applied to diagnosis removal — a second copy is how one surface
 * quietly keeps an old, unsafe action after the other is fixed.
 */
export function DocumentsTab({ visit, patientName, patientIdentifier }: DocumentsTabProps) {
  return (
    <DocumentsWorkspace visit={visit} patientName={patientName} patientIdentifier={patientIdentifier} />
  );
}
