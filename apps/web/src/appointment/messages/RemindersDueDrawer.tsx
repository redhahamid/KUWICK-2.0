import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Drawer, Empty, List, Tag, Typography } from 'antd';
import { BellOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { apiClient } from '../../core/api-client';
import { formatClinicDate, formatClinicTime } from '../../clinical/clinicTime';
import { MessagePatientModal } from './MessagePatientModal';

interface DueRow {
  appointmentId: string;
  /** The worklist's own log key — REMINDER_1440 — so sending clears the row. */
  template: string;
  offsetMinutes: number;
  channel: string;
  patient: { id: string; name: string; phone: string | null };
  scheduledStart: string;
  providerName: string;
  serviceName: string;
  preInstructions: string | null;
  manageToken: string | null;
}

function offsetWords(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '1 day before' : `${days} days before`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour before' : `${hours} hours before`;
  }
  return `${minutes} min before`;
}

function useRemindersDue(clinicId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['reminders-due', clinicId],
    queryFn: () => apiClient.get<DueRow[]>(`/appointment-communications/due?clinicId=${clinicId}`),
    enabled: Boolean(clinicId) && enabled,
    refetchInterval: 60_000,
  });
}

/**
 * PHASE 8 — the honest half of "automated reminders". The clinic's reminder
 * rules BUILD THIS WORKLIST; a person works through it, because no WhatsApp
 * gateway is connected and Kuwick does not pretend one is. Each send goes
 * through the same template modal as everywhere else and logs the rule's own
 * key, which is what clears the row.
 */
export function RemindersDueButton({ clinicId }: { clinicId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const { data: due, refetch } = useRemindersDue(clinicId, true);
  const [sending, setSending] = useState<DueRow | null>(null);

  return (
    <>
      <Badge count={due?.length ?? 0} size="small" offset={[-4, 4]}>
        <Button icon={<BellOutlined />} onClick={() => setOpen(true)}>
          Reminders due
        </Button>
      </Badge>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Reminders due"
        width={420}
        data-testid="reminders-due-drawer"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Built from this clinic&apos;s reminder rules. WhatsApp automation is not connected —
          these are sent by a person, from this list, and Kuwick records that the window was
          opened.
        </Typography.Paragraph>

        {due?.length ? (
          <List
            dataSource={due}
            rowKey={(row) => `${row.appointmentId}:${row.template}`}
            renderItem={(row) => (
              <List.Item
                actions={[
                  <Button
                    key="send"
                    size="small"
                    type="primary"
                    icon={<WhatsAppOutlined />}
                    disabled={!row.patient.phone}
                    onClick={() => setSending(row)}
                  >
                    Send
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <>
                      {row.patient.name} <Tag>{offsetWords(row.offsetMinutes)}</Tag>
                    </>
                  }
                  description={`${formatClinicDate(row.scheduledStart)} · ${formatClinicTime(
                    row.scheduledStart,
                  )} — ${row.serviceName} with ${row.providerName}${
                    row.patient.phone ? '' : ' · no phone on file'
                  }`}
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Nothing is due right now"
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Reminder rules live in <Link to="/settings/scheduling/communication">Clinic
              Settings → Communication &amp; Reminders</Link>.
            </Typography.Text>
          </Empty>
        )}
      </Drawer>

      {sending && clinicId ? (
        <MessagePatientModal
          open
          onClose={() => setSending(null)}
          clinicId={clinicId}
          appointment={{
            id: sending.appointmentId,
            scheduledStart: sending.scheduledStart,
            manageToken: sending.manageToken,
            patient: sending.patient,
            staff: { fullName: sending.providerName },
            service: { name: sending.serviceName },
          }}
          defaultTemplateKey="REMINDER"
          logTemplateKey={sending.template}
          onLogged={() => refetch()}
        />
      ) : null}
    </>
  );
}
