import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Drawer, Empty, Segmented, Tag, Typography } from 'antd';
import { BellOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { apiClient } from '../../core/api-client';
import { clinicDayjs, formatClinicDate, formatClinicDateTime, formatClinicTime } from '../../clinical/clinicTime';
import { PersonAvatar } from '../shared/PersonAvatar';
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

  // OVERDUE, truthfully: a reminder still on the due list whose moment passed
  // more than a day ago. Derived from the same rows below — no delivery
  // tracking is implied, and none exists. (There is deliberately no "Failed"
  // tile: nothing in Kuwick can observe a failure, because nothing observes
  // delivery at all.)
  const overdue = useMemo(
    () =>
      (due ?? []).filter((row) => {
        const dueAt = clinicDayjs(row.scheduledStart).subtract(row.offsetMinutes, 'minute');
        return clinicDayjs(new Date()).diff(dueAt, 'hour') >= 24;
      }).length,
    [due],
  );

  // Of the scheduled reminders, the ones whose moment falls before the
  // clinic's midnight — the "get ahead of this afternoon" tile.
  const dueLaterToday = useMemo(() => {
    const todayKey = clinicDayjs(new Date()).format('YYYY-MM-DD');
    return (upcoming ?? []).filter(
      (row) => clinicDayjs(row.dueAt).format('YYYY-MM-DD') === todayKey,
    ).length;
  }, [upcoming]);

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
        width="min(760px, 100vw)"
        data-testid="reminders-due-drawer"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          Built from this clinic&apos;s reminder rules. WhatsApp automation is not connected —
          reminders are sent by a person, from this list, and Kuwick records that the window was
          opened.
        </Typography.Paragraph>

        {/* Mockup 7's summary tiles — each an HONEST derivation of the three
            lists below (nothing this drawer cannot show is counted), and each
            a shortcut to the tab it summarises. */}
        <div className="kw-rem-tiles">
          <button type="button" className="kw-rem-tile" data-tone="due" onClick={() => setTab('due')}>
            <span className="kw-rem-tile-value">{due?.length ?? 0}</span>
            <span className="kw-rem-tile-label">Due now</span>
          </button>
          <button
            type="button"
            className="kw-rem-tile"
            data-tone="overdue"
            onClick={() => setTab('due')}
            title="Still unsent more than a day after its moment"
          >
            <span className="kw-rem-tile-value">{overdue}</span>
            <span className="kw-rem-tile-label">Overdue</span>
          </button>
          <button
            type="button"
            className="kw-rem-tile"
            data-tone="today"
            onClick={() => setTab('upcoming')}
          >
            <span className="kw-rem-tile-value">{dueLaterToday}</span>
            <span className="kw-rem-tile-label">Later today</span>
          </button>
          <button
            type="button"
            className="kw-rem-tile"
            data-tone="upcoming"
            onClick={() => setTab('upcoming')}
          >
            <span className="kw-rem-tile-value">{upcoming?.length ?? 0}</span>
            <span className="kw-rem-tile-label">Next 7 days</span>
          </button>
          <button type="button" className="kw-rem-tile" data-tone="sent" onClick={() => setTab('sent')}>
            <span className="kw-rem-tile-value">{sent?.length ?? 0}</span>
            <span className="kw-rem-tile-label">Sent · 7 days</span>
          </button>
        </div>

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

        {/* Mockup 7's worklist columns: time · patient · appointment · type ·
            channel · action. One header, shared by all three tabs. */}
        {(tab === 'due' && due?.length) ||
        (tab === 'upcoming' && upcoming?.length) ||
        (tab === 'sent' && sent?.length) ? (
          <div className="kw-rem-head" aria-hidden>
            <span>Time</span>
            <span>Patient</span>
            <span>Appointment</span>
            <span>Type</span>
            <span className="kw-rem-col-channel">Via</span>
            <span />
          </div>
        ) : null}

        {tab === 'due' ? (
          due?.length ? (
            <div className="kw-rem-rows">
              {due.map((row) => (
                <div className="kw-rem-row" key={`${row.appointmentId}:${row.template}`}>
                  <span className="kw-rem-time">{formatClinicTime(row.scheduledStart)}</span>
                  <span className="kw-rem-patient">
                    <PersonAvatar name={row.patient.name} size="sm" />
                    <span className="kw-rem-patient-text">
                      <span className="kw-rem-patient-name">{row.patient.name}</span>
                      <span className="kw-rem-patient-phone">
                        {row.patient.phone ?? 'no phone on file'}
                      </span>
                    </span>
                  </span>
                  <span className="kw-rem-appt">
                    {formatClinicDate(row.scheduledStart)} · {row.serviceName}
                    <span className="kw-rem-appt-provider">{row.providerName}</span>
                  </span>
                  <span>
                    <Tag className="kw-rem-type">{offsetWords(row.offsetMinutes)}</Tag>
                  </span>
                  <span className="kw-rem-col-channel">
                    <WhatsAppOutlined className="kw-rem-wa" aria-label="WhatsApp, opened by hand" />
                  </span>
                  <span className="kw-rem-action">
                    <Button
                      size="small"
                      type="primary"
                      icon={<WhatsAppOutlined />}
                      disabled={!row.patient.phone}
                      onClick={() => setSending(row)}
                    >
                      Send
                    </Button>
                  </span>
                </div>
              ))}
            </div>
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
            <div className="kw-rem-rows">
              {upcoming.map((row) => (
                <div className="kw-rem-row" key={`${row.appointmentId}:${row.template}`}>
                  <span className="kw-rem-time">
                    {formatClinicTime(row.dueAt)}
                    <span className="kw-rem-time-date">{formatClinicDate(row.dueAt)}</span>
                  </span>
                  <span className="kw-rem-patient">
                    <PersonAvatar name={row.patient.name} size="sm" />
                    <span className="kw-rem-patient-text">
                      <span className="kw-rem-patient-name">{row.patient.name}</span>
                      <span className="kw-rem-patient-phone">
                        {row.patient.phone ?? 'no phone on file'}
                      </span>
                    </span>
                  </span>
                  <span className="kw-rem-appt">
                    {formatClinicDate(row.scheduledStart)} · {formatClinicTime(row.scheduledStart)} ·{' '}
                    {row.serviceName}
                    <span className="kw-rem-appt-provider">{row.providerName}</span>
                  </span>
                  <span>
                    <Tag className="kw-rem-type" color="blue">
                      {offsetWords(row.offsetMinutes)}
                    </Tag>
                  </span>
                  <span className="kw-rem-col-channel">
                    <WhatsAppOutlined className="kw-rem-wa" aria-label="WhatsApp, opened by hand" />
                  </span>
                  <span className="kw-rem-action">
                    <Button
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
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Nothing scheduled for the next 7 days"
            />
          )
        ) : null}

        {tab === 'sent' ? (
          sent?.length ? (
            <div className="kw-rem-rows">
              {sent.map((row) => (
                <div className="kw-rem-row" key={row.id}>
                  <span className="kw-rem-time">
                    {row.sentAt ? formatClinicTime(row.sentAt) : '—'}
                    <span className="kw-rem-time-date">
                      {row.sentAt ? formatClinicDate(row.sentAt) : ''}
                    </span>
                  </span>
                  <span className="kw-rem-patient">
                    <PersonAvatar name={row.appointment.patient.name} size="sm" />
                    <span className="kw-rem-patient-text">
                      <span className="kw-rem-patient-name">{row.appointment.patient.name}</span>
                      <span className="kw-rem-patient-phone">{row.destination ?? ''}</span>
                    </span>
                  </span>
                  <span className="kw-rem-appt">
                    {formatClinicDate(row.appointment.scheduledStart)} · {row.appointment.service.name}
                    <span className="kw-rem-appt-provider">{row.appointment.staff.fullName}</span>
                  </span>
                  <span>
                    <Tag className="kw-rem-type" color="green">
                      {row.status === 'MANUAL' ? 'Sent by hand' : row.status}
                    </Tag>
                  </span>
                  <span className="kw-rem-col-channel">
                    <WhatsAppOutlined className="kw-rem-wa" aria-label="WhatsApp" />
                  </span>
                  <span className="kw-rem-action">
                    {row.actor ? (
                      <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                        by {row.actor.fullName}
                      </Typography.Text>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
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
