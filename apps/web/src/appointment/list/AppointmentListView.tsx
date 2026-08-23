import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Dropdown, Empty, Input, Modal, Segmented, Select, Space, Table, Tooltip, Typography, message } from 'antd';
import { EllipsisOutlined, WhatsAppOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
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
} from '../hooks/useAppointmentDashboard';
import { useWaitlist } from '../hooks/useWaitlist';
import { MessagePatientModal } from '../messages/MessagePatientModal';
import { RemindersDueButton } from '../messages/RemindersDueDrawer';
import { permissionHint, useCan } from '../../core/hooks/useCan';
import { RescheduleAppointmentDrawer } from '../RescheduleAppointmentDrawer';
import { AppointmentDrawer } from '../calendar/AppointmentDrawer';
import { paymentChip, sentence, statusChip } from '../appointment-presentation';
import { SOURCE_LABELS, type AppointmentSource } from '../types';
import {
  ARRIVABLE_FROM_STATUSES,
  CHECK_IN_FROM_STATUSES,
  NON_CANCELLABLE_STATUSES,
} from '../appointment-status.constants';
import { PersonAvatar } from '../shared/PersonAvatar';
import {
  useCancelAppointment,
  useConfirmAppointment,
  useMarkArrivedAppointment,
  useNoShowAppointment,
} from '../hooks/useAppointments';
import { CheckInRegistrationDrawer } from '../checkin/CheckInRegistrationDrawer';

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
// clinicName stays on the props interface for the module page's sake, but the
// list no longer builds any message text itself — the template modal resolves
// the patient-facing identity on its own.
export function AppointmentListView({ clinicId, onBook }: AppointmentListViewProps) {
  const { data: staff } = useStaff();
  const { data: services } = useServices();

  const [tab, setTab] = useState<ListTab>('UPCOMING');
  // The default period follows the TAB, not the calendar month. "This month"
  // is a poor default for a diary: opened on the 30th it shows one day of
  // upcoming appointments.
  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRangeFor('UPCOMING'));
  const [rangeChosen, setRangeChosen] = useState(false);
  const [staffId, setStaffId] = useState<string>();
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Phase 5 — a notification's "View appointment" lands here with ?open=<id>;
  // the drawer opens once and the param is consumed so refresh/back stay sane.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const open = searchParams.get('open');
    if (!open) return;
    setSelectedId(open);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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
    serviceIds,
    sources,
    search: search.trim() || undefined,
  });
  const { data: waitlist, isFetching: loadingWaitlist } = useWaitlist({
    clinicId,
    staffId,
    // The endpoint reads a comma list; a waitlist entry has no source.
    serviceId: serviceIds.length ? serviceIds.join(',') : undefined,
    search: search.trim() || undefined,
  });

  // Phase 3I — the KPI band describes the FILTERED worklist, and says so.
  const filtersActive =
    Boolean(staffId) || serviceIds.length > 0 || sources.length > 0 || search.trim().length > 0;

  const clearFilters = () => {
    setStaffId(undefined);
    setServiceIds([]);
    setSources([]);
    setSearch('');
  };

  const doctors = useMemo(
    () =>
      staff?.filter(
        (member) => member.role === 'DOCTOR_RESIDENT' || member.role === 'DOCTOR_LOCUM',
      ) ?? [],
    [staff],
  );

  // Mockup 4 — the status counts live ON the tabs ("Upcoming 11"), so the
  // worklist's shape is readable before a row is. Server figures, same as the
  // old KPI band (`appointment-dashboard.service.ts`).
  const tabCounts: Partial<Record<ListTab, number | undefined>> = {
    UPCOMING: data?.stats.upcoming,
    REQUESTS: data?.stats.requests,
    ARRIVED: data?.stats.arrived,
    COMPLETED: data?.stats.completed,
    NO_SHOW: data?.stats.noShow,
    CANCELLED: data?.stats.cancelled,
  };

  return (
    <div className="kw-appt-list">
      <div className="kw-appt-controls">
        <Segmented
          className="kw-appt-tabs"
          value={tab}
          onChange={(value) => changeTab(value as ListTab)}
          options={TABS.map((entry) => ({
            value: entry.value,
            label:
              tabCounts[entry.value] != null ? (
                <span className="kw-appt-tab">
                  {entry.label}
                  <span className="kw-appt-tab-count">{tabCounts[entry.value]}</span>
                </span>
              ) : (
                entry.label
              ),
          }))}
        />
        <StatsBar stats={data?.stats} loading={isFetching && !data} filtered={filtersActive} />
      </div>

      <div className="kw-appt-controls">
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
            mode="multiple"
            maxTagCount={1}
            placeholder="Any service"
            value={serviceIds}
            onChange={setServiceIds}
            allowClear
            showSearch
            optionFilterProp="label"
            options={services?.map((service) => ({ value: service.id, label: service.name }))}
            style={{ minWidth: 190 }}
          />
          {tab !== 'WAITLIST' ? (
            <Select
              mode="multiple"
              maxTagCount={1}
              placeholder="Any source"
              value={sources}
              onChange={setSources}
              allowClear
              optionFilterProp="label"
              options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))}
              style={{ minWidth: 150 }}
            />
          ) : null}
          <Input.Search
            placeholder="Patient name or phone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          {/* PHASE 8 — the reminder rules' worklist, where the counter works
              it: beside the list it reminds from. */}
          <RemindersDueButton clinicId={clinicId} />
        </Space>
      </div>

      {/* Phase 3H — the active narrowing said out loud, one chip each. */}
      {filtersActive ? (
        <div className="kw-cal-active-filters" data-testid="list-active-filters">
          {staffId ? (
            <span className="kw-filter-chip">
              {doctors.find((doctor) => doctor.id === staffId)?.fullName ?? 'Doctor'}
              <button type="button" aria-label="Remove doctor filter" onClick={() => setStaffId(undefined)}>
                ×
              </button>
            </span>
          ) : null}
          {serviceIds.map((id) => (
            <span key={id} className="kw-filter-chip">
              {services?.find((service) => service.id === id)?.name ?? 'Service'}
              <button
                type="button"
                aria-label="Remove service filter"
                onClick={() => setServiceIds((current) => current.filter((value) => value !== id))}
              >
                ×
              </button>
            </span>
          ))}
          {sources.map((value) => (
            <span key={value} className="kw-filter-chip">
              {SOURCE_LABELS[value as AppointmentSource] ?? value}
              <button
                type="button"
                aria-label="Remove source filter"
                onClick={() => setSources((current) => current.filter((item) => item !== value))}
              >
                ×
              </button>
            </span>
          ))}
          {search.trim() ? (
            <span className="kw-filter-chip">
              “{search.trim()}”
              <button type="button" aria-label="Clear the patient search" onClick={() => setSearch('')}>
                ×
              </button>
            </span>
          ) : null}
          <Button type="link" size="small" onClick={clearFilters}>
            Clear all
          </Button>
        </div>
      ) : null}

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
                <span className="kw-appt-patient-cell">
                  <PersonAvatar name={row.patient.name} size="md" />
                  <span className="kw-appt-patient">
                    <span className="kw-appt-patient-name">{row.patient.name}</span>
                    {row.patient.phone ? (
                      <span className="kw-appt-patient-phone">{row.patient.phone}</span>
                    ) : null}
                  </span>
                </span>
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
          onOpen={setSelectedId}
          onBook={onBook}
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

