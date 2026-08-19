import { useMemo, useState } from 'react';
import {
  Avatar,
  Button,
  DatePicker,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { WhatsAppOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useQueryClient } from '@tanstack/react-query';
import { AppointmentStatus } from '@kuwick/shared';
import { KuwickStatusTag } from '../../design-system/kuwick';
import { useStaff } from '../../hr/hooks/useStaff';
import { useServices } from '../../clinical/hooks/useServices';
import { formatClinicDate, formatClinicTime } from '../../clinical/clinicTime';
import { ApiError } from '../../core/api-client';
import {
  DashboardRow,
  DashboardStats,
  DashboardTab,
  ListTab,
  useAppointmentDashboard,
  useMarkReminderSent,
} from '../hooks/useAppointmentDashboard';
import { useWaitlist } from '../hooks/useWaitlist';
import { whatsappLink } from '../whatsappReminder';
import { RescheduleAppointmentDrawer } from '../RescheduleAppointmentDrawer';
import { AppointmentDrawer } from '../calendar/AppointmentDrawer';
import { paymentChip, sentence, statusChip } from '../appointment-presentation';
import { SOURCE_LABELS, type AppointmentSource } from '../types';
import {
  ARRIVABLE_FROM_STATUSES,
  CHECK_IN_FROM_STATUSES,
  NON_CANCELLABLE_STATUSES,
} from '../appointment-status.constants';
import {
  useArrivedAppointment,
  useCancelAppointment,
  useConfirmAppointment,
  useNoShowAppointment,
} from '../hooks/useAppointments';

const { Text } = Typography;

const TABS: { value: ListTab; label: string }[] = [
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'REQUESTS', label: 'Requests' },
  { value: 'ARRIVED', label: 'Arrived' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'NO_SHOW', label: 'No-show' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'WAITLIST', label: 'Waitlist' },
  { value: 'TO_BE_SCHEDULED', label: 'To be scheduled' },
];

