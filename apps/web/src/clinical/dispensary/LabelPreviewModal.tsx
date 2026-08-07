import { Alert, Button, Empty, Radio, Spin, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { KuwickModal, KuwickModalActionBar } from '../../design-system/kuwick';
import type { LabelHistoryEntry, LabelPayload } from '../hooks/useDispensary';
import { LABEL_PRESET, MAX_LABEL_COPIES, buildLabelLayout } from './labelPrint';

const { Text } = Typography;

/**
 * G4.5d5b-3 — the label, before it is printed.
 *
 * The preview is the label at its real proportions rather than a paragraph of
 * text in a dialog, because the thing being checked is whether the medicine
 * name and the directions fit and are legible at 70 × 40 mm. A preview that
 * looks nothing like the output cannot answer that.
 *
 * The order of operations is deliberate: the SERVER assembles and audits the
 * label first, and only then is there anything to preview. There is no
 * client-composed draft shown before the record has been read — that is
 * precisely the arrangement this checkpoint removed.
 *
 * PRINT LABEL IS NOT DISPENSE. Printing writes one audit row and nothing
 * else: no stock movement, no status change, no queue movement, no invoice
 * line, no payment, no visit completion. That is enforced on the server; this
 * dialog simply never offers to do any of it.
 */

export interface LabelPreviewModalProps {
  open: boolean;
  /** Null while the server is still assembling. */
  payload: LabelPayload | null;
  copies: number;
  onCopiesChange: (copies: number) => void;
  history: LabelHistoryEntry[];
  historyLoading?: boolean;
  loading?: boolean;
  error?: string | null;
  onPrint: () => void;
  onReprint: () => void;
  onClose: () => void;
}

export function LabelPreviewModal({
  open,
  payload,
  copies,
  onCopiesChange,
  history,
  historyLoading = false,
  loading = false,
  error = null,
  onPrint,
  onReprint,
  onClose,
}: LabelPreviewModalProps) {
  const alreadyPrinted = history.length > 0;

  return (
    <KuwickModal
      open={open}
      size="medium"
      title="Medication label"
      subtitle={
        payload
          ? `${payload.patient.name} · ${payload.medication.name}`
          : 'Assembling the label from the prescription'
      }
      loading={loading}
      error={error}
      onClose={onClose}
      dataTestId="label-preview-modal"
      footer={
        <KuwickModalActionBar
          cancel={<Button onClick={onClose}>Close</Button>}
          secondary={
            alreadyPrinted ? (
              <Button icon={<PrinterOutlined />} onClick={onReprint} disabled={!payload || loading}>
                Reprint
              </Button>
            ) : undefined
          }
          primary={
            <Button
              type="primary"
              icon={<PrinterOutlined />}
              onClick={onPrint}
              disabled={!payload || loading}
            >
              Print
            </Button>
          }
        />
      }
    >
      {loading && !payload && (
        <div className="kw-label-loading">
          <Spin /> <Text type="secondary">Reading the prescription…</Text>
        </div>
      )}

      {payload && (
        <>
          <div className="kw-label-copies">
            <Text type="secondary">Copies</Text>
            <Radio.Group
              value={copies}
              onChange={(event) => onCopiesChange(event.target.value as number)}
              optionType="button"
              buttonStyle="solid"
              // Bounded at three to match the server, which refuses more.
              options={Array.from({ length: MAX_LABEL_COPIES }, (_, index) => ({
                label: String(index + 1),
                value: index + 1,
              }))}
            />
            <Text type="secondary" className="kw-label-preset-note">
              {LABEL_PRESET.widthMm} × {LABEL_PRESET.heightMm} mm ({LABEL_PRESET.format})
            </Text>
          </div>

          {/* The sheet the print stylesheet shows. Rendered here rather than
              in a hidden corner of the page so what is checked is what is
              printed. */}
          <div className="kw-label-sheet" data-testid="label-sheet">
            {Array.from({ length: copies }, (_, index) => (
              <LabelFace key={index} payload={payload} />
            ))}
          </div>

          <Alert
            type="info"
            showIcon
            className="kw-label-print-note"
            message="Printing does not dispense"
            description="This prints a label and records that it was printed. It does not move stock, change the prescription, move the patient in the queue or touch the invoice."
          />

          <div className="kw-label-history">
            <Text strong>Print history</Text>
            {historyLoading && <Spin size="small" />}
            {!historyLoading && history.length === 0 && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="This label has not been printed yet." />
            )}
            {!historyLoading && history.length > 0 && (
              <ul className="kw-label-history-list">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <Text>
                      #{entry.printSequence} · {entry.copies} cop{entry.copies === 1 ? 'y' : 'ies'}
                      {entry.isReprint ? ' · reprint' : ''}
                    </Text>
                    <Text type="secondary">
                      {entry.printedByName} · {new Date(entry.printedAt).toLocaleString()}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </KuwickModal>
  );
}

/**
 * One physical label.
 *
 * Every string here comes from the server-assembled payload. Nothing is
 * derived, translated or supplemented: no generic name, no dosage form, no
 * route, no warning symbol and no barcode, because the schema holds none of
 * them and a label that invents them is worse than a label that omits them.
 */
function LabelFace({ payload }: { payload: LabelPayload }) {
  const layout = buildLabelLayout(payload);
  return (
    <div
      className="kw-label"
      style={{ width: `${LABEL_PRESET.widthMm}mm`, height: `${LABEL_PRESET.heightMm}mm` }}
    >
      <div className="kw-label-header">
        <span className="kw-label-clinic">{layout.header}</span>
        {layout.reprintNotice && <span className="kw-label-reprint">{layout.reprintNotice}</span>}
      </div>
      {/* Name and identifier on separate lines. Inline with a separator reads
          fine until a real Malaysian full name wraps, and a label whose first
          line ends in a dangling "·" is one somebody has to re-read. */}
      <div className="kw-label-patient">{layout.patient}</div>
      {layout.patientIdentifier && <div className="kw-label-nric">{layout.patientIdentifier}</div>}
      <div className="kw-label-medication">{layout.medication}</div>
      <div className="kw-label-directions">{layout.directions}</div>
      <div className="kw-label-quantity">{layout.quantity}</div>
      {layout.extras.map((line) => (
        <div key={line.label} className="kw-label-extra">
          <span className="kw-label-extra-label">{line.label}:</span> {line.value}
        </div>
      ))}
      <div className="kw-label-footer">
        {layout.footer.map((line) => (
          <span key={line.label}>
            {line.label}: {line.value}
          </span>
        ))}
      </div>
    </div>
  );
}
