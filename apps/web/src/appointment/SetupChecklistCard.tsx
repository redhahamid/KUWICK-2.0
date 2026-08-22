import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Typography } from 'antd';
import { CheckCircleFilled, MinusCircleOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { apiClient } from '../core/api-client';

interface ChecklistItem {
  key: string;
  done: boolean;
  core: boolean;
  count?: number;
}

interface ChecklistDoc {
  clinicId: string;
  items: ChecklistItem[];
  complete: boolean;
}

const ITEM_WORDS: Record<string, { label: string; to: string }> = {
  BOOKING_RULES: { label: "Set the clinic's booking rules", to: '/settings/scheduling/booking-rules' },
  SERVICES: { label: 'Make at least one service bookable', to: '/appointments/services' },
  ROSTER: { label: 'Roster your providers', to: '/appointments/roster' },
  BOOKING_PAGE: { label: 'Turn on the public booking page', to: '/appointments/booking-page' },
  REMINDERS: {
    label: 'Choose reminder timing (recommended)',
    to: '/settings/scheduling/communication',
  },
  CHANGE_POLICY: {
    label: 'Decide how patients may change bookings (recommended)',
    to: '/appointments/booking-page',
  },
};

function dismissKey(clinicId: string) {
  return `kw-setup-checklist-hidden:${clinicId}`;
}

/**
 * PHASE 8 — the setup checklist. A short computed list with links, not a
 * wizard: it reads what is actually configured (the server computes it), so
 * finishing a step anywhere makes it tick without being told. Once the four
 * core steps are done it renders NOTHING — a finished clinic never sees it —
 * and it can be hidden by hand before that.
 */
export function SetupChecklistCard({ clinicId }: { clinicId: string | undefined }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return clinicId ? localStorage.getItem(dismissKey(clinicId)) === 'yes' : false;
    } catch {
      return false;
    }
  });

  const { data } = useQuery({
    queryKey: ['appointment-setup-checklist', clinicId],
    queryFn: () =>
      apiClient.get<ChecklistDoc>(`/appointments/dashboard/setup-checklist?clinicId=${clinicId}`),
    enabled: Boolean(clinicId) && !hidden,
    staleTime: 60_000,
  });

  if (!clinicId || hidden || !data || data.complete) return null;

  const core = data.items.filter((item) => item.core);
  const doneCount = core.filter((item) => item.done).length;

  const hide = () => {
    try {
      localStorage.setItem(dismissKey(clinicId), 'yes');
    } catch {
      // Storage may be unavailable; hiding for this visit is still right.
    }
    setHidden(true);
  };

  return (
    <Card
      size="small"
      className="kw-setup-checklist"
      data-testid="setup-checklist"
      style={{ marginBottom: 12 }}
      title={`Finish setting up online booking — ${doneCount} of ${core.length} done`}
      extra={
        <Button type="text" size="small" onClick={hide}>
          Hide
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.items.map((item) => {
          const words = ITEM_WORDS[item.key];
          if (!words) return null;
          return (
            <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {item.done ? (
                <CheckCircleFilled style={{ color: '#52c41a' }} />
              ) : (
                <MinusCircleOutlined style={{ color: '#bfbfbf' }} />
              )}
              {item.done ? (
                <Typography.Text type="secondary" delete={false}>
                  {words.label}
                </Typography.Text>
              ) : (
                <Link to={words.to}>{words.label}</Link>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
