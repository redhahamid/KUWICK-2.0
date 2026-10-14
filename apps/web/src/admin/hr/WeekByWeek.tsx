import dayjs from "dayjs";
import { usePayrollWeeks } from "../hooks/useAdmin";
import type { PayrollWeek } from "../types";
import { Panel, PanelHead } from "./ui";

const hours = (minutes: number) =>
  `${Math.round((minutes / 60) * 100) / 100} h`;
const rm = (cents: number) => `RM ${(cents / 100).toFixed(2)}`;
const BASIS: Record<string, string> = {
  ACT: "Employment Act",
  WEEKLY: "weekly only",
  AVERAGED: "s.60C averaging",
};

/**
 * WEEK BY WEEK (Section C, 14 October 2026): how this run's overtime, locum
 * hours and night shifts were worked out, one row per week that ended last
 * month. Shows nothing when the rule set still approves day by day.
 */
export function WeekByWeek({
  runId,
  staffId,
}: {
  runId: string;
  staffId: string;
}) {
  const weeks = usePayrollWeeks(runId, staffId);
  const rows = weeks.data ?? [];
  if (rows.length === 0) return null;
  const doctor = rows[0].working.group === "DOCTOR";
  return (
    <div data-testid="week-by-week">
      <Panel className="hr-mt">
        <PanelHead
          title="Week by week"
          sub={
            doctor
              ? "Day hours above the weekly normal are locum hours; night shifts are paid apart."
              : `Overtime by the ${BASIS[rows[0].working.basis] ?? rows[0].working.basis} basis. The published roster is the approval.`
          }
        />
        <table className="hr-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Week</th>
              <th>Normal</th>
              <th>Counted</th>
              <th>{doctor ? "Locum" : "Overtime"}</th>
              {doctor ? <th>Nights</th> : null}
              <th style={{ textAlign: "right" }}>Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((week) => (
              <WeekRow key={week.id} week={week} doctor={doctor} />
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function WeekRow({ week, doctor }: { week: PayrollWeek; doctor: boolean }) {
  const w = week.working;
  const holidayMinutes = w.holidayLocum.reduce(
    (sum, day) => sum + day.minutes,
    0,
  );
  return (
    <>
      <tr>
        <td>
          {dayjs(week.weekStart).format("D MMM")} –{" "}
          {dayjs(week.weekEnd).format("D MMM")}
        </td>
        <td>{hours(w.normalMinutes)}</td>
        <td>{hours(w.countedMinutes)}</td>
        <td>
          {doctor
            ? `${hours(w.locumMinutes)}${holidayMinutes > 0 ? ` + ${hours(holidayMinutes)} holiday` : ""}`
            : w.dailyOvertimeMinutes > 0
              ? `${hours(w.overtimeMinutes)} (${hours(w.dailyOvertimeMinutes)} past the day)`
              : hours(w.overtimeMinutes)}
        </td>
        {doctor ? <td>{w.nights.length}</td> : null}
        <td style={{ textAlign: "right" }}>
          {rm(
            w.pay.overtimeCents +
              w.pay.locumCents +
              w.pay.holidayCents +
              w.pay.nightCents,
          )}
        </td>
      </tr>
      {w.notes.length > 0 ? (
        <tr>
          <td
            colSpan={doctor ? 6 : 5}
            className="hr-faint"
            style={{ fontSize: 12 }}
          >
            {w.notes.join(" ")}
          </td>
        </tr>
      ) : null}
    </>
  );
}
