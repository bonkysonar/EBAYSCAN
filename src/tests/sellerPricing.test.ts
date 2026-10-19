import { afterEach, describe, expect, it, vi } from "vitest";
import { ebaySellerSearchUrl, mediaGradeFromListing } from "../lib/seller/search";
import { rowsFromSnapshotCsv } from "../lib/seller/snapshot";
import type { SearchResult } from "../lib/ebay/types";
import { runSellerAnalysis, mergeSellerListings, restoreRows, draftSellerPrice, type AnalyzerRow } from "../lib/seller/queue";
import { sellerSearchInput } from "../lib/seller/search";
import { analyzeSellerPrice } from "../lib/seller/analyzeSellerPrice";
import { SellerListingsClient } from "../lib/seller/client";
import type { SellerListing } from "../lib/seller/types";
import { fetchSellerActiveListings, parseSellerListingsXml } from "../server/sellerListingsApi";

const listing: SellerListing = {
  currency: "USD",
  currentPrice: 15,
  customLabel: "A1-B2",
  id: "seller-1",
  sku: "SKU-001",
  title: "Test Artist Test Album LP VG+/VG+",
  condition: "Used",
};

function resultWithPrices(prices: number[], total = 25): SearchResult {
  return {
    input: { conditionFilter: "used", query: "Test Artist Test Album", type: "manual" },
    listings: prices.map((price, index) => ({
      condition: "Used",
      currency: "USD",
      id: `comp-${index}`,
      sellerId: `seller-${index}`,
      matchSignals: {},
      price,
      shippingPrice: 0,
      source: "ebay",
      title: `Test Artist Test Album Vinyl LP VG+/VG+ ${index}`,
      totalPrice: price,
    })),
    marketSnapshot: {
      ebaySearchPages: [
        {
          label: "manual",
          pageCount: 1,
          query: "Test Artist Test Album vinyl record",
          returnedCount: prices.length,
          total,
        },
      ],
    },
    source: "ebay",
    timestamp: new Date().toISOString(),
    warnings: [],
  };
}

