import { Badge, Button, Empty, List, Popover, Tag, Typography } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useProcedureQueue } from '../../clinical/hooks/useProcedureQueue';

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
  const { data: pendingOrders } = useProcedureQueue({ clinicId, status: 'PENDING' });
  const pendingCount = pendingOrders?.length ?? 0;
  const totalCount = pendingCount + unreadChatCount;

  const content = (
    <div style={{ width: 300 }}>
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
          {unreadChatCount > 0 ? `${unreadChatCount} new message${unreadChatCount > 1 ? 's' : ''} →` : 'Open chat →'}
        </Button>
      </div>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight">
      <Badge count={totalCount} size="small">
        <Button type="text" shape="circle" icon={<BellOutlined style={{ fontSize: 16 }} />} />
      </Badge>
    </Popover>
  );
}
