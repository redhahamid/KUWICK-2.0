import { useState } from 'react';
import { Button, Card, Empty, List, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { PrinterOutlined, SoundOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useClinics } from '../core/hooks/useClinics';
import {
  useArrivedTicket,
  useCallTicket,
  useCancelTicket,
  useCompleteTicket,
  useMoveToDispensary,
  useQueueTickets,
  useRooms,
} from './hooks/useQueueTickets';
import { QueueTicket, QueueType } from './types';
import { ApiError } from '../core/api-client';
import { printQueueTicket } from './printQueueTicket';

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  WAITING: 'gold',
  IN_CONSULTATION: 'blue',
  DISPENSARY_PAYMENT: 'purple',
  COMPLETED: 'green',
  CANCELLED: 'default',
};

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
  complete?: boolean;
}, handlers: {
  onCall: (id: string) => void;
  onArrived: (id: string) => void;
  onCancel: (id: string) => void;
  onMoveToDispensary: (id: string) => void;
  onComplete: (id: string) => void;
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
          <div>{record.visit.patient?.name}</div>
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
          {showActions.complete && (
            <Button size="small" onClick={() => handlers.onComplete(record.id)}>
              Complete
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
  const [clinicId, setClinicId] = useState<string>();
  const { data: clinics } = useClinics();
  const { data: allTickets, isLoading } = useQueueTickets({ clinicId });

  // D-038 — calling a patient asks which room/station they're headed to,
  // so the monitor can pair "W001" with "Consultation 1".
  const [callTarget, setCallTarget] = useState<QueueTicket | null>(null);
  const [callRoomId, setCallRoomId] = useState<string>();
  // Rooms come from the *ticket's* clinic, not the page filter — the filter
  // is often unset when the clinic only has one location.
  const { data: rooms } = useRooms(callTarget?.clinicId ?? clinicId, true);

  const callTicket = useCallTicket();
  const arrivedTicket = useArrivedTicket();
  const cancelTicket = useCancelTicket();
  const moveToDispensary = useMoveToDispensary();
  const completeTicket = useCompleteTicket();

  const reportFailure = (error: unknown, fallback: string) => {
    message.error(error instanceof ApiError ? error.message : fallback);
  };

  const confirmCall = async () => {
    if (!callTarget) return;
    try {
      await callTicket.mutateAsync({ id: callTarget.id, input: { roomId: callRoomId } });
      const roomName = rooms?.find((room) => room.id === callRoomId)?.name;
      message.success(`Called ${ticketNumberLabel(callTarget)}${roomName ? ` to ${roomName}` : ''}`);
      setCallTarget(null);
      setCallRoomId(undefined);
    } catch (error) {
      reportFailure(error, 'Failed to call');
    }
  };

  const handlers = {
    onCall: (id: string) => {
      const ticket = allTickets?.find((t) => t.id === id) ?? null;
      setCallTarget(ticket);
      setCallRoomId(ticket?.roomId ?? undefined);
    },
    onArrived: (id: string) =>
      arrivedTicket.mutateAsync({ id }).catch((e) => reportFailure(e, 'Failed to mark arrived')),
    onCancel: (id: string) => cancelTicket.mutateAsync({ id }).catch((e) => reportFailure(e, 'Failed to cancel')),
    onMoveToDispensary: (id: string) =>
      moveToDispensary.mutateAsync({ id }).catch((e) => reportFailure(e, 'Failed to move to dispensary')),
    onComplete: (id: string) => completeTicket.mutateAsync({ id }).catch((e) => reportFailure(e, 'Failed to complete')),
  };

  const waiting = allTickets?.filter((t) => t.status === 'WAITING') ?? [];
  const consultation = allTickets?.filter((t) => t.status === 'IN_CONSULTATION') ?? [];
  const dispensary = allTickets?.filter((t) => t.status === 'DISPENSARY_PAYMENT') ?? [];
  const completed = allTickets?.filter((t) => t.status === 'COMPLETED') ?? [];
  const current = consultation[0];

  const monitorUrl = clinicId ? `${window.location.origin}/queue/monitor/${clinicId}` : undefined;

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Queue Management
        </Title>
        <Space>
          <Select
            allowClear
            placeholder="Select clinic"
            style={{ width: 220 }}
            value={clinicId}
            onChange={setClinicId}
            options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
          />
          <Button
            type="primary"
            disabled={!monitorUrl}
            onClick={() => monitorUrl && window.open(monitorUrl, '_blank')}
          >
            Launch Monitor
          </Button>
        </Space>
      </Space>

      <Modal
        title={callTarget ? `Call ${ticketNumberLabel(callTarget)}` : 'Call'}
        open={!!callTarget}
        onCancel={() => setCallTarget(null)}
        onOk={confirmCall}
        okText="Call"
        okButtonProps={{ icon: <SoundOutlined /> }}
        confirmLoading={callTicket.isPending}
      >
        <Select
          placeholder="Call to which room/station? (optional)"
          style={{ width: '100%' }}
          allowClear
          value={callRoomId}
          onChange={setCallRoomId}
          options={rooms?.map((room) => ({ value: room.id, label: room.name }))}
        />
        {(rooms?.length ?? 0) === 0 && (
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            No rooms set up yet — add them under Management &gt; Operation &gt; Rooms.
          </Text>
        )}
      </Modal>

      <Tabs
        items={[
          {
            key: 'overview',
            label: 'Overview',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <Card title="Consultation">
                  {current ? (
                    <Space direction="vertical">
                      <Space>
                        <Text strong>
                          {ticketNumberLabel(current)} — {current.visit.patient?.name}
                        </Text>
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
                              <Text strong>
                                {ticketNumberLabel(ticket)} — {ticket.visit.patient?.name}
                              </Text>
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
                      dataSource={completed.slice(0, 5)}
                      locale={{ emptyText: 'None yet today' }}
                      renderItem={(ticket: QueueTicket) => (
                        <List.Item>
                          <Text>
                            {ticketNumberLabel(ticket)} — {ticket.visit.patient?.name}
                          </Text>
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
            label: 'Dispensary & Payment',
            children:
              dispensary.length === 0 ? (
                <Empty description="Content for Dispensary & Payment will be added soon" />
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={dispensary}
                  columns={[
                    { title: 'No.', render: (_: unknown, r: QueueTicket) => ticketNumberLabel(r) },
                    { title: 'Patient', render: (_: unknown, r: QueueTicket) => r.visit.patient?.name },
                    { title: 'Doctor', render: (_: unknown, r: QueueTicket) => r.visit.staff?.fullName },
                    {
                      title: 'Action',
                      render: (_: unknown, r: QueueTicket) => (
                        <Button size="small" onClick={() => handlers.onComplete(r.id)}>
                          Complete
                        </Button>
                      ),
                    },
                  ]}
                />
              ),
          },
          {
            key: 'completed',
            label: 'Completed',
            children:
              completed.length === 0 ? (
                <Empty description="Content for Completed will be added soon" />
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={completed}
                  columns={[
                    { title: 'No.', render: (_: unknown, r: QueueTicket) => ticketNumberLabel(r) },
                    { title: 'Patient', render: (_: unknown, r: QueueTicket) => r.visit.patient?.name },
                    { title: 'Doctor', render: (_: unknown, r: QueueTicket) => r.visit.staff?.fullName },
                    {
                      title: 'Status',
                      render: (_: unknown, r: QueueTicket) => <Tag color={STATUS_COLOR[r.status]}>{r.status}</Tag>,
                    },
                  ]}
                />
              ),
          },
        ]}
      />
    </>
  );
}
