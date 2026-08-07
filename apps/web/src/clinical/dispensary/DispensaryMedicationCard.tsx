import { Button, Checkbox, Space, Tooltip, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { KuwickStatusTag } from '../../design-system/kuwick';
import type { DispensaryMedication } from '../hooks/useDispensary';
import { dispenseStatusPresentation, isDispensable, stockPresentation } from './dispensaryPresentation';

const { Text } = Typography;

/**
 * G4.5d5b-3 — one medication, as the counter reads it.
 *
 * The card is ordered the way the work is done: WHAT the medicine is, then
 * HOW MUCH to hand over, then WHETHER the branch has it, then the actions.
 * Stock is deliberately not the headline — a dispenser looks up the medicine
 * first and the shelf second, and a card led by a red stock chip is a card
 * where the medicine name is the smallest thing on it.
 *
 * The quantity is READ ONLY, here and everywhere. It is what the doctor
 * prescribed, and there is no partial dispensing in this product: a field
 * that could be edited would be a field that could silently disagree with the
 * prescription, and the server would refuse it anyway.
 */

export interface DispensaryMedicationCardProps {
  medication: DispensaryMedication;
  /** Absent when the row cannot be selected (already dispensed, no permission). */
  selected?: boolean;
  onToggleSelect?: (prescriptionId: string, next: boolean) => void;
  onDispense?: (medication: DispensaryMedication) => void;
  onPrintLabel?: (medication: DispensaryMedication) => void;
  canDispense: boolean;
  canPrint: boolean;
}

export function DispensaryMedicationCard({
  medication,
  selected = false,
  onToggleSelect,
  onDispense,
  onPrintLabel,
  canDispense,
  canPrint,
}: DispensaryMedicationCardProps) {
  const dispensable = isDispensable(medication);
  const status = dispenseStatusPresentation(medication.status);
  const stock = stockPresentation({
    state: medication.stock.state,
    onHand: medication.stock.onHand,
    required: medication.quantity,
  });
  const dose = medication.doseUnit
    ? `${medication.doseAmount} ${medication.doseUnit}`
    : medication.doseAmount;

  return (
    <article
      className="kw-dispensary-med-card"
      data-prescription-id={medication.prescriptionId}
      data-status={medication.status}
      data-stock-state={medication.stock.state}
      data-selected={selected || undefined}
    >
      <div className="kw-dispensary-med-head">
        {dispensable && canDispense && onToggleSelect && (
          <Checkbox
            checked={selected}
            aria-label={`Select ${medication.name} for dispensing`}
            onChange={(event) => onToggleSelect(medication.prescriptionId, event.target.checked)}
          />
        )}
        <div className="kw-dispensary-med-identity">
          <h4 className="kw-dispensary-med-name">
            {medication.name}
            {medication.strength && <span className="kw-dispensary-med-strength"> {medication.strength}</span>}
          </h4>
          <Text type="secondary" className="kw-dispensary-med-directions">
            Take {dose} {medication.frequency}
            {medication.durationDays > 0 &&
              ` for ${medication.durationDays} ${medication.durationDays === 1 ? 'day' : 'days'}`}
          </Text>
        </div>
        <KuwickStatusTag tone={status.tone} label={status.label} />
      </div>

      <div className="kw-dispensary-med-facts">
        <div className="kw-dispensary-med-quantity">
          <Text type="secondary" className="kw-dispensary-med-fact-label">
            Quantity to dispense
          </Text>
          {/* Not an input. See the note at the top of this file. */}
          <div className="kw-dispensary-med-quantity-value" data-readonly="true">
            {medication.quantity}
            {medication.stock.prescriptionUnit && (
              <span className="kw-dispensary-med-unit"> {medication.stock.prescriptionUnit}</span>
            )}
          </div>
        </div>
        <div className="kw-dispensary-med-stock">
          <Text type="secondary" className="kw-dispensary-med-fact-label">
            Branch stock
          </Text>
          <KuwickStatusTag
            tone={stock.tone}
            label={stock.label}
            detail={stock.detail}
            alert={stock.tone === 'error'}
          />
        </div>
      </div>

      {medication.status === 'DISPENSED' && (
        <Text type="secondary" className="kw-dispensary-med-handover">
          Dispensed{medication.dispenserName ? ` by ${medication.dispenserName}` : ''}
          {medication.dispensedAt ? ` at ${new Date(medication.dispensedAt).toLocaleTimeString()}` : ''}
        </Text>
      )}

      <div className="kw-dispensary-med-actions">
        <Space size={8} wrap>
          {canPrint && onPrintLabel && (
            <Button
              size="small"
              icon={<PrinterOutlined />}
              onClick={() => onPrintLabel(medication)}
              aria-label={`Print label for ${medication.name}`}
            >
              {medication.labelPrintCount > 0 ? 'Reprint label' : 'Print label'}
            </Button>
          )}
          {dispensable && canDispense && onDispense && (
            <Button
              size="small"
              type="primary"
              onClick={() => onDispense(medication)}
              aria-label={`Dispense ${medication.name}`}
            >
              Dispense
            </Button>
          )}
          {dispensable && !canDispense && (
            // Shown disabled with the reason, not removed: staff who cannot
            // dispense should understand why rather than hunt for a button.
            <Tooltip title="This account may not dispense medication.">
              <Button size="small" disabled>
                Dispense
              </Button>
            </Tooltip>
          )}
        </Space>
        {medication.labelPrintCount > 0 && (
          <Text type="secondary" className="kw-dispensary-med-prints">
            {medication.labelPrintCount} label{medication.labelPrintCount === 1 ? '' : 's'} printed
          </Text>
        )}
      </div>
    </article>
  );
}