const money = (value: number) =>
  `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function initials(name: string): string {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

interface AppointmentListViewProps {
  clinicId?: string;
  clinicName: string;
  onBook: () => void;
}

/**
 * THE LIST — the diary as a worklist rather than a grid.
 *
 * The calendar answers "what does the day look like"; this answers "who is
 * waiting on something". They read the same appointments and the numbers on
 * this page come from the SERVER (`appointment-dashboard.service.ts`), so this
 * screen and the reports module cannot disagree about what "no-show rate"
 * means.
 *
 * §46 — the money is two figures with two different meanings. BOOKED VALUE is
 * what the diary is worth if it all happens; REALISED REVENUE is what the
 * linked invoices actually came to. Calling the first one "sales" implied a
 * forecast it was never entitled to make.
 */
export function AppointmentListView({ clinicId, clinicName, onBook }: AppointmentListViewProps) {
  const { data: staff } = useStaff();
  const { data: services } = useServices();

  const [tab, setTab] = useState<ListTab>('UPCOMING');
  // The default period follows the TAB, not the calendar month. "This month"
  // is a poor default for a diary: opened on the 30th it shows one day of
  // upcoming appointments.
  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRangeFor('UPCOMING'));
  const [rangeChosen, setRangeChosen] = useState(false);
  const [staffId, setStaffId] = useState<string>();
  const [serviceId, setServiceId] = useState<string>();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const changeTab = (next: ListTab) => {
    setTab(next);
    if (!rangeChosen && next !== 'WAITLIST') setRange(defaultRangeFor(next as DashboardTab));
  };

  const { data, isFetching } = useAppointmentDashboard({
    clinicId,
    from: range[0].format('YYYY-MM-DD'),
    to: range[1].format('YYYY-MM-DD'),
    tab: (tab === 'WAITLIST' ? 'UPCOMING' : tab) as DashboardTab,
    staffId,
    serviceId,
    search: search.trim() || undefined,
  });
  const { data: waitlist, isFetching: loadingWaitlist } = useWaitlist({
    clinicId,
    staffId,
    serviceId,
    search: search.trim() || undefined,
  });

  const doctors = useMemo(
    () =>
      staff?.filter(
        (member) => member.role === 'DOCTOR_RESIDENT' || member.role === 'DOCTOR_LOCUM',
      ) ?? [],
    [staff],
  );

  return (
    <div className="kw-appt-list">
      <StatsBar stats={data?.stats} loading={isFetching && !data} />

      <div className="kw-appt-controls">
        <Segmented
          className="kw-appt-tabs"
          value={tab}
          onChange={(value) => changeTab(value as ListTab)}
          options={TABS.map((entry) => ({ value: entry.value, label: entry.label }))}
        />
        <Space size={8} wrap className="kw-appt-filters">
          {tab !== 'WAITLIST' ? (
            <DatePicker.RangePicker
              value={range}
              onChange={(next) => {
                if (!next?.[0] || !next?.[1]) return;
                setRange([next[0], next[1]]);
                setRangeChosen(true);
              }}
              allowClear={false}
            />
          ) : null}
          <Select
            placeholder="Any doctor"
            value={staffId}
            onChange={setStaffId}
            allowClear
            showSearch
            optionFilterProp="label"
            options={doctors.map((doctor) => ({ value: doctor.id, label: doctor.fullName }))}
            style={{ minWidth: 170 }}
          />
          <Select
            placeholder="Any service"
            value={serviceId}
            onChange={setServiceId}
            allowClear
            showSearch
            optionFilterProp="label"
            options={services?.map((service) => ({ value: service.id, label: service.name }))}
            style={{ minWidth: 190 }}
          />
          <Input.Search
            placeholder="Patient name or phone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <Button type="primary" onClick={onBook}>
            New appointment
          </Button>
        </Space>
      </div>

      {tab === 'WAITLIST' ? (
        <Table
          rowKey="id"
          loading={loadingWaitlist}
          dataSource={waitlist ?? []}
          pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Nobody is waiting for a slot. Add a patient here when the day they want is full."
              />
            ),
          }}
          columns={[
            {
              title: 'Patient',
              render: (_, row) => (
                <div className="kw-appt-patient">
                  <span className="kw-appt-patient-name">{row.patient.name}</span>
                  {row.patient.phone ? (
                    <span className="kw-appt-patient-phone">{row.patient.phone}</span>
                  ) : null}
                </div>
              ),
            },
            { title: 'Service', render: (_, row) => row.service.name },
            {
              title: 'Provider',
              render: (_, row) =>
                row.preferredProvider?.fullName ?? <Text type="secondary">Any</Text>,
            },
            {
              title: 'Wants',
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <span>
                    {row.earliestDate ? formatClinicDate(row.earliestDate) : 'Any date'}
                    {row.latestDate ? ` – ${formatClinicDate(row.latestDate)}` : ''}
                  </span>
                  {row.preferredDaypart ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {sentence(row.preferredDaypart)}
                    </Text>
                  ) : null}
                </Space>
              ),
            },
            {
              title: 'Priority',
              width: 100,
              render: (_, row) =>
                row.priority > 0 ? (
                  <KuwickStatusTag tone="attention" label={`Priority ${row.priority}`} />
                ) : (
                  <Text type="secondary">Normal</Text>
                ),
            },
            {
              title: 'Added',
              width: 130,
              render: (_, row) => formatClinicDate(row.createdAt),
            },
            {
              title: 'Status',
              width: 110,
              render: (_, row) => (
                <KuwickStatusTag
                  tone={row.status === 'OFFERED' ? 'active' : 'neutral'}
                  label={sentence(row.status)}
                />
              ),
            },
          ]}
        />
      ) : (
        <AppointmentTable
          rows={data?.rows ?? []}
          loading={isFetching}
          tab={tab as DashboardTab}
          clinicName={clinicName}
          onOpen={setSelectedId}
        />
      )}

      <AppointmentDrawer
        appointmentId={selectedId}
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        onReschedule={() => undefined}
      />
    </div>
  );
}

/**
 * Upcoming looks FORWARD, history looks BACK. One default cannot serve both: a
 * month-to-date range shows an empty Completed tab on the 1st and an empty
 * Upcoming tab on the 30th.
 */
function defaultRangeFor(tab: DashboardTab): [Dayjs, Dayjs] {
  if (tab === 'COMPLETED' || tab === 'NO_SHOW' || tab === 'CANCELLED' || tab === 'TO_BE_SCHEDULED') {
    return [dayjs().subtract(30, 'day').startOf('day'), dayjs().endOf('day')];
  }
  if (tab === 'ARRIVED') return [dayjs().startOf('day'), dayjs().endOf('day')];
  return [dayjs().startOf('day'), dayjs().add(30, 'day').endOf('day')];
}

function StatsBar({ stats, loading }: { stats?: DashboardStats; loading: boolean }) {
  const cells = [
    { key: 'upcoming', label: 'Upcoming', value: stats?.upcoming, tone: 'active' as const },
    { key: 'requests', label: 'Requests', value: stats?.requests, tone: 'attention' as const },
    { key: 'completed', label: 'Completed', value: stats?.completed, tone: 'success' as const },
    { key: 'cancelled', label: 'Cancelled', value: stats?.cancelled, tone: 'neutral' as const },
    {
      key: 'noShow',
      label: 'No-show',
      value: stats?.noShow,
      tone: 'error' as const,
      // The rate is the number an owner acts on; the count alone means nothing
      // without knowing how many could have turned up.
      detail:
        stats?.noShowRate == null
          ? undefined
          : `${Math.round(stats.noShowRate * 100)}% of attendable`,
    },
  ];

  return (
    <div className="kw-appt-stats" data-testid="appointment-stats" data-loading={loading}>
      {cells.map((cell) => (
        <div key={cell.key} className="kw-appt-stat" data-tone={cell.tone}>
          <span className="kw-appt-stat-label">{cell.label}</span>
          <span className="kw-appt-stat-value">{cell.value ?? '—'}</span>
          {cell.detail ? <span className="kw-appt-stat-detail">{cell.detail}</span> : null}
        </div>
      ))}
      <div className="kw-appt-stat kw-appt-stat-money" data-tone="primary">
        <span className="kw-appt-stat-label">Booked value</span>
        <span className="kw-appt-stat-value">{stats ? money(stats.bookedValue) : '—'}</span>
        <span className="kw-appt-stat-detail">
          {stats ? `${money(stats.realisedRevenue)} realised` : ''}
        </span>
      </div>
    </div>
  );
}

function AppointmentTable({
  rows,
  loading,
  tab,
  clinicName,
  onOpen,
}: {
  rows: DashboardRow[];
  loading: boolean;
  tab: DashboardTab;
  clinicName: string;
  onOpen: (id: string) => void;
}) {
  const markReminder = useMarkReminderSent();
  const confirmAppointment = useConfirmAppointment();
  const checkInAppointment = useArrivedAppointment();
  const noShowAppointment = useNoShowAppointment();
  const cancelAppointment = useCancelAppointment();
  const [rescheduling, setRescheduling] = useState<DashboardRow | null>(null);
  const queryClient = useQueryClient();

  const act = async (run: Promise<unknown>, failure: string) => {
    try {
      await run;
      queryClient.invalidateQueries({ queryKey: ['appointment-dashboard'] });
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : failure);
    }
  };

  const sendReminder = async (row: DashboardRow) => {
    const link = whatsappLink({
      phone: row.patient.phone,
      patientName: row.patient.name,
      scheduledStart: row.scheduledStart,
      clinicName,
    });
    if (!link) {
      message.warning('This patient has no usable phone number on file.');
      return;
    }
    // Opened FIRST. If the popup is blocked or the staff member changes their
    // mind, nothing has been recorded — a "reminder sent" mark for a message
    // that never opened is worse than no mark at all.
    window.open(link, '_blank', 'noopener,noreferrer');
    try {
      await markReminder.mutateAsync(row.id);
    } catch {
      message.error('WhatsApp opened, but the reminder could not be recorded.');
    }
  };

  return (
    <>
      <Table<DashboardRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        onRow={(row) => ({ onClick: () => onOpen(row.id), style: { cursor: 'pointer' } })}
        pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={EMPTY_TEXT[tab]}
              className="kw-appt-empty"
            />
          ),
        }}
        columns={[
          {
            title: 'Patient',
            render: (_, row) => (
              <div className="kw-appt-patient">
                <span className="kw-appt-patient-name">{row.patient.name}</span>
                {row.patient.phone ? (
                  <span className="kw-appt-patient-phone">{row.patient.phone}</span>
                ) : null}
              </div>
            ),
          },
          { title: 'Date', width: 120, render: (_, row) => formatClinicDate(row.scheduledStart) },
          {
            title: 'Time',
            width: 110,
            render: (_, row) =>
              `${formatClinicTime(row.scheduledStart)}–${formatClinicTime(row.scheduledEnd)}`,
          },
          { title: 'Service', render: (_, row) => row.service.name },
          {
            title: 'Provider',
            render: (_, row) => (
              <Space size={8}>
                <Avatar size={26} className="kw-appt-avatar">
                  {initials(row.provider.fullName)}
                </Avatar>
                <span>{row.provider.fullName}</span>
              </Space>
            ),
          },
          {
            title: 'Payment',
            width: 120,
            render: (_, row) =>
              row.payment.state === 'NO_FEE' ? (
                <Text type="secondary">No fee</Text>
              ) : (
                <KuwickStatusTag
                  {...paymentChip(row.payment.state === 'PAID' ? 'PAID' : 'PENDING')}
                  detail={money(row.payment.amount)}
                />
              ),
          },
          {
            title: 'Reminder',
            width: 140,
            render: (_, row) =>
              row.reminder.sentAt ? (
                // WHO and WHEN, not just a tick. "Reminded" with nobody's name
                // on it is the thing this column exists to replace.
                <Tooltip
                  title={row.reminder.sentBy ? `Sent by ${row.reminder.sentBy}` : undefined}
                >
                  <span className="kw-appt-reminded">
                    Sent {formatClinicDate(row.reminder.sentAt)}
                  </span>
                </Tooltip>
              ) : (
                <Text type="secondary">Not sent</Text>
              ),
          },
          {
            title: 'Source',
            width: 110,
            render: (_, row) => (
              <Tooltip title={row.sourceDetail ?? undefined}>
                <Text type="secondary">
                  {SOURCE_LABELS[row.source as AppointmentSource] ?? sentence(row.source)}
                </Text>
              </Tooltip>
            ),
          },
          {
            title: 'Status',
            width: 120,
            render: (_, row) => <KuwickStatusTag {...statusChip(row.status)} />,
          },
          {
            title: 'Actions',
            width: 250,
            render: (_, row) => (
              <Space size={4} wrap onClick={(event) => event.stopPropagation()}>
                {row.status === 'REQUESTED' ? (
                  <Button
                    size="small"
                    onClick={() =>
                      act(confirmAppointment.mutateAsync({ id: row.id }), 'Could not accept.')
                    }
                  >
                    Accept
                  </Button>
                ) : null}
                {CHECK_IN_FROM_STATUSES.includes(row.status as AppointmentStatus) ? (
                  <Button
                    size="small"
                    type="primary"
                    onClick={() =>
                      act(checkInAppointment.mutateAsync({ id: row.id }), 'Could not check in.')
                    }
                  >
                    Check in
                  </Button>
                ) : null}
                {ARRIVABLE_FROM_STATUSES.includes(row.status as AppointmentStatus) ? (
                  <Button
                    size="small"
                    onClick={() =>
                      act(noShowAppointment.mutateAsync({ id: row.id }), 'Could not mark no-show.')
                    }
                  >
                    No-show
                  </Button>
                ) : null}
                {!NON_CANCELLABLE_STATUSES.includes(row.status as AppointmentStatus) ? (
                  <Button size="small" onClick={() => setRescheduling(row)}>
                    Reschedule
                  </Button>
                ) : null}
                {!NON_CANCELLABLE_STATUSES.includes(row.status as AppointmentStatus) ? (
                  <Popconfirm
                    title="Cancel this appointment?"
                    onConfirm={() =>
                      act(cancelAppointment.mutateAsync({ id: row.id }), 'Could not cancel.')
                    }
                  >
                    <Button size="small" danger>
                      Cancel
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            ),
          },
          {
            title: '',
            width: 52,
            render: (_, row) => (
              <Tooltip
                title={row.patient.phone ? 'Send a WhatsApp reminder' : 'No phone number on file'}
              >
                <Button
                  type="text"
                  icon={<WhatsAppOutlined />}
                  aria-label={`Send a WhatsApp reminder to ${row.patient.name}`}
                  disabled={!row.patient.phone}
                  onClick={(event) => {
                    event.stopPropagation();
                    sendReminder(row);
                  }}
                />
              </Tooltip>
            ),
          },
        ]}
      />
      <RescheduleAppointmentDrawer
        appointment={
          rescheduling
            ? ({
                id: rescheduling.id,
                clinicId: rescheduling.clinicId,
                staffId: rescheduling.staffId,
                serviceId: rescheduling.serviceId,
                patientId: rescheduling.patientId,
                scheduledStart: rescheduling.scheduledStart,
                scheduledEnd: rescheduling.scheduledEnd,
                status: rescheduling.status,
              } as never)
            : null
        }
        onClose={() => {
          setRescheduling(null);
          queryClient.invalidateQueries({ queryKey: ['appointment-dashboard'] });
        }}
      />
    </>
  );
}

const EMPTY_TEXT: Record<DashboardTab, string> = {
  UPCOMING: 'No appointments booked in this period',
  REQUESTS: 'No bookings are waiting for approval',
  ARRIVED: 'Nobody has arrived yet',
  COMPLETED: 'Nothing was completed in this period',
  NO_SHOW: 'Nobody missed an appointment in this period',
  CANCELLED: 'Nothing was cancelled in this period',
  // Says what would fill it, so an empty tab is an answer rather than a
  // question.
  TO_BE_SCHEDULED:
    'Nothing is waiting on a decision — this fills with appointments whose time has passed that were never checked in or marked no-show',
};
