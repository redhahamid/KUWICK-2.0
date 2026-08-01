import { useEffect, useMemo } from 'react';
import { Badge, Button, Drawer, Select, Space, message } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { useAuthStore } from '../core/auth-store';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useClinicChat, useSendClinicChat } from './hooks/useChat';
import { ChatPanel } from './ChatPanel';
import { ApiError } from '../core/api-client';

const SEEN_STORAGE_PREFIX = 'kuwick-chat-seen-';

// D-046 — the general clinic-wide chat box (owner: "internal clinic chat").
// A floating button is always reachable across the app (mounted once in
// AppLayout); the NotificationBell can also drive it open via the same
// `open`/`onOpenChange` pair so both entry points share one Drawer.
// "Unread" is tracked client-side (a per-clinic "last seen" timestamp in
// localStorage) rather than a server read-receipts table — this app has no
// realtime infra, so a lightweight client marker matching the existing
// polling convention is enough for a badge count.
interface ClinicChatWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnreadChange?: (count: number) => void;
}

export function ClinicChatWidget({ open, onOpenChange, onUnreadChange }: ClinicChatWidgetProps) {
  const staff = useAuthStore((state) => state.staff);
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const { data: messages, isLoading } = useClinicChat(clinicId);
  const sendChat = useSendClinicChat(clinicId);

  const storageKey = clinicId ? `${SEEN_STORAGE_PREFIX}${clinicId}` : undefined;

  useEffect(() => {
    // First-ever visit to this clinic's chat: don't retroactively flag
    // pre-existing history as unread, only messages from here on.
    if (storageKey && !localStorage.getItem(storageKey)) {
      localStorage.setItem(storageKey, new Date().toISOString());
    }
  }, [storageKey]);

  const unreadCount = useMemo(() => {
    if (!messages || !storageKey) return 0;
    const lastSeen = localStorage.getItem(storageKey);
    if (!lastSeen) return 0;
    return messages.filter((m) => m.staffId !== staff?.id && m.createdAt > lastSeen).length;
  }, [messages, storageKey, staff?.id]);

  useEffect(() => {
    onUnreadChange?.(unreadCount);
  }, [unreadCount, onUnreadChange]);

  const handleOpen = () => {
    onOpenChange(true);
    if (storageKey) {
      localStorage.setItem(storageKey, new Date().toISOString());
    }
  };

  return (
    <>
      <Badge count={unreadCount} size="small" offset={[-6, 6]}>
        <Button
          shape="circle"
          type="primary"
          icon={<MessageOutlined style={{ fontSize: 20 }} />}
          onClick={handleOpen}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 52,
            height: 52,
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            zIndex: 1000,
          }}
        />
      </Badge>
      <Drawer
        title={
          <Space>
            <span>Clinic Chat</span>
            {showSelector && (
              <Select
                size="small"
                style={{ width: 160 }}
                placeholder="Select clinic"
                value={clinicId}
                onChange={setClinicId}
                options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
              />
            )}
          </Space>
        }
        open={open}
        onClose={() => onOpenChange(false)}
        width={380}
        styles={{ body: { display: 'flex', flexDirection: 'column' } }}
      >
        <ChatPanel
          messages={messages}
          isLoading={isLoading}
          currentStaffId={staff?.id}
          onSend={(text) =>
            sendChat.mutateAsync(text).catch((error) => message.error(error instanceof ApiError ? error.message : 'Failed to send'))
          }
          sending={sendChat.isPending}
          height="calc(100vh - 200px)"
          emptyText="No messages yet — say hello to your team"
        />
      </Drawer>
    </>
  );
}
