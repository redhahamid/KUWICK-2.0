import {
  BUILT_IN_EDITIONS,
  contentHashOf,
  editionsFor,
  parseContent,
} from "./editions";
import { EPF_PARTS, EPF_TABLE_CEILING_CENTS } from "./epf-third-schedule";
import { EIS_BANDS, EIS_WAGE_CEILING_CENTS } from "./eis-act800";
import { SOCSO_BANDS, SOCSO_WAGE_CEILING_CENTS } from "./socso-act4";
import {
  BUILT_IN_PCB_PARAMS,
  PCB_PARAMS_2026_AS_FIRST_CODED,
  PCB_TABLE_1,
} from "./pcb-2026";
import {
  eisContribution,
  epfContribution,
  socsoContribution,
} from "./contributions";

/**
 * THE EDITIONS: with nothing on file, every scheme is the built-in table; a
 * platform edition takes over on its date and not a day before; a broken
 * one is ignored rather than half-applied.
 */
describe("statutory editions", () => {
  const june2026 = new Date("2026-06-30T00:00:00.000Z");

  it("resolves to the built-in tables when nothing is on file, by reference", () => {
    const editions = editionsFor(june2026);
    expect(editions.epf.parts).toBe(EPF_PARTS);
    expect(editions.epf.ceilingCents).toBe(EPF_TABLE_CEILING_CENTS);
    expect(editions.socso.bands).toBe(SOCSO_BANDS);
    expect(editions.eis.bands).toBe(EIS_BANDS);
    expect(editions.pcb.table1).toBe(PCB_TABLE_1);
    expect(editions.lindung.socso.bands).toBe(SOCSO_BANDS);
    expect(
      Object.values(editions.sources).every(
        (source) => source.origin === "BUILT_IN",
      ),
    ).toBe(true);
    expect(editions.sources.EPF.id).toBe("EPF_THIRD_SCHEDULE_2025_10");
    expect(BUILT_IN_EDITIONS.eis.ceilingCents).toBe(EIS_WAGE_CEILING_CENTS);
  });

  it("the engines read the same figures with the built-in editions handed in as with nothing handed in", () => {
    expect(
      epfContribution(350_000, "MALAYSIAN_CITIZEN", 30, BUILT_IN_EDITIONS.epf),
    ).toEqual(epfContribution(350_000, "MALAYSIAN_CITIZEN", 30));
    expect(
      socsoContribution(350_000, "FIRST", BUILT_IN_EDITIONS.socso),
    ).toEqual(socsoContribution(350_000, "FIRST"));
    expect(eisContribution(350_000, BUILT_IN_EDITIONS.eis)).toEqual(
      eisContribution(350_000),
    );
  });

  const eis2027 = {
    id: "v-eis-2027",
    scheme: "EIS",
    year: 2027,
    inForceFrom: new Date("2027-01-01T00:00:00.000Z"),
    sourceDocument: "Act 800 rate table, 2027 edition",
    content: {
      ceilingCents: 700_000,
      bands: [
        [0, 3_000, 10, 10],
        [3_000, 700_000, 1_400, 1_400],
        [700_000, null, 1_400, 1_400],
      ],
    },
    contentHash: contentHashOf({ ceilingCents: 700_000 }),
  };

  it("a platform edition prices the months from its date, and not the month before", () => {
    const before = editionsFor(new Date("2026-12-31T00:00:00.000Z"), [eis2027]);
    expect(before.eis.ceilingCents).toBe(EIS_WAGE_CEILING_CENTS);
    expect(before.sources.EIS.origin).toBe("BUILT_IN");

    const after = editionsFor(new Date("2027-01-31T00:00:00.000Z"), [eis2027]);
    expect(after.eis.ceilingCents).toBe(700_000);
    expect(after.sources.EIS).toMatchObject({
      origin: "PLATFORM",
      id: "v-eis-2027",
      document: "Act 800 rate table, 2027 edition",
      year: 2027,
      inForceFrom: "2027-01-01",
    });
    // The other schemes are untouched by an EIS edition.
    expect(after.epf.parts).toBe(EPF_PARTS);
    expect(after.sources.SOCSO.origin).toBe("BUILT_IN");
    // And the engine reads the new ceiling: RM6,500 is now inside the table.
    const outcome = eisContribution(650_000, after.eis);
    expect(outcome.kind === "COMPUTED" && outcome.value.atCeiling).toBe(false);
  });

  it("LINDUNG rides on whichever SOCSO edition is in force", () => {
    const socso2027 = {
      ...eis2027,
      id: "v-socso-2027",
      scheme: "SOCSO",
      sourceDocument: "Act 4 rate table, 2027 edition",
      content: {
        ceilingCents: 700_000,
        bands: [
          [0, 3_000, 40, 10, 5, 30, 5],
          [3_000, 700_000, 1_000, 500, 100, 800, 100],
          [700_000, null, 1_000, 500, 100, 800, 100],
        ],
      },
    };
    const editions = editionsFor(new Date("2027-03-31T00:00:00.000Z"), [
      socso2027,
    ]);
    expect(editions.lindung.socso.ceilingCents).toBe(700_000);
    expect(editions.lindung.effectiveFrom.toISOString().slice(0, 10)).toBe(
      "2026-06-01",
    );
  });

  it("ignores an edition whose content does not parse, keeping the built-in table", () => {
    const broken = {
      ...eis2027,
      id: "v-broken",
      content: {
        ceilingCents: 700_000,
        bands: [
          [0, 3_000, 10, 10],
          [5_000, null, 1_400, 1_400],
        ],
      },
    };
    const editions = editionsFor(new Date("2027-01-31T00:00:00.000Z"), [
      broken,
    ]);
    expect(editions.eis.bands).toBe(EIS_BANDS);
    expect(editions.sources.EIS.origin).toBe("BUILT_IN");
  });

  describe("parseContent", () => {
    it("names a gap between bands, a missing part, and a wrong shape", () => {
      const gap = parseContent("EIS", {
        ceilingCents: 600_000,
        bands: [
          [0, 3_000, 10, 10],
          [5_000, null, 1_400, 1_400],
        ],
      });
      expect(gap.ok).toBe(false);
      expect(!gap.ok && gap.problems[0]).toMatch(
        /band 2 starts at 5000 but the band before ends at 3000/,
      );

      const missingPart = parseContent("EPF", {
        ceilingCents: 2_000_000,
        parts: [
          {
            part: "A",
            bands: [[0, 1_000, 10, 20]],
            aboveCeiling: { employerPercent: 12, employeePercent: 11 },
          },
        ],
      });
      expect(missingPart.ok).toBe(false);
      expect(!missingPart.ok && missingPart.problems).toEqual(
        expect.arrayContaining([
          "parts: Part C is missing.",
          "parts: Part E is missing.",
          "parts: Part F is missing.",
        ]),
      );

      expect(parseContent("PCB", { table1: "no" }).ok).toBe(false);
      expect(parseContent("HRD_LEVY", { mandatoryPercent: 1 }).ok).toBe(false);
      expect(parseContent("ZAKAT", {}).ok).toBe(false);
    });

    it("accepts the built-in tables written back as content", () => {
      const epf = parseContent("EPF", {
        ceilingCents: EPF_TABLE_CEILING_CENTS,
        parts: EPF_PARTS.map((part) => ({
          part: part.part,
          appliesTo: part.appliesTo,
          bands: part.bands.map((band) => [...band]),
          aboveCeiling: part.aboveCeiling,
        })),
      });
      expect(epf.ok).toBe(true);
      const socso = parseContent("SOCSO", {
        ceilingCents: SOCSO_WAGE_CEILING_CENTS,
        bands: SOCSO_BANDS.map((band) => [...band]),
      });
      expect(socso.ok).toBe(true);
      const pcb = parseContent("PCB", {
        table1: PCB_TABLE_1.map((row) => ({ ...row })),
        individualCents: 900_000,
        spouseCents: 400_000,
        perChildCents: 200_000,
        disabledSelfCents: 600_000,
        disabledSpouseCents: 500_000,
        epfReliefCapCents: 400_000,
        nonResidentRatePercent: 30,
        minimumCents: 1_000,
      });
      expect(pcb.ok).toBe(true);
    });
  });

  it("hashes by value, whatever the key order", () => {
    expect(contentHashOf({ a: 1, b: [1, 2] })).toBe(
      contentHashOf({ b: [1, 2], a: 1 }),
    );
    expect(contentHashOf({ a: 1 })).not.toBe(contentHashOf({ a: 2 }));
  });
});

