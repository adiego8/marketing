import { describe, it, expect } from "vitest";
import {
  DEMOGRAPHIC_FIELDS,
  slugify,
  customDemographicKeys,
  demographicLabel,
} from "./demographics";

describe("DEMOGRAPHIC_FIELDS", () => {
  it("has unique keys", () => {
    const keys = DEMOGRAPHIC_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stores every key in the form slugify produces", () => {
    // Otherwise a custom field typed as "Company size" would slug to an
    // existing fixed key and silently overwrite it from the custom section.
    for (const f of DEMOGRAPHIC_FIELDS) {
      expect(slugify(f.key)).toBe(f.key);
    }
  });
});

describe("slugify", () => {
  it("lowercases and joins words with underscores", () => {
    expect(slugify("Tax complexity")).toBe("tax_complexity");
  });

  it("collapses a run of punctuation and spaces into one underscore", () => {
    expect(slugify("Household size (est.)")).toBe("household_size_est");
    expect(slugify("Income  —  range")).toBe("income_range");
  });

  it("keeps digits", () => {
    expect(slugify("Top 3 channels")).toBe("top_3_channels");
  });

  it("returns an empty string when there is nothing to slug", () => {
    expect(slugify("   ")).toBe("");
    expect(slugify("!!!")).toBe("");
  });
});

describe("customDemographicKeys", () => {
  it("returns nothing for an empty object", () => {
    expect(customDemographicKeys({})).toEqual([]);
  });

  it("returns nothing when every key is a fixed field", () => {
    expect(customDemographicKeys({ role: "Owner", location: "US" })).toEqual([]);
  });

  it("returns only the keys outside the fixed set, in insertion order", () => {
    const stored = {
      role: "Employee",
      tax_complexity: "Simple to moderate",
      location: "US",
      filing_status: "Single",
    };
    expect(customDemographicKeys(stored)).toEqual([
      "tax_complexity",
      "filing_status",
    ]);
  });
});

describe("demographicLabel", () => {
  it("uses the field's own label for a fixed key", () => {
    expect(demographicLabel("income_or_revenue")).toBe("Income / revenue");
  });

  it("makes a custom key readable", () => {
    expect(demographicLabel("tax_complexity")).toBe("Tax complexity");
  });

  it("falls back to the key when there is nothing to humanise", () => {
    expect(demographicLabel("")).toBe("");
  });
});
