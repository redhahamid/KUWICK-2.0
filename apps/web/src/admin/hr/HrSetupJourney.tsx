import { Link } from "react-router-dom";
import { canvas } from "../../design-system/tokens";
import { Button, Progress, Tag } from "antd";
import { AdminSection } from "../components/AdminShell";
import {
  useAttendancePolicy,
  useLeavePolicies,
  useLegalEmployers,
  usePayComponents,
  usePayrollReadiness,
  useStatutoryRuleSets,
} from "../hooks/useAdmin";

type State = "NOT_STARTED" | "INCOMPLETE" | "READY";

interface Step {
  key: string;
  title: string;
  /** One sentence. What breaks without it — never a paragraph. */
  why: string;
  state: State;
  detail: string | null;
  cta: { label: string; to: string };
}

const STATE_TAG: Record<State, { color: string; label: string }> = {
  NOT_STARTED: { color: "default", label: "Not started" },
  INCOMPLETE: { color: "gold", label: "Incomplete" },
  READY: { color: "green", label: "Ready" },
};

/**
 * GET YOUR WORKFORCE READY.
 *
 * A clinic that has not set HR up does not need a dashboard: every figure on
 * it is zero, and a screen full of zeros reads as "nothing is happening"
 * rather than "nothing is configured". The owner's own question was "where do
 * I start?", and the honest answer is a list in dependency order with one
 * button each.
 *
 * NOTHING HERE IS NEW STATE. Every step reads the same endpoint the screen
 * that fixes it reads, so a step cannot say Ready while the thing it describes
 * is missing — which is the failure mode of a setup checklist that keeps its
 * own progress flags.
 */
