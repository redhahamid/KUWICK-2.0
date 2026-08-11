import { Alert, Button, Empty, Space, Typography } from 'antd';
import { CheckCircleFilled, ExclamationCircleFilled, PrinterOutlined } from '@ant-design/icons';
import { KuwickStatusTag } from '../../design-system/kuwick';
import { ClinicalDocument } from '../types';
import { documentLabel } from '../documents/documentPresentation';
import {
  BillingSummary,
  CounterLine,
  PaymentState,
  money,
  panelReceivableLine,
} from './counterPresentation';

const { Text } = Typography;

/**
 * G4.5d5c — the counter's other three sections.
 *
 * Documents, payment and the completion check live in the SAME selected-patient
 * workspace as the medicines. Before this, printing an MC meant going back to
 * the Doctor Canvas and taking payment meant Queue → Payment tab → Billing
 * Review → find the patient again, which is four navigations to finish one
 * person standing at the counter.
 *
 * None of this is a second billing engine. The payment section renders what the
 * invoice API returned and calls the invoice API to settle it; responsibility
 * splitting stays where it already lives.
 */

// ---------------------------------------------------------------------------

export function CounterDocuments({
  documents,
  loading,
  onView,
  onPrint,
}: {
  documents: ClinicalDocument[];
  loading?: boolean;
  onView: (doc: ClinicalDocument) => void;
  onPrint: (doc: ClinicalDocument) => void;
}) {
  return (
    <section className="kw-counter-section" aria-label="Visit documents">
      <header className="kw-counter-section-head">
        <h4>Documents</h4>
        {documents.length > 0 && <Text type="secondary">{documents.length} issued</Text>}
      </header>
      {loading && <Text type="secondary">Loading documents…</Text>}
      {!loading && documents.length === 0 && (
        <Text type="secondary" className="kw-counter-empty-line">
          No documents were issued for this visit.
        </Text>
      )}
      {!loading && documents.length > 0 && (
        <ul className="kw-counter-doc-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <div className="kw-counter-doc-identity">
                <Text strong>{documentLabel(doc)}</Text>
                {doc.issuedDate && (
                  <Text type="secondary">{new Date(doc.issuedDate).toLocaleDateString()}</Text>
                )}
              </div>
              <Space size={6}>
                <Button size="small" onClick={() => onView(doc)} aria-label={`View ${documentLabel(doc)}`}>
                  View
                </Button>
                <Button
                  size="small"
                  icon={<PrinterOutlined />}
                  onClick={() => onPrint(doc)}
                  aria-label={`Print ${documentLabel(doc)}`}
                >
                  Print
                </Button>
              </Space>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'CARD', label: 'Card' },
  { key: 'QR', label: 'QR' },
  { key: 'BANK_TRANSFER', label: 'Bank Transfer' },
] as const;

export function CounterPayment({
  billing,
  state,
  method,
  onMethod,
  onCollect,
  collecting,
  canCollect,
  error,
}: {
  billing: BillingSummary | null;
  state: PaymentState;
  method: string;
  onMethod: (method: string) => void;
  onCollect: () => void;
  collecting?: boolean;
  canCollect: boolean;
  error?: string | null;
}) {
  const receivable = panelReceivableLine(billing);
  const payable = billing?.patientResponsibility;

  return (
    <section className="kw-counter-section" aria-label="Payment">
      <header className="kw-counter-section-head">
        <h4>Payment</h4>
      </header>

      {state === 'NO_INVOICE' && (
        <Alert
          type="warning"
          showIcon
          message="No invoice has been raised for this visit yet"
          description="Raise it in Billing Review before collecting payment."
        />
      )}

      {state !== 'NO_INVOICE' && (
        <>
          <dl className="kw-counter-money">
            <div>
              <dt>Total</dt>
              <dd>{money(billing?.grandTotal)}</dd>
            </div>
            {Number(billing?.panelResponsibility ?? 0) > 0 && (
              <div>
                <dt>Panel</dt>
                <dd>{money(billing?.panelResponsibility)}</dd>
              </div>
            )}
            <div className="kw-counter-money-payable">
              <dt>Patient payable</dt>
              <dd>{money(payable)}</dd>
            </div>
          </dl>

          {state === 'OUTSTANDING' && (
            <>
              <div className="kw-counter-methods" role="group" aria-label="Payment method">
                {PAYMENT_METHODS.map((m) => (
                  <Button
                    key={m.key}
                    type={method === m.key ? 'primary' : 'default'}
                    onClick={() => onMethod(m.key)}
                    aria-pressed={method === m.key}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
              {error && <Alert type="error" showIcon message={error} style={{ marginTop: 8 }} />}
              <Button
                type="primary"
                size="large"
                block
                loading={collecting}
                disabled={!canCollect}
                onClick={onCollect}
                className="kw-counter-collect"
              >
                Collect {money(billing?.remainingBalance ?? payable)}
              </Button>
              {!canCollect && (
                <Text type="secondary" className="kw-counter-empty-line">
                  This account may not record a payment.
                </Text>
              )}
            </>
          )}

          {state === 'SETTLED' && (
            <div className="kw-counter-settled" role="status">
              <CheckCircleFilled aria-hidden /> <Text strong>Payment settled</Text>
            </div>
          )}

          {state === 'NOT_REQUIRED' && (
            <div className="kw-counter-settled" role="status">
              <CheckCircleFilled aria-hidden /> <Text strong>No patient payment required</Text>
            </div>
          )}

          {/* Stated separately, and never as "paid". A panel receivable is money
              the clinic still has to claim; folding it into a settled tick is
              how it silently gets written off. */}
          {receivable && (
            <Text type="secondary" className="kw-counter-receivable">
              {receivable} — claimed from the panel, not collected here
            </Text>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export function CounterCheck({
  lines,
  reasons,
}: {
  lines: CounterLine[];
  reasons: string[];
}) {
  return (
    <section className="kw-counter-check" aria-label="Counter check">
      <header className="kw-counter-section-head">
        <h4>Counter check</h4>
      </header>
      <ul>
        {lines.map((line) => (
          <li key={line.label} data-done={line.done || undefined}>
            {line.done ? (
              <CheckCircleFilled aria-hidden className="kw-counter-tick" />
            ) : (
              <ExclamationCircleFilled aria-hidden className="kw-counter-cross" />
            )}
            <span>{line.label}</span>
          </li>
        ))}
        {/* Server blockers are listed in the SAME list and in the same words the
            server used. A disabled button with no reason is what sent staff
            back to the Queue to guess. */}
        {reasons.map((reason) => (
          <li key={reason}>
            <ExclamationCircleFilled aria-hidden className="kw-counter-cross" />
            <span>{reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CounterStatusStrip({ lines }: { lines: CounterLine[] }) {
  return (
    <div className="kw-counter-strip">
      {lines.map((line) => (
        <KuwickStatusTag key={line.label} tone={line.tone} label={line.label} />
      ))}
    </div>
  );
}

export { Empty };
