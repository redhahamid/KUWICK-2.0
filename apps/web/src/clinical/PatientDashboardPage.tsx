import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
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
import { useRecordViewLayoutStore } from './record-view-layout-store';
import { CanvasPatientHeader } from './CanvasPatientHeader';
import { CanvasQuickNav } from './CanvasQuickNav';
import { VisitCompletionBar } from './VisitCompletionBar';
import { LastVisitSnapshot } from './LastVisitSnapshot';
import { PatientSummarySidebar } from './PatientSummarySidebar';
import { VisitHistoryPanel } from './history/VisitHistoryPanel';
// G1 (D-058) — the four *SummaryCard components are deliberately still in the
// tree but no longer rendered anywhere. They stay until G1 is accepted and
// functional parity is confirmed, then go in a cleanup commit. Only one
// version is ever public.
import { ClinicalRail } from './sections/ClinicalRail';
import { SecondarySections } from './sections/SecondarySections';
import { ClinicalVitalsStrip } from './ClinicalVitalsStrip';
import { ClinicalImageStrip } from './ClinicalImageStrip';
import { VisitObservationsPanel } from './VisitObservationsPanel';
import { VisitAttachmentsPanel } from './VisitAttachmentsPanel';
import { Visit } from './types';
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
  const [summaryOpen, setSummaryOpen] = useState(false);
  // G4 (D-067) — reviewing previous visits is its own surface, and opening it
  // changes nothing about the consultation in progress.
  const [historyOpen, setHistoryOpen] = useState(false);
  // G4.5d (D-075) — lifted so the completion bar can open the full sections.
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  // D-077 — the compact strips own the values; these reveal the full panels.
  const [vitalsExpanded, setVitalsExpanded] = useState(false);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
  const [selectedVisitId, setSelectedVisitId] = useState<string>();
  const [activeRecordTab, setActiveRecordTab] = useState('notes');
  const layout = useRecordViewLayoutStore((state) => state.layout);
  const setLayout = useRecordViewLayoutStore((state) => state.setLayout);
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
   * G4.5d (D-075) — the completion bar summarises; this is how it hands over
   * to the full surface. Expand the section, then bring it into view.
   *
   * `scrollIntoView`, never a hash: a hash pushes a history entry and C1's
   * unsaved-note guard keys on navigation, so revealing a section further down
   * the same record must not look like leaving it (same rule as the mobile
   * quick-nav, D-072).
   */
  const revealSection = (which: 'documents' | 'invoice') => {
    if (which === 'documents') setDocumentsOpen(true);
    else setInvoiceOpen(true);
    // After the section has expanded, so the scroll lands on its real height.
    window.setTimeout(() => {
      document.getElementById(`kw-anchor-${which}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
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
        <>
          <CanvasPatientHeader
            patient={patient}
            visit={selectedVisit}
            onPatientSummary={() => setSummaryOpen(true)}
            layoutControl={layoutSwitch}
          />
          {/* G4.5d2 (D-076) — "what happened last time?", answered without
              opening anything. Read-only, and it never touches the current
              visit, the URL or the C1 draft. */}
          <div className="kw-visit-band">
          <LastVisitSnapshot
            patientId={patient.id}
            currentVisitId={selectedVisit.id}
            onViewHistory={() => setHistoryOpen(true)}
          />
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
        </>
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
                <div style={{ marginTop: 4 }}>
                  <Text type={patient.allergies && patient.allergies.length > 0 ? 'danger' : 'secondary'}>
                    Known Allergies:{' '}
                    {patient.allergies && patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None recorded'}
                  </Text>
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
                so this moves the viewport between the five surfaces. It never
                collapses anything — every panel stays open at every width. */}
            {!isDesktop && <CanvasQuickNav />}
            <div className="kw-canvas-shell">
              <div className="kw-canvas-main">
                <Card
                  size="small"
                  id="kw-anchor-note"
                  className="kw-notes-card"
                  title={<Space>Clinical Notes <Tag>{selectedVisit.visitNumber}</Tag></Space>}
                  styles={
                    canvasCompact ? { header: { padding: '4px 12px', minHeight: 30 }, body: { padding: 8 } } : undefined
                  }
                >
                  {/* D-077 — ONE compact component per fact. The strips carry
                      the values and the actions; the full panels appear below
                      only when asked for, so no vital is printed twice and an
                      empty attachments box is one row rather than a slab. */}
                  <ClinicalVitalsStrip
                    visitId={selectedVisit.id}
                    expanded={vitalsExpanded}
                    onToggleExpand={() => setVitalsExpanded((prev) => !prev)}
                  />
                  {vitalsExpanded && <VisitObservationsPanel visitId={selectedVisit.id} compact={canvasCompact} />}
                  <ClinicalImageStrip
                    visitId={selectedVisit.id}
                    expanded={attachmentsExpanded}
                    onToggleExpand={() => setAttachmentsExpanded((prev) => !prev)}
                  />
                  {attachmentsExpanded && (
                    <VisitAttachmentsPanel visitId={selectedVisit.id} compact={canvasCompact} />
                  )}
                  <ClinicalNotesTab visitId={selectedVisit.id} patientId={patient.id} compact={canvasCompact} embedded />
                </Card>
              </div>

              {/* 420–480px at 1920 so the rail is readable without taking the
                  note's width; the note keeps everything that remains and
                  never shrinks to accommodate rail content — long lists
                  truncate to "View all N" instead (G4.5b/c). */}
              <aside className="kw-canvas-rail">
                <ClinicalRail visit={selectedVisit} />
              </aside>
            </div>

            {/* Secondary, below the working Canvas: Documents and the
                read-only Invoice Summary. Full width, outside the flex row,
                so nothing here can take height from the note (G0a, D-054). */}
            <SecondarySections
              visit={selectedVisit}
              patientName={patient.name}
              patientIdentifier={patient.identifierValue}
              documentsOpen={documentsOpen}
              invoiceOpen={invoiceOpen}
              onToggleDocuments={() => setDocumentsOpen((prev) => !prev)}
              onToggleInvoice={() => setInvoiceOpen((prev) => !prev)}
            />
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