describe("the PCB spouse correction", () => {
  it("prices a month before October 2026 on the first coding, under the edition that approved it", () => {
    const september = editionsFor(new Date("2026-09-30T00:00:00.000Z"));
    expect(september.pcb).toBe(PCB_PARAMS_2026_AS_FIRST_CODED);
    expect(september.pcb.spouseCents).toBe(900_000);
    expect(september.sources.PCB.id).toBe("PCB_MTD_2026");
  });

  it("prices October 2026 onwards on S = RM4,000, under its own edition with its own hash", () => {
    const september = editionsFor(new Date("2026-09-30T00:00:00.000Z"));
    const october = editionsFor(new Date("2026-10-01T00:00:00.000Z"));
    expect(october.pcb).toBe(BUILT_IN_PCB_PARAMS);
    expect(october.pcb.spouseCents).toBe(400_000);
    expect(october.sources.PCB.id).toBe("PCB_MTD_2026_S_CORRECTED");
    expect(october.sources.PCB.inForceFrom).toBe("2026-10-01");
    expect(october.sources.PCB.contentHash).not.toBe(
      september.sources.PCB.contentHash,
    );
    expect(BUILT_IN_EDITIONS.pcb.spouseCents).toBe(400_000);
  });

  it("changes nothing but S between the two editions", () => {
    const { spouseCents: first, ...restFirst } = PCB_PARAMS_2026_AS_FIRST_CODED;
    const { spouseCents: corrected, ...restCorrected } = BUILT_IN_PCB_PARAMS;
    expect(first).toBe(900_000);
    expect(corrected).toBe(400_000);
    expect(restFirst).toEqual(restCorrected);
    expect(BUILT_IN_PCB_PARAMS.table1).toBe(PCB_TABLE_1);
  });
});
