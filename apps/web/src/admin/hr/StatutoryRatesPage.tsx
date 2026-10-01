import { useState } from "react";
import { Link } from "react-router-dom";
import { App, DatePicker } from "antd";
import dayjs from "dayjs";
import { useClinicFilter } from "../../core/hooks/useClinicFilter";
import { useCan } from "../../core/hooks/useCan";
import {
  useLegalEmployers,
  useMarkStatutoryChecked,
  usePayrollReadiness,
  useStatutoryRates,
} from "../hooks/useAdmin";
import { Drawer, HrPage, Panel, PanelHead, StatusChip } from "./ui";
import { Table } from "./ui/Table";
import {
  EpfScheduleTable,
  PcbParametersView,
  editionLine,
} from "./StatutoryTablesView";

/**
 * STATUTORY RATES — what Kuwick deducts and what the clinic pays on top.
 *
 * Nothing on this page can be typed into. EPF, SOCSO, EIS and PCB rates are
 * not a tenant preference — they are identical for every employer in Malaysia
 * — and the calculation reads them from `apps/api/src/statutory`, transcribed
 * from the authorities' own documents. This page shows those same tables.
 *
 * TWO DIFFERENT FACTS SIT IN THE HEAD OF THE PAGE, and the difference is the
 * point. The registry's own verification says whether Kuwick's transcription
 * was checked against KWSP's, PERKESO's and LHDN's documents; that is what
 * the approval bar reads, and nothing here moves it. "Checked 3 Sep 2026" says
 * that a named person at THIS clinic looked at these tables on that date: the
 * clinic's own diligence, kept apart from Kuwick's so that neither can be
 * mistaken for the other.
 */
