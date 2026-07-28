import { describe, expect, it } from "vitest";
import { sourceTypeFromFileName } from "./inferSourceType";

// The real sample-set file names, with the classifications the LLM actually
// produced on a live run in the second column — these are the regressions the
// override table exists to prevent.
describe("sourceTypeFromFileName", () => {
  it("overrides the two confident-but-wrong LLM classifications", () => {
    // was "AWS Billing" 95%, because one Server ID reads "Amazon Web Services, Inc. - Instance Hours"
    expect(sourceTypeFromFileName("Servers_Master_Data-07-21-2026.xlsx")).toBe("Server Inventory");
    // was "Application Inventory" 90%, because it carries ITRT_Application Key / Service Name
    expect(sourceTypeFromFileName("IT_Resource_Towers_Master_Data-07-21-2026.xlsx")).toBe("Resource Tower Master");
  });

  it("gives the six previously-Unknown datasets a real source type", () => {
    expect(sourceTypeFromFileName("Vendor_Master_Data-07-21-2026.xlsx")).toBe("Vendor Master");
    expect(sourceTypeFromFileName("Storage_Master_Data-07-21-2026.xlsx")).toBe("Storage Inventory");
    expect(sourceTypeFromFileName("Tickets_Master_Data-07-21-2026.xlsx")).toBe("ITSM Tickets");
    expect(sourceTypeFromFileName("Projects_Master_Data-07-21-2026.xlsx")).toBe("Project Portfolio");
    expect(sourceTypeFromFileName("All_Business_Services-07-21-2026.xlsx")).toBe("Business Service Catalog");
  });

  it("splits the three datasets that were all pooled into 'General Ledger'", () => {
    expect(sourceTypeFromFileName("Cost_Source_Master_Data-07-21-2026.xlsx")).toBe("General Ledger");
    expect(sourceTypeFromFileName("Chart_of_Accounts_Master_Data-07-21-2026.xlsx")).toBe("Chart of Accounts");
    expect(sourceTypeFromFileName("Fixed_Asset_Master_Data-07-21-2026.xlsx")).toBe("Fixed Asset Register");
  });

  it("keeps the more specific pattern when two could match", () => {
    // "storage_device" must win over "storage"
    expect(sourceTypeFromFileName("Storage_Devices_Master_Data-07-21-2026.xlsx")).toBe("CMDB");
  });

  it("returns null for a file name that describes nothing, so inference still runs", () => {
    expect(sourceTypeFromFileName("Client Email_2026-07-07 2.xlsx")).toBeNull();
    expect(sourceTypeFromFileName("export (3).xlsx")).toBeNull();
  });
});
