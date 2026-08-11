import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Empty, Result, Select, Space, Spin, Typography, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { ApiError } from '../../core/api-client';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useMediaQuery } from '../../core/hooks/useMediaQuery';
import { KuwickStatusTag } from '../../design-system/kuwick';
import {
  DispensaryMedication,
  LabelPayload,
  useDispensaryBoard,
  useDispenseMedications,
  useLabelHistory,
  useLabelPreview,
  usePrintLabel,
} from '../hooks/useDispensary';
import { DispensaryMedicationCard } from './DispensaryMedicationCard';
import { DispensaryPatientList, ListFilter } from './DispensaryPatientList';
import { ConfirmDispenseModal } from './ConfirmDispenseModal';
import { CounterCheck, CounterDocuments, CounterPayment } from './CounterSections';
import { DocumentPreviewDrawer } from '../documents/DocumentPreviewDrawer';
import { documentLabel } from '../documents/documentPresentation';
import { printTextDocument } from '../printTextDocument';
import { ClinicalDocument, PaymentMethod } from '../types';
import { LabelPreviewModal } from './LabelPreviewModal';
import {
  EMPTY_BOARD_TEXT,
  VISIT_MOVED_TEXT,
  dispenseSummaryText,
  progressText,
  waitingText,
} from './dispensaryPresentation';
import {
  BillingSummary,
  medicationLine,
  medicationState,
  money,
  paymentLine,
  paymentState,
  primaryAction,
} from './counterPresentation';
import { useCompletionBlockers, useInvoices, usePayInvoice } from '../hooks/useInvoices';
import { useDocuments } from '../hooks/useDocuments';
import { useCompleteVisit } from '../hooks/useQueueTickets';
import { printLabelSheet } from './labelPrint';

const { Text, Title } = Typography;

/**
 * G4.5d5c — THE COUNTER. One patient, one screen, start to finish.
 *
 * UAT found the workflow fragmented across five surfaces: a Queue tab, this
 * workspace, a per-row Dispense, a Dispense Selected, and then a hand-off to
 * Billing Review. Serving one patient meant understanding Kuwick's module
 * boundaries. It now reads the way the counter actually works —
 *
 *   open patient → prepare and label → take money → hand over → finish
 *
 * — with everything for that patient on this screen: medicines, documents,
 * payment and completion.
 *
 * TWO INDEPENDENT OBLIGATIONS, NOT A SEQUENCE. Some clinics take the money
 * before the bag leaves the counter and some after. Medication state and
 * payment state are tracked separately and either may be satisfied first; the
 * primary action simply becomes whichever is still open.
 *
 * NO SECOND ENGINE. Payment renders what the invoice API returned and calls
 * the invoice API to settle it. Dispensing calls the same atomic, audited
 * server transaction as before. Completion eligibility is the server's answer,
 * quoted verbatim. This screen composes; it does not decide.
 *
 * The list pane stays ONE query for the whole board. Only the SELECTED
 * patient's invoice, documents and blockers are fetched, so a busy board is
 * still three requests and not three per row.
 */
