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
import { DispenseConfirmModal } from './DispenseConfirmModal';
import { LabelPreviewModal } from './LabelPreviewModal';
import {
  EMPTY_BOARD_TEXT,
  VISIT_MOVED_TEXT,
  dispenseSummaryText,
  progressText,
  waitingText,
} from './dispensaryPresentation';
import { printLabelSheet } from './labelPrint';

const { Text, Title } = Typography;

/**
 * G4.5d5b-3 — the dispensary counter.
 *
 * Dispensing used to happen inside the Doctor's Medications tab, which meant
 * the person handing medicine to a patient was working in a clinical editor
 * built for someone else's job, on a screen that also offered to change the
 * prescription. This is that work given its own place.
 *
 * The layout is a split, not a table with a drawer: the dispenser's attention
 * moves between "who is next" and "what do they need" continuously, and a
 * drawer that covers the list every time loses the queue. The two panes
 * scroll independently for the same reason.
 *
 * Every action here is offered only where the SERVER said the actor may
 * perform it — the board returns its own permission object — and refused
 * again by the server when it is taken. The browser hides what would be
 * refused; it does not decide anything.
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingDispense, setPendingDispense] = useState<DispensaryMedication[] | null>(null);
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

  // A selection that survived the patient changing would be a selection
  // pointing at another visit's prescriptions.
  useEffect(() => {
    setSelectedIds([]);
  }, [selectedVisitId]);

  // Nothing is auto-selected. On a busy board the first row changes as people
  // are served, and a workspace that quietly re-points at somebody else while
  // a dispenser is reading is how the wrong medicine gets counted.

  const labelPreview = useLabelPreview(labelTarget?.prescriptionId);
  const labelHistory = useLabelHistory(labelTarget?.prescriptionId, Boolean(labelTarget));

  const selectedMedications = useMemo(
    () => (selectedRow?.medications ?? []).filter((m) => selectedIds.includes(m.prescriptionId)),
    [selectedRow, selectedIds],
  );

  const toggleSelect = (prescriptionId: string, next: boolean) => {
    setSelectedIds((current) =>
      next ? [...current, prescriptionId] : current.filter((id) => id !== prescriptionId),
    );
  };

  const runDispense = async (acknowledgeStockWarning: boolean) => {
    if (!selectedRow || !pendingDispense) return;
    try {
      const result = await dispense.mutateAsync({
        visitId: selectedRow.visitId,
        prescriptionIds: pendingDispense.map((m) => m.prescriptionId),
        acknowledgeStockWarning,
      });
      setPendingDispense(null);
      setSelectedIds([]);

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

                <div className="kw-dispensary-cards">
                  {selectedRow.medications.length === 0 && (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="This visit has no clinic-supplied medication."
                    />
                  )}
                  {selectedRow.medications.map((medication) => (
                    <DispensaryMedicationCard
                      key={medication.prescriptionId}
                      medication={medication}
                      selected={selectedIds.includes(medication.prescriptionId)}
                      onToggleSelect={toggleSelect}
                      onDispense={(target) => setPendingDispense([target])}
                      onPrintLabel={openLabel}
                      canDispense={canDispense}
                      canPrint={canPrint}
                    />
                  ))}
                </div>

                {/* Sticky footer: the batch action stays reachable however
                    long the list is, on a phone as much as a desktop. */}
                {canDispense && selectedRow.counts.remaining > 0 && (
                  <div className="kw-dispensary-action-footer">
                    <Text type="secondary">
                      {selectedIds.length === 0
                        ? 'Select medications to dispense together'
                        : `${selectedIds.length} selected`}
                    </Text>
                    <Space size={8}>
                      <Link to={`/billing/visits/${selectedRow.visitId}`}>
                        <Button>Go to Billing Review</Button>
                      </Link>
                      <Button
                        type="primary"
                        disabled={selectedIds.length === 0}
                        onClick={() => setPendingDispense(selectedMedications)}
                      >
                        Dispense Selected ({selectedIds.length})
                      </Button>
                    </Space>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>

      <DispenseConfirmModal
        open={pendingDispense !== null}
        patientName={selectedRow?.patientName ?? ''}
        medications={pendingDispense ?? []}
        loading={dispense.isPending}
        error={dispense.error instanceof ApiError ? dispense.error.message : null}
        onCancel={() => setPendingDispense(null)}
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
