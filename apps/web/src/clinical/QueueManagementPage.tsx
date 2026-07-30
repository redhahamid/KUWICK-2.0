import { useEffect, useState } from 'react';
import { Button, Card, Empty, Input, List, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { SoundOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useClinics } from '../core/hooks/useClinics';
import { useGlobalSetting, useSetGlobalSetting } from '../core/hooks/useGlobalSetting';
import {
  useArrivedTicket,
  useCallTicket,
  useCancelTicket,
  useCompleteTicket,
  useMoveToDispensary,
  useQueueTickets,
} from './hooks/useQueueTickets';
import { QueueTicket } from './types';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  WAITING: 'gold',
  IN_CONSULTATION: 'blue',
  DISPENSARY_PAYMENT: 'purple',
  COMPLETED: 'green',
  CANCELLED: 'default',
};

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
    { title: 'No.', dataIndex: 'ticketNumber' },
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
    { title: 'Location', render: (_: unknown, record: QueueTicket) => record.location ?? '—' },
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

const MONITOR_RUNNING_TEXT_KEY = 'queue_monitor_running_text';

export function QueueManagementPage() {
  const [clinicId, setClinicId] = useState<string>();
  const { data: clinics } = useClinics();
  const { data: allTickets, isLoading } = useQueueTickets({ clinicId });

  const { data: runningText } = useGlobalSetting<string>(MONITOR_RUNNING_TEXT_KEY);
  const setRunningText = useSetGlobalSetting<string>(MONITOR_RUNNING_TEXT_KEY);
  const [runningTextDraft, setRunningTextDraft] = useState('');
  useEffect(() => {
    if (typeof runningText === 'string') {
      setRunningTextDraft(runningText);
    }
  }, [runningText]);

  const callTicket = useCallTicket();
  const arrivedTicket = useArrivedTicket();
  const cancelTicket = useCancelTicket();
  const moveToDispensary = useMoveToDispensary();
  const completeTicket = useCompleteTicket();

  const reportFailure = (error: unknown, fallback: string) => {
    message.error(error instanceof ApiError ? error.message : fallback);
  };

  const handlers = {
    onCall: (id: string) => callTicket.mutateAsync({ id }).catch((e) => reportFailure(e, 'Failed to call')),
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

      <Space style={{ marginBottom: 16, width: '100%' }}>
        <Input
          prefix={<SoundOutlined />}
          placeholder="Monitor running text (e.g. a welcome message)"
          style={{ width: 420 }}
          value={runningTextDraft}
          onChange={(e) => setRunningTextDraft(e.target.value)}
          onBlur={() => runningTextDraft !== runningText && setRunningText.mutate(runningTextDraft)}
        />
      </Space>

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
                      <Text strong>
                        #{current.ticketNumber} — {current.visit.patient?.name}
                      </Text>
                      <Text type="secondary">{current.visit.billingType}</Text>
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
                            <Popconfirm key="cancel" title="Cancel this ticket?" onConfirm={() => handlers.onCancel(ticket.id)}>
                              <Button size="small" danger>
                                Cancel
                              </Button>
                            </Popconfirm>,
                          ]}
                        >
                          <Space direction="vertical" size={0}>
                            <Text strong>
                              #{ticket.ticketNumber} — {ticket.visit.patient?.name}
                            </Text>
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
                            #{ticket.ticketNumber} — {ticket.visit.patient?.name}
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
                    { title: 'No.', dataIndex: 'ticketNumber' },
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
                    { title: 'No.', dataIndex: 'ticketNumber' },
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