export function HrSetupJourney({
  period,
  clinicId,
}: {
  period: string;
  clinicId?: string;
}) {
  const employers = useLegalEmployers();
  const readiness = usePayrollReadiness({ period, clinicId });
  const components = usePayComponents();
  const attendance = useAttendancePolicy();
  const leave = useLeavePolicies();
  const statutory = useStatutoryRuleSets();

  // Until every read has landed there is nothing honest to say, and a
  // half-answered checklist is worse than none.
  if (
    !employers.data ||
    !readiness.data ||
    !components.data ||
    !attendance.data ||
    !leave.data ||
    !statutory.data
  ) {
    return null;
  }

  const employerRows = employers.data;
  const incompleteEmployers = employerRows.filter(
    (row) => !row.epfEmployerNo || !row.socsoEmployerNo || !row.lhdnEmployerNo,
  );
  const people = readiness.data;
  const withoutSalary = people.employees.filter((row) =>
    row.readiness.items.some((item) => item.key === "salary" && !item.done),
  );

  const steps: Step[] = [
    {
      key: "company",
      title: "The employing company",
      why: "Every statutory return is filed by a company, not by a clinic.",
      state:
        employerRows.length === 0
          ? "NOT_STARTED"
          : incompleteEmployers.length > 0
            ? "INCOMPLETE"
            : "READY",
      detail:
        employerRows.length === 0
          ? null
          : incompleteEmployers.length > 0
            ? `${incompleteEmployers.length} missing an EPF, SOCSO or LHDN number`
            : `${employerRows.length} on file`,
      cta: {
        label: employerRows.length === 0 ? "Set up employer" : "Open",
        to: "/admin/hr/settings/company",
      },
    },
    {
      key: "people",
      title: "Your employees",
      why: "Somebody with no employment record is left out of payroll rather than refused.",
      state: people.summary.total === 0 ? "NOT_STARTED" : "READY",
      detail:
        people.summary.total === 0
          ? null
          : `${people.summary.total} on the payroll`,
      cta: {
        label: people.summary.total === 0 ? "Add employees" : "Open",
        to: "/admin/hr/employees",
      },
    },
    {
      key: "pay",
      title: "Salary and pay components",
      why: "Payroll cannot work out a payslip without the salary in force.",
      state:
        people.summary.total === 0
          ? "NOT_STARTED"
          : withoutSalary.length > 0
            ? "INCOMPLETE"
            : "READY",
      detail:
        withoutSalary.length > 0
          ? `${withoutSalary.length} without a salary on record`
          : `${components.data.components?.length ?? 0} pay components set up`,
      cta: {
        label: withoutSalary.length > 0 ? "Set salaries" : "Open",
        to: "/admin/hr/employees",
      },
    },
    {
      key: "schedule",
      title: "The roster",
      why: "Attendance is judged against the roster, and reads it rather than guessing.",
      // A roster is per branch and per month, so "ready" is not a global fact.
      // The step points at the board rather than claiming to know.
      state: "INCOMPLETE",
      detail: "Weekly pattern or shift roster, per branch",
      cta: { label: "Open the roster", to: "/admin/hr/attendance/roster" },
    },
    {
      key: "attendance",
      title: "Attendance & leave",
      why: "A 24-hour clinic and a nine-to-five practice do not agree about when 09:06 is late.",
      state:
        attendance.data.hasOwnPolicy || attendance.data.hasGroupDefault
          ? "READY"
          : "NOT_STARTED",
      detail:
        attendance.data.hasOwnPolicy || attendance.data.hasGroupDefault
          ? `Late after ${attendance.data.policy.lateGraceMinutes} min · overtime from ${attendance.data.policy.overtimeMinimumMinutes} min`
          : "Kuwick's defaults apply until you choose",
      cta: {
        label: "Set the rules",
        to: "/admin/hr/settings/attendance-leave",
      },
    },
    {
      key: "leave",
      title: "Leave policies",
      why: "Without an entitlement there is no balance to approve against.",
      state: leave.data.length === 0 ? "NOT_STARTED" : "READY",
      detail: leave.data.length === 0 ? null : `${leave.data.length} set up`,
      cta: {
        label: leave.data.length === 0 ? "Set up leave" : "Open",
        to: "/admin/hr/settings",
      },
    },
    {
      key: "payroll",
      title: "Statutory rates and approval",
      why: "EPF, SOCSO, EIS and PCB are worked out from the tables in force.",
      state: statutory.data.some((set) => set.verified)
        ? "READY"
        : statutory.data.length > 0
          ? "INCOMPLETE"
          : "NOT_STARTED",
      detail: statutory.data.some((set) => set.verified)
        ? "Checked against the authorities’ published tables"
        : "Rates in force have not been verified",
      cta: { label: "Open payroll settings", to: "/admin/hr/settings" },
    },
  ];

  const ready = steps.filter((step) => step.state === "READY").length;

  return (
    <AdminSection
      title="Get your workforce ready"
      description={`${ready} of ${steps.length} done. Each one is needed by the one below it.`}
    >
      <Progress
        percent={Math.round((ready / steps.length) * 100)}
        showInfo={false}
        strokeColor={canvas.indigo}
      />
      <div className="kw-setupSteps">
        {steps.map((step, index) => (
          <div
            className={`kw-setupSteps__row kw-setupSteps__row--${step.state.toLowerCase()}`}
            key={step.key}
          >
            <span className="kw-setupSteps__index">{index + 1}</span>
            <div className="kw-setupSteps__body">
              <div className="kw-setupSteps__titleRow">
                <span className="kw-setupSteps__title">{step.title}</span>
                <Tag color={STATE_TAG[step.state].color}>
                  {STATE_TAG[step.state].label}
                </Tag>
              </div>
              <span className="kw-muted">{step.why}</span>
              {step.detail ? (
                <span className="kw-setupSteps__detail">{step.detail}</span>
              ) : null}
            </div>
            <Link to={step.cta.to}>
              <Button
                size="small"
                type={step.state === "NOT_STARTED" ? "primary" : "default"}
              >
                {step.cta.label}
              </Button>
            </Link>
          </div>
        ))}
      </div>
    </AdminSection>
  );
}
