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
import { PatientSummarySidebar } from './PatientSummarySidebar';
import { VisitHistoryPanel } from './history/VisitHistoryPanel';
// G1 (D-058) — the four *SummaryCard components are deliberately still in the
// tree but no longer rendered anywhere. They stay until G1 is accepted and
// functional parity is confirmed, then go in a cleanup commit. Only one
// version is ever public.
import { ClinicalSectionStack } from './sections/ClinicalSectionStack';
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

  return (
    <div>
      {layout === 'canvas' && selectedVisit ? (
        <CanvasPatientHeader patient={patient} visit={selectedVisit} />
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

      {selectedVisit && (
        <Space wrap style={{ marginBottom: 6, width: '100%', justifyContent: 'flex-end' }}>
          <Text type="secondary">Layout:</Text>
          <Segmented
            value={layout}
            onChange={(value) => setLayout(value as 'canvas' | 'flow')}
            options={[
              { label: 'Canvas', value: 'canvas', icon: <AppstoreOutlined /> },
              { label: 'Flow', value: 'flow', icon: <UnorderedListOutlined /> },
            ]}
          />
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
          // C2 (D-053) — the Canvas workspace is a flex row, not an antd
          // 16/8 grid. The old grid gave the sidebar a third of the screen
          // and left the editor 22px of typing height (measured); a bounded
          // sidebar plus a growing main column is what makes the note the
          // dominant surface.
          <Col span={24}>
            <div
              className="kw-canvas-shell"
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
            >
              <div
                className="kw-canvas-main"
                style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <Card
                  size="small"
                  className="kw-notes-card"
                  title={<Space>Clinical Notes <Tag>{selectedVisit.visitNumber}</Tag></Space>}
                  styles={
                    canvasCompact ? { header: { padding: '4px 12px', minHeight: 30 }, body: { padding: 8 } } : undefined
                  }
                >
                  <ClinicalNotesTab visitId={selectedVisit.id} patientId={patient.id} compact={canvasCompact} />
                </Card>

              </div>

              {/* Bounded sidebar: min 280px so it stays readable, ~22vw so it
                  scales, max 360px so it never eats the editor's width. Below
                  the desktop breakpoint it becomes a drawer (see below).
                  G0a — natural height, no inner scroller: the page scrolls. */}
              {isDesktop && (
                <aside
                  className="kw-canvas-sidebar"
                  style={{
                    flex: '0 0 clamp(280px, 22vw, 360px)',
                    width: 'clamp(280px, 22vw, 360px)',
                    alignSelf: 'flex-start',
                  }}
                >
                  <PatientSummarySidebar
                    patient={patient}
                    visits={visits}
                    selectedVisitId={selectedVisit.id}
                    onReviewHistory={() => setHistoryOpen(true)}
                    expanded={expandProfile}
                    onToggleExpand={() => setExpandProfile((prev) => !prev)}
                    onNewVisit={() => setNewVisitOpen(true)}
                  />
                </aside>
              )}
            </div>

            {/* G1 (D-058) — the clinical sections sit BELOW the editor row and
                span its full width, including under the sidebar. They are
                outside the flex row on purpose: nothing here can take height
                from the note, which declares its own (G0a, D-054). */}
            <ClinicalSectionStack
              visit={selectedVisit}
              patientName={patient.name}
              patientIdentifier={patient.identifierValue}
            />
          </Col>
        )}
      </Row>

      {/* Tablet/mobile: the summary moves out of the editor's way entirely.
          The allergy alert stays visible in the header, so nothing clinically
          urgent hides behind a closed drawer. */}
      {selectedVisit && layout === 'canvas' && !isDesktop && (
        <>
          <Button
            block
            icon={<UserOutlined />}
            style={{ marginTop: 12 }}
            onClick={() => setSummaryOpen(true)}
          >
            Patient Summary &amp; Recent Visits
          </Button>
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
