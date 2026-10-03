import { createHash } from "node:crypto";
import {
  BUILT_IN_EIS_TABLES,
  BUILT_IN_EPF_TABLES,
  BUILT_IN_SOCSO_TABLES,
  EisTables,
  EpfTables,
  SocsoTables,
} from "./contributions";
import { EisBand } from "./eis-act800";
import { EpfBand, EpfPart } from "./epf-third-schedule";
import {
  HRD_LEVY_RATE_MANDATORY_PERCENT,
  HRD_LEVY_RATE_OPTIONAL_PERCENT,
} from "./hrd-levy";
import { BUILT_IN_LINDUNG_TABLES, LindungTables } from "./lindung-24-jam";
import {
  BUILT_IN_PCB_PARAMS,
  PCB_PARAMS_2026_AS_FIRST_CODED,
  PcbBand,
  PcbParams,
} from "./pcb-2026";
import { scheduleFor } from "./registry";
import { SocsoBand } from "./socso-act4";

/**
 * THE EDITIONS A RUN IS PRICED ON — the tables themselves, scheme by scheme,
 * resolved for a period.
 *
 * The figures Kuwick ships are transcribed in code (`epf-third-schedule.ts`
 * and its siblings) and verified against the authorities' own worked
 * examples; the registry dates each edition. A platform admin — Kuwick's
 * owner, never a clinic — may add a LATER edition as data: the same shape,
 * with the source document, the year and the date it is in force from. A
 * period resolves to whichever edition was in force on its last day, so a
 * month already paid is never re-priced by a table published afterwards,
 * and a month before a new edition's date keeps the old one.
 *
 * Nothing here changes a figure by itself: with no platform edition on file,
 * every scheme resolves to the built-in tables exactly as before.
 */
export type EditionScheme =
  | "EPF"
  | "SOCSO"
  | "EIS"
  | "LINDUNG"
  | "PCB"
  | "HRD_LEVY";

export const EDITION_SCHEMES: readonly EditionScheme[] = [
  "EPF",
  "SOCSO",
  "EIS",
  "LINDUNG",
  "PCB",
  "HRD_LEVY",
];

export interface HrdRates {
  readonly mandatoryPercent: number;
  readonly optionalPercent: number;
}
export const BUILT_IN_HRD_RATES: HrdRates = {
  mandatoryPercent: HRD_LEVY_RATE_MANDATORY_PERCENT,
  optionalPercent: HRD_LEVY_RATE_OPTIONAL_PERCENT,
};

/** Where a scheme's figures came from, for the stamp and the screen. */
export interface EditionSource {
  readonly scheme: EditionScheme;
  readonly origin: "BUILT_IN" | "PLATFORM";
  /** The registry's schedule id, or the platform version's row id. */
  readonly id: string;
  readonly document: string;
  readonly year: number | null;
  readonly inForceFrom: string;
  readonly contentHash: string;
}

export interface Editions {
  readonly epf: EpfTables;
  readonly socso: SocsoTables;
  readonly eis: EisTables;
  readonly lindung: LindungTables;
  readonly pcb: PcbParams;
  readonly hrd: HrdRates;
  readonly sources: Readonly<Record<EditionScheme, EditionSource>>;
}

