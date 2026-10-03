import {
  MINIMUM_STATE_FOR_APPROVAL,
  SCHEMES_WITHOUT_A_SCHEDULE,
  STATUTORY_SCHEDULES,
  meetsApprovalBar,
  scheduleFor,
  stampFor,
  SUPERSEDED_SCHEDULES,
} from "./registry";

/**
 * The registry is what makes a payslip defensible a year later. These tests are
 * about that property rather than about any particular rate: that a period
 * resolves to the edition in force AT THE TIME, that the stamp records enough
 * to prove it, and that a gap is reported rather than filled in.
 */

const JAN_2026 = new Date("2026-01-31T00:00:00.000Z");
const BEFORE_EVERYTHING = new Date("2019-01-31T00:00:00.000Z");

describe("resolving a schedule", () => {
  it("resolves each scheme to exactly one schedule for a current period", () => {
    for (const scheme of [
      "EPF",
      "SOCSO",
      "EIS",
      "PCB",
      "HRD_LEVY",
      "EMPLOYMENT_ACT",
      "EA_FIRST_SCHEDULE",
    ] as const) {
      expect(scheduleFor(scheme, JAN_2026)).not.toBeNull();
    }
  });

  it("resolves nothing for a period before any edition took effect", () => {
    // Deliberately not "the earliest schedule we have". A 2019 period is a
    // period this system cannot speak to, and saying so is the only safe
    // answer — the alternative is a historical run quietly recalculated at
    // rates that did not exist yet.
    expect(scheduleFor("EPF", BEFORE_EVERYTHING)).toBeNull();
    expect(scheduleFor("PCB", BEFORE_EVERYTHING)).toBeNull();
  });

  it("does not resolve PCB for a 2025 period, because the 2026 specification does not reach back", () => {
    expect(scheduleFor("PCB", new Date("2025-11-30T00:00:00.000Z"))).toBeNull();
    // EPF's October 2025 edition does cover that month.
    expect(
      scheduleFor("EPF", new Date("2025-11-30T00:00:00.000Z")),
    ).not.toBeNull();
  });
});

describe("the stamp a run carries", () => {
  it("records the id, hash, verification state and document per scheme", () => {
    const stamp = stampFor(["EPF", "SOCSO", "EIS", "PCB"], JAN_2026);
    expect(stamp.schedules).toHaveLength(4);
    for (const line of stamp.schedules) {
      expect(line.missing).toBe(false);
      expect(line.scheduleId).toBeTruthy();
      expect(line.contentHash).toMatch(/^[0-9a-f]{16}$/);
      expect(line.verification).toBeTruthy();
      expect(line.document).toContain("—");
    }
    expect(stamp.approvable).toBe(true);
    expect(stamp.blockers).toEqual([]);
  });

  it("refuses approval and names the scheme when a period has no schedule", () => {
    const stamp = stampFor(["EPF", "PCB"], BEFORE_EVERYTHING);
    expect(stamp.approvable).toBe(false);
    expect(stamp.schedules.every((line) => line.missing)).toBe(true);
    expect(stamp.blockers.join(" ")).toMatch(/No EPF schedule is in force/);
    expect(stamp.blockers.join(" ")).toMatch(/No PCB schedule is in force/);
  });

  it("resolves against the period, not against today", () => {
    // The same call for two periods must be able to differ, or effective
    // dating is decorative. PCB is the case in hand: in force from 2026.
    const before = stampFor(["PCB"], new Date("2025-12-31T00:00:00.000Z"));
    const after = stampFor(["PCB"], new Date("2026-01-31T00:00:00.000Z"));
    expect(before.schedules[0].missing).toBe(true);
    expect(after.schedules[0].missing).toBe(false);
  });
});

