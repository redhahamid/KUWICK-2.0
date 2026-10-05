// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntApp } from "antd";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { StatutoryRates } from "../types";

/*
 * THE RATES PAGE NAMES THE EDITION EACH FIGURE COMES FROM.
 *
 * A clinic reading "EPF 11%" has to be able to see which document, which
 * year and from which day, because the figure is only right for the month
 * the edition was in force. Built-in editions are what the code carries;
 * a platform edition is one Kuwick added later, and the page says which
 * one answered. The Third Schedule is then shown band by band rather than
 * as a summary, and the editions on file are listed so a clinic can see
 * that nothing was typed in by hand.
 */
const edition = (
  scheme: string,
  origin: "BUILT_IN" | "PLATFORM",
  document: string,
  year: number,
  inForceFrom: string,
) => ({
  scheme,
  origin,
  id: `${scheme}-${origin}`,
  document,
  year,
  inForceFrom,
  contentHash: "h",
});

const rates = {
  epf: { schedule: null, tableCeilingCents: 2000000, parts: [] },
  socso: { schedule: null, wageCeilingCents: 600000, bands: [] },
  eis: { schedule: null, wageCeilingCents: 600000, bands: [] },
  pcb: { schedule: null, nonResidentRatePercent: 30 },
  hrd: { schedule: null, mandatoryPercent: 1, optionalPercent: 0.5 },
  registryHash: "h",
  wageCeilingLabel: "RM6,000.00",
  check: null,
  period: "2026-09",
  resolvedOn: "2026-09-30",
  editions: {
    EPF: edition(
      "EPF",
      "PLATFORM",
      "KWSP Third Schedule (2026 reprint)",
      2026,
      "2026-09-01",
    ),
    SOCSO: edition(
      "SOCSO",
      "BUILT_IN",
      "Act 4 First Schedule",
      2026,
      "2026-06-01",
    ),
    EIS: edition(
      "EIS",
      "BUILT_IN",
      "Act 800 Second Schedule",
      2026,
      "2026-06-01",
    ),
    LINDUNG: edition(
      "LINDUNG",
      "BUILT_IN",
      "Act 4 First Schedule",
      2026,
      "2026-06-01",
    ),
    PCB: edition(
      "PCB",
      "BUILT_IN",
      "MTD specification 2026",
      2026,
      "2026-01-01",
    ),
    HRD_LEVY: edition(
      "HRD_LEVY",
      "BUILT_IN",
      "PSMB Act 2001",
      2001,
      "2001-01-01",
    ),
  },
  versions: [
    {
      id: "v1",
      scheme: "EPF",
      year: 2026,
      inForceFrom: "2026-09-01",
      sourceDocument: "KWSP Third Schedule (2026 reprint)",
      sourceUrl: "https://www.kwsp.gov.my/third-schedule",
      note: "Added after the reprint",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
  ],
  tables: {
    epf: {
      ceilingCents: 2000000,
      parts: [
        {
          part: "A",
          appliesTo: "under 60",
          aboveCeiling: { employerPercent: 12, employeePercent: 11 },
          bands: [
            [0, 1000, 0, 0],
            [1001, 2000, 300, 300],
            [348001, 350000, 42000, 38500],
          ],
        },
        {
          part: "F",
          appliesTo: "non-citizens",
          aboveCeiling: { employerPercent: 2, employeePercent: 11 },
          bands: [],
        },
      ],
    },
    socso: { ceilingCents: 600000, bands: [] },
    eis: { ceilingCents: 600000, bands: [] },
    lindung: {
      effectiveFrom: "2026-06-01",
      phaseRatesPercent: { PHASE_1: 0.25, PHASE_2: 0.25, PHASE_3: 0.25 },
    },
    pcb: {
      table1: [
        {
          fromCents: 500001,
          toCents: 2000000,
          mCents: 500000,
          ratePercent: 1,
          bCategory13Cents: -40000,
          bCategory2Cents: -80000,
        },
      ],
      individualCents: 900000,
      spouseCents: 400000,
      perChildCents: 200000,
      disabledSelfCents: 600000,
      disabledSpouseCents: 500000,
      epfReliefCapCents: 400000,
      nonResidentRatePercent: 30,
      minimumCents: 1000,
    },
    hrd: { mandatoryPercent: 1, optionalPercent: 0.5 },
  },
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

describe("the edition line", () => {
  it("says which edition answers for each scheme, and whether Kuwick or the code supplied it", () => {
    mount();
    expect(
      screen.getByText(
        /Platform edition 2026 · KWSP Third Schedule \(2026 reprint\) · in force from 1 September 2026/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Built-in edition 2026 · MTD specification 2026 · in force from 1 January 2026/,
      ),
    ).toBeTruthy();
  });

  it("lets the reader pick the month, because a past month keeps the edition in force then", () => {
    mount();
    expect(screen.getByLabelText("Month")).toBeTruthy();
  });
});

describe("the Third Schedule drawer", () => {
  it("opens the EPF bands part by part, with the ceiling rule spelled out", () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: /View Third Schedule, band by band/i,
      }),
    );
    expect(screen.getByText(/Part A — under 60/)).toBeTruthy();
    expect(screen.getByText("RM3,480.01 – RM3,500.00")).toBeTruthy();
    expect(screen.getByText("RM420.00")).toBeTruthy();
    expect(screen.getByText("RM385.00")).toBeTruthy();
    expect(
      screen.getByText(/Above RM20,000.00: 11% employee, 12% employer/),
    ).toBeTruthy();
    expect(screen.getByText("3 bands in Part A.")).toBeTruthy();
  });

  it("lights the band for a wage typed in, says what it means, and keeps the rest of the table", () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: /View Third Schedule, band by band/i,
      }),
    );
    fireEvent.change(
      screen.getByLabelText("Find the band for a monthly wage"),
      { target: { value: "3490" } },
    );
    const band = screen.getByText("RM3,480.01 – RM3,500.00");
    expect(band.closest("tr")?.className).toMatch(/hr-row--hit/);
    expect(
      screen.getByText(/RM3,490.00 falls in the band RM3,480.01 – RM3,500.00/),
    ).toBeTruthy();
    // The neighbours are still there to read against; only the count line
    // gives way to the notice.
    expect(screen.getAllByRole("row").length).toBeGreaterThan(2);
    expect(screen.queryByText("3 bands in Part A.")).toBeNull();
  });

  it("opens as a viewer over the page and closes on Escape", () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: /View Third Schedule, band by band/i,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "EPF Third Schedule" }),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when a part is a flat percentage with no bands", () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: /View Third Schedule, band by band/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Part F" }));
    expect(
      screen.getByText(
        /This part states a flat percentage and has no band table/,
      ),
    ).toBeTruthy();
  });
});

describe("the PCB drawer", () => {
  it("shows Table 1 and every parameter the formula reads", () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: /View Table 1 and the parameters/i }),
    );
    expect(screen.getByText("Individual relief")).toBeTruthy();
    expect(screen.getByText("RM9,000.00")).toBeTruthy();
    expect(screen.getByText("RM5,000.01 – RM20,000.00")).toBeTruthy();
    expect(screen.getByText("Minimum MTD deducted")).toBeTruthy();
  });
});

describe("the editions on file", () => {
  it("lists every platform edition with its source document and the day it takes force", () => {
    mount();
    expect(screen.getByText("Editions on file")).toBeTruthy();
    const link = screen.getByRole("link", {
      name: "KWSP Third Schedule (2026 reprint)",
    });
    expect(link.getAttribute("href")).toBe(
      "https://www.kwsp.gov.my/third-schedule",
    );
    expect(screen.getByText("Added after the reprint")).toBeTruthy();
  });
});
