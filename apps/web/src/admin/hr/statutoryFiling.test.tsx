// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { StatutoryFiling } from "../types";

/*
 * THE FILING HELPER SAYS THREE THINGS PER AGENCY, IN THE ORDER A PORTAL
 * ASKS FOR THEM: who to add and remove, the list, the total — and lets a
 * person record that it was filed, once, with the portal's reference.
 */
const row = (
  name: string,
  identifier: string,
  parts: Record<string, [number, number]>,
) => {
  const employee = Object.values(parts).reduce((sum, [e]) => sum + e, 0);
  const employer = Object.values(parts).reduce((sum, [, r]) => sum + r, 0);
  return {
    staffId: name.toLowerCase().replace(/\s/g, "-"),
    name,
    identifier,
    membershipNo: `M-${identifier.slice(-4)}`,
    parts: Object.fromEntries(
      Object.entries(parts).map(([scheme, [e, r]]) => [
        scheme,
        { employeeCents: e, employerCents: r },
      ]),
    ),
    employeeCents: employee,
    employerCents: employer,
    totalCents: employee + employer,
    note: null,
    basisNote: null,
  };
};

const filing: StatutoryFiling = {
  runId: "run-1",
  period: "2026-09",
  periodLabel: "September 2026",
  employerName: "Klinik Demo Sdn Bhd",
  employerIdentity: {
    registrationNo: null,
    epfEmployerNo: "E-1",
    socsoEmployerNo: null,
    lhdnEmployerNo: null,
    hrdRegistrationNo: null,
    detailsAsAt: "CURRENT",
  },
  snapshotVersion: 1,
  previousMonth: "August 2026",
  notASubmission: "Kuwick files nothing.",
  agencies: [
    {
      agency: "KWSP",
      label: "KWSP (EPF)",
      portal: "KWSP i-Akaun (Majikan)",
      schemes: ["EPF"],
      applicable: true,
      note: null,
      rows: [
        row("Amir Demo", "910303015555", { EPF: [33000, 39000] }),
        row("Bella Demo", "920404016666", { EPF: [30800, 36400] }),
      ],
      joiners: [
        {
          staffId: "bella-demo",
          name: "Bella Demo",
          identifier: "920404016666",
          membershipNo: "M-6666",
          reason: "Started 10 Sep 2026",
        },
      ],
      leavers: [],
      notComputed: 0,
      employeeTotalCents: 63800,
      employerTotalCents: 75400,
      totalCents: 139200,
      submission: {
        state: "NOT_RECORDED",
        submittedDate: null,
        reference: null,
        recordedBy: null,
        recordedAt: null,
        perScheme: [{ scheme: "EPF", recorded: false, reference: null }],
      },
    },
    {
      agency: "PERKESO",
      label: "PERKESO (SOCSO, EIS and LINDUNG 24 JAM)",
      portal: "PERKESO ASSIST Portal",
      schemes: ["SOCSO", "EIS", "LINDUNG"],
      applicable: true,
      note: null,
      rows: [
        row("Amir Demo", "910303015555", {
          SOCSO: [1475, 5165],
          EIS: [590, 590],
          LINDUNG: [2215, 0],
        }),
      ],
      joiners: [],
      leavers: [
        {
          staffId: "chong-demo",
          name: "Chong Demo",
          identifier: "880101017777",
          membershipNo: null,
          reason: "On August 2026's payroll, not this month's",
        },
      ],
      notComputed: 0,
      employeeTotalCents: 4280,
      employerTotalCents: 5755,
      totalCents: 10035,
      submission: {
        state: "RECORDED",
        submittedDate: "2026-10-05",
        reference: "ASSIST-0042",
        recordedBy: "Dr Demo",
        recordedAt: "2026-10-05T03:00:00.000Z",
        perScheme: [],
      },
    },
    {
      agency: "HRD",
      label: "HRD Corp (levy)",
      portal: "HRD Corp e-TRiS",
      schemes: ["HRD"],
      applicable: false,
      note: "Not registered with HRD Corp: no levy is due this month.",
      rows: [],
      joiners: [],
      leavers: [],
      notComputed: 0,
      employeeTotalCents: null,
      employerTotalCents: null,
      totalCents: null,
      submission: {
        state: "NOT_APPLICABLE",
        submittedDate: null,
        reference: null,
        recordedBy: null,
        recordedAt: null,
        perScheme: [],
      },
    },
  ],
};

const mutate = vi.fn();
vi.mock("../hooks/useAdmin", () => ({
  useStatutoryFiling: () => ({
    data: filing,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useRecordAgencyFiling: () => ({ mutate, isPending: false }),
}));
vi.mock("../../core/hooks/useCan", () => ({ useCan: () => true }));

const { StatutoryFilingPage } = await import("./StatutoryFilingPage");

const mount = () =>
  render(
    <AntApp>
      <MemoryRouter initialEntries={["/admin/hr/payroll/run-1/filing"]}>
        <Routes>
          <Route
            path="/admin/hr/payroll/:id/filing"
            element={<StatutoryFilingPage />}
          />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  );

describe("the filing helper", () => {
  it("opens on KWSP with the list in portal order, the total to pay and who to add", () => {
    mount();
    expect(screen.getByText("KWSP (EPF)")).toBeTruthy();
    const names = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(names.findIndex((t) => t.includes("Amir Demo"))).toBeLessThan(
      names.findIndex((t) => t.includes("Bella Demo")),
    );
    expect(screen.getByText("RM1,392.00")).toBeTruthy();
    expect(screen.getByText(/Started 10 Sep 2026/)).toBeTruthy();
    expect(screen.getByText("Nobody left this month.")).toBeTruthy();
    expect(screen.getByText("Not yet submitted")).toBeTruthy();
  });

  it("shows PERKESO as one sitting for three schemes, already submitted, with who to remove", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "PERKESO" }));
    expect(screen.getByText("SOCSO employee")).toBeTruthy();
    expect(screen.getByText("SKBBK employee")).toBeTruthy();
    expect(screen.getByText(/Submitted 5 Oct 2026/)).toBeTruthy();
    expect(screen.getByText("ASSIST-0042")).toBeTruthy();
    expect(
      screen.getByText(/On August 2026's payroll, not this month's/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Mark as submitted" }),
    ).toBeNull();
  });

  it("says when an agency has nothing to file", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "HRD" }));
    expect(
      screen.getByText(
        "Not registered with HRD Corp: no levy is due this month.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Nothing to file")).toBeTruthy();
  });

  it("records a submission with the date and the portal reference, and refuses one without a reference", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Mark as submitted" }));
    fireEvent.click(screen.getByRole("button", { name: "Record submission" }));
    expect(screen.getByText(/The portal issued a reference/)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reference from the portal"), {
      target: { value: "KWSP-2026-09-77" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record submission" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      agency: "KWSP",
      reference: "KWSP-2026-09-77",
    });
    expect(mutate.mock.calls[0][0].submittedDate).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
