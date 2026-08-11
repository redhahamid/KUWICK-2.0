import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Drawer, Input, Popover, Select, Space, Typography, message } from 'antd';
import { MessageOutlined, PlusOutlined } from '@ant-design/icons';
import { useAuthStore } from '../core/auth-store';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useChannelChat, useChatChannels, useCreateChatChannel, useSendChannelChat } from './hooks/useChat';
import { ChatPanel } from './ChatPanel';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

const SEEN_STORAGE_PREFIX = 'kuwick-chat-seen-';

function lastSeen(channelId: string): string | null {
  return localStorage.getItem(`${SEEN_STORAGE_PREFIX}${channelId}`);
}

function markSeen(channelId: string) {
  localStorage.setItem(`${SEEN_STORAGE_PREFIX}${channelId}`, new Date().toISOString());
}

// D-046/D-048 — the internal chat: one "General" channel every clinic
// always has, plus any named team channels staff create (owner: "any
// option group chat" beyond a single thread — e.g. "Doctors", "Front
// Desk"). A floating button is always reachable across the app (mounted
// once in AppLayout); the NotificationBell can also drive it open via the
// same `open`/`onOpenChange` pair so both entry points share one Drawer.
// "Unread" is tracked client-side (a per-channel "last seen" timestamp in
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
  const { data: channels } = useChatChannels(clinicId);
  const createChannel = useCreateChatChannel(clinicId);
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>();
  const [newChannelName, setNewChannelName] = useState('');
  const [creatorOpen, setCreatorOpen] = useState(false);

  const generalChannel = channels?.find((c) => c.isGeneral);
  useEffect(() => {
    if (!activeChannelId && generalChannel) {
      setActiveChannelId(generalChannel.id);
    }
  }, [activeChannelId, generalChannel]);

  const { data: messages, isLoading } = useChannelChat(activeChannelId);
  const sendChat = useSendChannelChat(activeChannelId, clinicId);

  // First-ever visit to a channel: mark it seen-now rather than
  // retroactively flagging its whole history as unread. A real effect (not
  // done inline in the unread computation below, which must stay pure).
  useEffect(() => {
    channels?.forEach((c) => {
      if (!lastSeen(c.id)) markSeen(c.id);
    });
  }, [channels]);

  // Every channel with activity newer than its last-seen marker (from
  // someone else) counts toward the bell's badge.
  const unreadChannelIds = useMemo(() => {
    if (!channels) return new Set<string>();
    return new Set(
      channels
        .filter((c) => {
          if (!c.latestMessageAt || c.latestMessageStaffId === staff?.id) return false;
          const seen = lastSeen(c.id);
          return Boolean(seen) && c.latestMessageAt > seen!;
        })
        .map((c) => c.id),
    );
  }, [channels, staff?.id]);

  useEffect(() => {
    onUnreadChange?.(unreadChannelIds.size);
  }, [unreadChannelIds, onUnreadChange]);

  const handleOpen = () => {
    onOpenChange(true);
    if (activeChannelId) markSeen(activeChannelId);
  };

  const handleSwitchChannel = (channelId: string) => {
    setActiveChannelId(channelId);
    markSeen(channelId);
  };

  const handleCreateChannel = () => {
    const name = newChannelName.trim();
    if (!name) return;
    createChannel
      .mutateAsync(name)
      .then((channel) => {
        setNewChannelName('');
        setCreatorOpen(false);
        setActiveChannelId(channel.id);
      })
      .catch((error) => message.error(error instanceof ApiError ? error.message : 'Failed to create channel'));
  };

  return (
    <>
      {/* D-077 — the floating button sat over the Open Invoice / completion
          actions at the bottom of a phone screen, so a tap meant to bill a
          visit could open chat instead. `.kw-chat-launcher` docks it clear of
          those controls on a phone and hides it entirely inside the Clinical
          Workspace, where chat is reachable from the header. Nothing about the
          chat itself changes — only where its launcher sits. */}
      <Badge count={unreadChannelIds.size} size="small" offset={[-6, 6]} className="kw-chat-launcher">
        <Button
          shape="circle"
          type="primary"
          aria-label="Open clinic chat"
          icon={<MessageOutlined style={{ fontSize: 20 }} />}
          onClick={handleOpen}
          style={{ width: 52, height: 52, boxShadow: '0 4px 12px rgba(0,0,0,0.18)' }}
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
        styles={{ body: { display: 'flex', flexDirection: 'column', padding: 12 } }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          {channels?.map((channel) => (
            <Button
              key={channel.id}
              size="small"
              shape="round"
              type={channel.id === activeChannelId ? 'primary' : 'default'}
              onClick={() => handleSwitchChannel(channel.id)}
              style={{ position: 'relative' }}
            >
              {channel.name}
              {unreadChannelIds.has(channel.id) && channel.id !== activeChannelId && (
                <span
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#f5222d',
                    border: '1.5px solid #fff',
                  }}
                />
              )}
            </Button>
          ))}
          <Popover
            open={creatorOpen}
            onOpenChange={setCreatorOpen}
            trigger="click"
            placement="bottomLeft"
            content={
              <Space>
                <Input
                  size="small"
                  placeholder="Channel name"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  onPressEnter={handleCreateChannel}
                  style={{ width: 140 }}
                  autoFocus
                />
                <Button size="small" type="primary" loading={createChannel.isPending} onClick={handleCreateChannel}>
                  Add
                </Button>
              </Space>
            }
          >
            <Button size="small" shape="circle" icon={<PlusOutlined />} title="New channel" />
          </Popover>
        </div>

        <ChatPanel
          messages={messages}
          isLoading={isLoading}
          currentStaffId={staff?.id}
          onSend={(text) =>
            sendChat.mutateAsync(text).catch((error) => message.error(error instanceof ApiError ? error.message : 'Failed to send'))
          }
          sending={sendChat.isPending}
          height="calc(100vh - 240px)"
          emptyText="No messages yet — say hello to your team"
        />
      </Drawer>
    </>
  );
}
