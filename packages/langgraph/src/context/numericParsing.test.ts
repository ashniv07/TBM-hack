import { describe, expect, it } from "vitest";
import { types } from "pg";
// Importing @tbm/db runs pool.ts, which registers the parser as a side effect.
import "@tbm/db";

// Postgres `numeric` arrives as a string by default. Every score, confidence
// and weight in this schema is numeric, so without this parser `sum + score`
// concatenates instead of adding — which is exactly how "0% avg readiness"
// appeared next to a dataset showing 57%.
describe("numeric type parsing", () => {
  const parse = types.getTypeParser(types.builtins.NUMERIC) as (v: string) => unknown;

  it("returns a number, not a string", () => {
    expect(parse("0.57")).toBe(0.57);
    expect(typeof parse("0.57")).toBe("number");
  });

  it("makes summation add rather than concatenate", () => {
    const scores = ["0.57", "0.62", "0.81"].map(parse) as number[];
    expect(scores.reduce((sum, s) => sum + s, 0) / scores.length).toBeCloseTo(0.6667, 4);
  });

  it("handles integers, negatives and zero", () => {
    expect(parse("1")).toBe(1);
    expect(parse("0")).toBe(0);
    expect(parse("-12.5")).toBe(-12.5);
  });
});
