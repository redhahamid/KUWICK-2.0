// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntApp } from "antd";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { StatutoryRates } from "../types";

/*
 * SKBBK HAS TO BE ON THE SCREEN THAT CLAIMS TO LIST WHAT IS DEDUCTED.
 *
 * The engine has contributed LINDUNG 24 JAM since the Act 4 table was replaced
 * with the one that includes it, and since September every employee is enrolled
 * by default. The card still listed three schemes — SOCSO category 1, category
 * 2 and EIS — so an owner reading it would have found nothing to explain a
 * deduction appearing on payslips, and the band table hid the column the figure
 * is read from.
 *
 * The second half matters as much as the first: with SKBBK in force a category
 * 2 employee is no longer somebody whose share is nil, and a screen that says
 * "injury only, employee 0%" without naming the third scheme is now untrue.
 */
const band = (
  from: number,
  to: number | null,
  values: [number, number, number, number, number],
) => ({
  fromCents: from,
  toCents: to,
  cat1EmployerCents: values[0],
  cat1EmployeeCents: values[1],
  cat1EmployeeNonInjuryCents: values[2],
  cat2EmployerCents: values[3],
  cat2EmployeeNonInjuryCents: values[4],
});

const rates: StatutoryRates = {
  epf: { schedule: null, tableCeilingCents: 2000000, parts: [] },
  socso: {
    schedule: {
      effectiveFrom: "2026-06-01",
      section: "Act 4",
      verified: true,
      evidence: "PERKESO",
      contentHash: "h",
    },
    wageCeilingCents: 600000,
    // The top band of the schedule the account holder supplied: the employee's
    // First Category share is 29.75 invalidity PLUS 44.65 SKBBK, and Second
    // Category is 44.65 where it used to be nothing.
    bands: [band(600000, null, [10415, 2975, 4465, 7440, 4465])],
  },
  eis: { schedule: null, wageCeilingCents: 600000, bands: [] },
  pcb: { schedule: null, nonResidentRatePercent: 30 },
  hrd: { schedule: null, mandatoryPercent: 1, optionalPercent: 0.5 },
  registryHash: "h",
  wageCeilingLabel: "RM6,000.00",
  check: null,
} as unknown as StatutoryRates;

vi.mock("../hooks/useAdmin", () => ({
  useStatutoryRates: () => ({ data: rates, isLoading: false, error: null }),
  useLegalEmployers: () => ({ data: [], isLoading: false }),
  usePayrollReadiness: () => ({ data: undefined, isLoading: false }),
  useMarkStatutoryChecked: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../core/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("../../core/hooks/useClinicFilter", () => ({
  useClinicFilter: () => ({ clinicId: undefined }),
}));

const { StatutoryRatesPage } = await import("./StatutoryRatesPage");

const mount = () =>
  render(
    <AntApp>
      <MemoryRouter>
        <StatutoryRatesPage />
      </MemoryRouter>
    </AntApp>,
  );

describe("the PERKESO card", () => {
  it("names LINDUNG 24 JAM as a scheme of its own, not a footnote on SOCSO", () => {
    mount();
    expect(screen.getByText(/LINDUNG 24 JAM \(SKBBK\)/i)).toBeTruthy();
  });

  it("says the employee is enrolled by default and leaves through PERKESO, not through the clinic", () => {
    mount();
    // The headline sits in a <strong>; the sentences that matter are its siblings.
    const note = screen
      .getByText(/everybody is in it by default/i)
      .closest(".hr-panelNote");
    expect(note).toBeTruthy();
    expect(note?.textContent).toMatch(/opt-out form/i);
    // The clinic must not read this as its own switch to flip.
    expect(note?.textContent).toMatch(/not something the clinic decides/i);
  });

  it("no longer describes category 2 as injury only, now that its employee pays SKBBK", () => {
    mount();
    expect(screen.queryByText(/Category 2 \(injury only\)/i)).toBeNull();
    expect(screen.getByText(/Category 2 — employment injury/i)).toBeTruthy();
  });
});

describe("the SOCSO contribution table", () => {
  it("shows the SKBBK column for both categories, because it is a column of that same table", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /View SOCSO table/i }));
    expect(screen.getByText("Employee SKBBK (cat 1)")).toBeTruthy();
    expect(screen.getByText("Employee SKBBK (cat 2)")).toBeTruthy();
    // And the invalidity column is labelled as such, so the two employee
    // figures in category 1 cannot be read as one number printed twice.
    expect(screen.getByText("Employee invalidity (cat 1)")).toBeTruthy();
  });

  it("prints the top band as the schedule states it, to the sen", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /View SOCSO table/i }));
    for (const amount of ["RM104.15", "RM29.75", "RM74.40"]) {
      expect(screen.getAllByText(amount).length).toBeGreaterThan(0);
    }
    // 44.65 appears twice: once per category.
    expect(screen.getAllByText("RM44.65").length).toBe(2);
  });
});
