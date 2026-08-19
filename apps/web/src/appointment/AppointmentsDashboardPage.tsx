import { useMemo, useState } from "react";
import {
  Avatar,
  Button,
  DatePicker,
  Empty,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  message,
} from "antd";
import { WhatsAppOutlined } from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import { PageHeader } from "../design-system/components/PageHeader";
import { KuwickStatusTag } from "../design-system/kuwick";
import { useClinicFilter } from "../core/hooks/useClinicFilter";
import { useStaff } from "../hr/hooks/useStaff";
import { useServices } from "../clinical/hooks/useServices";
import { formatClinicDate, formatClinicTime } from "../clinical/clinicTime";
import {
  DashboardRow,
  DashboardStats,
  DashboardTab,
  useAppointmentDashboard,
  useMarkReminderSent,
} from "./hooks/useAppointmentDashboard";
import { whatsappLink } from "./whatsappReminder";
import { Popconfirm } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../core/api-client";
import { RescheduleAppointmentDrawer } from "./RescheduleAppointmentDrawer";
import { BookAppointmentDrawer } from "./BookAppointmentDrawer";
import { AppointmentCalendarView } from "./calendar/AppointmentCalendarView";
import { AppointmentStatus } from "@kuwick/shared";
// The SAME guards the popover and the API use. A third copy of "which
// statuses may be marked arrived" is a third thing to forget to update.
import {
  ARRIVABLE_FROM_STATUSES,
  NON_CANCELLABLE_STATUSES,
} from "./appointment-status.constants";
import {
  useArrivedAppointment,
  useCancelAppointment,
  useConfirmAppointment,
  useNoShowAppointment,
} from "./hooks/useAppointments";

const TABS: { value: DashboardTab; label: string }[] = [
  { value: "UPCOMING", label: "Upcoming" },
  { value: "COMPLETED", label: "Completed" },
  { value: "NO_SHOW", label: "No-Show" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "TO_BE_SCHEDULED", label: "To Be Scheduled" },
  { value: "REQUESTS", label: "Requests" },
];

const STATUS_TONE: Record<
  string,
  "success" | "active" | "attention" | "error" | "neutral"
> = {
  CONFIRMED: "active",
  REMINDED: "active",
  ARRIVED: "success",
  IN_QUEUE: "success",
  COMPLETED: "success",
  REQUESTED: "attention",
  NO_SHOW: "error",
  CANCELLED: "neutral",
  RESCHEDULED: "neutral",
};