const rm = (cents: number) =>
  `RM${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
const pct = (value: number) => `${value}%`;

const HRD_LABELS: Record<string, string> = {
  MANDATORY_SECTION_14: "Registered — s.14, 1%",
  OPTIONAL_SECTION_15: "Registered — s.15, 0.5%",
  NOT_REGISTERED: "Not registered",
};

export function StatutoryRatesPage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  // THE MONTH THE TABLES ARE SHOWN FOR. A run resolves its schedules on the
  // period's last day, so a past month shows the edition that priced it,
  // which may not be the one in force today.
  const [period, setPeriod] = useState(dayjs().format("YYYY-MM"));
  const rates = useStatutoryRates(period);
  const employers = useLegalEmployers();
  const readiness = usePayrollReadiness({
    period: dayjs().format("YYYY-MM"),
    clinicId,
  });
  const mark = useMarkStatutoryChecked();
  const mayCheck = useCan("hr.payroll.approve");
  const [showBands, setShowBands] = useState<
    "SOCSO" | "EIS" | "EPF" | "PCB" | null
  >(null);
  const [epfPart, setEpfPart] = useState<"A" | "C" | "E" | "F">("A");
  const [wageSearch, setWageSearch] = useState("");

  const data = rates.data;
  const check = data?.check ?? null;
  const epfA = data?.epf.parts.find((part) => part.part === "A");
  const epfE = data?.epf.parts.find((part) => part.part === "E");
  const epfF = data?.epf.parts.find((part) => part.part === "F");
  const inForce = (stamp: { effectiveFrom: string } | null | undefined) =>
    stamp
      ? `In force from ${dayjs(stamp.effectiveFrom).format("D MMM YYYY")}`
      : "No schedule held";

  // "N employees have not answered the monthly tax questions" — readiness
  // already judges this per employee for the payroll gate; the count is
  // borrowed from it, not recomputed here.
  const taxOutstanding = (readiness.data?.employees ?? []).filter((employee) =>
    employee.readiness.items.some(
      (item) => /tax|pcb/i.test(item.label) && !item.done,
    ),
  ).length;
  const employerRows = employers.data ?? [];

  const onMark = () =>
    mark.mutate(undefined, {
      onSuccess: () =>
        message.success(
          "Recorded. The registry itself is unchanged; this is your check.",
        ),
      onError: (error: Error) => message.error(error.message),
    });

  return (
    <HrPage
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Statutory
          rates
        </>
      }
      title="Statutory rates"
      sub="What Kuwick deducts and what the clinic pays on top. Rates come from KWSP, PERKESO and LHDN tables — you check them, you don't type them."
      error={rates.error instanceof Error ? rates.error.message : null}
      actions={
        <>
          <DatePicker
            picker="month"
            allowClear={false}
            aria-label="Month"
            value={dayjs(`${period}-01`)}
            onChange={(value) => value && setPeriod(value.format("YYYY-MM"))}
            format="MMM YYYY"
            style={{ width: 132 }}
          />
          {check ? (
            <StatusChip tone={check.current ? "done" : "attn"}>
              {check.current ? "Checked" : "Checked before the current edition"}{" "}
              {dayjs(check.checkedAt).format("D MMM YYYY")}
              {check.checkedBy ? ` · ${check.checkedBy}` : ""}
            </StatusChip>
          ) : (
            <StatusChip tone="attn">Not checked by this clinic</StatusChip>
          )}
          <button
            type="button"
            className="hr-btn hr-btn--primary"
            onClick={onMark}
            disabled={!mayCheck || mark.isPending}
            title={
              mayCheck
                ? undefined
                : "Only somebody who can approve payroll may record a check."
            }
          >
            Mark as checked
          </button>
        </>
      }
    >
      <div className="hr-grid2">
        <Panel>
          <PanelHead
            title="EPF (KWSP)"
            sub={
              editionLine(data?.editions?.EPF) ?? inForce(data?.epf.schedule)
            }
          />
          <div className="hr-rate">
            <div className="hr-rate__h">Employee group</div>
            <div className="hr-rate__h hr-rate__num">Employee</div>
            <div className="hr-rate__h hr-rate__num">Employer</div>
            <div className="hr-rate__h hr-rate__num">Wage ceiling</div>
            <div>Malaysian, under 60</div>
            <div className="hr-rate__num">
              {epfA ? pct(epfA.employeePercent) : "—"}
            </div>
            <div className="hr-rate__num">
              {epfA
                ? epfA.employerPercentUpTo5000 &&
                  epfA.employerPercentUpTo5000 !== epfA.employerPercent
                  ? `${pct(epfA.employerPercentUpTo5000)} ≤ RM5,000 · ${pct(epfA.employerPercent)} above`
                  : pct(epfA.employerPercent)
                : "—"}
            </div>
            <div className="hr-rate__num">none</div>
            <div>Malaysian, 60 and over</div>
            <div className="hr-rate__num">
              {epfE ? pct(epfE.employeePercent) : "—"}
            </div>
            <div className="hr-rate__num">
              {epfE ? pct(epfE.employerPercent) : "—"}
            </div>
            <div className="hr-rate__num">none</div>
            <div>Non-Malaysian</div>
            <div className="hr-rate__num">
              {epfF ? pct(epfF.employeePercent) : "—"}
            </div>
            <div className="hr-rate__num">
              {epfF ? pct(epfF.employerPercent) : "—"}
            </div>
            <div className="hr-rate__num">none</div>
          </div>
          <div className="hr-panelNote">
            Per-employee choices (9% / 11%, voluntary excess) are set on the
            employee's Statutory tab.
            {data?.epf.schedule
              ? ` Registry: ${data.epf.schedule.evidence}`
              : ""}{" "}
            <button
              type="button"
              className="hr-btn hr-btn--ghost hr-btn--sm"
              onClick={() => setShowBands("EPF")}
            >
              View Third Schedule, band by band
            </button>
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="SOCSO & EIS (PERKESO)"
            sub={`${editionLine(data?.editions?.SOCSO) ?? inForce(data?.socso.schedule)} · wage ceiling ${data?.wageCeilingLabel ?? "—"}`}
          />
          <div className="hr-rate">
            <div className="hr-rate__h">Scheme</div>
            <div className="hr-rate__h hr-rate__num">Employee</div>
            <div className="hr-rate__h hr-rate__num">Employer</div>
            <div className="hr-rate__h hr-rate__num">Applies to</div>
            <div>SOCSO Category 1 — employment injury and invalidity</div>
            <div className="hr-rate__num">≈0.5%</div>
            <div className="hr-rate__num">≈1.75%</div>
            <div className="hr-rate__num">under 60</div>
            <div>SOCSO Category 2 — employment injury</div>
            <div className="hr-rate__num">0%</div>
            <div className="hr-rate__num">≈1.25%</div>
            <div className="hr-rate__num">60+, or after cat 1 exhausted</div>
            <div>LINDUNG 24 JAM (SKBBK) — non-employment injury</div>
            <div className="hr-rate__num">≈0.75%</div>
            <div className="hr-rate__num">in the category figure</div>
            <div className="hr-rate__num">both categories</div>
            <div>EIS</div>
            <div className="hr-rate__num">0.2%</div>
            <div className="hr-rate__num">0.2%</div>
            <div className="hr-rate__num">Malaysian, under 60</div>
          </div>
          <div className="hr-panelNote">
            <strong>
              LINDUNG 24 JAM covers the employee away from work, and everybody
              is in it by default.
            </strong>{" "}
            PERKESO enrols every contributing employee automatically; leaving is
            the employee's own act, through a PERKESO opt-out form, not
            something the clinic decides. Record it per employee on their
            Statutory tab. It is a third scheme rather than part of SOCSO, which
            is why the employee's share is two figures in Category 1 and why a
            Category 2 employee now pays something where they used to pay
            nothing. The employer's share of it is inside the category figure
            above, which is how PERKESO's own table prints it.
          </div>
          <div className="hr-panelNote">
            Exact ringgit amounts follow PERKESO's contribution table by wage
            band, not a flat percentage.{" "}
            <button
              type="button"
              className="hr-btn hr-btn--ghost hr-btn--sm"
              onClick={() => setShowBands("SOCSO")}
            >
              View SOCSO table
            </button>{" "}
            <button
              type="button"
              className="hr-btn hr-btn--ghost hr-btn--sm"
              onClick={() => setShowBands("EIS")}
            >
              View EIS table
            </button>
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="PCB / MTD (LHDN)"
            sub={
              editionLine(data?.editions?.PCB) ??
              (data?.pcb.schedule
                ? `${data.pcb.schedule.section}`
                : "Computerised method")
            }
          />
          <div className="hr-rate">
            <div className="hr-rate__h">Input</div>
            <div className="hr-rate__h hr-rate__num hr-rate__span3">
              Where it comes from
            </div>
            <div>Resident status</div>
            <div className="hr-rate__num hr-rate__span3">
              Employee › Statutory
            </div>
            <div>Marital status & children</div>
            <div className="hr-rate__num hr-rate__span3">
              Employee › Statutory (TP3 on joining)
            </div>
            <div>Reliefs, zakat, previous employer</div>
            <div className="hr-rate__num hr-rate__span3">
              Employee › Statutory · TP1 forms
            </div>
            <div>Non-resident flat rate</div>
            <div className="hr-rate__num hr-rate__span3">
              {data ? pct(data.pcb.nonResidentRatePercent) : "—"}
            </div>
          </div>
          <div className="hr-panelNote">
            <button
              type="button"
              className="hr-btn hr-btn--ghost hr-btn--sm"
              onClick={() => setShowBands("PCB")}
            >
              View Table 1 and the parameters
            </button>
          </div>
          <div className="hr-panelNote">
            {taxOutstanding > 0 ? (
              <>
                {taxOutstanding} employee
                {taxOutstanding === 1 ? " has" : "s have"} not answered the
                monthly tax questions — PCB for them may be over-deducted.{" "}
                <Link
                  className="hr-link hr-link--gold"
                  to="/admin/hr/employees"
                >
                  Fix in Employees
                </Link>
              </>
            ) : (
              "Every employee has answered the monthly tax questions."
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="HRD Corp levy"
            sub={editionLine(data?.editions?.HRD_LEVY) ?? "Optional"}
          />
          {employerRows.length === 0 ? (
            <div className="hr-panelNote">
              No legal employer is recorded yet.
            </div>
          ) : (
            employerRows.map((row) => (
              <div key={row.id} className="hr-fld">
                <span className="hr-fld__k">{row.name}</span>
                <span>
                  {row.hrdRegistration ? (
                    (HRD_LABELS[row.hrdRegistration] ?? row.hrdRegistration)
                  ) : (
                    <StatusChip tone="attn">Not recorded</StatusChip>
                  )}
                  <span className="hr-fld__help">
                    {data
                      ? `${pct(data.hrd.mandatoryPercent)} of eligible wages under s.14, ${pct(data.hrd.optionalPercent)} under s.15 — employer only, when registered.`
                      : ""}
                  </span>
                </span>
              </div>
            ))
          )}
          <PanelHead
            title="Employer numbers"
            actions={
              <Link className="hr-link" to="/admin/hr/settings/company">
                Edit in Company &amp; statutory
              </Link>
            }
          />
          {employerRows.map((row) => (
            <div key={row.id} className="hr-kv">
              {employerRows.length > 1 ? (
                <span className="hr-kv__k hr-strong">{row.name}</span>
              ) : null}
              {employerRows.length > 1 ? <span /> : null}
              <span className="hr-kv__k">EPF employer no.</span>
              <span
                className={
                  row.epfEmployerNo ? "hr-kv__v" : "hr-kv__v hr-kv__v--gold"
                }
              >
                {row.epfEmployerNo ?? "Missing"}
              </span>
              <span className="hr-kv__k">SOCSO employer no.</span>
              <span
                className={
                  row.socsoEmployerNo ? "hr-kv__v" : "hr-kv__v hr-kv__v--gold"
                }
              >
                {row.socsoEmployerNo ?? "Missing"}
              </span>
              <span className="hr-kv__k">LHDN E no.</span>
              <span
                className={
                  row.lhdnEmployerNo ? "hr-kv__v" : "hr-kv__v hr-kv__v--gold"
                }
              >
                {row.lhdnEmployerNo ?? "Missing"}
              </span>
            </div>
          ))}
        </Panel>
      </div>

      <Panel>
        <PanelHead
          title="Editions on file"
          sub="Built-in editions are verified in code. A later edition is added by Kuwick, never typed by a clinic; a month is priced on the edition in force on its last day."
        />
        {(data?.versions ?? []).length === 0 ? (
          <div className="hr-panelNote">
            No later edition has been added by Kuwick yet: every scheme runs on
            the built-in, verified tables.
          </div>
        ) : (
          <Table
            rows={data?.versions ?? []}
            rowKey={(row) => row.id}
            columns={[
              { title: "Scheme", render: (_: unknown, row) => row.scheme },
              { title: "Year", render: (_: unknown, row) => String(row.year) },
              {
                title: "In force from",
                render: (_: unknown, row) => row.inForceFrom,
              },
              {
                title: "Source document",
                render: (_: unknown, row) =>
                  row.sourceUrl ? (
                    <a href={row.sourceUrl} target="_blank" rel="noreferrer">
                      {row.sourceDocument}
                    </a>
                  ) : (
                    row.sourceDocument
                  ),
              },
              { title: "Note", render: (_: unknown, row) => row.note ?? "" },
            ]}
          />
        )}
      </Panel>
      <Drawer
        open={showBands !== null}
        title={
          showBands === "SOCSO"
            ? "SOCSO contribution table"
            : showBands === "EIS"
              ? "EIS contribution table"
              : showBands === "EPF"
                ? "EPF Third Schedule"
                : "PCB — Table 1 and parameters"
        }
        sub={
          showBands === "SOCSO"
            ? `Act 4 schedule, including SKBBK · ${data?.socso.bands.length ?? 0} wage bands · ceiling ${data?.wageCeilingLabel ?? ""}`
            : showBands === "EIS"
              ? `Act 800 schedule · ${data?.eis.bands.length ?? 0} wage bands · ceiling ${data?.wageCeilingLabel ?? ""}`
              : showBands === "EPF"
                ? (editionLine(data?.editions?.EPF) ?? "")
                : (editionLine(data?.editions?.PCB) ?? "")
        }
        onClose={() => setShowBands(null)}
      >
        {showBands === "EPF" ? (
          <EpfScheduleTable
            tables={data?.tables?.epf}
            part={epfPart}
            onPart={setEpfPart}
            wages={wageSearch}
            onWages={setWageSearch}
          />
        ) : showBands === "PCB" ? (
          <PcbParametersView pcb={data?.tables?.pcb} />
        ) : showBands === "SOCSO" ? (
          <Table
            rows={data?.socso.bands}
            rowKey={(band) => String(band.fromCents)}
            columns={[
              {
                title: "Wages",
                render: (_: unknown, band) =>
                  band.toCents === null
                    ? `over ${rm(band.fromCents)}`
                    : `${rm(band.fromCents)} – ${rm(band.toCents)}`,
              },
              {
                title: "Employer (cat 1)",
                num: true,
                render: (_: unknown, band) => rm(band.cat1EmployerCents),
              },
              {
                title: "Employee invalidity (cat 1)",
                num: true,
                render: (_: unknown, band) => rm(band.cat1EmployeeCents),
              },
              {
                title: "Employee SKBBK (cat 1)",
                num: true,
                render: (_: unknown, band) =>
                  rm(band.cat1EmployeeNonInjuryCents),
              },
              {
                title: "Employer (cat 2)",
                num: true,
                render: (_: unknown, band) => rm(band.cat2EmployerCents),
              },
              {
                title: "Employee SKBBK (cat 2)",
                num: true,
                render: (_: unknown, band) =>
                  rm(band.cat2EmployeeNonInjuryCents),
              },
            ]}
          />
        ) : (
          <Table
            rows={data?.eis.bands}
            rowKey={(band) => String(band.fromCents)}
            columns={[
              {
                title: "Wages",
                render: (_: unknown, band) =>
                  band.toCents === null
                    ? `over ${rm(band.fromCents)}`
                    : `${rm(band.fromCents)} – ${rm(band.toCents)}`,
              },
              {
                title: "Employer",
                num: true,
                render: (_: unknown, band) => rm(band.employerCents),
              },
              {
                title: "Employee",
                num: true,
                render: (_: unknown, band) => rm(band.employeeCents),
              },
            ]}
          />
        )}
      </Drawer>
    </HrPage>
  );
}