/** Canonical JSON — key order fixed, so the hash depends on values alone. Mirrors the registry's. */
export function contentHashOf(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = canonical((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
    .slice(0, 16);
}

/** A platform-added edition as stored: the content is checked by `parseContent` before it is ever used. */
export interface TableVersionRecord {
  readonly id: string;
  readonly scheme: string;
  readonly year: number;
  readonly inForceFrom: Date;
  readonly sourceDocument: string;
  readonly content: unknown;
  readonly contentHash: string;
}

type LindungCore = Omit<LindungTables, "socso">;

export type ParsedEdition =
  | { scheme: "EPF"; tables: EpfTables }
  | { scheme: "SOCSO"; tables: SocsoTables }
  | { scheme: "EIS"; tables: EisTables }
  | { scheme: "LINDUNG"; tables: LindungCore }
  | { scheme: "PCB"; tables: PcbParams }
  | { scheme: "HRD_LEVY"; tables: HrdRates };

export type ParseResult =
  | { ok: true; parsed: ParsedEdition }
  | { ok: false; problems: string[] };

const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * THE SHAPE, THE ORDER AND THE JOINS — not the figures. A platform admin
 * transcribing a gazette is trusted for the sen; what is checked here is
 * that every band is a band, the bands climb without a gap or an overlap,
 * and the fields the engines read are all there. A refused edition names
 * each problem so it can be fixed in the file rather than guessed at.
 */
export function parseContent(scheme: string, content: unknown): ParseResult {
  const problems: string[] = [];
  const bandList = (
    value: unknown,
    width: number,
    label: string,
    joinedAtEdge: boolean,
  ): number[][] | null => {
    if (!Array.isArray(value) || value.length === 0) {
      problems.push(`${label}: a non-empty list of bands is needed.`);
      return null;
    }
    const rows: number[][] = [];
    value.forEach((row, index) => {
      if (!Array.isArray(row) || row.length !== width) {
        problems.push(
          `${label}: band ${index + 1} must have ${width} figures.`,
        );
        return;
      }
      row.forEach((cell, at) => {
        const openEnd =
          joinedAtEdge &&
          at === 1 &&
          cell === null &&
          index === value.length - 1;
        if (!openEnd && !isInt(cell))
          problems.push(
            `${label}: band ${index + 1}, figure ${at + 1} must be a whole number of cents.`,
          );
        if (isInt(cell) && cell < 0)
          problems.push(
            `${label}: band ${index + 1}, figure ${at + 1} cannot be negative.`,
          );
      });
      rows.push(row as number[]);
    });
    for (let index = 1; index < rows.length; index += 1) {
      const previousTo = rows[index - 1][1];
      const from = rows[index][0];
      if (previousTo === null)
        problems.push(`${label}: only the last band may be open-ended.`);
      else if (joinedAtEdge ? from !== previousTo : from !== previousTo + 1) {
        problems.push(
          `${label}: band ${index + 1} starts at ${from} but the band before ends at ${previousTo} — the bands must join.`,
        );
      }
      if (rows[index][1] !== null && rows[index][1] <= from)
        problems.push(`${label}: band ${index + 1} ends before it starts.`);
    }
    return rows;
  };

  if (!isObj(content))
    return { ok: false, problems: ["The edition must be an object."] };

  switch (scheme) {
    case "EPF": {
      const ceiling = content.ceilingCents;
      if (!isInt(ceiling) || ceiling <= 0)
        problems.push("ceilingCents: the table ceiling in cents is needed.");
      const parts = content.parts;
      const parsedParts: EpfPart[] = [];
      if (!Array.isArray(parts))
        problems.push(
          "parts: the four Third Schedule parts (A, C, E, F) are needed.",
        );
      else {
        for (const letter of ["A", "C", "E", "F"] as const) {
          const part = parts.find(
            (candidate) => isObj(candidate) && candidate.part === letter,
          ) as Record<string, unknown> | undefined;
          if (!part) {
            problems.push(`parts: Part ${letter} is missing.`);
            continue;
          }
          const above = part.aboveCeiling;
          if (
            !isObj(above) ||
            !isNum(above.employerPercent) ||
            !isNum(above.employeePercent)
          ) {
            problems.push(
              `Part ${letter}: aboveCeiling needs employerPercent and employeePercent.`,
            );
            continue;
          }
          // Part F states a flat percentage and has no bands; the others are banded to the ceiling.
          const bands =
            Array.isArray(part.bands) && part.bands.length === 0
              ? []
              : bandList(part.bands, 4, `Part ${letter} bands`, false);
          if (bands) {
            parsedParts.push({
              part: letter,
              appliesTo:
                typeof part.appliesTo === "string" ? part.appliesTo : "",
              bands: bands as unknown as readonly EpfBand[],
              aboveCeiling: {
                employerPercent: above.employerPercent,
                employeePercent: above.employeePercent,
              },
            });
          }
        }
      }
      if (problems.length > 0) return { ok: false, problems };
      return {
        ok: true,
        parsed: {
          scheme: "EPF",
          tables: { parts: parsedParts, ceilingCents: ceiling as number },
        },
      };
    }
    case "SOCSO": {
      const ceiling = content.ceilingCents;
      if (!isInt(ceiling) || ceiling <= 0)
        problems.push("ceilingCents: the wage ceiling in cents is needed.");
      const bands = bandList(content.bands, 7, "bands", true);
      if (problems.length > 0) return { ok: false, problems };
      return {
        ok: true,
        parsed: {
          scheme: "SOCSO",
          tables: {
            bands: bands as unknown as readonly SocsoBand[],
            ceilingCents: ceiling as number,
          },
        },
      };
    }
    case "EIS": {
      const ceiling = content.ceilingCents;
      if (!isInt(ceiling) || ceiling <= 0)
        problems.push("ceilingCents: the wage ceiling in cents is needed.");
      const bands = bandList(content.bands, 4, "bands", true);
      if (problems.length > 0) return { ok: false, problems };
      return {
        ok: true,
        parsed: {
          scheme: "EIS",
          tables: {
            bands: bands as unknown as readonly EisBand[],
            ceilingCents: ceiling as number,
          },
        },
      };
    }
    case "LINDUNG": {
      const from =
        typeof content.effectiveFrom === "string"
          ? new Date(`${content.effectiveFrom}T00:00:00.000Z`)
          : null;
      if (!from || Number.isNaN(from.getTime()))
        problems.push(
          "effectiveFrom: the date the scheme is in force from, as YYYY-MM-DD.",
        );
      const rates = content.phaseRatesPercent;
      if (
        !isObj(rates) ||
        !isNum(rates.PHASE_1) ||
        !isNum(rates.PHASE_2) ||
        !isNum(rates.PHASE_3)
      ) {
        problems.push(
          "phaseRatesPercent: PHASE_1, PHASE_2 and PHASE_3 percentages are needed.",
        );
      }
      if (problems.length > 0) return { ok: false, problems };
      const r = rates as Record<string, number>;
      return {
        ok: true,
        parsed: {
          scheme: "LINDUNG",
          tables: {
            effectiveFrom: from as Date,
            phaseRatesPercent: {
              PHASE_1: r.PHASE_1,
              PHASE_2: r.PHASE_2,
              PHASE_3: r.PHASE_3,
            },
          },
        },
      };
    }
    case "PCB": {
      const table = content.table1;
      const rows: PcbBand[] = [];
      if (!Array.isArray(table) || table.length === 0)
        problems.push("table1: the MTD Table 1 rows are needed.");
      else {
        table.forEach((row, index) => {
          if (
            !isObj(row) ||
            !isInt(row.fromCents) ||
            !(row.toCents === null || isInt(row.toCents)) ||
            !isInt(row.mCents) ||
            !isNum(row.ratePercent) ||
            !isInt(row.bCategory13Cents) ||
            !isInt(row.bCategory2Cents)
          ) {
            problems.push(
              `table1: row ${index + 1} needs fromCents, toCents (or null), mCents, ratePercent, bCategory13Cents and bCategory2Cents.`,
            );
            return;
          }
          rows.push({
            fromCents: row.fromCents,
            toCents: row.toCents as number | null,
            mCents: row.mCents,
            ratePercent: row.ratePercent,
            bCategory13Cents: row.bCategory13Cents,
            bCategory2Cents: row.bCategory2Cents,
          });
        });
        for (let index = 1; index < rows.length; index += 1) {
          const previousTo = rows[index - 1].toCents;
          if (previousTo === null)
            problems.push("table1: only the last row may be open-ended.");
          else if (rows[index].fromCents <= previousTo)
            problems.push(`table1: row ${index + 1} overlaps the row before.`);
        }
      }
      for (const key of [
        "individualCents",
        "spouseCents",
        "perChildCents",
        "disabledSelfCents",
        "disabledSpouseCents",
        "epfReliefCapCents",
        "minimumCents",
      ] as const) {
        if (!isInt(content[key]) || (content[key] as number) < 0)
          problems.push(`${key}: a whole number of cents is needed.`);
      }
      if (!isNum(content.nonResidentRatePercent))
        problems.push("nonResidentRatePercent: a percentage is needed.");
      if (problems.length > 0) return { ok: false, problems };
      const c = content as Record<string, number>;
      return {
        ok: true,
        parsed: {
          scheme: "PCB",
          tables: {
            table1: rows,
            individualCents: c.individualCents,
            spouseCents: c.spouseCents,
            perChildCents: c.perChildCents,
            disabledSelfCents: c.disabledSelfCents,
            disabledSpouseCents: c.disabledSpouseCents,
            epfReliefCapCents: c.epfReliefCapCents,
            nonResidentRatePercent: c.nonResidentRatePercent,
            minimumCents: c.minimumCents,
          },
        },
      };
    }
    case "HRD_LEVY": {
      if (!isNum(content.mandatoryPercent) || !isNum(content.optionalPercent))
        problems.push("mandatoryPercent and optionalPercent are needed.");
      if (problems.length > 0) return { ok: false, problems };
      return {
        ok: true,
        parsed: {
          scheme: "HRD_LEVY",
          tables: {
            mandatoryPercent: content.mandatoryPercent as number,
            optionalPercent: content.optionalPercent as number,
          },
        },
      };
    }
    default:
      return {
        ok: false,
        problems: [`"${scheme}" is not a scheme this registry versions.`],
      };
  }
}

/**
 * THE BUILT-IN PCB PARAMETERS FOR A DATE. The 2026 specification was coded
 * twice: first with the individual figure copied into S by mistake, then
 * corrected. The registry says which edition governs a month; the figures
 * follow its schedule id, so a month before the correction reproduces what it
 * was approved on, and a month from October 2026 deducts what the
 * specification says.
 */
export function builtInPcbParamsFor(on: Date): PcbParams {
  const schedule = scheduleFor("PCB", on);
  return schedule?.id === "PCB_MTD_2026"
    ? PCB_PARAMS_2026_AS_FIRST_CODED
    : BUILT_IN_PCB_PARAMS;
}

function builtInSource(scheme: EditionScheme, on: Date): EditionSource {
  const schedule = scheduleFor(scheme, on);
  return {
    scheme,
    origin: "BUILT_IN",
    id: schedule?.id ?? `${scheme}_BUILT_IN`,
    document: schedule?.document ?? "Built into this version of Kuwick",
    year: schedule ? schedule.effectiveFrom.getUTCFullYear() : null,
    inForceFrom: schedule
      ? schedule.effectiveFrom.toISOString().slice(0, 10)
      : "",
    contentHash: schedule?.contentHash ?? "",
  };
}

/**
 * THE EDITIONS IN FORCE ON A DATE: the built-in tables, unless a platform
 * edition for that scheme is in force from a later date that is on or before
 * `on`. A platform edition whose content no longer parses is ignored with
 * the built-in tables kept — a run must never be priced on half a table.
 */
export function editionsFor(
  on: Date,
  versions: readonly TableVersionRecord[] = [],
): Editions {
  let epf = BUILT_IN_EPF_TABLES;
  let socso = BUILT_IN_SOCSO_TABLES;
  let eis = BUILT_IN_EIS_TABLES;
  let lindungCore: LindungCore = {
    effectiveFrom: BUILT_IN_LINDUNG_TABLES.effectiveFrom,
    phaseRatesPercent: BUILT_IN_LINDUNG_TABLES.phaseRatesPercent,
  };
  let pcb = builtInPcbParamsFor(on);
  let hrd = BUILT_IN_HRD_RATES;
  const sources = Object.fromEntries(
    EDITION_SCHEMES.map((scheme) => [scheme, builtInSource(scheme, on)]),
  ) as Record<EditionScheme, EditionSource>;

  for (const scheme of EDITION_SCHEMES) {
    const builtInFrom =
      scheduleFor(scheme, on)?.effectiveFrom.getTime() ??
      Number.NEGATIVE_INFINITY;
    const candidates = versions
      .filter(
        (version) =>
          version.scheme === scheme &&
          version.inForceFrom.getTime() <= on.getTime() &&
          version.inForceFrom.getTime() >= builtInFrom,
      )
      .sort((a, b) => b.inForceFrom.getTime() - a.inForceFrom.getTime());
    for (const version of candidates) {
      const parsed = parseContent(scheme, version.content);
      if (!parsed.ok) continue;
      switch (parsed.parsed.scheme) {
        case "EPF":
          epf = parsed.parsed.tables;
          break;
        case "SOCSO":
          socso = parsed.parsed.tables;
          break;
        case "EIS":
          eis = parsed.parsed.tables;
          break;
        case "LINDUNG":
          lindungCore = parsed.parsed.tables;
          break;
        case "PCB":
          pcb = parsed.parsed.tables;
          break;
        case "HRD_LEVY":
          hrd = parsed.parsed.tables;
          break;
      }
      sources[scheme] = {
        scheme,
        origin: "PLATFORM",
        id: version.id,
        document: version.sourceDocument,
        year: version.year,
        inForceFrom: version.inForceFrom.toISOString().slice(0, 10),
        contentHash: version.contentHash,
      };
      break;
    }
  }
  // LINDUNG's column sits in the Act 4 table, so it rides on whichever SOCSO edition is in force.
  return {
    epf,
    socso,
    eis,
    lindung: { ...lindungCore, socso },
    pcb,
    hrd,
    sources,
  };
}

/** The built-in editions, as the engines read them when nothing else is said. */
export const BUILT_IN_EDITIONS: Editions = editionsFor(
  new Date("2099-12-31T00:00:00.000Z"),
);