export function DispensaryPage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const [searchParams, setSearchParams] = useSearchParams();
  const board = useDispensaryBoard(clinicId);
  const dispense = useDispenseMedications(clinicId);
  const printLabel = usePrintLabel();
  const isDesktop = useMediaQuery('(min-width: 992px)');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ListFilter>('ALL');
  const [confirmingDispense, setConfirmingDispense] = useState(false);
  // Typed against the invoice API's own union, so an unsupported method
  // cannot reach the payment call.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [previewingDocument, setPreviewingDocument] = useState<ClinicalDocument | null>(null);
  const [labelTarget, setLabelTarget] = useState<DispensaryMedication | null>(null);
  const [labelCopies, setLabelCopies] = useState(1);
  /** Set only once a print has been RECORDED; replaces the preview on screen. */
  const [printedPayload, setPrintedPayload] = useState<LabelPayload | null>(null);

  // The deep link IS the selection. /dispensary?visitId=… must open on that
  // patient, and choosing a patient must produce a link a colleague can be
  // sent — a workspace whose state lives only in memory cannot be handed over
  // across a counter, which is exactly what happens here all day.
  const selectedVisitId = searchParams.get('visitId');
  const rows = board.data?.rows ?? [];
  const selectedRow = rows.find((row) => row.visitId === selectedVisitId) ?? null;
  const permissions = board.data?.permissions;
  const canDispense = Boolean(permissions?.DISPENSE_MEDICATION);
  const canPrint = Boolean(permissions?.PRINT_LABEL);

  const selectVisit = useCallback(
    (visitId: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (visitId) next.set('visitId', visitId);
      else next.delete('visitId');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Per-patient counter state resets with the patient. A payment method or a
  // half-open confirmation carried across patients is a mis-post waiting to
  // happen.
  useEffect(() => {
    setConfirmingDispense(false);
    setPaymentMethod('CASH');
  }, [selectedVisitId]);

  // --- The SELECTED patient's counter data -------------------------------
  //
  // Three requests for one visit, never three per row: the board pane stays a
  // single query however many patients are waiting.
  const invoices = useInvoices(selectedVisitId ?? undefined);
  const documents = useDocuments(selectedVisitId ?? undefined);
  const blockers = useCompletionBlockers(selectedVisitId ?? undefined);
  const payInvoice = usePayInvoice(selectedVisitId ?? undefined);
  const completeVisit = useCompleteVisit();

  const invoice = (invoices.data ?? [])[0] ?? null;
  const billing: BillingSummary | null = invoice
    ? {
        grandTotal: (invoice as Record<string, any>).grandTotal ?? null,
        panelResponsibility: (invoice as Record<string, any>).panelResponsibilityAmount ?? null,
        patientResponsibility: (invoice as Record<string, any>).patientResponsibilityAmount ?? null,
        remainingBalance: (invoice as Record<string, any>).remainingBalance ?? null,
        invoiceId: (invoice as Record<string, any>).id ?? null,
        status: (invoice as Record<string, any>).status ?? null,
      }
    : null;

  // Nothing is auto-selected. On a busy board the first row changes as people
  // are served, and a workspace that quietly re-points at somebody else while
  // a dispenser is reading is how the wrong medicine gets counted.

  const labelPreview = useLabelPreview(labelTarget?.prescriptionId);
  const labelHistory = useLabelHistory(labelTarget?.prescriptionId, Boolean(labelTarget));

  /** Everything still to hand over for this visit — the whole bag, at once. */
  const outstandingMedications = useMemo(
    () => (selectedRow?.medications ?? []).filter((m) => m.status === 'ORDERED'),
    [selectedRow],
  );

  const medState = medicationState(selectedRow?.medications ?? []);
  const payState = paymentState(billing);
  const serverBlockers = blockers.data ?? [];
  const action = primaryAction({
    medication: medState,
    payment: payState,
    serverBlockers,
    completed: Boolean(selectedRow?.queueStatus === 'COMPLETED'),
  });
  const checkLines = [
    medicationLine(medState, selectedRow?.counts ?? { total: 0, remaining: 0 }),
    paymentLine(payState, billing),
  ];

  const runDispense = async (acknowledgeStockWarning: boolean) => {
    if (!selectedRow) return;
    try {
      const result = await dispense.mutateAsync({
        visitId: selectedRow.visitId,
        prescriptionIds: outstandingMedications.map((m) => m.prescriptionId),
        acknowledgeStockWarning,
      });
      setConfirmingDispense(false);
      // The counter's other obligations may now have changed.
      void invoices.refetch();
      void blockers.refetch();

      // Per item, not per batch. A batch where one row failed and three
      // succeeded, summarised as "failed", sends a dispenser to hand over
      // medicine that has already left the shelf.
      const summary = dispenseSummaryText(result.summary);
      const failures = result.results.filter(
        (item) => item.outcome !== 'DISPENSED' && item.outcome !== 'STOCK_WARNING_ACKNOWLEDGED',
      );
      if (failures.length === 0) {
        message.success(`${summary}. ${result.routing.message}`);
      } else {
        message.warning(
          `${summary}. ${failures
            .map((item) => `${item.medicationName ?? 'One medication'}: ${item.message}`)
            .join(' ')}`,
          8,
        );
      }
    } catch (error) {
      // Left open with the error inside it — see KuwickModal's `error` prop.
      // A toast that disappears while the dispenser is still reading the list
      // it refers to is not a report.
      if (!(error instanceof ApiError)) throw error;
    }
  };

  const openLabel = (medication: DispensaryMedication) => {
    setLabelTarget(medication);
    setLabelCopies(1);
    setPrintedPayload(null);
  };

  const closeLabel = () => {
    setLabelTarget(null);
    setPrintedPayload(null);
  };

  /**
   * Record the print, then hand the page to the browser's print dialog.
   *
   * In that order, and never the other way round: the audit row is written by
   * the server before anything can reach a printer, so a label on paper
   * always has a record behind it.
   *
   * What goes on the paper is the PRINTED payload the server returned, not
   * the preview — the print sequence, the reprint notice and the printed-at
   * time are decided by that write. `flushSync` is here for exactly that
   * reason: `window.print()` reads the DOM synchronously, so the swap has to
   * have happened before it is called rather than on the next render.
   */
  const runPrint = async () => {
    if (!labelTarget) return;
    try {
      const printed = await printLabel.mutateAsync({
        prescriptionId: labelTarget.prescriptionId,
        copies: labelCopies,
      });
      flushSync(() => setPrintedPayload(printed));
      printLabelSheet();
    } catch (error) {
      // Reported inside the modal by KuwickModal's `error` prop. Nothing was
      // printed and nothing was recorded.
      if (!(error instanceof ApiError)) throw error;
    }
  };

  if (board.isError) {
    const forbidden = board.error instanceof ApiError && board.error.status === 403;
    return (
      <Result
        status={forbidden ? '403' : 'error'}
        title={forbidden ? 'The dispensary is not available to this account' : 'The dispensary board could not be loaded'}
        subTitle={board.error instanceof ApiError ? board.error.message : undefined}
        extra={
          forbidden ? (
            <Link to="/queue">
              <Button type="primary">Back to Queue</Button>
            </Link>
          ) : (
            <Button type="primary" onClick={() => board.refetch()}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  const counts = board.data?.counts ?? { waitingPatients: 0, medicationsRemaining: 0, stockWarnings: 0 };
  // On a phone the two panes become one: the list, or the patient. Showing
  // both stacked means scrolling past every waiting patient to reach the
  // medication being handed over.
  const showList = isDesktop || !selectedRow;
  const showDetail = isDesktop || Boolean(selectedRow);

  return (
    <div className="kw-dispensary kw-operational-surface">
      <header className="kw-dispensary-header">
        <div className="kw-dispensary-header-identity">
          <Title level={4} style={{ margin: 0 }}>
            Dispensary
          </Title>
          <Space size={8} wrap>
            <KuwickStatusTag tone="active" label="Waiting" detail={counts.waitingPatients} />
            <KuwickStatusTag tone="attention" label="To dispense" detail={counts.medicationsRemaining} />
            {counts.stockWarnings > 0 && (
              <KuwickStatusTag tone="error" label="Stock issues" detail={counts.stockWarnings} alert />
            )}
          </Space>
        </div>
        <Space wrap>
          {showSelector && (
            <Select
              allowClear
              placeholder="Select clinic"
              style={{ width: 220 }}
              value={clinicId}
              onChange={setClinicId}
              options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
            />
          )}
          <Button
            icon={<ReloadOutlined />}
            loading={board.isFetching}
            onClick={() => board.refetch()}
            aria-label="Refresh the dispensary board"
          >
            Refresh
          </Button>
          <Link to="/queue">
            <Button icon={<ArrowLeftOutlined />}>Back to Queue</Button>
          </Link>
        </Space>
      </header>

      <div className="kw-dispensary-body">
        {showList && (
          <aside className="kw-dispensary-pane-list">
            <DispensaryPatientList
              rows={rows}
              selectedVisitId={selectedVisitId}
              onSelect={selectVisit}
              search={search}
              onSearch={setSearch}
              filter={filter}
              onFilter={setFilter}
              loading={board.isLoading}
            />
          </aside>
        )}

        {showDetail && (
          <section className="kw-dispensary-pane-detail" aria-label="Selected patient">
            {board.isLoading && (
              <div className="kw-dispensary-detail-loading">
                <Spin />
              </div>
            )}

            {!board.isLoading && !selectedRow && (
              <div className="kw-dispensary-detail-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    rows.length === 0
                      ? EMPTY_BOARD_TEXT
                      : selectedVisitId
                        ? VISIT_MOVED_TEXT
                        : 'Choose a patient from the list to begin dispensing.'
                  }
                />
              </div>
            )}

            {!board.isLoading && selectedRow && (
              <>
                {/* Sticky, because the dispenser scrolls a long medication
                    list and must never lose track of whose it is. */}
                <div className="kw-dispensary-patient-header">
                  {!isDesktop && (
                    <Button
                      type="text"
                      icon={<ArrowLeftOutlined />}
                      onClick={() => selectVisit(null)}
                      aria-label="Back to the waiting list"
                    >
                      Waiting list
                    </Button>
                  )}
                  <div className="kw-dispensary-patient-identity">
                    <h3>{selectedRow.patientName}</h3>
                    <Text type="secondary">
                      {selectedRow.displayNumber ? `${selectedRow.displayNumber} · ` : ''}
                      {selectedRow.visitNumber}
                      {selectedRow.doctorName ? ` · ${selectedRow.doctorName}` : ''}
                    </Text>
                  </div>
                  <div className="kw-dispensary-patient-progress">
                    <Text>{progressText(selectedRow.counts)}</Text>
                    {waitingText(selectedRow.checkInAt) && (
                      <Text type="secondary">{waitingText(selectedRow.checkInAt)}</Text>
                    )}
                  </div>
                </div>

                {selectedRow.unresolvedCount > 0 && (
                  // Not the dispensary's decision to make. The supply mode is
                  // the prescriber's, and the counter is told rather than
                  // offered a control that would silently choose one.
                  <Alert
                    type="warning"
                    showIcon
                    className="kw-dispensary-unresolved"
                    message={`${selectedRow.unresolvedCount} medication${selectedRow.unresolvedCount === 1 ? '' : 's'} without a confirmed supply mode`}
                    description="The prescriber has not said whether the clinic supplies these. They are not shown as dispensary work until that is confirmed in the visit."
                  />
                )}

                <div className="kw-counter-scroll">
                  {/* A — MEDICATIONS. Prepare and label; hand-over is
                      confirmed once, below, for the whole visit. */}
                  <section className="kw-counter-section" aria-label="Medications">
                    <header className="kw-counter-section-head">
                      <h4>Medications</h4>
                      <Text type="secondary">{progressText(selectedRow.counts)}</Text>
                    </header>
                    {selectedRow.medications.length === 0 && (
                      <Text type="secondary" className="kw-counter-empty-line">
                        This visit has no clinic-supplied medication.
                      </Text>
                    )}
                    <div className="kw-dispensary-cards">
                      {selectedRow.medications.map((medication) => (
                        <DispensaryMedicationCard
                          key={medication.prescriptionId}
                          medication={medication}
                          onPrintLabel={openLabel}
                          canPrint={canPrint}
                        />
                      ))}
                    </div>
                  </section>

                  {/* B — DOCUMENTS. An MC is printed at the counter; making
                      staff return to the Doctor Canvas for it is why this
                      section is here. */}
                  <CounterDocuments
                    documents={documents.data ?? []}
                    loading={documents.isLoading}
                    onView={setPreviewingDocument}
                    onPrint={(doc) => printTextDocument(documentLabel(doc), doc.content)}
                  />

                  {/* C — PAYMENT, inline. Renders the invoice API's own
                      responsibility split and settles through the same API. */}
                  <CounterPayment
                    billing={billing}
                    state={payState}
                    method={paymentMethod}
                    onMethod={(next) => setPaymentMethod(next as PaymentMethod)}
                    collecting={payInvoice.isPending}
                    canCollect={Boolean(billing?.invoiceId)}
                    error={payInvoice.error instanceof ApiError ? payInvoice.error.message : null}
                    onCollect={async () => {
                      if (!billing?.invoiceId) return;
                      try {
                        await payInvoice.mutateAsync({
                          invoiceId: billing.invoiceId,
                          dto: { paymentMethod },
                        });
                        message.success('Payment settled');
                        void blockers.refetch();
                        void board.refetch();
                      } catch (error) {
                        if (!(error instanceof ApiError)) throw error;
                      }
                    }}
                  />

                  {/* D — FINAL VISIT ACTION. */}
                  <CounterCheck lines={checkLines} reasons={action.reasons} />
                </div>

                {/* One primary action, and it is whichever obligation is still
                    open. Never a fixed dispense-then-pay sequence. */}
                <div className="kw-dispensary-action-footer">
                  <Text type="secondary" className="kw-counter-next">
                    {action.stage === 'BLOCKED'
                      ? action.reasons[0]
                      : action.stage === 'DONE'
                        ? 'Counter work complete'
                        : 'Next step'}
                  </Text>
                  <Space size={8}>
                    {action.stage === 'CONFIRM_MEDICATIONS' && (
                      <Button
                        type="primary"
                        size="large"
                        disabled={!canDispense}
                        onClick={() => setConfirmingDispense(true)}
                      >
                        Confirm Medications Dispensed
                      </Button>
                    )}
                    {(action.stage === 'COMPLETE_VISIT' || action.stage === 'BLOCKED') && (
                      <Button
                        type="primary"
                        size="large"
                        loading={completeVisit.isPending}
                        disabled={action.stage === 'BLOCKED'}
                        onClick={async () => {
                          try {
                            await completeVisit.mutateAsync({ visitId: selectedRow.visitId });
                            message.success('Visit completed');
                            void board.refetch();
                            selectVisit(null);
                          } catch (error) {
                            if (error instanceof ApiError) message.error(error.message);
                            void blockers.refetch();
                          }
                        }}
                      >
                        Complete Visit
                      </Button>
                    )}
                  </Space>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {/* The SAME preview the Documents workspace uses — one implementation,
          so a control that exists there cannot go missing here. */}
      <DocumentPreviewDrawer
        document={previewingDocument}
        patientName={selectedRow?.patientName ?? ''}
        onClose={() => setPreviewingDocument(null)}
      />

      <ConfirmDispenseModal
        open={confirmingDispense}
        patientName={selectedRow?.patientName ?? ''}
        medications={outstandingMedications}
        loading={dispense.isPending}
        error={dispense.error instanceof ApiError ? dispense.error.message : null}
        onCancel={() => setConfirmingDispense(false)}
        onConfirm={runDispense}
      />

      <LabelPreviewModal
        open={labelTarget !== null}
        payload={printedPayload ?? labelPreview.data ?? null}
        copies={labelCopies}
        onCopiesChange={(next) => {
          setLabelCopies(next);
          // The sheet goes back to being a preview: the recorded print was
          // for a different number of copies.
          setPrintedPayload(null);
        }}
        history={labelHistory.data ?? []}
        historyLoading={labelHistory.isLoading}
        loading={printLabel.isPending || labelPreview.isLoading}
        error={
          printLabel.error instanceof ApiError
            ? printLabel.error.message
            : labelPreview.error instanceof ApiError
              ? labelPreview.error.message
              : null
        }
        // A reprint is the same operation: a fresh server-assembled label
        // with its own audit row, never the previous payload sent again.
        onPrint={runPrint}
        onReprint={runPrint}
        onClose={closeLabel}
      />
    </div>
  );
}
