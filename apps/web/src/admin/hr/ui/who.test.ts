import { describe, expect, it } from "vitest";
import { initialsOf } from "./who";

describe("initialsOf", () => {
  it("drops the honorific and reads the name", () => {
    expect(initialsOf("Dr Aisyah Rahman")).toBe("AR");
    expect(initialsOf("Chandra Devi")).toBe("CD");
    expect(initialsOf("Chandra")).toBe("CH");
  });

  it("gives an empty avatar for a name that has not arrived, rather than crashing the page", () => {
    // A payslip opened from a bookmark renders once before its row loads.
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });
});
