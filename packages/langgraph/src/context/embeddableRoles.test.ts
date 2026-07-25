import { describe, expect, it } from "vitest";
import { EMBEDDABLE_ROLES } from "@tbm/db";

describe("EMBEDDABLE_ROLES (Stage 4 node-promotion gate)", () => {
  it("never includes person, so owner/manager/contact columns never become graph nodes", () => {
    expect(EMBEDDABLE_ROLES).not.toContain("person");
  });

  it("never includes technical/measure/free-text roles", () => {
    for (const excluded of ["identifier", "description", "other", "date", "cost_amount"]) {
      expect(EMBEDDABLE_ROLES).not.toContain(excluded);
    }
  });

  it("includes the real enterprise business-entity roles, including the new vendor-relationship roles", () => {
    for (const role of [
      "vendor",
      "application",
      "service",
      "business_unit",
      "department",
      "cost_center",
      "cloud_resource",
      "cloud_provider",
      "infrastructure_asset",
      "project",
    ]) {
      expect(EMBEDDABLE_ROLES).toContain(role);
    }
  });
});
