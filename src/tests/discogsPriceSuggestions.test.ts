import { describe, expect, it } from "vitest";
import { selectUsedDiscogsPriceSuggestion } from "../lib/discogs/priceSuggestions";

describe("Discogs price suggestions", () => {
  it("selects the conservative Very Good price for used records", () => {
    const suggestion = selectUsedDiscogsPriceSuggestion({
      "Near Mint (NM or M-)": { currency: "USD", value: 24.5 },
      "Very Good (VG)": { currency: "USD", value: 12.34 },
      "Very Good Plus (VG+)": { currency: "USD", value: 18 },
    });

    expect(suggestion).toEqual({
      condition: "Very Good (VG)",
      currency: "USD",
      value: 12.34,
    });
  });

  it("falls back to the next usable condition and normalizes string prices", () => {
    const suggestion = selectUsedDiscogsPriceSuggestion({
      "Very Good (VG)": { currency: "USD", value: "not available" },
      "Very Good Plus (VG+)": { currency: "EUR", value: "8.126" },
    });

    expect(suggestion).toEqual({
      condition: "Very Good Plus (VG+)",
      currency: "EUR",
      value: 8.13,
    });
  });

  it("returns undefined when Discogs has no usable suggestion", () => {
    expect(selectUsedDiscogsPriceSuggestion({})).toBeUndefined();
    expect(selectUsedDiscogsPriceSuggestion({ "Very Good (VG)": { value: 0 } })).toBeUndefined();
  });
});