const money = (value: number) =>
  `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A stable colour per provider, so the same doctor reads the same everywhere. */
function initials(name: string): string {
  return name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * APPOINTMENTS — the clinic dashboard.
 *
 * The stats bar and the list come from ONE response, so they cannot show two
 * different periods mid-refresh, and the five figures are computed server-side
 * (`appointment-dashboard.service.ts`) so this screen and the future report
 * cannot disagree about what "no-show rate" means.
 *
 * Every time on this page renders in the CLINIC's clock, per the piece 1
 * convention. An owner reading the diary from another country sees the hours
 * the front desk sees.
 */
export function AppointmentsDashboardPage() {
  const { clinicId, clinics, showSelector, setClinicId } = useClinicFilter();
  const { data: staff } = useStaff();
  const { data: services } = useServices();

  const [tab, setTab] = useState<DashboardTab>("UPCOMING");
  // The default period follows the TAB, not the calendar month. "This month"
  // is a poor default for a diary: opened on the 30th it shows one day of
  // upcoming appointments, and a booking made for next Tuesday is invisible on
  // the screen whose job is to show it.
  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRangeFor("UPCOMING"));
  // Once a person picks a period it is theirs — switching tabs must not throw
  // it away.
  const [rangeChosen, setRangeChosen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  // LIST or CALENDAR — the same appointments, two ways of reading them. The
  // calendar was orphaned when the old page was retired; this is the only
  // route to it, and a screen nothing links to may as well not exist.
  const [surface, setSurface] = useState<"list" | "calendar">("list");

  const changeTab = (next: DashboardTab) => {
    setTab(next);
    if (!rangeChosen) setRange(defaultRangeFor(next));
  };
  const [staffId, setStaffId] = useState<string>();
  const [serviceId, setServiceId] = useState<string>();
  const [search, setSearch] = useState("");

  const { data, isFetching } = useAppointmentDashboard({
    clinicId,
    from: range[0].format("YYYY-MM-DD"),
    to: range[1].format("YYYY-MM-DD"),
    tab,
    staffId,
    serviceId,
    search: search.trim() || undefined,
  });

  const clinicName = useMemo(
    () =>
      clinics?.find((clinic) => clinic.id === clinicId)?.name ?? "the clinic",
    [clinics, clinicId],
  );

  const doctors = useMemo(
    () =>
      staff?.filter(
        (member) =>
          member.role === "DOCTOR_RESIDENT" || member.role === "DOCTOR_LOCUM",
      ) ?? [],
    [staff],
  );

  return (
    <div className="kw-appt-page">
      <PageHeader
        title="Appointments"
        subtitle="The diary for the selected period, and what it is worth."
        extra={
          <Space size={8}>
            <Segmented
              value={surface}
              onChange={(value) => setSurface(value as "list" | "calendar")}
              options={[
                { value: "list", label: "List" },
                { value: "calendar", label: "Calendar" },
              ]}
            />
            <Button type="primary" onClick={() => setBookOpen(true)}>
              Book appointment
            </Button>
          </Space>
        }
      />

      {surface === "calendar" && (
        <AppointmentCalendarView clinicId={clinicId} onSwitchToList={() => setSurface("list")} />
      )}

      {surface === "list" && <StatsBar stats={data?.stats} loading={isFetching && !data} />}

      {surface === "list" && (
      <div className="kw-appt-controls">
        <Segmented
          className="kw-appt-tabs"
          value={tab}
          onChange={(value) => changeTab(value as DashboardTab)}
          options={TABS.map((entry) => ({
            value: entry.value,
            label: entry.label,
          }))}
        />
        <Space size={8} wrap className="kw-appt-filters">
          {showSelector && (
            <Select
              placeholder="Branch"
              value={clinicId}
              onChange={setClinicId}
              options={clinics?.map((clinic) => ({
                value: clinic.id,
                label: clinic.name,
              }))}
              style={{ minWidth: 160 }}
            />
          )}
          <DatePicker.RangePicker
            value={range}
            onChange={(next) => {
              if (!next?.[0] || !next?.[1]) return;
              setRange([next[0], next[1]]);
              setRangeChosen(true);
            }}
            allowClear={false}
          />
          <Select
            placeholder="Any doctor"
            value={staffId}
            onChange={setStaffId}
            allowClear
            showSearch
            optionFilterProp="label"
            options={doctors.map((doctor) => ({
              value: doctor.id,
              label: doctor.fullName,
            }))}
            style={{ minWidth: 180 }}
          />
          <Select
            placeholder="Any service"
            value={serviceId}
            onChange={setServiceId}
            allowClear
            showSearch
            optionFilterProp="label"
            options={services?.map((service) => ({
              value: service.id,
              label: service.name,
            }))}
            style={{ minWidth: 200 }}
          />
          <Input.Search
            placeholder="Patient name or phone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            style={{ width: 240 }}
          />
        </Space>
      </div>
      )}

      {surface === "list" && (
      <AppointmentTable
        rows={data?.rows ?? []}
        loading={isFetching}
        tab={tab}
        clinicName={clinicName}
      />
      )}

      <BookAppointmentDrawer open={bookOpen} onClose={() => setBookOpen(false)} />
    </div>
  );
}

/**
 * Upcoming looks FORWARD, history looks BACK. One default cannot serve both: a
 * month-to-date range shows an empty Completed tab on the 1st and an empty
 * Upcoming tab on the 30th.
 */
function defaultRangeFor(tab: DashboardTab): [Dayjs, Dayjs] {
  if (tab === "COMPLETED" || tab === "NO_SHOW" || tab === "CANCELLED" || tab === "TO_BE_SCHEDULED") {
    return [dayjs().subtract(30, "day").startOf("day"), dayjs().endOf("day")];
  }
  return [dayjs().startOf("day"), dayjs().add(30, "day").endOf("day")];
}

function StatsBar({
  stats,
  loading,
}: {
  stats?: DashboardStats;
  loading: boolean;
}) {
  const cells = [
    {
      key: "upcoming",
      label: "Upcoming",
      value: stats?.upcoming,
      tone: "active" as const,
    },
    {
      key: "completed",
      label: "Completed",
      value: stats?.completed,
      tone: "success" as const,
    },
    {
      key: "cancelled",
      label: "Cancelled",
      value: stats?.cancelled,
      tone: "neutral" as const,
    },
    {
      key: "noShow",
      label: "No-show",
      value: stats?.noShow,
      tone: "error" as const,
      // The rate is the number an owner actually acts on; the count alone
      // means nothing without knowing how many could have turned up.
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
          <span className="kw-appt-stat-value">{cell.value ?? "—"}</span>
          {cell.detail && (
            <span className="kw-appt-stat-detail">{cell.detail}</span>
          )}
        </div>
      ))}
      <div className="kw-appt-stat kw-appt-stat-money" data-tone="primary">
        <span className="kw-appt-stat-label">Potential sales</span>
        <span className="kw-appt-stat-value">
          {stats ? money(stats.potentialSales) : "—"}
        </span>
        <span className="kw-appt-stat-detail">
          {stats ? `${money(stats.realisedSales)} realised` : ""}
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
}: {
  rows: DashboardRow[];
  loading: boolean;
  tab: DashboardTab;
  clinicName: string;
}) {
  const markReminder = useMarkReminderSent();
  const confirmAppointment = useConfirmAppointment();
  const arrivedAppointment = useArrivedAppointment();
  const noShowAppointment = useNoShowAppointment();
  const cancelAppointment = useCancelAppointment();
  const [rescheduling, setRescheduling] = useState<DashboardRow | null>(null);
  const queryClient = useQueryClient();

  // Every lifecycle action refreshes the dashboard, because the stats bar
  // above the table is computed from the same rows: marking a no-show that
  // left the counts unchanged would be a screen disagreeing with itself.
  const act = async (run: Promise<unknown>, failure: string) => {
    try {
      await run;
      queryClient.invalidateQueries({ queryKey: ["appointment-dashboard"] });
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
      message.warning("This patient has no usable phone number on file.");
      return;
    }
    // Opened FIRST. If the popup is blocked or the staff member changes their
    // mind, nothing has been recorded — a "reminder sent" mark for a message
    // that never opened is worse than no mark at all.
    window.open(link, "_blank", "noopener,noreferrer");
    try {
      await markReminder.mutateAsync(row.id);
    } catch {
      message.error("WhatsApp opened, but the reminder could not be recorded.");
    }
  };

  return (
    <>
      <Table<DashboardRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{
          pageSize: 25,
          hideOnSinglePage: true,
          showSizeChanger: false,
        }}
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
            title: "Patient",
            render: (_, row) => (
              <div className="kw-appt-patient">
                <span className="kw-appt-patient-name">{row.patient.name}</span>
                {row.patient.phone && (
                  <span className="kw-appt-patient-phone">
                    {row.patient.phone}
                  </span>
                )}
              </div>
            ),
          },
          {
            title: "Date",
            width: 130,
            render: (_, row) => formatClinicDate(row.scheduledStart),
          },
          {
            title: "Time",
            width: 120,
            render: (_, row) =>
              `${formatClinicTime(row.scheduledStart)}–${formatClinicTime(row.scheduledEnd)}`,
          },
          { title: "Service", render: (_, row) => row.service.name },
          {
            title: "Provider",
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
            title: "Payment",
            width: 120,
            render: (_, row) =>
              row.payment.state === "NO_FEE" ? (
                <Typography.Text type="secondary">No fee</Typography.Text>
              ) : (
                <KuwickStatusTag
                  tone={row.payment.state === "PAID" ? "success" : "attention"}
                  label={row.payment.state === "PAID" ? "Paid" : "Unpaid"}
                  detail={money(row.payment.amount)}
                />
              ),
          },
          {
            title: "Reminder",
            width: 150,
            render: (_, row) =>
              row.reminder.sentAt ? (
                // WHO and WHEN, not just a tick. "Reminded" with nobody's name
                // on it is the thing this column exists to replace.
                <Tooltip
                  title={
                    row.reminder.sentBy
                      ? `Sent by ${row.reminder.sentBy}`
                      : undefined
                  }
                >
                  <span className="kw-appt-reminded">
                    Sent {formatClinicDate(row.reminder.sentAt)}
                  </span>
                </Tooltip>
              ) : (
                <Typography.Text type="secondary">Not sent</Typography.Text>
              ),
          },
          {
            title: "Status",
            width: 120,
            render: (_, row) => (
              <KuwickStatusTag
                tone={STATUS_TONE[row.status] ?? "neutral"}
                label={row.status.replace(/_/g, " ").toLowerCase()}
              />
            ),
          },
          {
            title: "Actions",
            width: 260,
            render: (_, row) => (
              <Space size={4} wrap>
                {row.status === "REQUESTED" && (
                  <Button
                    size="small"
                    onClick={() =>
                      act(
                        confirmAppointment.mutateAsync({ id: row.id }),
                        "Could not confirm.",
                      )
                    }
                  >
                    Confirm
                  </Button>
                )}
                {ARRIVABLE_FROM_STATUSES.includes(row.status as AppointmentStatus) && (
                  <Button
                    size="small"
                    onClick={() =>
                      act(
                        arrivedAppointment.mutateAsync({ id: row.id }),
                        "Could not mark arrived.",
                      )
                    }
                  >
                    Arrived
                  </Button>
                )}
                {ARRIVABLE_FROM_STATUSES.includes(row.status as AppointmentStatus) && (
                  <Button
                    size="small"
                    onClick={() =>
                      act(
                        noShowAppointment.mutateAsync({ id: row.id }),
                        "Could not mark no-show.",
                      )
                    }
                  >
                    No-Show
                  </Button>
                )}
                {!NON_CANCELLABLE_STATUSES.includes(row.status as AppointmentStatus) && (
                  <Button size="small" onClick={() => setRescheduling(row)}>
                    Reschedule
                  </Button>
                )}
                {!NON_CANCELLABLE_STATUSES.includes(row.status as AppointmentStatus) && (
                  <Popconfirm
                    title="Cancel this appointment?"
                    onConfirm={() =>
                      act(
                        cancelAppointment.mutateAsync({ id: row.id }),
                        "Could not cancel.",
                      )
                    }
                  >
                    <Button size="small" danger>
                      Cancel
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
          {
            title: "",
            width: 56,
            render: (_, row) => (
              <Tooltip
                title={
                  row.patient.phone
                    ? "Send a WhatsApp reminder"
                    : "No phone number on file"
                }
              >
                <Button
                  type="text"
                  icon={<WhatsAppOutlined />}
                  aria-label={`Send a WhatsApp reminder to ${row.patient.name}`}
                  disabled={!row.patient.phone}
                  onClick={() => sendReminder(row)}
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
          queryClient.invalidateQueries({
            queryKey: ["appointment-dashboard"],
          });
        }}
      />
    </>
  );
}


const EMPTY_TEXT: Record<DashboardTab, string> = {
  UPCOMING: "No appointments booked in this period",
  COMPLETED: "Nothing was completed in this period",
  NO_SHOW: "Nobody missed an appointment in this period",
  CANCELLED: "Nothing was cancelled in this period",
  // Says what would fill it, so an empty tab is an answer rather than a
  // question.
  TO_BE_SCHEDULED:
    "Nothing is waiting on a decision — this fills with appointments whose time has passed that were never marked arrived or no-show",
  REQUESTS: "No bookings are waiting for approval",
};
