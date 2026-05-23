import { describe, expect, it } from "vitest";
import { ebaySellerSearchUrl, mediaGradeFromListing, rowsFromSnapshotCsv } from "../components/SellerPriceAnalyzer";
import type { SearchResult } from "../lib/ebay/types";
import { analyzeSellerPrice } from "../lib/seller/analyzeSellerPrice";
import type { SellerListing } from "../lib/seller/types";
import { parseSellerListingsXml } from "../server/sellerListingsApi";

const listing: SellerListing = {
  currency: "USD",
  currentPrice: 15,
  customLabel: "A1-B2",
  id: "seller-1",
  sku: "SKU-001",
  title: "Test Artist Test Album LP",
};

function resultWithPrices(prices: number[], total = 25): SearchResult {
  return {
    input: { conditionFilter: "used", query: "Test Artist Test Album", type: "manual" },
    listings: prices.map((price, index) => ({
      condition: "Used",
      currency: "USD",
      id: `comp-${index}`,
      matchSignals: {},
      price,
      shippingPrice: 0,
      source: "ebay",
      title: `Test Artist Test Album Vinyl LP ${index}`,
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
    timestamp: "2026-05-20T00:00:00.000Z",
    warnings: [],
  };
}

describe("seller price analysis", () => {
  it("flags seller listings priced more than 25 percent above cheapest ten average", () => {
    const analysis = analyzeSellerPrice({ ...listing, currentPrice: 15 }, resultWithPrices([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]));
    expect(analysis.status).toBe("PRICE_HIGH");
    expect(analysis.deltaPercent).toBe(50);
  });

  it("flags possible underpricing below cheapest ten average", () => {
    const analysis = analyzeSellerPrice({ ...listing, currentPrice: 7 }, resultWithPrices([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]));
    expect(analysis.status).toBe("PRICE_LOW");
  });

  it("adds crowded-market urgency when active comp totals are high", () => {
    const crowded = analyzeSellerPrice({ ...listing, currentPrice: 15 }, resultWithPrices([10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 75));
    const veryCrowded = analyzeSellerPrice({ ...listing, currentPrice: 15 }, resultWithPrices([10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 175));

    expect(crowded.status).toBe("CROWDED_PRICE_HIGH");
    expect(veryCrowded.status).toBe("VERY_CROWDED_PRICE_HIGH");
  });

  it("marks too few comparable listings as needs review", () => {
    const analysis = analyzeSellerPrice({ ...listing, currentPrice: 15 }, resultWithPrices([10, 11, 12], 3));
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
