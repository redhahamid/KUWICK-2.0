import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Segmented,
  Space,
  Modal,
  Spin,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
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
import { InvoiceTab } from './InvoiceTab';
import { useOrderServices } from './hooks/useOrderServices';
import { useIsDesktop } from '../core/hooks/useMediaQuery';
import { useRecordViewLayoutStore } from './record-view-layout-store';
import { CanvasPatientHeader } from './CanvasPatientHeader';
import { PatientSummarySidebar } from './PatientSummarySidebar';
import { DiagnosisSummaryCard } from './DiagnosisSummaryCard';
import { OrdersSummaryCard } from './OrdersSummaryCard';
import { MedicationsSummaryCard } from './MedicationsSummaryCard';
import { DocumentsInvoiceSummaryCard } from './DocumentsInvoiceSummaryCard';
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
  // "No page scroll" only makes sense as a desktop affordance — on mobile/
  // tablet widths Canvas falls back to a stacked, naturally-scrolling
  // layout instead of fighting for space in a short viewport (user
  // feedback: needs to be responsive to all device sizes).
  const canvasFill = layout === 'canvas' && Boolean(selectedVisit) && isDesktop;

  return (
    <div style={canvasFill ? { display: 'flex', flexDirection: 'column', height: '100%' } : undefined}>
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
        <Space wrap style={{ marginBottom: 6, width: '100%', justifyContent: 'flex-end', flex: '0 0 auto' }}>
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

      <Row gutter={[16, 16]} style={canvasFill ? { flex: '1 1 auto', minHeight: 0 } : undefined}>
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
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {visits && visits.length > 0 ? (
                visits.map((visit) => (
                  <div
                    key={visit.id}
                    onClick={() => setSelectedVisitId(visit.id)}
                    style={{
                      cursor: 'pointer',
                      padding: 12,
                      borderRadius: 8,
                      background: visit.id === selectedVisit?.id ? '#4338ca' : '#fafafa',
                      color: visit.id === selectedVisit?.id ? '#fff' : undefined,
                    }}
                  >
                    <Text strong style={{ color: 'inherit' }}>
                      {dayjs(visit.checkInAt).format('D MMM YYYY')}
                    </Text>
                    <div>
                      <Text style={{ color: 'inherit', opacity: 0.8, fontSize: 12 }}>
                        {dayjs(visit.checkInAt).format('HH:mm')}
                      </Text>
                    </div>
                    <Tag style={{ marginTop: 4 }}>{visit.visitNumber}</Tag>
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      <div>Billing Type: {visit.billingType}</div>
                      <div>Doctor: {visit.staff?.fullName ?? '—'}</div>
                    </div>
                  </div>
                ))
              ) : (
                <Text type="secondary">No visits yet</Text>
              )}
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
                {activeTab.key === 'invoices' && <InvoiceTab visit={selectedVisit} />}
              </Card>
            </Col>
          </>
        )}

        {selectedVisit && layout === 'canvas' && (
          <>
            <Col xs={24} lg={16} style={canvasFill ? { height: '100%' } : undefined}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: canvasFill ? '100%' : undefined,
                  gap: 6,
                }}
              >
                <Card
                  size="small"
                  title={<Space>Clinical Notes <Tag>{selectedVisit.visitNumber}</Tag></Space>}
                  style={
                    canvasFill
                      ? { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }
                      : undefined
                  }
                  styles={
                    canvasFill
                      ? {
                          header: { padding: '4px 12px', minHeight: 28 },
                          body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 6 },
                        }
                      : undefined
                  }
                >
                  <ClinicalNotesTab visitId={selectedVisit.id} patientId={patient.id} compact />
                </Card>
                <Row gutter={[8, 8]} style={canvasFill ? { flex: '0 0 118px', minHeight: 0 } : undefined}>
                  <Col xs={12} sm={12} lg={6} style={canvasFill ? { height: '100%' } : undefined}>
                    <DiagnosisSummaryCard visitId={selectedVisit.id} />
                  </Col>
                  <Col xs={12} sm={12} lg={6} style={canvasFill ? { height: '100%' } : undefined}>
                    <OrdersSummaryCard visitId={selectedVisit.id} />
                  </Col>
                  <Col xs={12} sm={12} lg={6} style={canvasFill ? { height: '100%' } : undefined}>
                    <MedicationsSummaryCard visitId={selectedVisit.id} />
                  </Col>
                  <Col xs={12} sm={12} lg={6} style={canvasFill ? { height: '100%' } : undefined}>
                    <DocumentsInvoiceSummaryCard
                      visit={selectedVisit}
                      patientName={patient.name}
                      patientIdentifier={patient.identifierValue}
                    />
                  </Col>
                </Row>
              </div>
            </Col>

            <Col xs={24} lg={8} style={canvasFill ? { height: '100%', overflowY: 'auto' } : undefined}>
              <PatientSummarySidebar
                patient={patient}
                visits={visits}
                selectedVisitId={selectedVisit.id}
                onSelectVisit={requestVisitChange}
                expanded={expandProfile}
                onToggleExpand={() => setExpandProfile((prev) => !prev)}
                onNewVisit={() => setNewVisitOpen(true)}
              />
            </Col>
          </>
        )}
      </Row>

      <EditPatientDrawer patient={patient} open={editOpen} onClose={() => setEditOpen(false)} />
      <NewVisitDrawer
        patient={patient}
        open={newVisitOpen}
        onClose={() => setNewVisitOpen(false)}
        onCreated={(visitId) => setSelectedVisitId(visitId)}
      />
    </div>
  );
}
