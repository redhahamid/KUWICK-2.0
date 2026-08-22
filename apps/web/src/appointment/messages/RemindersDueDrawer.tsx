import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Drawer, Empty, List, Segmented, Tag, Typography } from 'antd';
import { BellOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { apiClient } from '../../core/api-client';
import { formatClinicDate, formatClinicDateTime, formatClinicTime } from '../../clinical/clinicTime';
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

interface UpcomingRow {
  appointmentId: string;
  template: string;
  offsetMinutes: number;
  channel: string;
  dueAt: string;
  patient: { id: string; name: string; phone: string | null };
  scheduledStart: string;
  providerName: string;
  serviceName: string;
  manageToken: string | null;
}

interface SentRow {
  id: string;
  template: string;
  channel: string;
  status: string;
  sentAt: string | null;
  destination: string | null;
  actor: { fullName: string } | null;
  appointment: {
    id: string;
    scheduledStart: string;
    patient: { id: string; name: string };
    service: { name: string };
    staff: { fullName: string };
  };
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
 * FINAL-UAT — the REMINDER CENTRE (target mockup 7). Three honest tabs:
 *
 *   Due now   — the worklist a person works through (the Phase 8 read);
 *   Upcoming  — what WILL come due in the next week, each row naming its
 *               moment, so a quiet afternoon can get ahead of tomorrow;
 *   Sent      — the reminders that actually went out, with who sent each.
 *
 * The honesty rule is unchanged: no WhatsApp gateway is connected, every
 * send is a person opening WhatsApp from the same template modal, and the
 * log records exactly that.
 */
export function RemindersDueButton({ clinicId }: { clinicId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'due' | 'upcoming' | 'sent'>('due');
  const { data: due, refetch } = useRemindersDue(clinicId, true);
  const [sending, setSending] = useState<DueRow | null>(null);

  const { data: upcoming } = useQuery({
    queryKey: ['reminders-upcoming', clinicId],
    queryFn: () =>
      apiClient.get<UpcomingRow[]>(`/appointment-communications/upcoming?clinicId=${clinicId}`),
    enabled: Boolean(clinicId) && open,
  });
  const { data: sent } = useQuery({
    queryKey: ['reminders-sent', clinicId],
    queryFn: () => apiClient.get<SentRow[]>(`/appointment-communications/sent?clinicId=${clinicId}`),
    enabled: Boolean(clinicId) && open,
  });

  return (
    <>
      <Badge count={due?.length ?? 0} size="small" offset={[-4, 4]}>
        <Button icon={<BellOutlined />} onClick={() => setOpen(true)}>
          Reminder Centre
        </Button>
      </Badge>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Reminder Centre"
        width={460}
        data-testid="reminders-due-drawer"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Built from this clinic&apos;s reminder rules. WhatsApp automation is not connected —
          reminders are sent by a person, from this list, and Kuwick records that the window was
          opened.
        </Typography.Paragraph>

        <Segmented
          block
          value={tab}
          onChange={(value) => setTab(value as typeof tab)}
          options={[
            { value: 'due', label: `Due now (${due?.length ?? 0})` },
            { value: 'upcoming', label: `Upcoming (${upcoming?.length ?? 0})` },
            { value: 'sent', label: `Sent (${sent?.length ?? 0})` },
          ]}
          style={{ marginBottom: 12 }}
        />

        {tab === 'due' ? (
          due?.length ? (
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
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing is due right now">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Reminder rules live in the{' '}
                <Link to="/appointments/booking-page">Booking Page → Communication</Link> tab.
              </Typography.Text>
            </Empty>
          )
        ) : null}

        {tab === 'upcoming' ? (
          upcoming?.length ? (
            <List
              dataSource={upcoming}
              rowKey={(row) => `${row.appointmentId}:${row.template}`}
              renderItem={(row) => (
                <List.Item
                  actions={[
                    <Button
                      key="early"
                      size="small"
                      icon={<WhatsAppOutlined />}
                      disabled={!row.patient.phone}
                      onClick={() =>
                        setSending({
                          ...row,
                          preInstructions: null,
                        })
                      }
                    >
                      Send early
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <>
                        {row.patient.name} <Tag color="blue">due {formatClinicDateTime(row.dueAt)}</Tag>
                      </>
                    }
                    description={`${formatClinicDate(row.scheduledStart)} · ${formatClinicTime(
                      row.scheduledStart,
                    )} — ${row.serviceName} with ${row.providerName} · ${offsetWords(
                      row.offsetMinutes,
                    )}`}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Nothing scheduled for the next 7 days"
            />
          )
        ) : null}

        {tab === 'sent' ? (
          sent?.length ? (
            <List
              dataSource={sent}
              rowKey={(row) => row.id}
              renderItem={(row) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <>
                        {row.appointment.patient.name}{' '}
                        <Tag color="green">{row.status === 'MANUAL' ? 'Sent by hand' : row.status}</Tag>
                      </>
                    }
                    description={`${row.sentAt ? formatClinicDateTime(row.sentAt) : '—'} · ${
                      row.appointment.service.name
                    }${row.actor ? ` · by ${row.actor.fullName}` : ''}${
                      row.destination ? ` · to ${row.destination}` : ''
                    }`}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No reminders sent in the last 7 days" />
          )
        ) : null}
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
