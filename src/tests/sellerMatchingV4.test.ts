import { describe, it, expect, vi, afterEach } from "vitest";
import { analyzeSellerPrice } from "../lib/seller/analyzeSellerPrice";
import { draftSellerPrice } from "../lib/seller/queue";
import { mediaGradeFromListing, mediaGradeFromDescription, sellerCondition, sellerSearchQuery } from "../lib/seller/search";
import { sellerListingBlocker } from "../lib/seller/matching";
import type { SellerListing } from "../lib/seller/types";
import type { SearchResult } from "../lib/ebay/types";

const own: SellerListing = { id: "own", title: "ExampleArtist - ActualTitle VG+/VG+ 1970 Ultrasonic Clean", currency: "USD", currentPrice: 20, condition: "Used" };
function result(prices = [10, 10, 10, 10, 10]): SearchResult {
  return { input: { type: "manual", query: "ExampleArtist ActualTitle", searchProfile: "seller-pricing" }, source: "ebay", timestamp: new Date().toISOString(), warnings: [],
    listings: prices.map((price, i) => ({ id: `comp-${i}`, sellerId: `seller-${i}`, title: "ExampleArtist - ActualTitle LP VG+/VG+", condition: "Used", currency: "USD", source: "ebay", price, shippingPrice: 5, totalPrice: price + 5, matchSignals: {} })) };
}
describe("seller matching coverage without weakening identity", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("matches sealed M/M records against new records without inventing single-disc counts", () => {
    const record = { ...own, title: "ExampleArtist - ActualTitle M/M 2023 New/Sealed Vinyl", condition: undefined };
    const data = result(); data.listings = data.listings.map(comp => ({ ...comp, title: "ExampleArtist ActualTitle 3LP Factory Sealed", condition: "New" }));
    expect(analyzeSellerPrice(record, data)).toMatchObject({ matchedCount: 5, confidence: "supported" });
    expect(mediaGradeFromListing({ title: record.title, condition: "" })).toBe("Sealed");
  });
  it("keeps conflicting known disc counts, mixed albums and singles out", () => {
    const data = result();
    data.listings[0].title = "ExampleArtist ActualTitle / Another Album 2LP VG+";
    data.listings[1].title = 'ExampleArtist ActualTitle 7" VG+';
    data.listings[2].title = "ExampleArtist ActualTitle 45 RPM VG+";
    expect(analyzeSellerPrice(own, data).matchedCount).toBe(2);
    expect(analyzeSellerPrice({ ...own, title: "ExampleArtist - ActualTitle 2LP VG+/VG+" }, { ...data, listings: [{ ...data.listings[3], title: "ExampleArtist ActualTitle 3LP VG+" }] }).matchedCount).toBe(0);
  });
  it("does not mistake an artist match for a self-titled album", () => {
    const data = result(); data.listings = data.listings.map(comp => ({ ...comp, title: "Emerson Lake Palmer Brain Salad Surgery LP VG+" }));
    const record = { ...own, title: "Emerson, Lake & Palmer - Emerson, Lake & Palmer VG+/VG+ 1970" };
    expect(analyzeSellerPrice(record, data).matchedCount).toBe(0);
    data.listings[0].title = "Emerson Lake Palmer - Self Titled LP VG+";
    expect(analyzeSellerPrice(record, data).matchedCount).toBe(1);
  });
  it("keeps premium editions and explicit colors separate", () => {
    const data = result();
    data.listings[0].title = "ExampleArtist ActualTitle MFSL VG+";
    data.listings[1].title = "ExampleArtist ActualTitle Blue Vinyl VG+";
    data.listings[2].title = "ExampleArtist ActualTitle mono VG+";
    expect(analyzeSellerPrice(own, data).matchedCount).toBe(2);
  });
  it("normalizes apostrophes and removes process metadata without losing album identity", () => {
    expect(sellerSearchQuery("George Harrison With Eric Clapton – Live In Japan 2XLP Remaster 180G Brand New")).toBe("George Harrison - Live In Japan");
    expect(sellerSearchQuery("Mint Condition - Definition of a Band")).toBe("Mint Condition - Definition of a Band");
    const data = result(); data.listings[0].title = "Artist Dont Stop LP VG+";
    expect(analyzeSellerPrice({ ...own, title: "Artist - Don't Stop VG+/VG+" }, data).matchedCount).toBe(1);
  });
  it("extracts explicit description grades but never sleeve-only or generic grade promises", () => {
    expect(mediaGradeFromDescription("Record Grading: Very Good Plus (VG+). Sleeve: VG.")).toBe("VG+");
    expect(mediaGradeFromDescription("Vinyl: EX. Jacket is VG+.")).toBe("EX");
    expect(mediaGradeFromDescription("All records are VG or better")).toBeUndefined();
    expect(mediaGradeFromDescription("Sleeve condition: Excellent")).toBeUndefined();
    expect(mediaGradeFromListing({ title: "ExampleArtist ActualTitle Cover EX", condition: "Used" })).toBe("Unknown");
    expect(mediaGradeFromListing({ title: "ExampleArtist ActualTitle Vinyl VG+ Sleeve M-", condition: "Used" })).toBe("VG+");
    expect(mediaGradeFromListing({ title: "Cat Stevens Foreigner LP EX COVER/VG+ VINYL!", condition: "Used", recordGrade: "EX", recordGradeSource: "title" })).toBe("VG+");
  });
  it("does not turn unsealed or contradictory used-grade inventory into new evidence", () => {
    expect(sellerCondition({ title: "ExampleArtist ActualTitle not sealed VG+", condition: "Used" })).toBe("used");
    expect(sellerListingBlocker({ ...own, title: "ExampleArtist ActualTitle VG+/M New/Sealed" })).toContain("used media grade");
  });
  it("uses a median and keeps three-to-four matches tentative with a 10 percent cap", () => {
    const analysis = analyzeSellerPrice(own, result([1, 10, 11]));
    expect(analysis).toMatchObject({ benchmarkPrice: 10, confidence: "indicative", maximumDraftReductionPercent: 10 });
    expect(draftSellerPrice({ listing: own, analysis, state: "done" })).toBe(18);
  });
  it("requires multiple sellers and a bounded spread for a supported recommendation", () => {
    expect(analyzeSellerPrice(own, result()).confidence).toBe("supported");
    const data = result(); data.listings = data.listings.map(comp => ({ ...comp, sellerId: "one-seller" }));
    expect(analyzeSellerPrice(own, data).confidence).toBe("indicative");
    data.listings = data.listings.map(comp => ({ ...comp, sellerId: undefined }));
    expect(analyzeSellerPrice(own, data).confidence).toBe("indicative");
    expect(analyzeSellerPrice(own, result([1, 2, 10, 20, 25])).confidence).toBe("indicative");
  });
  it("records the actual rejection reasons for future review", () => {
    const data = result(); data.listings[0].id = own.id; data.listings[1].title = "Unrelated Artist Other Album VG+";
    data.listings[2].title = "ExampleArtist ActualTitle LP";
    expect(analyzeSellerPrice(own, data).matchDiagnostics?.rejected).toMatchObject({ own_inventory: 1, title_identity: 1, grade_unknown: 1 });
  });
  it("excludes incomplete copies from ordinary complete-record comparisons", () => {
    const data = result(); data.listings[0].title = "ExampleArtist ActualTitle No Cover VG+";
    expect(analyzeSellerPrice(own, data).matchDiagnostics?.rejected.incomplete_copy).toBe(1);
  });
  it("fetches 200 extended records in one request and retains explicit grade provenance", async () => {
    vi.resetModules();
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname.includes("oauth2/token")) return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }));
      requests.push(url);
      return new Response(JSON.stringify({ total: 1, itemSummaries: [{ itemId: "v1|test|0", title: "ExampleArtist ActualTitle LP", condition: "Used", price: { value: "10", currency: "USD" }, shortDescription: "Vinyl: EX. Sleeve: VG+.", seller: { username: "different-seller" }, buyingOptions: ["FIXED_PRICE"] }] }));
    }));
    const { searchMarketplace } = await import("../server/marketplaceApi");
    const data = await searchMarketplace({ type: "manual", query: "ExampleArtist ActualTitle", conditionFilter: "used", searchProfile: "seller-pricing" }, { EBAY_CLIENT_ID: "test", EBAY_CLIENT_SECRET: "test" });
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("limit")).toBe("200");
    expect(requests[0].searchParams.get("fieldgroups")).toBe("EXTENDED");
    expect(requests[0].searchParams.get("q")).toBe("ExampleArtist ActualTitle");
    expect(data.listings[0]).toMatchObject({ recordGrade: "EX", recordGradeSource: "description", sellerId: "different-seller", buyingOptions: ["FIXED_PRICE"] });
  });
});
