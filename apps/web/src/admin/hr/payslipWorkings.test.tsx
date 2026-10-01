// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayslipWorkings } from "./PayslipWorkings";

describe("the payslip workings", () => {
  it("shows nothing when a payslip was frozen before workings existed", () => {
    const { container } = render(<PayslipWorkings workings={undefined} />);
    expect(container.textContent).toBe("");
  });

  it("opens the rows for each figure that was worked out, and only those", () => {
    render(
      <PayslipWorkings
        workings={{
          epf: {
            "EPF wages": "RM3500.00",
            "Third Schedule part": "Part A (malaysian citizen, age 30)",
            "Table row":
              "RM3480.01 to RM3500.00: employer RM420.00, employee RM385.00",
            Edition: "D5 — EPF Act 1991, Third Schedule",
          },
          socso: null,
          pcb: {
            "P — chargeable income for the year": "RM31000.00",
            "R — rate": "1%",
            Edition: "D1 — MTD 2026",
          },
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "How this was worked out" }),
    );
    expect(screen.getByText("EPF")).toBeInTheDocument();
    expect(screen.getByText("PCB (MTD)")).toBeInTheDocument();
    expect(screen.queryByText("SOCSO")).toBeNull();
    expect(
      screen.getByText(
        "RM3480.01 to RM3500.00: employer RM420.00, employee RM385.00",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("P — chargeable income for the year"),
    ).toBeInTheDocument();
  });
});
