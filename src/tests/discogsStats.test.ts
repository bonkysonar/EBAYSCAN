import { describe, expect, it } from "vitest";
import { parseDiscogsSalesStats } from "../lib/discogs/parseSalesStats";

describe("parseDiscogsSalesStats", () => {
  it("parses visible Discogs statistics text", () => {
    const stats = parseDiscogsSalesStats(`
      Statistics
      Have: 495
      Last Sold: Apr 5, 2026
      Low: $0.93
      Median: $4.15
      High: $8.71
    `);

    expect(stats?.lastSold).toBe("Apr 5, 2026");
    expect(stats?.lowPrice?.value).toBe(0.93);
    expect(stats?.medianPrice?.value).toBe(4.15);
    expect(stats?.highPrice?.value).toBe(8.71);
  });

  it("parses saved Discogs HTML", () => {
    const stats = parseDiscogsSalesStats(`
      <section><h2>Statistics</h2>
      <dl><dt>Last Sold:</dt><dd>Apr 5, 2026</dd>
      <dt>Low:</dt><dd>$0.93</dd>
      <dt>Median:</dt><dd>$4.15</dd>
      <dt>High:</dt><dd>$8.71</dd></dl></section>
    `);

    expect(stats?.medianPrice?.value).toBe(4.15);
  });
});
