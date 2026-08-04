import { useRef, useState } from 'react';
import { Button, Card, Empty, List, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { FileTextOutlined, PlusOutlined, PrinterOutlined, SoundOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useStaff } from '../hr/hooks/useStaff';
import { useAuthStore } from '../core/auth-store';
import {
  useArrivedTicket,
  useCallTicket,
  useCancelTicket,
  useMoveToDispensary,
  useQueueBoard,
  useQueueTickets,
  useRooms,
} from './hooks/useQueueTickets';
import { QueueBoardRow, QueueTicket, QueueType } from './types';
import {
  BILLING_STATE_COLOR,
  BILLING_STATE_LABEL,
  QUEUE_STAGE_ORDER,
  STAGE_LABEL,
  completionDisabledReason,
  dispensingLabel,
  money,
  queueStatusColor,
  queueStatusLabel,
} from './queuePresentation';
import { CompleteVisitModal } from './queue/CompleteVisitModal';
import { QueueBlockerPanel } from './queue/QueueBlockerPanel';
import { ApiError } from '../core/api-client';
import { printQueueTicket } from './printQueueTicket';
import { AddQueuePatientDrawer } from './AddQueuePatientDrawer';

const { Title, Text } = Typography;

const DOCTOR_ROLES = new Set(['DOCTOR_RESIDENT', 'DOCTOR_LOCUM']);

// D-044 — the patient's name is now a link into their medical record, and
// a small hover icon opens the same record directly (both routes into the
// consultation record staff previously had no way to reach from Queue).
function PatientCell({ ticket }: { ticket: QueueTicket }) {
  return (
    <Space size={6}>
      <Link to={`/patients/${ticket.visit.patientId}?visitId=${ticket.visitId}`}>{ticket.visit.patient?.name}</Link>
      <Link
        to={`/patients/${ticket.visit.patientId}?visitId=${ticket.visitId}`}
        title="Open visit record"
        style={{ opacity: 0.5 }}
      >
        <FileTextOutlined />
      </Link>
    </Space>
  );
}

// D-038 — the 4 queue streams and their monitor colours.
const QUEUE_TYPE_TAG: Record<QueueType, { label: string; color: string }> = {
  APPOINTMENT: { label: 'A · Appointment', color: 'blue' },
  OTC: { label: 'C · OTC', color: 'cyan' },
  WALK_IN: { label: 'W · Walk-in', color: 'green' },
  EMERGENCY: { label: 'E · Emergency', color: 'red' },
};

function ticketNumberLabel(ticket: QueueTicket): string {
  return ticket.displayNumber ?? `#${ticket.ticketNumber}`;
}

function duration(from: string): string {
  const minutes = dayjs().diff(dayjs(from), 'minute');
  return `${minutes} min`;
}

// The full column set from the audited kuwick.com Waiting/Consultation
// tabs. Dispensary & Payment/Completed stay thinner (D-023,
// docs/DECISIONS.md) — matching the reference's own placeholder tabs —
// but still expose the one action needed to progress the ticket.
function detailColumns(showActions: {
  call?: boolean;
  arrived?: boolean;
  cancel?: boolean;
  moveToDispensary?: boolean;
}, handlers: {
  onCall: (id: string) => void;
  onArrived: (id: string) => void;
  onCancel: (id: string) => void;
  onMoveToDispensary: (id: string) => void;
}) {
  return [
    {
      title: 'No.',
      render: (_: unknown, record: QueueTicket) => <Text strong>{ticketNumberLabel(record)}</Text>,
    },
    {
      title: 'Type',
      render: (_: unknown, record: QueueTicket) => (
        <Tag color={QUEUE_TYPE_TAG[record.queueType].color}>{QUEUE_TYPE_TAG[record.queueType].label}</Tag>
      ),
    },
    { title: 'Visit No.', render: (_: unknown, record: QueueTicket) => record.visit.visitNumber },
    { title: 'Date', render: (_: unknown, record: QueueTicket) => dayjs(record.visit.checkInAt).format('YYYY-MM-DD') },
    {
      title: 'Check-in At',
      render: (_: unknown, record: QueueTicket) => dayjs(record.visit.checkInAt).format('HH:mm'),
    },
    {
      title: 'Called At',
      render: (_: unknown, record: QueueTicket) => (record.calledAt ? dayjs(record.calledAt).format('HH:mm') : '—'),
    },
    { title: 'Duration', render: (_: unknown, record: QueueTicket) => duration(record.visit.checkInAt) },
    {
      title: 'Patient',
      render: (_: unknown, record: QueueTicket) => (
        <>
          <div>
            <PatientCell ticket={record} />
          </div>
          <Text type="secondary">{record.visit.patient?.identifierValue}</Text>
        </>
      ),
    },
    { title: 'Billing Type', render: (_: unknown, record: QueueTicket) => record.visit.billingType },
    {
      title: 'Presenting Complaint',
      render: (_: unknown, record: QueueTicket) => record.visit.presentingComplaint ?? '—',
    },
    { title: 'Doctor', render: (_: unknown, record: QueueTicket) => record.visit.staff?.fullName ?? '—' },
    { title: 'Room', render: (_: unknown, record: QueueTicket) => record.room?.name ?? record.location ?? '—' },
    {
      // G4.5d3c-3b (D-095) — the exact state within the stage. This is where
      // "At procedure" shows: the patient is out at a procedure while the
      // doctor still holds the visit, so they stay under Consultation rather
      // than acquiring a tab of their own.
      title: 'Stage',
      render: (_: unknown, record: QueueTicket) => (
        <Tag color={queueStatusColor(record.status)}>{queueStatusLabel(record.status) ?? '—'}</Tag>
      ),
    },
    {
      title: 'Actions',
      render: (_: unknown, record: QueueTicket) => (
        <Space wrap>
          {showActions.call && (
            <Button size="small" onClick={() => handlers.onCall(record.id)}>
              Call
            </Button>
          )}
          {showActions.arrived && (
            <Button size="small" onClick={() => handlers.onArrived(record.id)}>
              Arrived
            </Button>
          )}
          {showActions.moveToDispensary && (
            <Button size="small" onClick={() => handlers.onMoveToDispensary(record.id)}>
              Move to Dispensary
            </Button>
          )}
          {showActions.cancel && (
            <Popconfirm title="Cancel this ticket?" onConfirm={() => handlers.onCancel(record.id)}>
              <Button size="small" danger>
                Cancel
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];
}

export function QueueManagementPage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const { data: staff } = useStaff();
  const currentStaff = useAuthStore((state) => state.staff);
  const { data: allTickets, isLoading } = useQueueTickets({ clinicId });
  // D-095 — one server read for stages, counts, dispensing progress, billing
  // state, blockers and the completion decision. The browser derives none of
  // it, and in particular never decides whether a visit may be completed.
  const { data: board, isLoading: boardLoading } = useQueueBoard(clinicId);
  const [addPatientOpen, setAddPatientOpen] = useState(false);
  const [completeTarget, setCompleteTarget] = useState<QueueBoardRow | null>(null);
  const completeTriggerRef = useRef<HTMLElement | null>(null);

  // D-038 — calling a patient asks which room/station they're headed to,
  // so the monitor can pair "W001" with "Consultation 1". D-044: also lets
  // staff (re)assign the attending doctor at call time, auto-selecting the
  // logged-in staff member if they're a doctor.
  const [callTarget, setCallTarget] = useState<QueueTicket | null>(null);
  const [callRoomId, setCallRoomId] = useState<string>();
  const [callStaffId, setCallStaffId] = useState<string>();
  // Rooms come from the *ticket's* clinic, not the page filter — the filter
  // is often unset when the clinic only has one location.
  const { data: rooms } = useRooms(callTarget?.clinicId ?? clinicId, true);

  const callTicket = useCallTicket();
  const arrivedTicket = useArrivedTicket();
  const cancelTicket = useCancelTicket();
  const moveToDispensary = useMoveToDispensary();

  const reportFailure = (error: unknown, fallback: string) => {
    message.error(error instanceof ApiError ? error.message : fallback);
  };

  const confirmCall = async () => {
    if (!callTarget) return;
    try {
      await callTicket.mutateAsync({ id: callTarget.id, input: { roomId: callRoomId, staffId: callStaffId } });
      const roomName = rooms?.find((room) => room.id === callRoomId)?.name;
      message.success(`Called ${ticketNumberLabel(callTarget)}${roomName ? ` to ${roomName}` : ''}`);
      setCallTarget(null);
      setCallRoomId(undefined);
      setCallStaffId(undefined);
    } catch (error) {
      reportFailure(error, 'Failed to call');
    }
  };

  const handlers = {
    onCall: (id: string) => {
      const ticket = allTickets?.find((t) => t.id === id) ?? null;
      setCallTarget(ticket);
      setCallRoomId(ticket?.roomId ?? undefined);
      const isDoctor = currentStaff && DOCTOR_ROLES.has(currentStaff.role);
      setCallStaffId(isDoctor ? currentStaff!.id : ticket?.visit.staff?.id);
    },
    onArrived: (id: string) =>
      arrivedTicket.mutateAsync({ id }).catch((e) => reportFailure(e, 'Failed to mark arrived')),
    onCancel: (id: string) => cancelTicket.mutateAsync({ id }).catch((e) => reportFailure(e, 'Failed to cancel')),
    onMoveToDispensary: (id: string) =>
      moveToDispensary.mutateAsync({ id }).catch((e) => reportFailure(e, 'Failed to move to dispensary')),
  };

  // D-095 — Complete Visit is never fired blind. The row carries the server's
  // decision and its blockers; the modal shows what is being asserted, and the
  // server re-evaluates inside its own transaction on submit.
  const openComplete = (row: QueueBoardRow, event?: { currentTarget: HTMLElement }) => {
    completeTriggerRef.current = event?.currentTarget ?? null;
    setCompleteTarget(row);
  };

  // The ticket list keeps serving the two tabs whose rich columns and queue
  // actions it already owns; the board serves the three downstream stages,
  // whose rows need dispensing, billing and blocker state.
  //
  // AT_PROCEDURE is grouped WITH in-consultation here — the defect this
  // checkpoint closes is that it, READY_FOR_DISPENSARY and READY_FOR_PAYMENT
  // matched no filter at all, so those patients disappeared from the board.
  const waiting = allTickets?.filter((t) => t.status === 'WAITING') ?? [];
  const consultation =
    allTickets?.filter((t) => t.status === 'IN_CONSULTATION' || t.status === 'AT_PROCEDURE') ?? [];
  const rows = board?.rows ?? [];
  const dispensaryRows = rows.filter((r) => r.stage === 'DISPENSARY');
  const paymentRows = rows.filter((r) => r.stage === 'PAYMENT');
  const completedRows = rows.filter((r) => r.stage === 'COMPLETED');
  const counts = board?.counts ?? {
    totalToday: 0, waiting: 0, consultation: 0, dispensary: 0, payment: 0, completed: 0, cancelled: 0,
  };
  const current = consultation[0];

  const monitorUrl = clinicId ? `${window.location.origin}/queue/monitor/${clinicId}` : undefined;

  return (
    // kw-operational-surface — Complete Visit lives in the bottom-right of
    // these rows on a phone, so the floating chat launcher stands down here.
    <div className="kw-operational-surface">
      {/* wrap + a non-shrinking title: without it the heading was squeezed to
          one character per line on a 375px screen while the action buttons
          held their width. */}
      <Space
        wrap
        style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between', rowGap: 12 }}
      >
        <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>
          Queue Management
        </Title>
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
          <Button icon={<PlusOutlined />} onClick={() => setAddPatientOpen(true)}>
            Add to Queue
          </Button>
          <Button
            type="primary"
            disabled={!monitorUrl}
            onClick={() => monitorUrl && window.open(monitorUrl, '_blank')}
          >
            Launch Monitor
          </Button>
        </Space>
      </Space>

      <AddQueuePatientDrawer open={addPatientOpen} onClose={() => setAddPatientOpen(false)} />

      <Modal
        title={callTarget ? `Call ${ticketNumberLabel(callTarget)}` : 'Call'}
        open={!!callTarget}
        onCancel={() => setCallTarget(null)}
        onOk={confirmCall}
        okText="Call"
        okButtonProps={{ icon: <SoundOutlined /> }}
        confirmLoading={callTicket.isPending}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Room / Station
            </Text>
            <Select
              placeholder="Call to which room/station? (optional)"
              style={{ width: '100%' }}
              allowClear
              value={callRoomId}
              onChange={setCallRoomId}
              options={rooms?.map((room) => ({ value: room.id, label: room.name }))}
            />
            {(rooms?.length ?? 0) === 0 && (
              <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                No rooms set up yet — add them under Management &gt; Operation &gt; Rooms.
              </Text>
            )}
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Attending Doctor
            </Text>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Assign doctor"
              style={{ width: '100%' }}
              value={callStaffId}
              onChange={setCallStaffId}
              options={staff?.map((member) => ({ value: member.id, label: member.fullName }))}
            />
          </div>
        </Space>
      </Modal>

      {/* The stage navigation is a landmark with a name: antd puts role
          ="tablist" on its own nav strip and does not forward an aria-label
          onto it, so the name lives on the wrapper where assistive tech will
          actually announce it. Below the desktop breakpoint the strip scrolls
          horizontally and antd keeps the active tab in view, which is the
          approved behaviour rather than wrapping six stages onto two lines. */}
      <nav aria-label="Queue stages">
      <Tabs
        type="line"
        tabBarGutter={16}
        items={[
          {
            key: 'overview',
            label: 'Overview',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                {/* D-095 — one card per operational stage, counted by the
                    server. A visit may legitimately skip stages, so this is a
                    reading order, not a required path. */}
                <Space size={12} wrap>
                  <Card size="small" style={{ minWidth: 150 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Total today</Text>
                    <div><Text strong style={{ fontSize: 22 }}>{counts.totalToday}</Text></div>
                  </Card>
                  {QUEUE_STAGE_ORDER.map((stage) => (
                    <Card key={stage} size="small" style={{ minWidth: 150 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{STAGE_LABEL[stage]}</Text>
                      <div>
                        <Text strong style={{ fontSize: 22 }}>
                          {stage === 'WAITING' ? counts.waiting
                            : stage === 'CONSULTATION' ? counts.consultation
                            : stage === 'DISPENSARY' ? counts.dispensary
                            : stage === 'PAYMENT' ? counts.payment
                            : counts.completed}
                        </Text>
                      </div>
                    </Card>
                  ))}
                </Space>

                <Card size="small" title="Live patient flow">
                  <Space size={4} wrap>
                    {QUEUE_STAGE_ORDER.map((stage, index) => (
                      <Space key={stage} size={4}>
                        <Tag>
                          {index + 1}. {STAGE_LABEL[stage]} ·{' '}
                          {stage === 'WAITING' ? counts.waiting
                            : stage === 'CONSULTATION' ? counts.consultation
                            : stage === 'DISPENSARY' ? counts.dispensary
                            : stage === 'PAYMENT' ? counts.payment
                            : counts.completed}
                        </Tag>
                        {index < QUEUE_STAGE_ORDER.length - 1 && <Text type="secondary">→</Text>}
                      </Space>
                    ))}
                  </Space>
                  <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                    A visit may skip stages — a consultation with no medication and nothing to bill goes straight to
                    completed.
                  </Text>
                </Card>

                <Card title="Consultation">
                  {current ? (
                    <Space direction="vertical">
                      <Space>
                        <Text strong>{ticketNumberLabel(current)} —</Text>
                        <PatientCell ticket={current} />
                        <Tag color={QUEUE_TYPE_TAG[current.queueType].color}>
                          {QUEUE_TYPE_TAG[current.queueType].label}
                        </Tag>
                      </Space>
                      <Text type="secondary">
                        {current.visit.billingType}
                        {current.room ? ` · ${current.room.name}` : ''}
                      </Text>
                    </Space>
                  ) : (
                    <Text type="secondary">No patient is currently being served.</Text>
                  )}
                </Card>
                <Space align="start" size="large" style={{ width: '100%' }} wrap>
                  <Card title={`Waiting List (${waiting.length})`} style={{ minWidth: 360 }}>
                    <List
                      dataSource={waiting}
                      locale={{ emptyText: 'No one waiting' }}
                      renderItem={(ticket: QueueTicket) => (
                        <List.Item
                          actions={[
                            <Button key="call" size="small" onClick={() => handlers.onCall(ticket.id)}>
                              Call
                            </Button>,
                            <Button key="arrived" size="small" onClick={() => handlers.onArrived(ticket.id)}>
                              Arrived
                            </Button>,
                            <Button
                              key="print"
                              size="small"
                              icon={<PrinterOutlined />}
                              disabled={!ticket.displayNumber}
                              onClick={() =>
                                ticket.displayNumber &&
                                printQueueTicket(
                                  ticket.displayNumber,
                                  clinics?.find((clinic) => clinic.id === ticket.clinicId)?.name ?? '',
                                )
                              }
                            />,
                            <Popconfirm key="cancel" title="Cancel this ticket?" onConfirm={() => handlers.onCancel(ticket.id)}>
                              <Button size="small" danger>
                                Cancel
                              </Button>
                            </Popconfirm>,
                          ]}
                        >
                          <Space direction="vertical" size={0}>
                            <Space>
                              <Text strong>{ticketNumberLabel(ticket)} —</Text>
                              <PatientCell ticket={ticket} />
                              <Tag color={QUEUE_TYPE_TAG[ticket.queueType].color}>
                                {QUEUE_TYPE_TAG[ticket.queueType].label}
                              </Tag>
                            </Space>
                            <Text type="secondary">{ticket.visit.billingType}</Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>
                  <Card title="Recently Completed" style={{ minWidth: 360 }}>
                    <List
                      dataSource={completedRows.slice(0, 5)}
                      locale={{ emptyText: 'None yet today' }}
                      renderItem={(row: QueueBoardRow) => (
                        <List.Item>
                          <Space size={6}>
                            <Text>{row.displayNumber ?? '—'} —</Text>
                            <Link to={`/patients/${row.patientId}?visitId=${row.visitId}`}>{row.patientName}</Link>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>
                </Space>
              </Space>
            ),
          },
          {
            key: 'waiting',
            label: `Waiting (${waiting.length})`,
            children: (
              <Table
                rowKey="id"
                loading={isLoading}
                dataSource={waiting}
                columns={detailColumns({ call: true, arrived: true, cancel: true }, handlers)}
              />
            ),
          },
          {
            key: 'consultation',
            label: `Consultation (${consultation.length})`,
            children: (
              <Table
                rowKey="id"
                loading={isLoading}
                dataSource={consultation}
                columns={detailColumns({ moveToDispensary: true }, handlers)}
              />
            ),
          },
          {
            key: 'dispensary',
            label: `Dispensary (${counts.dispensary})`,
            children: (
              <Table
                rowKey="ticketId"
                size="small"
                loading={boardLoading}
                dataSource={dispensaryRows}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: <Empty description="No patient is waiting for medication." /> }}
                columns={[
                  { title: 'No.', width: 90, render: (_: unknown, r: QueueBoardRow) => <Text strong>{r.displayNumber ?? '—'}</Text> },
                  {
                    title: 'Patient',
                    render: (_: unknown, r: QueueBoardRow) => (
                      <Space direction="vertical" size={0}>
                        <Link to={`/patients/${r.patientId}?visitId=${r.visitId}`}>{r.patientName}</Link>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          Checked in {dayjs(r.checkInAt).format('HH:mm')}
                        </Text>
                      </Space>
                    ),
                  },
                  { title: 'Doctor', render: (_: unknown, r: QueueBoardRow) => r.doctorName ?? '—' },
                  {
                    title: 'Medication',
                    render: (_: unknown, r: QueueBoardRow) => (
                      <Space direction="vertical" size={0}>
                        <Text>{dispensingLabel(r.dispensing)}</Text>
                        {r.dispensing.remaining > 0 && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            Dispense from the clinical visit — the dispensary workspace is a later checkpoint.
                          </Text>
                        )}
                      </Space>
                    ),
                  },
                  { title: 'Billing type', render: (_: unknown, r: QueueBoardRow) => r.panelName ?? r.billingType },
                  {
                    title: 'Status',
                    render: (_: unknown, r: QueueBoardRow) => (
                      <Tag color={queueStatusColor(r.status)}>{queueStatusLabel(r.status) ?? '—'}</Tag>
                    ),
                  },
                  {
                    title: 'Actions',
                    width: 190,
                    render: (_: unknown, r: QueueBoardRow) => <RowActions row={r} onComplete={openComplete} />,
                  },
                ]}
                expandable={{
                  rowExpandable: (r: QueueBoardRow) => (r.blockers?.length ?? 0) > 0,
                  expandedRowRender: (r: QueueBoardRow) => <QueueBlockerPanel row={r} />,
                }}
              />
            ),
          },
          {
            key: 'payment',
            label: `Payment (${counts.payment})`,
            children: (
              <Table
                rowKey="ticketId"
                size="small"
                loading={boardLoading}
                dataSource={paymentRows}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: <Empty description="Nothing is waiting for payment." /> }}
                columns={[
                  {
                    title: 'No.',
                    width: 90,
                    render: (_: unknown, r: QueueBoardRow) => (
                      <Space direction="vertical" size={0}>
                        <Text strong>{r.displayNumber ?? '—'}</Text>
                        {/* Legacy rows are labelled, never quietly presented
                            as modern tickets. */}
                        {r.legacyStatus && <Tag>Legacy</Tag>}
                      </Space>
                    ),
                  },
                  {
                    title: 'Patient',
                    render: (_: unknown, r: QueueBoardRow) => (
                      <Link to={`/patients/${r.patientId}?visitId=${r.visitId}`}>{r.patientName}</Link>
                    ),
                  },
                  { title: 'Doctor', render: (_: unknown, r: QueueBoardRow) => r.doctorName ?? '—' },
                  { title: 'Billing type', render: (_: unknown, r: QueueBoardRow) => r.panelName ?? r.billingType },
                  {
                    title: 'Total',
                    align: 'right' as const,
                    render: (_: unknown, r: QueueBoardRow) => money(r.billing.grandTotal) ?? '—',
                  },
                  {
                    title: 'Panel',
                    align: 'right' as const,
                    render: (_: unknown, r: QueueBoardRow) => money(r.billing.panelResponsibility) ?? '—',
                  },
                  {
                    title: 'Patient owes',
                    align: 'right' as const,
                    render: (_: unknown, r: QueueBoardRow) =>
                      r.billing.remainingBalance === null ? (
                        <Text type="secondary">Unresolved</Text>
                      ) : (
                        <Text strong>{money(r.billing.remainingBalance)}</Text>
                      ),
                  },
                  {
                    title: 'Billing status',
                    render: (_: unknown, r: QueueBoardRow) => (
                      <Space direction="vertical" size={2}>
                        <Tag color={BILLING_STATE_COLOR[r.billing.state]}>{BILLING_STATE_LABEL[r.billing.state]}</Tag>
                        {/* Consultation-tariff review lives HERE, in the
                            payment workload — not in a tab of its own. */}
                        {r.blockers?.some((b) => b.code === 'CONSULTATION_TARIFF_REVIEW_REQUIRED') && (
                          <Tag color="red">Tariff review required</Tag>
                        )}
                      </Space>
                    ),
                  },
                  {
                    title: 'Actions',
                    width: 190,
                    render: (_: unknown, r: QueueBoardRow) => <RowActions row={r} onComplete={openComplete} />,
                  },
                ]}
                expandable={{
                  rowExpandable: (r: QueueBoardRow) => (r.blockers?.length ?? 0) > 0,
                  expandedRowRender: (r: QueueBoardRow) => <QueueBlockerPanel row={r} />,
                }}
              />
            ),
          },
          {
            key: 'completed',
            label: `Completed (${counts.completed})`,
            children: (
              <Table
                rowKey="ticketId"
                size="small"
                loading={boardLoading}
                dataSource={completedRows}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: <Empty description="No visit has been completed today yet." /> }}
                columns={[
                  { title: 'No.', width: 90, render: (_: unknown, r: QueueBoardRow) => r.displayNumber ?? '—' },
                  {
                    title: 'Patient',
                    render: (_: unknown, r: QueueBoardRow) => (
                      <Link to={`/patients/${r.patientId}?visitId=${r.visitId}`}>{r.patientName}</Link>
                    ),
                  },
                  { title: 'Doctor', render: (_: unknown, r: QueueBoardRow) => r.doctorName ?? '—' },
                  { title: 'Checked in', render: (_: unknown, r: QueueBoardRow) => dayjs(r.checkInAt).format('HH:mm') },
                  {
                    title: 'Checked out',
                    render: (_: unknown, r: QueueBoardRow) => (r.checkOutAt ? dayjs(r.checkOutAt).format('HH:mm') : '—'),
                  },
                  { title: 'Billing type', render: (_: unknown, r: QueueBoardRow) => r.panelName ?? r.billingType },
                  {
                    title: 'Status',
                    render: (_: unknown, r: QueueBoardRow) => (
                      <Tag color={queueStatusColor(r.status)}>{queueStatusLabel(r.status) ?? '—'}</Tag>
                    ),
                  },
                  {
                    // Completed history is READ ONLY: no completion action is
                    // offered on a visit that is already closed.
                    title: 'Actions',
                    width: 170,
                    render: (_: unknown, r: QueueBoardRow) => (
                      <Space size={4} wrap>
                        <Link to={`/patients/${r.patientId}?visitId=${r.visitId}`}>Open visit</Link>
                        {r.billing.invoiceId && (
                          <Link to={`/billing/visits/${r.visitId}?invoiceId=${r.billing.invoiceId}`}>Open invoice</Link>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />
      </nav>

      <CompleteVisitModal
        row={completeTarget}
        onClose={() => setCompleteTarget(null)}
        onAfterClose={() => completeTriggerRef.current?.focus()}
      />
    </div>
  );
}

/**
 * G4.5d3c-3b (D-095) — a queue row's actions.
 *
 * Complete Visit is offered ONLY where the server said so. Where it is not,
 * the control is shown disabled with the reason visible rather than removed,
 * so staff learn what to fix instead of wondering where the button went.
 */
function RowActions({
  row,
  onComplete,
}: {
  row: QueueBoardRow;
  onComplete: (row: QueueBoardRow, event: { currentTarget: HTMLElement }) => void;
}) {
  const reason = completionDisabledReason(row);
  const permissionWithheld = reason === 'Your role is not permitted to complete a visit.';
  return (
    <Space size={4} wrap>
      <Link to={`/billing/visits/${row.visitId}`}>Billing Review</Link>
      {!permissionWithheld && (
        <Tooltip title={reason ?? undefined}>
          <Button
            size="small"
            type={row.canComplete ? 'primary' : 'default'}
            disabled={!row.canComplete}
            aria-label={`Complete visit for ${row.patientName}`}
            aria-description={reason ?? undefined}
            style={{ minHeight: 44 }}
            onClick={(event) => onComplete(row, event)}
          >
            Complete Visit
          </Button>
        </Tooltip>
      )}
    </Space>
  );
}
