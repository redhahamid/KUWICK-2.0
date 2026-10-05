import { useEffect, useRef, type RefObject } from "react";
import { SegControl } from "./ui";
import { Table } from "./ui/Table";
import type {
  StatutoryEditionSource,
  StatutoryRates,
  StatutoryTables,
} from "../types";

/**
 * THE TABLES THEMSELVES, band by band — what the rates screen used to
 * summarise and now shows in full for the month chosen: the Third Schedule
 * part by part, Act 4's and Act 800's schedules, and the MTD specification's
 * Table 1 with every parameter the formula reads. Read-only: a clinic checks
 * these; the platform adds a later edition.
 *
 * Each table takes the amount typed in the viewer's head and LIGHTS the band
 * it falls in, scrolling it into view, rather than hiding the rest of the
 * table: a clinic checking a figure wants to see the band's neighbours, and a
 * table that shrinks to seven rows as you type reads as a table that lost
 * something.
 */
const rm = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? "—"
    : `RM${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const longDate = (iso: string) => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
};

export function editionLine(
  source: StatutoryEditionSource | undefined,
): string | null {
  if (!source) return null;
  const who =
    source.origin === "PLATFORM" ? "Platform edition" : "Built-in edition";
  const year = source.year ? ` ${source.year}` : "";
  // A built-in document's own name often says when it took force; saying it
  // twice on one line reads as a mistake.
  const inForce = /in force from/i.test(source.document)
    ? ""
    : ` · in force from ${longDate(source.inForceFrom)}`;
  return `${who}${year} · ${source.document}${inForce}`;
}

/** The amount typed in the head, in cents; null when nothing usable is typed. */
export function amountCents(value: string): number | null {
  const cents = Math.round(Number(value.replace(/[^0-9.]/g, "")) * 100);
  return value.trim() !== "" && Number.isFinite(cents) && cents > 0
    ? cents
    : null;
}

/** The index of the band an amount falls in; an open top band (`to` null) takes everything above its floor. */
export function bandIndex<T>(
  rows: readonly T[],
  cents: number | null,
  from: (row: T) => number,
  to: (row: T) => number | null,
): number {
  if (cents === null) return -1;
  return rows.findIndex((row) => {
    const top = to(row);
    return cents >= from(row) && (top === null || cents <= top);
  });
}

/** The lit band comes into view, centred, each time it changes. */
function useScrollToHit(ref: RefObject<HTMLDivElement | null>, hit: number) {
  useEffect(() => {
    if (hit < 0) return;
    const row = ref.current?.querySelector<HTMLElement>(".hr-row--hit");
    // jsdom has no scrollIntoView; a browser does.
    row?.scrollIntoView?.({ block: "center" });
  }, [ref, hit]);
}

const PART_LABEL: Record<string, string> = {
  A: "Part A — under 60: citizens, PRs, non-citizens who elected before Aug 1998",
  C: "Part C — 60 and over: PRs and non-citizens who elected before Aug 1998",
  E: "Part E — 60 and over: Malaysian citizens",
  F: "Part F — non-citizens (flat percentage, no bands)",
};

export function EpfScheduleTable({
  tables,
  part,
  onPart,
  wages,
}: {
  tables: StatutoryTables["epf"] | undefined;
  part: "A" | "C" | "E" | "F";
  onPart: (part: "A" | "C" | "E" | "F") => void;
  /** The wage typed in the viewer's head. */
  wages: string;
}) {
  const current = tables?.parts.find((candidate) => candidate.part === part);
  const wagesCents = amountCents(wages);
  const searching = wagesCents !== null;
  const rows = (current?.bands ?? []).map((band, index) => ({
    index,
    from: band[0],
    to: band[1],
    employer: band[2],
    employee: band[3],
  }));
  const hit = bandIndex(
    rows,
    wagesCents,
    (row) => row.from,
    (row) => row.to,
  );
  const ref = useRef<HTMLDivElement>(null);
  useScrollToHit(ref, hit);
  return (
    <div ref={ref}>
      <div className="hr-modal__tools">
        <SegControl
          label="Third Schedule part"
          value={part}
          onChange={(value) => onPart(value as "A" | "C" | "E" | "F")}
          options={(tables?.parts ?? []).map((row) => ({
            value: row.part,
            label: `Part ${row.part}`,
          }))}
        />
      </div>
      <div className="hr-panelNote">
        {current
          ? (PART_LABEL[current.part] ?? current.appliesTo)
          : "No part chosen."}
        {current
          ? `. Above ${rm(tables?.ceilingCents)}: ${current.aboveCeiling.employeePercent}% employee, ${current.aboveCeiling.employerPercent}% employer, the total rounded up to the ringgit.`
          : ""}
        {current && current.bands.length === 0
          ? " This part states a flat percentage and has no band table."
          : ""}
      </div>
      {searching && hit >= 0 ? (
        <div className="hr-notice hr-notice--info">
          {rm(wagesCents)} falls in the band {rm(rows[hit].from)} –{" "}
          {rm(rows[hit].to)}: employer {rm(rows[hit].employer)}, employee{" "}
          {rm(rows[hit].employee)}.
        </div>
      ) : null}
      {searching && hit < 0 && current && current.bands.length > 0 ? (
        <div className="hr-notice hr-notice--info">
          {wagesCents > (tables?.ceilingCents ?? 0)
            ? `${rm(wagesCents)} is above the table ceiling of ${rm(tables?.ceilingCents)}: the percentage applies.`
            : `${rm(wagesCents)} falls in no band of this part.`}
        </div>
      ) : null}
      <Table
        rows={rows}
        rowKey={(row) => String(row.from)}
        rowClassName={(row) => (row.index === hit ? "hr-row--hit" : "")}
        emptyText={
          current && current.bands.length === 0
            ? "Flat percentage, no bands"
            : "No bands in this part"
        }
        columns={[
          {
            title: "Wages",
            render: (_: unknown, row) => `${rm(row.from)} – ${rm(row.to)}`,
          },
          {
            title: "Employer",
            num: true,
            render: (_: unknown, row) => rm(row.employer),
          },
          {
            title: "Employee",
            num: true,
            render: (_: unknown, row) => rm(row.employee),
          },
          {
            title: "Total",
            num: true,
            render: (_: unknown, row) => rm(row.employer + row.employee),
          },
        ]}
      />
      {!searching && rows.length > 0 ? (
        <div className="hr-panelNote">
          {rows.length} bands in Part {part}.
        </div>
      ) : null}
    </div>
  );
}

type SocsoBand = StatutoryRates["socso"]["bands"][number];
type EisBand = StatutoryRates["eis"]["bands"][number];

const bandLabel = (fromCents: number, toCents: number | null) =>
  toCents === null
    ? `over ${rm(fromCents)}`
    : `${rm(fromCents)} – ${rm(toCents)}`;

export function SocsoBandsTable({
  bands,
  wages,
}: {
  bands: readonly SocsoBand[] | undefined;
  wages: string;
}) {
  const rows = bands ?? [];
  const hit = bandIndex(
    rows,
    amountCents(wages),
    (band) => band.fromCents,
    (band) => band.toCents,
  );
  const ref = useRef<HTMLDivElement>(null);
  useScrollToHit(ref, hit);
  return (
    <div ref={ref}>
      <Table
        rows={rows as SocsoBand[]}
        rowKey={(band) => String(band.fromCents)}
        rowClassName={(band) =>
          rows.indexOf(band) === hit ? "hr-row--hit" : ""
        }
        columns={[
          {
            title: "Wages",
            render: (_: unknown, band) =>
              bandLabel(band.fromCents, band.toCents),
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
            render: (_: unknown, band) => rm(band.cat1EmployeeNonInjuryCents),
          },
          {
            title: "Employer (cat 2)",
            num: true,
            render: (_: unknown, band) => rm(band.cat2EmployerCents),
          },
          {
            title: "Employee SKBBK (cat 2)",
            num: true,
            render: (_: unknown, band) => rm(band.cat2EmployeeNonInjuryCents),
          },
        ]}
      />
    </div>
  );
}

export function EisBandsTable({
  bands,
  wages,
}: {
  bands: readonly EisBand[] | undefined;
  wages: string;
}) {
  const rows = bands ?? [];
  const hit = bandIndex(
    rows,
    amountCents(wages),
    (band) => band.fromCents,
    (band) => band.toCents,
  );
  const ref = useRef<HTMLDivElement>(null);
  useScrollToHit(ref, hit);
  return (
    <div ref={ref}>
      <Table
        rows={rows as EisBand[]}
        rowKey={(band) => String(band.fromCents)}
        rowClassName={(band) =>
          rows.indexOf(band) === hit ? "hr-row--hit" : ""
        }
        columns={[
          {
            title: "Wages",
            render: (_: unknown, band) =>
              bandLabel(band.fromCents, band.toCents),
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
    </div>
  );
}

export function PcbParametersView({
  pcb,
  amount,
}: {
  pcb: StatutoryTables["pcb"] | undefined;
  /** The chargeable income (P) typed in the viewer's head. */
  amount: string;
}) {
  const rows = pcb?.table1 ?? [];
  const hit = bandIndex(
    rows,
    amountCents(amount),
    (row) => row.fromCents,
    (row) => row.toCents,
  );
  const ref = useRef<HTMLDivElement>(null);
  useScrollToHit(ref, hit);
  if (!pcb) return null;
  const params: [string, string][] = [
    ["Individual relief", rm(pcb.individualCents)],
    ["Spouse relief (category 2)", rm(pcb.spouseCents)],
    ["Per qualifying child (categories 2 and 3)", rm(pcb.perChildCents)],
    ["Disabled individual", rm(pcb.disabledSelfCents)],
    ["Disabled spouse", rm(pcb.disabledSpouseCents)],
    ["EPF relief cap for the year", rm(pcb.epfReliefCapCents)],
    ["Non-resident flat rate", `${pcb.nonResidentRatePercent}%`],
    ["Minimum MTD deducted", rm(pcb.minimumCents)],
  ];
  return (
    <div ref={ref}>
      <div className="hr-kv hr-kv--pairs" style={{ padding: "14px 0 12px" }}>
        {params.map(([key, value]) => (
          <span key={key} style={{ display: "contents" }}>
            <span className="hr-kv__k">{key}</span>
            <span className="hr-kv__v">{value}</span>
          </span>
        ))}
      </div>
      <Table
        rows={rows as StatutoryTables["pcb"]["table1"][number][]}
        rowKey={(row) => String(row.fromCents)}
        rowClassName={(row) => (rows.indexOf(row) === hit ? "hr-row--hit" : "")}
        columns={[
          {
            title: "P — chargeable income",
            render: (_: unknown, row) => bandLabel(row.fromCents, row.toCents),
          },
          {
            title: "M",
            num: true,
            render: (_: unknown, row) => rm(row.mCents),
          },
          {
            title: "R",
            num: true,
            render: (_: unknown, row) => `${row.ratePercent}%`,
          },
          {
            title: "B — categories 1 and 3",
            num: true,
            render: (_: unknown, row) => rm(row.bCategory13Cents),
          },
          {
            title: "B — category 2",
            num: true,
            render: (_: unknown, row) => rm(row.bCategory2Cents),
          },
        ]}
      />
      <div className="hr-panelNote">
        Table 1 of the Computerised Calculation: the year’s tax is [(P − M) R +
        B], apportioned over the months left.
      </div>
    </div>
  );
}
