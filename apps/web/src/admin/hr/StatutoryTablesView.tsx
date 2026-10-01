import { Input } from "antd";
import { SegControl } from "./ui";
import { Table } from "./ui/Table";
import type { StatutoryEditionSource, StatutoryTables } from "../types";

/**
 * THE TABLES THEMSELVES, band by band — what the rates screen used to
 * summarise and now shows in full for the month chosen: the Third Schedule
 * part by part with a wage search, and the MTD specification's Table 1 with
 * every parameter the formula reads. Read-only: a clinic checks these; the
 * platform adds a later edition.
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
  onWages,
}: {
  tables: StatutoryTables["epf"] | undefined;
  part: "A" | "C" | "E" | "F";
  onPart: (part: "A" | "C" | "E" | "F") => void;
  wages: string;
  onWages: (value: string) => void;
}) {
  const current = tables?.parts.find((candidate) => candidate.part === part);
  const wagesCents = Math.round(Number(wages.replace(/[^0-9.]/g, "")) * 100);
  const searching =
    wages.trim() !== "" && Number.isFinite(wagesCents) && wagesCents > 0;
  // A wage typed in shows its own row and its neighbours, not a thousand rows.
  const rows = (current?.bands ?? []).map((band, index) => ({
    index,
    from: band[0],
    to: band[1],
    employer: band[2],
    employee: band[3],
  }));
  const hit = searching
    ? rows.findIndex((row) => wagesCents >= row.from && wagesCents <= row.to)
    : -1;
  const shown = searching
    ? hit >= 0
      ? rows.slice(Math.max(0, hit - 3), hit + 4)
      : []
    : rows;
  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <SegControl
          label="Third Schedule part"
          value={part}
          onChange={(value) => onPart(value as "A" | "C" | "E" | "F")}
          options={(tables?.parts ?? []).map((row) => ({
            value: row.part,
            label: `Part ${row.part}`,
          }))}
        />
        <Input
          aria-label="Find the band for a monthly wage"
          placeholder="e.g. 3250.00 — find the band"
          value={wages}
          onChange={(event) => onWages(event.target.value)}
          style={{ maxWidth: 260 }}
          allowClear
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
      <div style={{ overflowX: "auto" }}>
        <Table
          rows={shown}
          rowKey={(row) => String(row.from)}
          emptyText={
            current && current.bands.length === 0
              ? "Flat percentage, no bands"
              : "Type a wage to find its band"
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
      </div>
      {!searching && rows.length > 0 ? (
        <div className="hr-panelNote">
          {rows.length} bands in Part {part}.
        </div>
      ) : null}
    </div>
  );
}

export function PcbParametersView({
  pcb,
}: {
  pcb: StatutoryTables["pcb"] | undefined;
}) {
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
    <div>
      <div className="hr-kv hr-kv--pairs" style={{ marginBottom: 16 }}>
        {params.map(([key, value]) => (
          <span key={key} style={{ display: "contents" }}>
            <span className="hr-kv__k">{key}</span>
            <span className="hr-kv__v">{value}</span>
          </span>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <Table
          rows={pcb.table1}
          rowKey={(row) => String(row.fromCents)}
          columns={[
            {
              title: "P — chargeable income",
              render: (_: unknown, row) =>
                row.toCents === null
                  ? `over ${rm(row.fromCents)}`
                  : `${rm(row.fromCents)} – ${rm(row.toCents)}`,
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
      </div>
      <div className="hr-panelNote">
        Table 1 of the Computerised Calculation: the year’s tax is [(P − M) R +
        B], apportioned over the months left.
      </div>
    </div>
  );
}
