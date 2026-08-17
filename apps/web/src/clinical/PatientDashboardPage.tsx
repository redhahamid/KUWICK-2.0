import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Segmented,
  Space,
  Drawer,
  Modal,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  HistoryOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { usePatient } from '../core/hooks/usePatients';
import { useAuthStore } from '../core/auth-store';
import { usePatientVisits } from './hooks/useVisits';
import { EditPatientDrawer } from './EditPatientDrawer';
import { NewVisitDrawer } from './NewVisitDrawer';
import { ClinicalNotesTab } from './ClinicalNotesTab';
import { DiagnosisTab } from './DiagnosisTab';
import { OrdersServicesTab } from './OrdersServicesTab';
import { MedicationsTab } from './MedicationsTab';
import { DocumentsTab } from './DocumentsTab';
import { InvoiceSummary } from './invoice/InvoiceSummary';
import { useOrderServices } from './hooks/useOrderServices';
import { useIsDesktop } from '../core/hooks/useMediaQuery';
import { useRecordViewLayout } from './hooks/useRecordViewLayout';
import { CanvasPatientHeader } from './CanvasPatientHeader';
import { AllergyQuickRecord } from './canvas/AllergyQuickRecord';
import { CanvasQuickNav } from './CanvasQuickNav';
import { CanvasWorkspace } from './canvas/CanvasWorkspace';
import { CanvasVisitsRail } from './canvas/CanvasVisitsRail';
import { CopyRxModal } from './medications/CopyRxModal';
import { DiagnosisRail } from './sections/DiagnosisRail';
import { MedicationsRail } from './sections/MedicationsRail';
import { OrdersRail } from './sections/OrdersRail';
import { ServicesRail } from './sections/ServicesRail';
import { DocumentsRail } from './sections/DocumentsRail';
import { VisitCompletionBar } from './VisitCompletionBar';
import { InvoiceBottomBar } from './invoice/InvoiceBottomBar';
import { PatientSummarySidebar } from './PatientSummarySidebar';
import { VisitHistoryPanel } from './history/VisitHistoryPanel';
// G1 (D-058) — the four *SummaryCard components are deliberately still in the
// tree but no longer rendered anywhere. They stay until G1 is accepted and
// functional parity is confirmed, then go in a cleanup commit. Only one
// version is ever public.
import { InlineVitalsRow } from './InlineVitalsRow';
import { VisitObservationsPanel } from './VisitObservationsPanel';
import { Visit } from './types';
import { ApiError } from '../core/api-client';
import { useHoldConsultation, useResumeConsultation } from './hooks/useQueueTickets';
import { mayHoldConsultation } from './holdPresentation';
import { PatientProfileSlideOver } from './PatientProfileSlideOver';
import { mayManagePatientAlerts, mayRecordMedicalAlert } from './patientAlertPresentation';
import { mayCorrectPatientIdentity } from '../core/patient-identity-access';
import { useStaff } from '../hr/hooks/useStaff';
import { isDraftDirty, useClinicalDraftStore, visitPrefix } from './clinical-draft-store';

const { Title, Text } = Typography;

// The six numbered "Record View" tabs from the audited kuwick.com Patient
// Dashboard.
const RECORD_TABS = [
  { key: 'notes', label: 'Clinical Notes' },
  { key: 'orders', label: 'Orders & Services' },
  { key: 'diagnosis', label: 'Diagnosis' },
  { key: 'medications', label: 'Medications' },
  { key: 'documents', label: 'Documents' },
  { key: 'invoices', label: 'Invoices' },
];