describe("seller price analysis", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("flags seller listings priced more than 25 percent above cheapest ten average", () => {
    const analysis = analyzeSellerPrice({ ...listing, currentPrice: 15 }, resultWithPrices([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]));
    expect(analysis.status).toBe("PRICE_HIGH");
    expect(analysis.deltaPercent).toBe(50);
  });

  it("flags possible underpricing below cheapest ten average", () => {
    const analysis = analyzeSellerPrice({ ...listing, currentPrice: 7 }, resultWithPrices([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]));
    expect(analysis.status).toBe("PRICE_LOW");
  });

  it("does not turn broad query totals into verified market crowding", () => {
    const crowded = analyzeSellerPrice({ ...listing, currentPrice: 15 }, resultWithPrices([10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 75));
    const veryCrowded = analyzeSellerPrice({ ...listing, currentPrice: 15 }, resultWithPrices([10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 175));

    expect(crowded.status).toBe("PRICE_HIGH");
    expect(crowded.activeComparableCount).toBeNull();
    expect(veryCrowded.status).toBe("PRICE_HIGH");
  });

  it("marks fewer than three comparable listings as needs review", () => {
    const analysis = analyzeSellerPrice({ ...listing, currentPrice: 15 }, resultWithPrices([10, 11], 2));
    expect(analysis.status).toBe("NEEDS_REVIEW");
  });

  it("parses active listings from GetMyeBaySelling XML", () => {
    const xml = `<?xml version="1.0"?>
      <GetMyeBaySellingResponse>
        <Ack>Success</Ack>
        <ActiveList>
          <ItemArray>
            <Item>
              <ItemID>123</ItemID>
              <Title>Boz Scaggs Slow Dancer LP</Title>
              <SKU>SKU-BOZ-001</SKU>
              <ViewItemURL>https://www.ebay.com/itm/123</ViewItemURL>
              <GalleryURL>https://i.ebayimg.com/images/123.jpg</GalleryURL>
              <ConditionDisplayName>Used</ConditionDisplayName>
              <SellingManagerDetails><CustomLabel>BOX-42</CustomLabel></SellingManagerDetails>
              <SellingStatus><CurrentPrice currencyID="USD">8.99</CurrentPrice><QuantitySold>0</QuantitySold></SellingStatus>
              <QuantityAvailable>1</QuantityAvailable>
            </Item>
          </ItemArray>
          <PaginationResult><PageNumber>1</PageNumber><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        </ActiveList>
      </GetMyeBaySellingResponse>`;

    const parsed = parseSellerListingsXml(xml);

    expect(parsed.listings).toHaveLength(1);
    expect(parsed.listings[0]).toMatchObject({
      condition: "Used",
      currentPrice: 8.99,
      customLabel: "BOX-42",
      id: "123",
      sku: "SKU-BOZ-001",
      title: "Boz Scaggs Slow Dancer LP",
    });
  });

  it("refreshes seller OAuth access tokens before fetching active listings", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/identity/v1/oauth2/token")) {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return new Response(JSON.stringify({ access_token: "fresh-user-token", expires_in: 7200 }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      expect(String(url)).toBe("https://api.ebay.com/ws/api.dll");
      expect((init?.headers as Record<string, string>)["X-EBAY-API-IAF-TOKEN"]).toBe("fresh-user-token");
      return new Response(
        `<?xml version="1.0"?>
        <GetMyeBaySellingResponse>
          <Ack>Success</Ack>
          <ActiveList>
            <ItemArray />
            <PaginationResult><PageNumber>1</PageNumber><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
          </ActiveList>
        </GetMyeBaySellingResponse>`,
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSellerActiveListings({
      EBAY_CLIENT_ID: "client-id",
      EBAY_CLIENT_SECRET: "client-secret",
      EBAY_USER_REFRESH_TOKEN: "refresh-token",
    });

    expect(result.listings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches seller listing chunks that start after the first page", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain("<PageNumber>6</PageNumber>");
      return new Response(
        `<?xml version="1.0"?>
        <GetMyeBaySellingResponse>
          <Ack>Success</Ack>
          <ActiveList>
            <ItemArray>
              <Item>
                <ItemID>page-6-item</ItemID>
                <Title>Page Six LP</Title>
                <SellingStatus><CurrentPrice currencyID="USD">12.00</CurrentPrice></SellingStatus>
              </Item>
            </ItemArray>
            <PaginationResult><PageNumber>6</PageNumber><TotalNumberOfPages>6</TotalNumberOfPages></PaginationResult>
          </ActiveList>
        </GetMyeBaySellingResponse>`,
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSellerActiveListings({ EBAY_USER_ACCESS_TOKEN: "user-token" }, { maxPages: 5, pageNumber: 6 });

    expect(result.listings.map((row) => row.id)).toEqual(["page-6-item"]);
    expect(result.hasMore).toBe(false);
    expect(result.pageCount).toBe(1);
  });

  it("loads seller listings in paged chunks from the browser client", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hasMore: true,
            listings: [{ ...listing, id: "page-1" }],
            nextPageNumber: 6,
            source: "ebay-trading",
            timestamp: "2026-07-03T00:00:00.000Z",
            total: 1,
            warnings: [],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hasMore: false,
            listings: [{ ...listing, id: "page-2" }],
            source: "ebay-trading",
            timestamp: "2026-07-03T00:00:01.000Z",
            total: 1,
            warnings: [],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SellerListingsClient().listActive();

    expect(result.listings.map((row) => row.id)).toEqual(["page-1", "page-2"]);
    expect(result.total).toBe(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ maxPages: 5, pageNumber: 1 });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ maxPages: 5, pageNumber: 6 });
  });

  it("imports browser snapshot CSV rows while preserving loaded SKU metadata", () => {
    const csv = [
      "title,item_url,meta,your_price,cheapest_10_average,delta,active_comps,recommendation,reason",
      '"Boz Scaggs Slow Dancer LP","https://www.ebay.com/itm/123456789012","Used · 123456789012","$10.80","$5.71","+89.16%","288","Very crowded + high","Your listing is above the cheapest active comps."',
    ].join("\n");
    const current = [
      {
        listing: {
          currency: "USD",
          currentPrice: 10.8,
          customLabel: "BOX-42",
          id: "123456789012",
          sku: "SKU-BOZ-001",
          title: "Boz Scaggs Slow Dancer LP",
        },
        state: "pending" as const,
      },
    ];

    const imported = rowsFromSnapshotCsv(csv, current);

    expect(imported).toHaveLength(1);
    expect(imported[0].listing.sku).toBe("SKU-BOZ-001");
    expect(imported[0].listing.customLabel).toBe("BOX-42");
    expect(imported[0].analysis?.status).toBe("VERY_CROWDED_PRICE_HIGH");
    expect(imported[0].analysis?.benchmarkPrice).toBe(5.71);
    expect(imported[0].analysis?.deltaValue).toBe(5.09);
    expect(imported[0].analysis?.activeComparableCount).toBe(288);
  });

  it("extracts media grading from active comp titles", () => {
    expect(mediaGradeFromListing({ condition: "Used", title: "Peter Cetera Solitude Solitaire LP Vinyl NM/VG+" })).toBe("NM");
    expect(mediaGradeFromListing({ condition: "Used", title: "Boz Scaggs Slow Dancer media VG+ sleeve VG" })).toBe("VG+");
    expect(mediaGradeFromListing({ condition: "Brand New", title: "Factory sealed vinyl LP" })).toBe("Sealed");
  });

  it("builds active and sold eBay search links with the media grading filter", () => {
    const activeUrl = ebaySellerSearchUrl({ condition: "Used", title: "Aerosmith Get Your Wings VG+/EX" }, "active");
    const soldUrl = ebaySellerSearchUrl({ condition: "Used", title: "Aerosmith Get Your Wings VG+/EX" }, "sold");

    expect(activeUrl).toContain("_nkw=Aerosmith+Get+Your+Wings+VG+plus+vinyl");
    expect(activeUrl).toContain("_sop=15");
    expect(activeUrl).toContain("Record%2520Grading=Very+Good+Plus+%28VG%2B%29");
    expect(activeUrl).not.toContain("LH_Sold=1");
    expect(soldUrl).toContain("LH_Sold=1");
    expect(soldUrl).toContain("Record%2520Grading=Very+Good+Plus+%28VG%2B%29");
  });

  it("drops seller cleanup and pressing notes after the first media grade when building eBay links", () => {
    const url = ebaySellerSearchUrl({ condition: "Used", title: "Asia - Asia VG+/VG+ Ultrasonic Clean 1982 Jacksonville Pr" }, "active");

    expect(url).toContain("_nkw=Asia+Asia+VG+plus+vinyl");
    expect(url).not.toContain("Ultrasonic");
    expect(url).not.toContain("Jacksonville");
    expect(url).not.toContain("1982");
  });
});


