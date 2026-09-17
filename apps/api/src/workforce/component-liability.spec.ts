import {
  CatalogueRow,
  catalogueFor,
  checkOrdinaryRateBase,
  liabilityOf,
} from "./component-liability";
import { SEED_PAY_COMPONENTS } from "./pay-component-catalogue";
import { DEFAULT_COMPONENT_LIABILITY } from "./payroll-calculation";

const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  code: "ALLOWANCE",
  name: "Allowance",
  type: "ADDITION",
  includeIn: "GROSS_AND_NET",
  active: true,
  effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
  effectiveTo: null,
  verificationStatus: "DRAFT",
  sourceRef: null,
  pcbLiable: true,
  epfLiable: true,
  socsoLiable: true,
  eisLiable: true,
  includeInOrpBase: false,
  additionalRemuneration: false,
  hrdLiable: false,
  ...over,
});

const AUG_2026 = new Date("2026-08-31T00:00:00.000Z");

describe("one source of truth for what a component is liable to", () => {
  /*
   * THE DEFECT THIS PINS.
   *
   * Kuwick had two answers: the `pay_components` rows a clinic configures, and
   * a hardcoded map the payroll actually read. They disagreed in eight of
   * sixteen entries, and two disagreements moved money — the ordinary-rate base
   * for allowances, and a zakat deduction that reduced the taxable base while
   * the MTD engine also applied zakat as relief.
   */
  it("derives the engine’s map from the catalogue, so they cannot diverge again", () => {
    for (const component of SEED_PAY_COMPONENTS) {
      const derived = DEFAULT_COMPONENT_LIABILITY[component.code];
      expect(derived).toBeDefined();
      expect(derived).toEqual(liabilityOf(component));
    }
    expect(Object.keys(DEFAULT_COMPONENT_LIABILITY)).toHaveLength(
      SEED_PAY_COMPONENTS.length,
    );
  });

  /*
   * THE LEAVE PAYOUT IS A COMPONENT, NOT A SPECIAL CASE IN THE ENGINE.
   *
   * s.60E(3) tells the run WHAT is owed; it says nothing about what the payment
   * attracts for EPF, SOCSO, EIS and PCB, because that turns on each scheme's
   * own definition of wages. The product's answer is to make it an ordinary
   * component with ordinary switches, so the clinic sets its own treatment with
   * a reason and a date, and nothing about it is hardcoded.
   */
  describe("the untaken annual leave payout", () => {
    const payout = SEED_PAY_COMPONENTS.find(
      (component) => component.code === "LEAVE_PAYOUT",
    );

    it("ships at this clinic’s policy, which is a starting position and not a claim about the law", () => {
      // EPF off, SOCSO on, EIS on, PCB on — what the account holder set for his
      // other additional components. Another clinic may read KWSP's definition
      // differently and set it differently, which is the whole point of it
      // being a row rather than a constant.
      expect(payout?.epfLiable).toBe(false);
      expect(payout?.socsoLiable).toBe(true);
      expect(payout?.eisLiable).toBe(true);
      expect(payout?.pcbLiable).toBe(true);
    });

    it("never enters the ordinary-rate base, because the rate is what produced it", () => {
      // The payout is days x the ordinary rate. Feeding it back into the base
      // would raise the rate that computed it — the same trap overtime is held
      // out of, arriving by a different door.
      expect(payout?.includeInOrpBase).toBe(false);
      expect(payout?.includeInUnpaidLeaveBase).toBe(false);
    });

    it("is not prorated, because the days were earned before the part month began", () => {
      // A leaver's last month is already cut to the days served. Cutting the
      // settlement by the same fraction would take the reduction twice.
      expect(payout?.prorated).toBe(false);
      expect(payout?.employerSide).toBe(false);
    });

    it("reaches the engine through the derived map, like every other component", () => {
      expect(DEFAULT_COMPONENT_LIABILITY.LEAVE_PAYOUT).toEqual(
        liabilityOf(payout!),
      );
    });
  });

  it("keeps zakat OUT of the taxable base, because the MTD engine already relieves it", () => {
    // Counted in both places, RM200 of zakat under-deducted PCB by RM38.00 in
    // the month measured. Under-deducted tax is the employee's bill later.
    const zakat = SEED_PAY_COMPONENTS.find(
      (component) => component.code === "ZAKAT",
    );
    expect(zakat?.pcbLiable).toBe(false);
    expect(DEFAULT_COMPONENT_LIABILITY.ZAKAT.pcb).toBe(false);
  });

  it("covers every component the engine knows, and no component the clinic cannot see", () => {
    // CLAIM_REIMBURSEMENT was in the map and not in the catalogue: a component
    // payroll paid and the clinic could neither inspect nor configure.
    expect(SEED_PAY_COMPONENTS.map((c) => c.code)).toContain(
      "CLAIM_REIMBURSEMENT",
    );
  });
});