export function PatientDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { data: patient, isLoading } = usePatient(id);
  const { data: visits } = usePatientVisits(id);
  const [expandProfile, setExpandProfile] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [newVisitOpen, setNewVisitOpen] = useState(false);
  // b1.5 PHASE D — the patient profile slide-over, opened from the identity strip.
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const [copyRxFrom, setCopyRxFrom] = useState<{ id: string; label: string } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // G4 (D-067) — reviewing previous visits is its own surface, and opening it
  // changes nothing about the consultation in progress.
  const [historyOpen, setHistoryOpen] = useState(false);
  // G4.5d (D-075) — lifted so the completion bar can open the full sections.
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  // D-077 — the compact strips own the values; these reveal the full panels.
  const [vitalsExpanded, setVitalsExpanded] = useState(false);
  const [selectedVisitId, setSelectedVisitId] = useState<string>();
  const [activeRecordTab, setActiveRecordTab] = useState('notes');
  // Per staff member, not per browser — a shared consultation-room desktop
  // is the normal case, and one shared value meant each user changed the
  // layout for everybody else.
  const [layout, setLayout] = useRecordViewLayout();
  const isDesktop = useIsDesktop();

  // D-044 — arriving from Queue's "open visit record" link/icon jumps
  // straight to that visit instead of always defaulting to the most recent.
  useEffect(() => {
    const requestedVisitId = searchParams.get('visitId');
    if (requestedVisitId && visits?.some((visit) => visit.id === requestedVisitId)) {
      setSelectedVisitId(requestedVisitId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, searchParams.get('visitId')]);

  const selectedVisit: Visit | undefined =
    visits?.find((visit) => visit.id === selectedVisitId) ?? visits?.[0];
  const { data: procedureOrders } = useOrderServices(selectedVisit?.id, { orderType: 'TASK_ORDER' });

  // C1 (D-052) — changing visit swaps the clinical record under the editor,
  // so unsaved text must be confirmed first. The draft itself is keyed per
  // visit and stays in memory, so cancelling loses nothing.
  const drafts = useClinicalDraftStore((state) => state.drafts);
  const clearVisitDrafts = useClinicalDraftStore((state) => state.clearVisitDrafts);
  const staff = useAuthStore((state) => state.staff);
  const tenant = useAuthStore((state) => state.tenant);

  // KW2-C2 — pause and take back. The mutations refresh the queue and the
  // visit; nothing that owns clinical content is touched, which is what makes
  // "resuming returns them with state intact" true (C1/D-091).
  const holdConsultation = useHoldConsultation();
  const resumeConsultation = useResumeConsultation();
  // Only to put a name on the id the ticket carries. The server is what
  // enforces who may hold; this list decides nothing.
  const { data: staffDirectory } = useStaff();

  const requestVisitChange = (visitId: string) => {
    const leavingVisitId = selectedVisit?.id;
    if (!leavingVisitId || visitId === leavingVisitId) {
      return;
    }
    // Only ask about the visit being LEFT. Unsaved work on a different visit
    // or patient is none of this decision's business and must survive it.
    const leavingPrefix = visitPrefix(
      tenant?.id ?? 'unknown-tenant',
      staff?.clinicId ?? null,
      patient?.id ?? '',
      leavingVisitId,
    );
    const leavingHasUnsaved = Object.entries(drafts).some(
      ([key, draft]) => key.startsWith(leavingPrefix) && isDraftDirty(draft),
    );

    if (!leavingHasUnsaved) {
      setSelectedVisitId(visitId);
      return;
    }
    Modal.confirm({
      title: 'You have unsaved clinical notes on this visit',
      icon: <ExclamationCircleOutlined />,
      content: 'Switching to another visit will discard the clinical text you have not saved on this one.',
      okText: 'Discard and switch',
      okButtonProps: { danger: true },
      cancelText: 'Continue editing',
      onOk: () => {
        // Scoped to the visit being left — never clearAll.
        clearVisitDrafts(
          tenant?.id ?? 'unknown-tenant',
          staff?.clinicId ?? null,
          patient?.id ?? '',
          leavingVisitId,
        );
        setSelectedVisitId(visitId);
      },
    });
  };

  if (isLoading || !patient) {
    return <Spin />;
  }

  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
  const procedureCounts = {
    pending: procedureOrders?.filter((o) => o.status === 'PENDING').length ?? 0,
    inProgress: procedureOrders?.filter((o) => o.status === 'IN_PROGRESS').length ?? 0,
    completed: procedureOrders?.filter((o) => o.status === 'COMPLETED').length ?? 0,
    cancelled: procedureOrders?.filter((o) => o.status === 'CANCELLED').length ?? 0,
  };
  const hasProcedures = procedureOrders && procedureOrders.length > 0;

  const activeTab = RECORD_TABS.find((tab) => tab.key === activeRecordTab) ?? RECORD_TABS[0];
  // G0a (D-054) — this used to be `canvasFill`, which pinned the whole
  // workspace to the viewport height so nothing scrolled. That is what made
  // the editor a leftover: the lower sections were guaranteed a place on
  // screen and the note absorbed whatever remained. It now selects desktop
  // DENSITY only. The page scrolls naturally and the editor's height is
  // declared (.kw-editor-fill), so lower sections may continue below the
  // fold instead of competing with the note.
  const canvasCompact = layout === 'canvas' && Boolean(selectedVisit) && isDesktop;

  /**
   * G4.5d3c-3a0v (D-090) — the completion bar's "More Documents" and "Open
   * Invoice" now open DRAWERS over the Canvas instead of scrolling to
   * duplicate sections below it.
   *
   * The bottom Documents/Invoice accordions duplicated what the top Visit
   * Actions already summarised, and their standing height was most of what
   * pushed the Consultation Footer a full viewport below the clinical work.
   * The full surfaces are unchanged — the drawers mount the SAME
   * DocumentsTab and InvoiceSummary the Flow layout uses — they simply
   * appear when asked for rather than occupying the page permanently.
   *
   * A drawer, never navigation: the consultation stays mounted behind it,
   * so closing it returns to the same visit, the same note and the same
   * unsaved text (the History Drawer rule, D-067).
   */
  const revealSection = (which: 'documents' | 'invoice') => {
    if (which === 'documents') setDocumentsOpen(true);
    else setInvoiceOpen(true);
  };

  /**
   * G4.5d3c-3a (D-089) — how the Consultation Footer hands a blocker back to
   * the section that can clear it.
   *
   * The footer implements NOTHING it points at: no second signing control, no
   * medication editor, and deliberately no Send to Procedure — there is no
   * approved procedure-transition service, and a button that looks like it
   * moves a patient but does not is worse than no button.
   *
   * `scrollIntoView` for the same reason as the quick-nav (D-072): a hash
   * would push a history entry and C1's unsaved-note guard keys on
   * navigation. Focus follows the scroll so a keyboard user actually arrives
   * somewhere rather than being told they have.
   */
  const revealCanvasSection = (anchor: 'note' | 'orders' | 'medications') => {
    const target = document.getElementById(`kw-anchor-${anchor}`);
    if (!target) return;
    // G4.5d3c-3a1 (D-091) — an unresolved supply mode is a ROW, not a
    // section, so "Review Medications" lands on the first one where it
    // exists. The row is found by a DOM marker the rail sets from the same
    // presentation rule the badge uses — nothing clinical is re-derived
    // here. Falls back to the section when nothing is unresolved.
    const unresolvedRow =
      anchor === 'medications' ? target.querySelector<HTMLElement>('[data-unresolved-supply]') : null;
    const focusTarget = unresolvedRow ?? target;
    focusTarget.scrollIntoView({ behavior: 'smooth', block: unresolvedRow ? 'center' : 'start' });
    focusTarget.setAttribute('tabindex', '-1');
    focusTarget.focus({ preventScroll: true });
    if (unresolvedRow) {
      // A brief, restrained attention ring — colour is not the only signal
      // (focus lands on the row) and it removes itself.
      unresolvedRow.classList.add('kw-row-attention');
      window.setTimeout(() => unresolvedRow.classList.remove('kw-row-attention'), 2600);
    }
  };

  // KW2-C2 — the hold state of the visit on screen, read from its ticket.
  //
  // Nothing is derived from the queue board here: the ticket carries the
  // CURRENT hold, and asking a second source would give a second answer.
  const heldTicket = selectedVisit?.queueTicket ?? null;
  const heldByName = heldTicket?.heldAt
    ? (staffDirectory?.find((member) => member.id === heldTicket.heldByStaffId)?.fullName ??
      'another clinician')
    : null;
  const holdPending = holdConsultation.isPending || resumeConsultation.isPending;
  const runHold = (mutation: typeof holdConsultation, failure: string) => () => {
    if (!heldTicket || !selectedVisit) return;
    mutation
      .mutateAsync({ ticketId: heldTicket.id, visitId: selectedVisit.id, patientId: patient?.id })
      .catch((error) => message.error(error instanceof ApiError ? error.message : failure));
  };

  const layoutSwitch = (
    <Segmented
      size="small"
      value={layout}
      onChange={(value) => setLayout(value as 'canvas' | 'flow')}
      options={[
        { label: 'Canvas', value: 'canvas', icon: <AppstoreOutlined /> },
        { label: 'Flow', value: 'flow', icon: <UnorderedListOutlined /> },
      ]}
    />
  );

  return (
    <div>
      {layout === 'canvas' && selectedVisit ? (
        <div className="kw-canvas2">
          <CanvasPatientHeader
            patient={patient}
            visit={selectedVisit}
            layoutControl={layoutSwitch}
            onBack={() => navigate('/queue')}
            onBookAppointment={() => setNewVisitOpen(true)}
            // The one exit action. It scrolls to the completion footer, which
            // owns the eligibility rules, the blockers and the confirmation —
            // duplicating that logic here would give two answers to one
            // question.
            onCompleteConsultation={() => revealCanvasSection('note')}
            // Withheld where it cannot be honoured: no ticket to move, the
            // visit already closed, or a role the server would refuse. The
            // header renders the reason rather than a button that fails.
            onHold={
              heldTicket && !selectedVisit.checkOutAt && !heldByName && mayHoldConsultation(staff?.role)
                ? runHold(holdConsultation, 'The consultation could not be put on hold.')
                : undefined
            }
            onResume={
              heldTicket && heldByName
                ? runHold(resumeConsultation, 'The consultation could not be resumed.')
                : undefined
            }
            heldByName={heldByName}
            holdPending={holdPending}
            onOpenProfile={() => setProfileOpen(true)}
            canEditAlerts={mayManagePatientAlerts(staff?.role)}
            canRecordMedicalAlert={mayRecordMedicalAlert(staff?.role)}
          />
          {/* b1.5 PHASE D — the profile behind the identity strip. Mounted
              here, beside the header that opens it, so the slide-over and the
              band it belongs to cannot drift apart. */}
          {/* The alerts view is no longer mounted here: it opens under the
              chip that asks for it (see AlertsQuickView), the way the allergy
              chip beside it always has. */}
          <PatientProfileSlideOver
            open={profileOpen}
            patient={patient}
            visit={selectedVisit}
            onClose={() => setProfileOpen(false)}
            canEdit={mayManagePatientAlerts(staff?.role)}
            canRecordMedical={mayRecordMedicalAlert(staff?.role)}
            canCorrectIdentity={mayCorrectPatientIdentity(staff)}
          />
          {/* KW2-C1a — the LAST VISIT band is RETIRED in Canvas.
              D-076 put it here to answer "what happened last time?" without
              opening anything. The Kuwick 2.0 visits rail now answers that
              question permanently and in the same glance, so the band had
              become the same fact printed twice. Not deleted yet: Phase 2
              removes `LastVisitSnapshot` and its tests together, once the
              rail owns hover-preview and Copy Rx.

              THE DOCUMENTS/INVOICE BAND BELOW IS NOT RETIRED WITH IT, and
              that is deliberate. It is not yet a duplicate: it carries the
              only Create MC, Create Referral and Open Invoice controls that
              exist in Canvas, and the cards meant to replace them are Phase 7
              and Phase 8. Hiding it now would not remove a duplication, it
              would remove a doctor's only way to issue an MC in production.
              It goes the day the Documents card lands. */}
          <div className="kw-visit-band">
          {/* G4.5d (D-075) — how the consultation ENDS, immediately below the
              context band instead of at the bottom of the page. A summary and
              entry points only; the full workspaces stay below the Canvas. */}
          <VisitCompletionBar
            visit={selectedVisit}
            patientName={patient.name}
            patientIdentifier={patient.identifierValue}
            onOpenDocuments={() => revealSection('documents')}
            onOpenInvoice={() => revealSection('invoice')}
          />
          </div>
        </div>
      ) : (
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[24, 16]}>
          <Col xs={24} md={10}>
            <Space align="start" size="large">
              <Avatar size={64} icon={<UserOutlined />} />
              <div>
                <Space>
                  <Title level={4} style={{ margin: 0 }}>
                    {patient.name}
                  </Title>
                  <Button size="small" icon={<EditOutlined />} onClick={() => setEditOpen(true)} />
                  <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setNewVisitOpen(true)}>
                    New Visit
                  </Button>
                </Space>
                <div>
                  <Tag>ID {patient.id.slice(0, 8)}</Tag>
                  <Text type="secondary">
                    {patient.identifierType}: {patient.identifierValue}
                  </Text>
                </div>
                <Space size="large" style={{ marginTop: 4 }} wrap>
                  <Text>Phone: {patient.phone ?? '—'}</Text>
                  <Text>DOB: {patient.dob ? dayjs(patient.dob).format('YYYY-MM-DD') : '—'}</Text>
                  <Text>Age: {age ?? '—'}</Text>
                </Space>
                <div style={{ marginTop: 6 }}>
                  {/* A2 — the SAME quick-record chip as the Canvas header.
                      Flow is the default layout, so an allergy control that
                      lives only in Canvas is invisible to most of the clinic
                      — the deployed-app review proved it. The old text line
                      also said "None recorded" for both a confirmed negative
                      and a question nobody asked, which the chip's three
                      states keep apart. */}
                  <AllergyQuickRecord patient={patient} />
                </div>
              </div>
            </Space>
            <div style={{ marginTop: 12 }}>
              <Button size="small" onClick={() => setExpandProfile((prev) => !prev)}>
                {expandProfile ? 'Collapse Profile' : 'Expand Profile'}
              </Button>
              {expandProfile && (
                <Descriptions column={2} size="small" style={{ marginTop: 12 }}>
                  <Descriptions.Item label="Gender">{patient.gender ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Race">{patient.race ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Address">{patient.address ?? 'No address provided.'}</Descriptions.Item>
                  <Descriptions.Item label="Emergency Contact">
                    {patient.emergencyContactName
                      ? `${patient.emergencyContactName} ${patient.emergencyContactPhone ?? ''}`
                      : 'No emergency contact provided.'}
                  </Descriptions.Item>
                </Descriptions>
              )}
            </div>
          </Col>
          <Col
            xs={24}
            md={7}
            style={isDesktop ? { borderLeft: '1px solid #f0f0f0', textAlign: 'center' } : { textAlign: 'center' }}
          >
            <Text type="secondary">ATTENDING PHYSICIAN</Text>
            <Avatar size={40} icon={<UserOutlined />} style={{ display: 'block', margin: '12px auto 8px' }} />
            <div>
              <Text strong>{selectedVisit?.staff ? selectedVisit.staff.fullName : 'No active visit'}</Text>
            </div>
          </Col>
          <Col xs={24} md={7} style={isDesktop ? { borderLeft: '1px solid #f0f0f0', paddingLeft: 16 } : undefined}>
            <Text type="secondary">PROCEDURE STATUS</Text>
            {hasProcedures ? (
              <Space size="large" style={{ marginTop: 12 }} wrap>
                <Statistic title="Pending" value={procedureCounts.pending} />
                <Statistic title="In Progress" value={procedureCounts.inProgress} />
                <Statistic title="Completed" value={procedureCounts.completed} />
                <Statistic title="Cancelled" value={procedureCounts.cancelled} />
              </Space>
            ) : (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" italic>
                  No procedures requested
                </Text>
              </div>
            )}
          </Col>
        </Row>
      </Card>
      )}

      {/* In Canvas the switch rides in the context band. A dedicated row for it
          cost ~38px of the first screen, and the first screen is the whole
          point of G4.5 — see the band above. Flow keeps its own row. */}
      {selectedVisit && layout === 'flow' && (
        <Space wrap style={{ marginBottom: 6, width: '100%', justifyContent: 'flex-end' }}>
          <Text type="secondary">Layout:</Text>
          {layoutSwitch}
        </Space>
      )}

      <Row gutter={[16, 16]}>
        {layout === 'flow' && (
        <Col xs={24} lg={5}>
          <Card
            title={
              <Space>
                Visits History
                <Tag>TOTAL: {visits?.length ?? 0}</Tag>
              </Space>
            }
            size="small"
          >
            {/* G4 (D-067) — this list previously called setSelectedVisitId
                DIRECTLY, with no unsaved-note guard at all: one click on a
                three-year-old visit replaced the record under the editor and
                silently abandoned whatever was being typed. It is now a
                timeline that opens the read-only history. */}
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {visits && visits.length > 0 ? (
                visits.slice(0, 6).map((visit) => (
                  <div
                    key={visit.id}
                    className="kw-visit-timeline-entry"
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      background: visit.id === selectedVisit?.id ? '#eef2ff' : '#fafafa',
                      borderLeft: visit.id === selectedVisit?.id ? '3px solid #4338ca' : '3px solid transparent',
                    }}
                  >
                    <Text strong>{dayjs(visit.checkInAt).format('D MMM YYYY')}</Text>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(visit.checkInAt).format('HH:mm')}
                      </Text>
                    </div>
                    <Space size={4} wrap style={{ marginTop: 4 }}>
                      <Tag>{visit.visitNumber}</Tag>
                      {visit.id === selectedVisit?.id && <Tag color="blue">Current visit</Tag>}
                    </Space>
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      <div>Billing Type: {visit.billingType}</div>
                      <div>Doctor: {visit.staff?.fullName ?? '—'}</div>
                    </div>
                  </div>
                ))
              ) : (
                <Text type="secondary">No visits yet</Text>
              )}
              <Button
                block
                icon={<HistoryOutlined />}
                onClick={() => setHistoryOpen(true)}
                style={{ minHeight: 44 }}
                disabled={!visits || visits.length === 0}
              >
                Previous Visits
              </Button>
            </Space>
          </Card>
        </Col>
        )}

        {selectedVisit && layout === 'flow' && (
          <>
            <Col xs={24} lg={5}>
              <Card title="Record View" size="small">
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {RECORD_TABS.map((tab, index) => (
                    <div
                      key={tab.key}
                      onClick={() => setActiveRecordTab(tab.key)}
                      style={{
                        cursor: 'pointer',
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: tab.key === activeRecordTab ? '#eef2ff' : undefined,
                      }}
                    >
                      <Badge
                        count={index + 1}
                        style={{
                          backgroundColor: tab.key === activeRecordTab ? '#4338ca' : '#d9d9d9',
                          marginRight: 8,
                        }}
                      />
                      <Text strong={tab.key === activeRecordTab}>{tab.label}</Text>
                    </div>
                  ))}
                </Space>
              </Card>
            </Col>

            <Col xs={24} lg={14}>
              <Card
                title={
                  <Space>
                    {activeTab.label}
                    <Tag>{selectedVisit.visitNumber}</Tag>
                  </Space>
                }
                size="small"
              >
                {activeTab.key === 'notes' && <ClinicalNotesTab visitId={selectedVisit.id} patientId={patient.id} />}
                {activeTab.key === 'orders' && <OrdersServicesTab visitId={selectedVisit.id} />}
                {activeTab.key === 'diagnosis' && <DiagnosisTab visitId={selectedVisit.id} />}
                {activeTab.key === 'medications' && <MedicationsTab visitId={selectedVisit.id} />}
                {activeTab.key === 'documents' && (
                  <DocumentsTab visit={selectedVisit} patientName={patient.name} patientIdentifier={patient.identifierValue} />
                )}
                {/* G3c (D-065) — the Flow layout's invoice tab is the same
                    read-only summary as the Canvas section. One implementation,
                    so a mutation control cannot survive on one surface. */}
                {activeTab.key === 'invoices' && <InvoiceSummary visit={selectedVisit} />}
              </Card>
            </Col>
          </>
        )}

        {selectedVisit && layout === 'canvas' && (
          // G4.5a (D-071) — the two-zone Clinical Canvas.
          //
          // Left: what the doctor WRITES — recorded vitals, this visit's
          // clinical images, then the note, which stays the dominant surface.
          // Right: what the doctor DOES — diagnosis, medications, orders and
          // services, beside the note rather than scrolled below it.
          //
          // Replaces the C2 arrangement, where the right column held patient
          // summary/allergies/recent visits and every clinical action was a
          // collapsed row underneath. Allergies moved into the context band
          // (they change what may be prescribed), recent visits became the G4
          // read-only history drawer, and the rail took the freed width.
          <Col span={24}>
            {/* Phone only (CSS-gated): the one column becomes a long scroll,
                so this moves the viewport between the surfaces. It never
                collapses anything — every panel stays open at every width. */}
            {!isDesktop && <CanvasQuickNav />}

            {/* Kuwick 2.0 Canvas (spec p.2) — three columns.
                LEFT   history, always on screen rather than behind a drawer
                MIDDLE what the doctor WRITES: note, diagnosis, documents
                RIGHT  what the doctor ORDERS: services, medication, invoice

                Diagnosis moves from the right rail into the middle, where the
                spec puts it. The earlier instruction it appears to contradict
                was about INTERACTION, not position — it must stay inline and
                never become a popup — and it still is. */}
            <CanvasWorkspace
              visits={
                <CanvasVisitsRail
                  patientId={patient.id}
                  currentVisit={selectedVisit}
                  onOpenHistory={() => setHistoryOpen(true)}
                  onOpenVisit={() => setHistoryOpen(true)}
                  onNewVisit={() => setNewVisitOpen(true)}
                  onCopyRx={setCopyRxFrom}
                />
              }
              middle={
                <>
                  <Card
                    size="small"
                    id="kw-anchor-note"
                    className="kw-notes-card"
                    title={<Space>Clinical Notes <Tag>{selectedVisit.visitNumber}</Tag></Space>}
                    styles={
                      canvasCompact
                        ? { header: { padding: '4px 12px', minHeight: 30 }, body: { padding: 8 } }
                        : undefined
                    }
                  >
                    {/* D-077 — ONE compact component per fact. The strips carry
                        the values and the actions; the full panels appear below
                        only when asked for, so no vital is printed twice and an
                        empty attachments box is one row rather than a slab. */}
                    {/* KW2-C3 — vitals are ENTERED here now, not read here and
                        entered somewhere else. The read-only strip plus its
                        "Record vitals" link cost a screen change, a form, a
                        save and a dismissal to type a blood pressure. The
                        full panel is still one click away for the four
                        observations the strip does not own, and for the
                        corrections that need a reason. */}
                    <InlineVitalsRow
                      visitId={selectedVisit.id}
                      readOnly={Boolean(selectedVisit.checkOutAt)}
                      onOpenFull={() => setVitalsExpanded((prev) => !prev)}
                    />
                    {vitalsExpanded && (
                      <VisitObservationsPanel visitId={selectedVisit.id} compact={canvasCompact} />
                    )}
                    {/* b0 — attachments are NOT mounted here any more. The
                        strip-plus-panel pair rendered "Attachments (N)" twice
                        with the same thumbnails and two Upload buttons, one of
                        which landed on the note area. The single component
                        mounts inside ClinicalNotesTab, below the editor. */}
                    <ClinicalNotesTab
                      visitId={selectedVisit.id}
                      patientId={patient.id}
                      compact={canvasCompact}
                      embedded
                    />
                  </Card>
                  <DiagnosisRail visitId={selectedVisit.id} />
                </>
              }
              right={
                <>
                  <ServicesRail visitId={selectedVisit.id} />
                  <OrdersRail visitId={selectedVisit.id} clinicId={selectedVisit.clinicId} />
                  <MedicationsRail visitId={selectedVisit.id} />
                  {/* b3 PHASE F — Documents, below Medications, filling the
                      space the right column used to end in. The visit band's
                      Create MC control above STAYS for now: it is still a
                      doctor's only way to issue an MC on a screen this card
                      has not been proven on yet, and removing it the same day
                      would trade a duplicate for an outage. */}
                  <DocumentsRail visit={selectedVisit} />
                </>
              }
              footer={
                /* b4 PIECE B — the STICKY BOTTOM BAR: the visit's running
                   total and how the doctor's part of the consultation ends,
                   on one slim line that never scrolls away.

                   It does not sit ABOVE the completion footer, it CARRIES it:
                   `ConsultationFooter` renders inside in its one-line `bar`
                   variant, so there is still exactly one completion action on
                   the page, with one set of rules behind it (D-089, and no
                   "Complete Visit" here either — closing the visit is counter
                   work under a different permission, D-087).

                   The invoice is deliberately NOT a fifth rail card: below
                   Documents it would already be past the fold at 1366×768. */
                <InvoiceBottomBar visit={selectedVisit} onReview={revealCanvasSection} />
              }
            />

            {copyRxFrom && (
              <CopyRxModal
                open
                sourceVisitId={copyRxFrom.id}
                sourceLabel={copyRxFrom.label}
                patientId={patient.id}
                targetVisitId={selectedVisit.id}
                onClose={() => setCopyRxFrom(null)}
              />
            )}
          </Col>
        )}
      </Row>

      {/* Tablet/mobile: the summary moves out of the editor's way entirely.
          The allergy alert stays visible in the header, so nothing clinically
          urgent hides behind a closed drawer. */}
      {/* D-077 — the drawer is now available at EVERY width, because the
          context band's Patient Summary control exists on desktop too (it took
          the space the duplicated Previous Visits button was using). The
          full-width button below stays phone-only. */}
      {selectedVisit && layout === 'canvas' && (
        <>
          {!isDesktop && (
            <Button
              block
              icon={<UserOutlined />}
              style={{ marginTop: 12 }}
              onClick={() => setSummaryOpen(true)}
            >
              Patient Summary &amp; Recent Visits
            </Button>
          )}
          <Drawer
            title="Patient Summary"
            placement="right"
            width={340}
            open={summaryOpen}
            onClose={() => setSummaryOpen(false)}
          >
            <PatientSummarySidebar
              patient={patient}
              visits={visits}
              selectedVisitId={selectedVisit.id}
              onReviewHistory={() => {
                setSummaryOpen(false);
                setHistoryOpen(true);
              }}
              expanded={expandProfile}
              onToggleExpand={() => setExpandProfile((prev) => !prev)}
              onNewVisit={() => setNewVisitOpen(true)}
            />
          </Drawer>
        </>
      )}

      {/* G4 (D-067) — Previous Visits. Wide on desktop so clinical detail is
          readable without a horizontal scroll; full-screen on mobile. The
          consultation stays mounted behind it: closing this drawer returns to
          the same visit, the same note and the same unsaved text. */}
      <Drawer
        title={`Previous Visits — ${patient.name}`}
        placement="right"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        styles={{ body: { paddingTop: 12 } }}
        {...(isDesktop ? { width: 720 } : { height: '92%', placement: 'bottom' as const })}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Read only"
          description="Reviewing a previous visit does not change the visit you are working on, and nothing here can be edited."
        />
        <VisitHistoryPanel patientId={patient.id} currentVisitId={selectedVisit?.id} compact={!isDesktop} />
      </Drawer>

      {/* G4.5d3c-3a0v (D-090) — the full Documents Workspace and the
          read-only Invoice Summary, on demand. Same components as the Flow
          layout's tabs — one implementation per surface — mounted only while
          open, over a Canvas that stays exactly as it was underneath. */}
      {selectedVisit && (
        <>
          <Drawer
            title="Documents"
            open={documentsOpen}
            onClose={() => setDocumentsOpen(false)}
            styles={{ body: { paddingTop: 12 } }}
            {...(isDesktop ? { placement: 'right' as const, width: 880 } : { placement: 'bottom' as const, height: '92%' })}
          >
            {documentsOpen && (
              <DocumentsTab
                visit={selectedVisit}
                patientName={patient.name}
                patientIdentifier={patient.identifierValue}
              />
            )}
          </Drawer>
          <Drawer
            title="Invoice"
            open={invoiceOpen}
            onClose={() => setInvoiceOpen(false)}
            styles={{ body: { paddingTop: 12 } }}
            {...(isDesktop ? { placement: 'right' as const, width: 720 } : { placement: 'bottom' as const, height: '92%' })}
          >
            {invoiceOpen && <InvoiceSummary visit={selectedVisit} />}
          </Drawer>
        </>
      )}

      <EditPatientDrawer patient={patient} open={editOpen} onClose={() => setEditOpen(false)} />
      <NewVisitDrawer
        patient={patient}
        open={newVisitOpen}
        onClose={() => setNewVisitOpen(false)}
        // C1 (D-052) — creating a visit also swaps the record under the
        // editor, so it goes through the same unsaved-note guard as any other
        // change of current visit.
        onCreated={(visitId) => requestVisitChange(visitId)}
      />
    </div>
  );
}