/**
 * How many attendable appointments a no-show rate needs before it is worth
 * reading as a rate rather than as three individual patients.
 */
const NO_SHOW_MEANINGFUL_SAMPLE = 20;

/**
 * Mockup 4 slimmed the old five-card KPI band down: the per-status counts now
 * ride the tabs themselves, so what remains here is what only THIS strip can
 * say — the §46 money (booked value vs realised revenue, two different
 * meanings), the no-show rate an owner acts on, and the "Filtered" flag.
 */
function StatsBar({
  stats,
  loading,
  filtered = false,
}: {
  stats?: DashboardStats;
  loading: boolean;
  filtered?: boolean;
}) {
  return (
    <div className="kw-appt-stats" data-testid="appointment-stats" data-loading={loading}>
      {/* §3I — these figures describe the FILTERED worklist. Unlabelled, a
          service-filtered "Upcoming 12" reads as the whole clinic's twelve. */}
      {filtered ? <span className="kw-appt-stats-filtered">Filtered results</span> : null}
      {stats?.noShowRate != null ? (
        // DEMOTED, AND SAID WITH ITS DENOMINATOR (approved decision 12).
        //
        // "60%" on its own is true and useless: the server divides no-shows
        // by the appointments a patient COULD have turned up to — completed
        // plus no-show, cancellations excluded — over whatever range and
        // filters are on screen, and three of five reads very differently
        // from three hundred of five hundred. The calculation is untouched;
        // the denominator is simply recomposed from the same two counts the
        // endpoint already returns, and the figure steps down to secondary
        // type while the sample is too small to act on.
        <span
          className="kw-appt-stats-cell kw-appt-stats-cell--quiet"
          data-thin={stats.completed + stats.noShow < NO_SHOW_MEANINGFUL_SAMPLE || undefined}
        >
          <span className="kw-appt-stats-label">No-show</span>
          <span className="kw-appt-stats-value">{Math.round(stats.noShowRate * 100)}%</span>
          <span className="kw-appt-stats-detail">
            {stats.noShow} of {stats.completed + stats.noShow} attendable
          </span>
        </span>
      ) : null}
      <span className="kw-appt-stats-cell">
        <span className="kw-appt-stats-label">Booked value</span>
        <span className="kw-appt-stats-value">{stats ? money(stats.bookedValue) : '—'}</span>
        <span className="kw-appt-stats-detail">
          {stats ? `${money(stats.realisedRevenue)} realised` : ''}
        </span>
      </span>
    </div>
  );
}

