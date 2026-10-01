import { describe, expect, it } from "vitest";
import { bestEvidenceForEntry } from "../../scripts/lib/productResearchCuration.mjs";

const now = new Date("2026-10-01T18:00:00Z");
const find = { artist: "Example Duo", title: "Night Tide", sourceListingTitle: "Example Duo Night Tide Red 2LP", retailEditionText: "Red 2LP" };
const title = "Example Duo - Night Tide 2LP NEW Colored Vinyl";
const row = {
  title, avgSoldPrice: 30, avgShipping: 5, totalSold: 4, dateLastSold: "2026-09-15",
  itemUrl: "https://www.ebay.com/itm/123456789012",
  itemIdentityEvidence: {
    captureMethod: "visible_browser", capturedAt: now.toISOString(),
    url: "https://www.ebay.com/itm/123456789012?orig_cvip=true",
    listingTitle: title, editionText: "Red vinyl pressing, 2LP, limited to 1500 copies.",
    visibleText: `${title}\nRed vinyl pressing, 2LP, limited to 1500 copies.`,
  },
};
const curate = (sale = row) => bestEvidenceForEntry(find, { runs: [{
  query: "Example Duo Night Tide", capturedAt: now.toISOString(), rows: [sale],
}] }, now);

describe("observed sold item identity", () => {
  it("recovers a generic colored title from its own item page while preserving sale facts", () => {
    expect(curate({ ...row, itemIdentityEvidence: undefined }).rows).toEqual([]);
    const result = curate();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ title, avgSoldPrice: 30, avgShipping: 5, totalSold: 4,
      verifiedItemIdentity: { url: row.itemIdentityEvidence.url, editionText: row.itemIdentityEvidence.editionText } });
    expect(result.rows[0]).not.toHaveProperty("itemIdentityEvidence");
    expect(result.sales90Days).toBeNull(); // Item pages do not establish sold velocity.
  });

  it.each([
    { url: "https://www.ebay.com/itm/999999999999" },
    { url: "https://www.ebay.com.attacker.test/itm/123456789012" },
    { capturedAt: "2026-10-01T11:59:59Z" },
    { capturedAt: "2026-10-01T18:06:00Z" },
    { listingTitle: "Different album" },
    { editionText: "Red vinyl 2LP not actually visible" },
    { captureMethod: "inferred" },
  ])("ignores unverified or expired item details: %j", mutation => {
    expect(curate({ ...row, itemIdentityEvidence: { ...row.itemIdentityEvidence, ...mutation } }).rows).toEqual([]);
  });

  it.each(["Blue 2LP", "Red 3LP", "Red 2LP sleeve damage", "Red 2LP signed"])(
    "never erases a conflict already stated in the sold title: %s", detail => {
      const conflictingTitle = `Example Duo Night Tide ${detail}`;
      expect(curate({ ...row, title: conflictingTitle, itemIdentityEvidence: {
        ...row.itemIdentityEvidence, listingTitle: conflictingTitle,
        visibleText: `${conflictingTitle}\n${row.itemIdentityEvidence.editionText}`,
      } }).rows).toEqual([]);
    });
});
