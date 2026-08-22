import { useEffect, useRef } from 'react';
import { Badge, Button, Empty, List, Popover, Tag, Typography, notification } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useProcedureQueue } from '../../clinical/hooks/useProcedureQueue';
import {
  StaffNotificationRow,
  notificationWord,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useStaffNotifications,
} from '../../appointment/hooks/useStaffNotifications';

const { Text } = Typography;

interface NotificationBellProps {
  unreadChatCount: number;
  onOpenChat: () => void;
}

// D-046 — owner: "task bell notifications" combining pending tasks (the
// Procedure Task Queue's PENDING items, so nothing new is invented — this
// just surfaces the existing queue) and unread clinic chat. Pending-task
// count is always "live" (no read/unread concept — a task stays pending
// until it's actually accepted), unread chat clears when the chat drawer
// opens (see ClinicChatWidget).
export function NotificationBell({ unreadChatCount, onOpenChat }: NotificationBellProps) {
  const { clinicId } = useClinicFilter();
  const navigate = useNavigate();
  const { data: pendingOrders } = useProcedureQueue({ clinicId, status: 'PENDING' });
  // PHASE 5 — the appointment inbox: persisted per-recipient rows, polled.
  const { data: inbox } = useStaffNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const pendingCount = pendingOrders?.length ?? 0;
  const appointmentUnread = inbox?.unread ?? 0;
  const totalCount = pendingCount + unreadChatCount + appointmentUnread;

  const openNotification = (row: StaffNotificationRow) => {
    if (!row.readAt) markRead.mutate(row.id);
    if (row.appointmentId) {
      navigate(`/appointments/list?open=${row.appointmentId}`);
    }
  };

  // THE TOAST (§5A) — non-blocking, auto-dismissing, and only for rows that
  // ARRIVED while this session was open: everything older is the centre's
  // job, and toasting a day's backlog on sign-in would be a wall of noise.
  const sessionStart = useRef(new Date().toISOString());
  const toasted = useRef(new Set<string>());
  const [toastApi, toastHolder] = notification.useNotification();
  useEffect(() => {
    if (!inbox) return;
    const fresh = inbox.rows
      .filter((row) => !row.readAt && row.createdAt > sessionStart.current)
      .filter((row) => !toasted.current.has(row.id))
      .slice(0, 3);
    for (const row of fresh) {
      toasted.current.add(row.id);
      toastApi.open({
        message: notificationWord(row),
        description: (
          <div>
            {row.body.split(' · ').map((line) => (
              <div key={line}>{line}</div>
            ))}
            {row.appointmentId ? (
              <Button
                size="small"
                type="primary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  toastApi.destroy(row.id);
                  openNotification(row);
                }}
              >
                View appointment
              </Button>
            ) : null}
          </div>
        ),
        key: row.id,
        duration: 8,
        placement: 'topRight',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox]);

  const content = (
    <div style={{ width: 300 }}>
      {/* PHASE 5 — appointment activity first: it is the only section with a
          real unread state, and the one a front desk acts on. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text strong style={{ fontSize: 13 }}>
          Appointments
        </Text>
        <span>
          {appointmentUnread > 0 ? (
            <Button
              size="small"
              type="link"
              style={{ padding: 0, marginRight: 8, fontSize: 12 }}
              onClick={() => markAllRead.mutate()}
            >
              Mark all read
            </Button>
          ) : null}
          <Tag color={appointmentUnread > 0 ? 'blue' : 'default'}>{appointmentUnread}</Tag>
        </span>
      </div>
      {(inbox?.rows.length ?? 0) === 0 ? (
        <Empty
          description="Nothing yet — new bookings and patient changes land here"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ padding: '8px 0' }}
        />
      ) : (
        <List
          size="small"
          dataSource={inbox?.rows.slice(0, 6)}
          data-testid="appointment-notification-list"
          renderItem={(row) => (
            <List.Item style={{ padding: '5px 0', border: 'none' }}>
              <button
                type="button"
                onClick={() => openNotification(row)}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  width: '100%',
                  fontSize: 12,
                  opacity: row.readAt ? 0.62 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <Text strong={!row.readAt} style={{ fontSize: 12 }}>
                    {notificationWord(row)}
                  </Text>
                  {!row.readAt ? (
                    <span
                      aria-label="unread"
                      style={{
                        width: 7,
                        height: 7,
                        marginTop: 5,
                        borderRadius: '50%',
                        background: '#1d4ed8',
                        flex: 'none',
                      }}
                    />
                  ) : null}
                </div>
                <div style={{ color: 'rgba(0,0,0,0.55)', fontSize: 11, lineHeight: 1.5 }}>
                  {row.body}
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {dayjs(row.createdAt).format('D MMM, h:mm A')} · {row.clinicName}
                </Text>
              </button>
            </List.Item>
          )}
        />
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f0f0f0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text strong style={{ fontSize: 13 }}>
          Pending Tasks
        </Text>
        <Tag color={pendingCount > 0 ? 'gold' : 'default'}>{pendingCount}</Tag>
      </div>
      {pendingCount === 0 ? (
        <Empty description="Nothing pending" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '8px 0' }} />
      ) : (
        <>
          <List
            size="small"
            dataSource={pendingOrders?.slice(0, 5)}
            renderItem={(order) => (
              <List.Item style={{ padding: '4px 0', border: 'none' }}>
                <Link to="/procedure-queue" style={{ fontSize: 12, width: '100%' }}>
                  <div>{order.procedureName}</div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {order.visit?.patient?.name ?? 'Unknown patient'} · {dayjs(order.requestedAt).format('D MMM, h:mm A')}
                  </Text>
                </Link>
              </List.Item>
            )}
          />
          <Link to="/procedure-queue" style={{ fontSize: 12 }}>
            View all {pendingCount} pending →
          </Link>
        </>
      )}

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <Text strong style={{ fontSize: 13 }}>
            Clinic Chat
          </Text>
          <Tag color={unreadChatCount > 0 ? 'blue' : 'default'}>{unreadChatCount}</Tag>
        </div>
        <Button size="small" type="link" style={{ padding: 0, fontSize: 12 }} onClick={onOpenChat}>
          {unreadChatCount > 0 ? `${unreadChatCount} channel${unreadChatCount > 1 ? 's' : ''} with new messages →` : 'Open chat →'}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {toastHolder}
      <Popover content={content} trigger="click" placement="bottomRight">
        <Badge count={totalCount} size="small">
          <Button type="text" shape="circle" icon={<BellOutlined style={{ fontSize: 16 }} />} />
        </Badge>
      </Popover>
    </>
  );
}