function AppointmentTable({
  rows,
  loading,
  tab,
  onOpen,
  onBook,
}: {
  rows: DashboardRow[];
  loading: boolean;
  tab: DashboardTab;
  onOpen: (id: string) => void;
  onBook: () => void;
}) {
  const confirmAppointment = useConfirmAppointment();
  const markArrived = useMarkArrivedAppointment();
  // Phase 4 — the primary is REGISTER / CHECK IN, which opens the
  // registration review; nothing is created until Confirm & add to queue.
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const permEdit = useCan('appointment.edit');
  const permCreate = useCan('appointment.create');
  const permCheckIn = useCan('appointment.check_in');
  const permCancel = useCan('appointment.cancel');
  const permNoShow = useCan('appointment.no_show');
  const permReschedule = useCan('appointment.reschedule');
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

  // PHASE 8 — the Remind button opens the SAME template modal as the drawer:
  // the message comes from the clinic's own wording through the one renderer,
  // in either language, previewed before anything opens. The modal's log
  // stamps reminderSentAt server-side, so the Reminder column stays fed.
  const [messagingRow, setMessagingRow] = useState<DashboardRow | null>(null);

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
            >
              {/* An empty worklist offers the next move, not 500px of blank
                  table. */}
              {tab === 'UPCOMING' || tab === 'REQUESTS' ? (
                <Tooltip
                  title={permCreate ? undefined : permissionHint('book an appointment')}
                >
                  <Button type="primary" disabled={!permCreate} onClick={onBook}>
                    New appointment
                  </Button>
                </Tooltip>
              ) : null}
            </Empty>
          ),
        }}
        columns={[
          // V3 worklist priority: WHEN → PATIENT → SERVICE → PROVIDER →
          // STATUS, then the quiet operational columns. Same facts as V2,
          // re-weighted: the row is a work item, not a record dump.
          {
            title: 'When',
            width: 150,
            render: (_, row) => (
              <div className="kw-appt-when">
                <span className="kw-appt-when-time">
                  {formatClinicTime(row.scheduledStart)}–{formatClinicTime(row.scheduledEnd)}
                </span>
                <span className="kw-appt-when-date">{formatClinicDate(row.scheduledStart)}</span>
              </div>
            ),
          },
          {
            title: 'Patient',
            render: (_, row) => (
              // Mockup 4 — the patient is a PERSON in the row: the neutral
              // slate avatar beside name-over-phone.
              <span className="kw-appt-patient-cell">
                <PersonAvatar name={row.patient.name} size="md" />
                <span className="kw-appt-patient">
                  <span className="kw-appt-patient-name">{row.patient.name}</span>
                  {row.patient.phone ? (
                    <span className="kw-appt-patient-phone">{row.patient.phone}</span>
                  ) : null}
                </span>
              </span>
            ),
          },
          {
            title: 'Service',
            width: 180,
            render: (_, row) => (
              <span className="kw-appt-service" title={row.service.name}>
                {row.service.name}
              </span>
            ),
          },
          {
            title: 'Provider',
            render: (_, row) => (
              <span className="kw-appt-provider-cell">
                <PersonAvatar name={row.provider.fullName} colorSeed={row.staffId} size="sm" />
                <span>{row.provider.fullName}</span>
              </span>
            ),
          },
          {
            title: 'Status',
            width: 120,
            render: (_, row) => <KuwickStatusTag {...statusChip(row.status)} />,
          },
          {
            title: 'Payment',
            width: 120,
            render: (_, row) =>
              row.payment.state === 'NO_FEE' ? (
                <Text className="kw-appt-quiet">No fee</Text>
              ) : (
                <KuwickStatusTag
                  {...paymentChip(row.payment.state === 'PAID' ? 'PAID' : 'PENDING')}
                  detail={money(row.payment.amount)}
                />
              ),
          },
          {
            title: 'Reminder',
            width: 130,
            render: (_, row) =>
              row.reminder.sentAt ? (
                // WHO and WHEN, worded as what Kuwick actually observed:
                // WhatsApp was OPENED with the message prefilled. Whether Send
                // was pressed inside WhatsApp is not something this system can
                // see, so this column never claims "sent" on its behalf.
                <Tooltip
                  title={
                    row.reminder.sentBy ? `WhatsApp opened by ${row.reminder.sentBy}` : undefined
                  }
                >
                  <span className="kw-appt-reminded">
                    Opened {formatClinicDate(row.reminder.sentAt)}
                  </span>
                </Tooltip>
              ) : (
                <Text className="kw-appt-quiet">—</Text>
              ),
          },
          {
            title: 'Source',
            width: 110,
            render: (_, row) => (
              <Tooltip title={row.sourceDetail ?? undefined}>
                <Text className="kw-appt-quiet">
                  {SOURCE_LABELS[row.source as AppointmentSource] ?? sentence(row.source)}
                </Text>
              </Tooltip>
            ),
          },
          {
            // ONE button and a menu (§11). Four buttons per row times thirty
            // rows was a hundred and twenty buttons on one screen — the
            // reader stopped seeing any of them. The primary is the row's
            // NEXT step; everything else waits behind the dots.
            title: '',
            width: 150,
            render: (_, row) => {
              const cancellable = !NON_CANCELLABLE_STATUSES.includes(row.status as AppointmentStatus);
              const menuItems = [
                cancellable
                  ? {
                      key: 'reschedule',
                      label: 'Reschedule',
                      disabled: !permReschedule,
                      title: permReschedule ? undefined : permissionHint('move an appointment'),
                    }
                  : null,
                // Phase 4D — "they're here" in one keystroke, WITHOUT creating
                // the visit. Registration and the queue happen at Register /
                // Check in.
                ARRIVABLE_FROM_STATUSES.includes(row.status as AppointmentStatus)
                  ? {
                      key: 'arrived',
                      label: 'Mark arrived',
                      disabled: !permCheckIn,
                      title: permCheckIn
                        ? 'Records that the patient is at the desk — registration and the queue happen at Register / Check in'
                        : permissionHint('mark a patient as arrived'),
                    }
                  : null,
                ARRIVABLE_FROM_STATUSES.includes(row.status as AppointmentStatus)
                  ? {
                      key: 'no-show',
                      label: 'Mark as no-show',
                      disabled: !permNoShow,
                      title: permNoShow
                        ? undefined
                        : permissionHint('mark an appointment as a no-show'),
                    }
                  : null,
                cancellable
                  ? {
                      key: 'cancel',
                      danger: true,
                      label: 'Cancel appointment',
                      disabled: !permCancel,
                      title: permCancel ? undefined : permissionHint('cancel an appointment'),
                    }
                  : null,
              ].filter(Boolean) as { key: string; label: string }[];
              return (
                <Space size={4} onClick={(event) => event.stopPropagation()}>
                  {row.status === 'REQUESTED' ? (
                    <Tooltip
                      title={permEdit ? undefined : permissionHint('accept a booking request')}
                    >
                      <Button
                        size="small"
                        type="primary"
                        disabled={!permEdit}
                        onClick={() =>
                          act(confirmAppointment.mutateAsync({ id: row.id }), 'Could not accept.')
                        }
                      >
                        Accept
                      </Button>
                    </Tooltip>
                  ) : CHECK_IN_FROM_STATUSES.includes(row.status as AppointmentStatus) ? (
                    <Tooltip
                      title={permCheckIn ? undefined : permissionHint('check a patient in')}
                    >
                      <Button
                        size="small"
                        type="primary"
                        disabled={!permCheckIn}
                        onClick={() => setCheckingInId(row.id)}
                      >
                        Register / Check in
                      </Button>
                    </Tooltip>
                  ) : (
                    <Button size="small" onClick={() => onOpen(row.id)}>
                      View
                    </Button>
                  )}
                  {menuItems.length > 0 ? (
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: menuItems,
                        onClick: ({ key }) => {
                          if (key === 'reschedule') setRescheduling(row);
                          if (key === 'arrived') {
                            act(markArrived.mutateAsync({ id: row.id }), 'Could not mark arrived.');
                          }
                          if (key === 'no-show') {
                            Modal.confirm({
                              title: 'Mark as a no-show?',
                              okText: 'No-show',
                              okButtonProps: { danger: true },
                              onOk: () =>
                                act(
                                  noShowAppointment.mutateAsync({ id: row.id }),
                                  'Could not mark no-show.',
                                ),
                            });
                          }
                          if (key === 'cancel') {
                            Modal.confirm({
                              title: 'Cancel this appointment?',
                              content: 'The slot is released for somebody else to book.',
                              okText: 'Cancel appointment',
                              okButtonProps: { danger: true },
                              cancelText: 'Keep it',
                              onOk: () =>
                                act(cancelAppointment.mutateAsync({ id: row.id }), 'Could not cancel.'),
                            });
                          }
                        },
                      }}
                    >
                      <Button
                        size="small"
                        type="text"
                        icon={<EllipsisOutlined />}
                        aria-label={`More actions for ${row.patient.name}`}
                      />
                    </Dropdown>
                  ) : null}
                </Space>
              );
            },
          },
          {
            title: '',
            width: 52,
            render: (_, row) => (
              <Tooltip
                title={
                  row.patient.phone
                    ? 'Open WhatsApp with a reminder message'
                    : 'No phone number on file'
                }
              >
                <Button
                  type="text"
                  icon={<WhatsAppOutlined />}
                  aria-label={`Open WhatsApp with a reminder for ${row.patient.name}`}
                  disabled={!row.patient.phone}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMessagingRow(row);
                  }}
                />
              </Tooltip>
            ),
          },
        ]}
      />
      {checkingInId ? (
        <CheckInRegistrationDrawer
          appointmentId={checkingInId}
          onClose={() => setCheckingInId(null)}
          onCheckedIn={() =>
            queryClient.invalidateQueries({ queryKey: ['appointment-dashboard'] })
          }
        />
      ) : null}
      {messagingRow ? (
        <MessagePatientModal
          open
          onClose={() => setMessagingRow(null)}
          clinicId={messagingRow.clinicId}
          appointment={{
            id: messagingRow.id,
            scheduledStart: messagingRow.scheduledStart,
            manageToken: messagingRow.manageToken ?? null,
            patient: messagingRow.patient,
            staff: { fullName: messagingRow.provider.fullName },
            service: { name: messagingRow.service.name },
          }}
          defaultTemplateKey="REMINDER"
        />
      ) : null}
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
