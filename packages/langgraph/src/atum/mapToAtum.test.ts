import { describe, expect, it } from "vitest";
import { lexicalScore, ruleBoost } from "./mapToAtum";

describe("ATUM lexical scoring", () => {
  it("ranks explicit compute terminology strongly", () => {
    expect(lexicalScore("cloud compute hosting", {
      path: "Infrastructure > Compute > Cloud Compute",
      search_text: "Virtual compute resources and cloud hosting",
    })).toBe(1);
  });

  it("does not reward unrelated taxonomy text", () => {
    expect(lexicalScore("payroll management", {
      path: "Infrastructure > Network > LAN",
      search_text: "Local area network equipment",
    })).toBe(0);
  });
});

describe("ATUM contextual rules", () => {
  it("boosts a Compute category when the row contains EC2 evidence", () => {
    expect(ruleBoost("Vendor: AWS. Product: EC2 instance", { path: "Infrastructure > Compute > Servers" }, "resource_tower"))
      .toEqual({ score: 1, label: "compute technology" });
  });

  it("does not boost an unrelated Network category", () => {
    expect(ruleBoost("Vendor: AWS. Product: EC2 instance", { path: "Infrastructure > Network > LAN" }, "resource_tower"))
      .toEqual({ score: 0 });
  });
});