describe("seller pricing evidence and full-store queue", () => {
  it("compares item prices without adding competitor shipping", () => {
    const result = resultWithPrices(Array(10).fill(10));
    result.listings = result.listings.map(comp => ({ ...comp, shippingPrice: 8, totalPrice: 18 }));
    const analysis = analyzeSellerPrice({ ...listing, currentPrice: 10 }, result);
    expect(analysis.benchmarkPrice).toBe(10);
    expect(analysis.status).toBe("OK");
    expect(analysis.comparisonBasis).toBe("item-price");
  });

  it("never substitutes unrelated, own-store, duplicate, other-currency or worse-grade listings", () => {
    const result = resultWithPrices(Array(10).fill(10));
    result.listings = result.listings.map((comp, i) => {
      if (i < 2) return { ...comp, title: "Different Artist Album VG+/VG+" };
      if (i === 2) return { ...comp, id: "v1|seller-1|0" };
      if (i === 3) return { ...comp, id: "v1|another-own-item|0" };
      if (i === 4) return { ...comp, currency: "EUR" };
      if (i === 5) return { ...comp, title: "Test Artist Test Album LP VG/VG+" };
      if (i === 6) return { ...comp, title: "Test Artist Test Album cassette VG+/VG+" };
      if (i === 7) return { ...comp, title: "Test Artist Test Album LP MFSL VG+/VG+" };
      return { ...comp, id: "same-comp" };
    });
    const analysis = analyzeSellerPrice(listing, result, {}, ["another-own-item"]);
    expect(analysis.status).toBe("NEEDS_REVIEW");
    expect(analysis.matchedCount).toBe(1);
    expect(analysis.comparableIds).toEqual(["same-comp"]);
  });

  it("leaves unknown grades, auctions, variations and expired evidence for review", () => {
    const result = resultWithPrices(Array(10).fill(10));
    for (const candidate of [{ ...listing, title: "Test Artist Test Album LP" }, { ...listing, listingType: "Chinese" }, { ...listing, hasVariations: true }]) {
      expect(analyzeSellerPrice(candidate, result).status).toBe("NEEDS_REVIEW");
    }
    expect(analyzeSellerPrice(listing, { ...result, timestamp: "2020-01-01T00:00:00Z" }).status).toBe("NEEDS_REVIEW");
  });

  it("rejects a two-album offer as a comparable for one LP and rechecks saved evidence", () => {
    const result = resultWithPrices(Array(10).fill(10));
    result.listings[0].title = "Test Artist Test Album / Another Album 2 LPs VG+";
    const analysis = analyzeSellerPrice(listing, result);
    expect(analysis.matchedCount).toBe(9);
    expect(analysis.confidence).toBe("supported");
    const restored = restoreRows([{ listing, state: "done", searchResult: result, analysis: { ...analysis, pricingVersion: 3, status: "PRICE_HIGH", matchedCount: 10 } }]);
    expect(restored[0].analysis?.matchedCount).toBe(9);
    expect(restored[0].analysis?.analyzedAt).toBe(result.timestamp);
    expect(restored[0].analysis?.comparableIds).not.toContain("comp-0");
  });

  it("cleans seller process notes and uses new condition for sealed records", () => {
    expect(sellerSearchInput({ ...listing, title: "Asia - Asia VG+/VG+ Ultrasonic Clean 1982 Jacksonville Pr" })).toMatchObject({ query: "Asia - Asia", conditionFilter: "used" });
    expect(sellerSearchInput({ ...listing, condition: "Brand New", title: "Artist Album Sealed" })).toMatchObject({ conditionFilter: "new" });
    expect(sellerSearchInput({ ...listing, title: "Mint Condition - Definition of a Band" })).toMatchObject({ query: "Mint Condition - Definition of a Band" });
  });

  it("does not treat a release year before LP as a multi-record offer", () => {
    const result = resultWithPrices(Array(10).fill(10));
    result.listings = result.listings.map(comp => ({ ...comp, title: "Test Artist Test Album 1970 LP VG+/VG+" }));
    expect(analyzeSellerPrice(listing, result).matchedCount).toBe(10);
  });

  it("processes more than 25 rows, bounds concurrency and reuses duplicate searches", async () => {
    const rows: AnalyzerRow[] = Array.from({ length: 60 }, (_, i) => ({ listing: { ...listing, id: `own-${i}`, title: `Test Artist Test Album ${i % 3} VG+/VG+` }, state: "pending" }));
    let inFlight = 0, maximum = 0;
    const search = vi.fn(async () => {
      inFlight++; maximum = Math.max(maximum, inFlight);
      await new Promise(resolve => setTimeout(resolve, 2)); inFlight--;
      return resultWithPrices(Array(10).fill(10));
    });
    const completed: AnalyzerRow[] = [];
    const outcome = await runSellerAnalysis({ rows, search, delayMs: 0, onRow: row => { if (row.state === "done") completed.push(row); } });
    expect(outcome.completed).toBe(60); expect(completed).toHaveLength(60);
    expect(search).toHaveBeenCalledTimes(3); expect(maximum).toBeLessThanOrEqual(2);
  });

  it("stops on rate limits without repeatedly calling eBay", async () => {
    const rows: AnalyzerRow[] = Array.from({ length: 60 }, (_, i) => ({ listing: { ...listing, id: `own-${i}` }, state: "pending" }));
    const search = vi.fn().mockRejectedValue(new Error("eBay Browse API failed (429)"));
    const updates: AnalyzerRow[] = [];
    const outcome = await runSellerAnalysis({ rows, search, delayMs: 0, onRow: row => updates.push(row) });
    expect(outcome.stopReason).toContain("429"); expect(search).toHaveBeenCalledTimes(1);
    expect(updates.filter(row => row.state === "pending").length).toBeLessThanOrEqual(2);
    expect(outcome.completed).toBe(0);
  });

  it("pauses after the in-flight row and resumes without repeating finished work", async () => {
    let pause = false;
    const rows: AnalyzerRow[] = Array.from({ length: 30 }, (_, i) => ({ listing: { ...listing, id: `own-${i}` }, state: "pending" }));
    const search = vi.fn(async () => resultWithPrices(Array(10).fill(10)));
    await runSellerAnalysis({ rows, search, concurrency: 1, delayMs: 0, shouldPause: () => pause, onRow: row => { rows[Number(row.listing.id.split('-')[1])] = row; if (row.state === "done") pause = true; } });
    expect(rows.filter(row => row.state === "done")).toHaveLength(1);
    pause = false;
    const outcome = await runSellerAnalysis({ rows, search, delayMs: 0, onRow: () => {} });
    expect(outcome.completed).toBe(29);
  });

  it("invalidates changed prices and interrupted or legacy results, preserving notes", () => {
    const row: AnalyzerRow = { listing, analysis: analyzeSellerPrice(listing, resultWithPrices(Array(10).fill(10))), state: "done", changeNote: "Keep my note" };
    expect(mergeSellerListings([{ ...listing, currentPrice: 20 }], [row])[0]).toMatchObject({ state: "pending", changeNote: "Keep my note" });
    expect(mergeSellerListings([{ ...listing, currentPrice: 20 }], [row])[0].analysis).toBeUndefined();
    expect(restoreRows([{ ...row, state: "analyzing" }])[0].state).toBe("pending");
    expect(restoreRows([{ ...row, analysis: { ...row.analysis!, pricingVersion: undefined } }])[0].analysis).toBeUndefined();
    expect(draftSellerPrice(row)).toBe(12);
    expect(draftSellerPrice({ ...row, analysis: { ...row.analysis!, status: "PRICE_LOW" } })).toBeNull();
    expect(draftSellerPrice({ ...row, analysis: { ...row.analysis!, status: "NEEDS_REVIEW" } })).toBeNull();
  });

  it("preserves currency attributes and distinguishes missing shipping from free", () => {
    const wrap = (item: string) => `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList><ItemArray><Item><ItemID>123</ItemID><Title>Album</Title><SellingStatus><CurrentPrice currencyID="EUR">12.50</CurrentPrice></SellingStatus>${item}</Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`;
    expect(parseSellerListingsXml(wrap("")).listings[0]).toMatchObject({ currency: "EUR", shippingPrice: undefined });
    expect(parseSellerListingsXml(wrap('<ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServiceCost currencyID="EUR">0</ShippingServiceCost></ShippingServiceOptions></ShippingDetails>')).listings[0].shippingPrice).toBe(0);
    expect(() => parseSellerListingsXml('<html>Error</html>')).toThrow();
  });

  it("does not round a faster-sales draft past its maximum cut", () => {
    const own = { ...listing, currentPrice: 8.53 };
    const row: AnalyzerRow = { listing: own, state: "done", analysis: analyzeSellerPrice(own, resultWithPrices(Array(10).fill(4))) };
    expect(draftSellerPrice(row)).toBe(6.83);
    expect(draftSellerPrice(row)!).toBeGreaterThanOrEqual(own.currentPrice * 0.8);
  });

  it("rejects missing inventory rows or a pagination cursor that does not advance", async () => {
    const response = (overrides: object) => new Response(JSON.stringify({ source: "ebay-trading", listings: [listing], warnings: [], timestamp: new Date().toISOString(), total: 1, ...overrides }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ hasMore: false, complete: true, reportedTotal: 2 })));
    await expect(new SellerListingsClient().listActive()).rejects.toThrow("Incomplete inventory");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ hasMore: true, nextPageNumber: 1 })));
    await expect(new SellerListingsClient().listActive()).rejects.toThrow("did not advance");
    vi.unstubAllGlobals();
  });
});