describe("resolving the catalogue for a period", () => {
  it("takes the row in force on that date, not the newest row", () => {
    // A correction made today must not reprice a month already paid.
    const catalogue = catalogueFor(
      [
        row({
          epfLiable: true,
          effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-06-30T00:00:00.000Z"),
        }),
        row({
          epfLiable: false,
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        }),
      ],
      new Date("2026-03-31T00:00:00.000Z"),
    );
    expect(catalogue.get("ALLOWANCE")?.liability.epf).toBe(true);
  });

  it("supersedes an older row with a corrected one, without deleting either", () => {
    const catalogue = catalogueFor(
      [
        row({
          epfLiable: true,
          effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
        }),
        row({
          epfLiable: false,
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        }),
      ],
      AUG_2026,
    );
    expect(catalogue.get("ALLOWANCE")?.liability.epf).toBe(false);
  });

  it("leaves out a component that is not yet in force", () => {
    const catalogue = catalogueFor(
      [row({ effectiveFrom: new Date("2027-01-01T00:00:00.000Z") })],
      AUG_2026,
    );
    expect(catalogue.has("ALLOWANCE")).toBe(false);
  });

  /*
   * SWITCHING A COMPONENT OFF MUST NOT REACH BACKWARDS.
   *
   * This used to assert the opposite — that an inactive component does not
   * resolve — on the reasoning that "we stopped using this" and "this never
   * existed" are the same to a run that meets one. They are not. `active`
   * carries no date, so applying it here made the switch retroactive to the
   * beginning of time: an allowance switched off today stopped covering every
   * month, and an unapproved August holding an input that named it blocked
   * with UNKNOWN_COMPONENT on money that had been fine the day before. That
   * happened to a real clinic on a real comparison run.
   *
   * "In use" on the settings screen reads as "offer this when somebody keys
   * pay". That is all it means now. A NEW input naming a switched-off
   * component is still refused in `payroll-input.service.ts`, and the screens
   * that offer components filter on `active` themselves.
   */
  it("still resolves a switched-off component, because a month that names it must price", () => {
    const catalogue = catalogueFor([row({ active: false })], AUG_2026);
    expect(catalogue.has("ALLOWANCE")).toBe(true);
    // And it is liable to exactly what its dated version says, unchanged by the
    // switch: switching a component off is not a statement about EPF.
    expect(catalogue.get("ALLOWANCE")?.liability).toEqual(
      catalogueFor([row({ active: true })], AUG_2026).get("ALLOWANCE")
        ?.liability,
    );
  });

  it("says whether the clinic still offers it, so a picker can leave it out", () => {
    expect(
      catalogueFor([row({ active: false })], AUG_2026).get("ALLOWANCE")?.active,
    ).toBe(false);
    expect(catalogueFor([row()], AUG_2026).get("ALLOWANCE")?.active).toBe(true);
  });

  it("keeps the date tests, which are the ones that carry a date", () => {
    // Switching off is timeless; starting and ending are not. A version that
    // has not begun, or was closed before the month, still does not resolve —
    // switched off or not.
    expect(
      catalogueFor(
        [
          row({
            active: false,
            effectiveFrom: new Date("2027-01-01T00:00:00.000Z"),
          }),
        ],
        AUG_2026,
      ).has("ALLOWANCE"),
    ).toBe(false);
    expect(
      catalogueFor(
        [
          row({
            active: false,
            effectiveTo: new Date("2026-05-31T00:00:00.000Z"),
          }),
        ],
        AUG_2026,
      ).has("ALLOWANCE"),
    ).toBe(false);
  });

  it("reads the wage-reduction / withholding distinction off `includeIn`", () => {
    const catalogue = catalogueFor(
      [
        row({
          code: "UNPAID_LEAVE",
          type: "DEDUCTION",
          includeIn: "GROSS_AND_NET",
        }),
        row({ code: "ZAKAT", type: "DEDUCTION", includeIn: "NET_ONLY" }),
        row({ code: "BASIC", type: "ADDITION", includeIn: "GROSS_AND_NET" }),
      ],
      AUG_2026,
    );
    expect(catalogue.get("UNPAID_LEAVE")?.kind).toBe("WAGE_REDUCTION");
    expect(catalogue.get("ZAKAT")?.kind).toBe("DEDUCTION");
    expect(catalogue.get("BASIC")?.kind).toBe("EARNING");
  });
});

describe("the ordinary-rate base guard", () => {
  it("passes while basic pay alone is in the base", () => {
    const catalogue = catalogueFor(
      [row({ code: "BASIC", includeInOrpBase: true }), row()],
      AUG_2026,
    );
    expect(checkOrdinaryRateBase(catalogue)).toBeNull();
  });

  it("refuses the run if anything else is marked as part of the ordinary rate", () => {
    // s.60I(1A) builds the rate from the monthly wage, and the run takes the
    // contractual salary rather than assembling it from component lines. Mark
    // an allowance into the base and the flag says one thing while the
    // calculation does another — so the run stops instead of quietly ignoring
    // a clinic's configuration.
    const catalogue = catalogueFor(
      [
        row({ code: "BASIC", includeInOrpBase: true }),
        row({ code: "ALLOWANCE", includeInOrpBase: true }),
      ],
      AUG_2026,
    );
    const problem = checkOrdinaryRateBase(catalogue);
    expect(problem).toMatch(/ALLOWANCE/);
    expect(problem).toMatch(/recurring contractual components/);
  });

  it("refuses a catalogue with no basic pay in the base at all", () => {
    expect(checkOrdinaryRateBase(catalogueFor([row()], AUG_2026))).toMatch(
      /nothing/,
    );
  });

  it("keeps unpaid leave out of the ordinary-rate base", () => {
    // s.60I(1A) uses the monthly RATE of pay. A month with unpaid leave still
    // prices overtime from the full wage; shrinking the rate because somebody
    // was absent compounds one deduction into another.
    const leave = SEED_PAY_COMPONENTS.find(
      (component) => component.code === "UNPAID_LEAVE",
    );
    expect(leave?.includeInOrpBase).toBe(false);
    expect(
      checkOrdinaryRateBase(
        catalogueFor(
          SEED_PAY_COMPONENTS.map((c) => row({ ...c, type: c.type })),
          AUG_2026,
        ),
      ),
    ).toBeNull();
  });
});
