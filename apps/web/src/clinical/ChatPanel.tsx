import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Empty, Input, Spin, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ChatMessage } from './types';

const { Text } = Typography;

// A faint medical-cross wallpaper (own motif, not a lift of any messaging
// app's pattern) — gives the thread a chat-app backdrop instead of a flat
// white list, at low enough opacity to never compete with the bubbles.
const WALLPAPER_BG =
  "#f0f1f6 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Cpath d='M30 24h4v6h6v4h-6v6h-4v-6h-6v-4h6z' fill='%234338ca' fill-opacity='0.028'/%3E%3C/svg%3E\")";

const OWN_BUBBLE = '#4338ca';
const OTHER_BUBBLE = '#ffffff';
const GROUP_GAP_MINUTES = 5;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function dateLabel(iso: string): string {
  const d = dayjs(iso);
  if (d.isSame(dayjs(), 'day')) return 'Today';
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  return d.format('D MMMM YYYY');
}

function bubbleRadius(isOwn: boolean, isLastInGroup: boolean): string {
  const tail = isLastInGroup ? 6 : 16;
  return isOwn ? `16px 16px ${tail}px 16px` : `16px 16px 16px ${tail}px`;
}

interface MessageGroup {
  key: string;
  isOwn: boolean;
  staffName: string;
  messages: ChatMessage[];
}

type ThreadItem = { type: 'date'; key: string; label: string } | { type: 'group'; key: string; group: MessageGroup };

// WhatsApp/Telegram-style grouping: consecutive messages from the same
// sender within a short gap collapse into one visual cluster (avatar/name
// shown once), with a centered date pill wherever the calendar day changes.
function buildThread(messages: ChatMessage[], currentStaffId?: string): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastDateKey = '';
  let currentGroup: MessageGroup | null = null;

  for (const msg of messages) {
    const dateKey = dayjs(msg.createdAt).format('YYYY-MM-DD');
    if (dateKey !== lastDateKey) {
      items.push({ type: 'date', key: `date-${dateKey}`, label: dateLabel(msg.createdAt) });
      lastDateKey = dateKey;
      currentGroup = null;
    }

    const isOwn = msg.staffId === currentStaffId;
    const last = currentGroup?.messages[currentGroup.messages.length - 1];
    const withinGap = last ? dayjs(msg.createdAt).diff(dayjs(last.createdAt), 'minute') < GROUP_GAP_MINUTES : false;

    if (currentGroup && currentGroup.isOwn === isOwn && last?.staffId === msg.staffId && withinGap) {
      currentGroup.messages.push(msg);
    } else {
      currentGroup = { key: `group-${msg.id}`, isOwn, staffName: msg.staff?.fullName ?? 'Unknown', messages: [msg] };
      items.push({ type: 'group', key: currentGroup.key, group: currentGroup });
    }
  }
  return items;
}

interface ChatPanelProps {
  messages?: ChatMessage[];
  isLoading?: boolean;
  currentStaffId?: string;
  onSend: (text: string) => void;
  sending?: boolean;
  emptyText?: string;
  height?: number | string;
}

// D-046 — shared by per-procedure chat (CompleteOrderModal) and the
// clinic-wide chat widget (ClinicChatWidget). Polling-backed (see
// hooks/useChat.ts), so this component is purely presentational + the
// send box.
export function ChatPanel({ messages, isLoading, currentStaffId, onSend, sending, emptyText, height = 320 }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages?.length]);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft('');
  };

  const thread = messages ? buildThread(messages, currentStaffId) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height, borderRadius: 8, overflow: 'hidden', border: '1px solid #f0f0f0' }}>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', background: WALLPAPER_BG }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spin size="small" />
          </div>
        ) : thread.length === 0 ? (
          <Empty description={emptyText ?? 'No messages yet'} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '24px 0' }} />
        ) : (
          thread.map((item) =>
            item.type === 'date' ? (
              <div key={item.key} style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    background: 'rgba(0,0,0,0.06)',
                    color: 'rgba(0,0,0,0.55)',
                    padding: '3px 10px',
                    borderRadius: 10,
                  }}
                >
                  {item.label}
                </span>
              </div>
            ) : (
              <div
                key={item.key}
                style={{ display: 'flex', gap: 6, flexDirection: item.group.isOwn ? 'row-reverse' : 'row', marginTop: 10, alignItems: 'flex-end' }}
              >
                {!item.group.isOwn && (
                  <Avatar size={26} style={{ backgroundColor: '#8c8c8c', flexShrink: 0 }}>
                    {initials(item.group.staffName)}
                  </Avatar>
                )}
                <div style={{ maxWidth: '74%', display: 'flex', flexDirection: 'column', gap: 2, alignItems: item.group.isOwn ? 'flex-end' : 'flex-start' }}>
                  {!item.group.isOwn && (
                    <Text style={{ fontSize: 11, fontWeight: 600, marginLeft: 11, color: '#4338ca' }}>{item.group.staffName}</Text>
                  )}
                  {item.group.messages.map((msg, i) => {
                    const isLastInGroup = i === item.group.messages.length - 1;
                    return (
                      <div
                        key={msg.id}
                        style={{
                          padding: '6px 10px',
                          borderRadius: bubbleRadius(item.group.isOwn, isLastInGroup),
                          background: item.group.isOwn ? OWN_BUBBLE : OTHER_BUBBLE,
                          color: item.group.isOwn ? '#fff' : 'rgba(0,0,0,0.88)',
                          fontSize: 13,
                          lineHeight: 1.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          boxShadow: item.group.isOwn ? 'none' : '0 1px 2px rgba(0,0,0,0.08)',
                        }}
                      >
                        {msg.message}
                        <span
                          style={{
                            float: 'right',
                            fontSize: 10,
                            opacity: 0.7,
                            marginLeft: 8,
                            marginTop: 3,
                            userSelect: 'none',
                          }}
                        >
                          {dayjs(msg.createdAt).format('h:mm A')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ),
          )
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 8, background: '#fafafa', borderTop: '1px solid #f0f0f0' }}>
        <Input.TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message..."
          autoSize={{ minRows: 1, maxRows: 3 }}
          style={{ borderRadius: 18, resize: 'none' }}
        />
        <Button
          type="primary"
          shape="circle"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={sending}
          disabled={!draft.trim()}
          style={{ flexShrink: 0 }}
        />
      </div>
    </div>
  );
}