describe("the content hash", () => {
  it("is stable across calls, so a re-run of an unchanged period reconciles", () => {
    expect(stampFor(["EPF"], JAN_2026).schedules[0].contentHash).toBe(
      stampFor(["EPF"], JAN_2026).schedules[0].contentHash,
    );
  });

  it("differs between schemes, so one schedule’s stamp cannot stand in for another", () => {
    const hashes = STATUTORY_SCHEDULES.map((schedule) => schedule.contentHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("what may drive an approved run", () => {
  it("holds every shipped schedule at or above the approval bar", () => {
    for (const schedule of STATUTORY_SCHEDULES) {
      expect(meetsApprovalBar(schedule.verification)).toBe(true);
    }
  });

  it("treats corroboration as below the bar, however many sources agree", () => {
    // §1 of the brief: official current authority wins, never majority voting.
    expect(meetsApprovalBar("CORROBORATED")).toBe(false);
    expect(meetsApprovalBar("UNVERIFIED")).toBe(false);
    expect(MINIMUM_STATE_FOR_APPROVAL).toBe("OFFICIAL_SOURCE_VERIFIED");
  });

  it("never claims a state stronger than the evidence behind it", () => {
    // Test-vector verification means the authority published expected answers
    // that Kuwick reproduces. HRD Corp and the Employment Act publish none, so
    // they stop at source-verified however carefully they were transcribed.
    const byScheme = Object.fromEntries(
      STATUTORY_SCHEDULES.map((s) => [s.scheme, s.verification]),
    );
    expect(byScheme.HRD_LEVY).toBe("OFFICIAL_SOURCE_VERIFIED");
    expect(byScheme.EA_FIRST_SCHEDULE).toBe("OFFICIAL_SOURCE_VERIFIED");
    expect(byScheme.EMPLOYMENT_ACT).toBe("OFFICIAL_SOURCE_VERIFIED");
    // PCB: the corrected 2026 edition rests on the specification's parameter
    // list for S, which Exhibit 5 (category 3) never exercises, so it stops
    // at source-verified and says so. The edition as first coded reproduced
    // Exhibit 5; it is superseded, not deleted — see the test below.
    const pcb = Object.fromEntries(
      STATUTORY_SCHEDULES.filter((s) => s.scheme === "PCB").map((s) => [
        s.id,
        s.verification,
      ]),
    );
    expect(pcb).toEqual({
      PCB_MTD_2026_S_CORRECTED: "OFFICIAL_SOURCE_VERIFIED",
    });
    expect(byScheme.PCB).toBe("OFFICIAL_SOURCE_VERIFIED");
  });

  it("keeps a superseded edition by id and hash, out of force and never reused", () => {
    // The 2026 PCB edition as first coded carried the individual figure in S.
    // The months approved on it between January and September 2026 name its
    // id and hash in their frozen snapshots, so it is kept — and it answers
    // for no day: the corrected edition is in force from 1 January 2026.
    const superseded = SUPERSEDED_SCHEDULES.find((s) => s.id === "PCB_MTD_2026");
    expect(superseded).toBeDefined();
    expect(superseded!.scheme).toBe("PCB");
    expect(superseded!.verification).toBe("OFFICIAL_TEST_VECTOR_VERIFIED");
    expect(superseded!.effectiveTo).toEqual(superseded!.effectiveFrom);
    const live = scheduleFor("PCB", superseded!.effectiveFrom);
    expect(live?.id).toBe("PCB_MTD_2026_S_CORRECTED");
    expect(live?.effectiveFrom).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    // The hash those snapshots carry: Table 1, D and the non-resident rate,
    // with S not yet among them. The correction did not move it.
    expect(superseded!.contentHash).toBe("d2c8fca6b990daf8");
    expect(superseded!.contentHash).not.toBe(live?.contentHash);
    // An id is never reused for different content.
    const liveIds = new Set(STATUTORY_SCHEDULES.map((s) => s.id));
    for (const entry of SUPERSEDED_SCHEDULES) {
      expect(liveIds.has(entry.id)).toBe(false);
    }
  });
});

describe("what is missing is named, not left blank", () => {
  it("tracks the First Schedule’s special categories as a PARTIAL rule, not a closed one", () => {
    // The dangerous shape of gap: the wage limb is implemented, so an employee
    // in a special category gets a finished-looking overtime figure judged by
    // wages alone. Recorded as data so it cannot quietly become "done" by
    // generalising from the limb that IS held.
    const gap = SCHEMES_WITHOUT_A_SCHEDULE.find((row) =>
      row.scheme.includes("First Schedule"),
    );
    expect(gap).toBeDefined();
    expect(gap?.kind).toBe("PARTIAL_RULE");
    expect(gap?.needs).toMatch(/First Schedule’s own text/);
    expect(gap?.affects).toMatch(/specified categories of work/);
  });

  it("says what would close every gap, so none is merely a lament", () => {
    for (const gap of SCHEMES_WITHOUT_A_SCHEDULE) {
      expect(gap.needs.length).toBeGreaterThan(20);
      expect(gap.affects.length).toBeGreaterThan(20);
    }
  });

  it("now HAS a LINDUNG schedule, dated from when the scheme starts", () => {
    // It was a NO_SCHEDULE gap until current PERKESO guidance supplied the
    // commencement, who bears it and who may decline. The rate had been in D6
    // all along, printed as a column of the Act 4 table.
    const schedule = STATUTORY_SCHEDULES.find(
      (entry) => entry.scheme === "LINDUNG",
    );
    expect(schedule).toBeDefined();
    expect(schedule?.effectiveFrom.toISOString().slice(0, 10)).toBe(
      "2026-06-01",
    );
    expect(schedule?.verification).toBe("OFFICIAL_SOURCE_VERIFIED");
  });

  it("keeps LINDUNG’s later phases as a PARTIAL gap, because their schedules are not held", () => {
    const gap = SCHEMES_WITHOUT_A_SCHEDULE.find((entry) =>
      entry.scheme.includes("LINDUNG"),
    );
    expect(gap?.kind).toBe("PARTIAL_RULE");
    expect(gap?.needs).toMatch(/phase 2 and phase 3/i);
  });
});

describe("two rules under one Act, dated apart", () => {
  it("keeps the First Schedule limitation separate from the sections it limits", () => {
    // They took effect on different dates and answer different questions —
    // what the Act says, and who it says it to. A run stamps both, so a
    // figure can be defended on either front a year later.
    const stamp = stampFor(["EMPLOYMENT_ACT", "EA_FIRST_SCHEDULE"], JAN_2026);
    expect(stamp.schedules.map((line) => line.scheduleId)).toEqual([
      "EMPLOYMENT_ACT_1955",
      "EA_FIRST_SCHEDULE_2023_01",
    ]);
    expect(stamp.approvable).toBe(true);
  });

  it("resolves the First Schedule for a 2023 period the Act extract does not reach", () => {
    const early = new Date("2023-06-30T00:00:00.000Z");
    expect(scheduleFor("EA_FIRST_SCHEDULE", early)).not.toBeNull();
    expect(scheduleFor("EMPLOYMENT_ACT", early)).toBeNull();
  });
});

describe("a scheme that has not started is not a scheme that is missing", () => {
  /*
   * Conflating the two makes either an unfileable historical run look
   * finished, or an honest current one look broken. The discriminator is
   * explicit — `commencesScheme` — and never derived from the earliest date on
   * file, because that is the edition we hold rather than the day the rule
   * began.
   */
  it("treats LINDUNG before June 2026 as not yet begun, and does not block on it", () => {
    const stamp = stampFor(["LINDUNG"], new Date("2026-01-31T00:00:00.000Z"));
    expect(stamp.schedules[0]).toMatchObject({
      notYetInForce: true,
      missing: false,
    });
    expect(stamp.blockers).toEqual([]);
    expect(stamp.approvable).toBe(true);
  });

  it("treats EPF before October 2025 as MISSING, because EPF did not begin then", () => {
    // The registry holds the October 2025 edition of a Schedule that has
    // existed since 1991. A 2019 period is one this system cannot speak to.
    const stamp = stampFor(["EPF"], new Date("2019-06-30T00:00:00.000Z"));
    expect(stamp.schedules[0]).toMatchObject({
      notYetInForce: false,
      missing: true,
    });
    expect(stamp.approvable).toBe(false);
  });

  it("marks exactly one schedule as commencing its scheme", () => {
    // A flag set carelessly across the registry would silently stop historical
    // runs blocking, so the set is asserted rather than spot-checked.
    const commencing = STATUTORY_SCHEDULES.filter(
      (entry) => entry.commencesScheme,
    ).map((entry) => entry.id);
    expect(commencing).toEqual(["LINDUNG_SKBBK_PHASE_1_2026_06"]);
  });
});
