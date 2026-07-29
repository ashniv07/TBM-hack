import { describe, expect, it } from "vitest";
import { toAmount } from "./costFacts";

// Amounts arrive from Excel as numbers most of the time, but Cost_Source and the
// cloud billing exports also carry them as formatted strings. Getting this wrong
// silently changes the totals Apptio would allocate, so it gets a check.
describe("toAmount", () => {
  it("passes through real numbers, including negatives and zero", () => {
    expect(toAmount(7179)).toBe(7179);
    expect(toAmount(-250.5)).toBe(-250.5);
    expect(toAmount(0)).toBe(0);
  });

  it("parses formatted currency strings", () => {
    expect(toAmount("$1,234.56")).toBe(1234.56);
    expect(toAmount(" 20 ")).toBe(20);
    expect(toAmount("USD 42")).toBe(42);
  });

  it("reads accounting-style parentheses as negative", () => {
    expect(toAmount("(1,500)")).toBe(-1500);
    expect(toAmount("($99.99)")).toBe(-99.99);
  });

  it("rejects anything that is not a number, rather than counting it as zero", () => {
    expect(toAmount(null)).toBeNull();
    expect(toAmount(undefined)).toBeNull();
    expect(toAmount("")).toBeNull();
    expect(toAmount("n/a")).toBeNull();
    expect(toAmount("-")).toBeNull();
    expect(toAmount(NaN)).toBeNull();
    expect(toAmount(Infinity)).toBeNull();
    expect(toAmount({ formula: "SUM(A1:A2)" })).toBeNull();
  });
});
