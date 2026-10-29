import { describe, expect, it } from "vitest";
import { browserObservedRetailIdentity, browserVerifiedRetailOffer } from "../../scripts/lib/browserRetailVerification.mjs";

const now = new Date("2026-09-05T01:00:00.000Z");
const find = {
  id: "fall",
  artist: "The Fall",
  title: "Futures And Pasts",
  sourceId: "mvd-shop",
  sourceUrl:
    "https://mvdshop.com/products/the-fall-futures-and-pasts-lp?variant=11",
  shopifyVariantId: 11,
  barcode: "760137191872",
  recordFormat: "LP",
  purchasePrice: 24.99,
  sourceCurrency: "USD",
  identityStatus: "resolved",
  physicalFormatConfirmed: true,
  sourceListingTitle: "The Fall - Futures And Pasts LP",
};
const page = {
  sourceId: find.sourceId,
  url: find.sourceUrl,
  outcome: "available",
  capturedAt: now.toISOString(),
  visibleText:
    "The Fall\nFutures And Pasts (LP)\nUPC: 760137191872\nRegular price $24.99 USD\nSale price $14.99 USD\nAdd to cart\nDescription\nVinyl edition.",
  productEvidence: {
    artist: "The Fall",
    title: "Futures And Pasts",
    format: "LP",
    price: 14.99,
    originalPrice: 24.99,
    currency: "USD",
    available: true,
    variantId: 11,
    barcode: "760137191872",
    availabilityEvidence: "Add to cart",
  },
};
const capture = (overrides: Record<string, any> = {}) => ({
  captureMethod: "visible_browser",
  pages: [{ ...page, ...overrides }],
});
const verify = (
  overrides: Record<string, any> = {},
  candidate: Record<string, any> = find,
) => browserVerifiedRetailOffer(candidate, capture(overrides), now);

const roughFind = {
  ...find,
  sourceId: "rough-trade",
  artist: "Barrie",
  title: "Barbara",
  sourceUrl: "https://www.roughtrade.com/en-us/product/barrie/barbara#56476241789259",
  shopifyVariantId: "56476241789259",
  barcode: null,
  shopifyVariantTitle: "LP - Orange | Rough Trade Exclusive | Signed",
};
const selectedText = "LP - Orange | Rough Trade Exclusive | Signed\n$24.99\n$4.99\nSigned Copy\nCustomer Limit\n2\nIn stock ready for immediate dispatch\nADD TO CART";
const roughBlock = `Barrie\nBarbara\nWinspear\nLP - Black\n$2.99\nTape\n$12.99\nCD\n$14.99\n${selectedText}`;
const roughPage = {
  sourceId: "rough-trade",
  url: roughFind.sourceUrl,
  capturedAt: now.toISOString(),
  outcome: "available",
  visibleText: `MUSIC\nCD\nPre-Order\nProduct description\nNot available to pre-order.\n${roughBlock}\nRecently viewed\nAnother Album\n$1.00\nUnited States | USD`,
  purchaseBlockText: roughBlock,
  selectedVariantEvidence: { variantId: "56476241789259", expanded: true, visibleText: selectedText },
  productEvidence: {
    artist: "Barrie", title: "Barbara", format: roughFind.shopifyVariantTitle,
    price: 4.99, originalPrice: 24.99, currency: "USD", available: true,
    variantId: "56476241789259", customerLimit: 2,
    availabilityEvidence: "In stock ready for immediate dispatch; ADD TO CART",
  },
};
const verifyRough = (overrides: Record<string, any> = {}, candidate = roughFind) =>
  browserVerifiedRetailOffer(candidate, { captureMethod: "visible_browser", pages: [{ ...roughPage, ...overrides }] }, now);

describe("Rough Trade exact selected-variant browser evidence", () => {
  it("uses the expanded LP price and stock independently of CD and cheaper LP options", () => {
    expect(verifyRough()).toMatchObject({ purchasePrice: 4.99, sourceOriginalPrice: 24.99, sourceDiscountPercent: 80,
      retailVerification: { status: "verified", customerLimit: 2 } });
    expect(verifyRough({}, { ...roughFind, shopifyVariantId: undefined } as any)).not.toBeNull();
  });
  it("rejects missing, conflicting or collapsed variant identity", () => {
    for (const overrides of [
      { url: roughFind.sourceUrl.replace(/#.*/, "?algolia_object_id=56476241789259") },
      { url: roughFind.sourceUrl.replace(/#.*/, "#999") },
      { selectedVariantEvidence: undefined },
      { selectedVariantEvidence: { ...roughPage.selectedVariantEvidence, variantId: "999" } },
      { selectedVariantEvidence: { ...roughPage.selectedVariantEvidence, expanded: false } },
      { productEvidence: { ...roughPage.productEvidence, variantId: "999" } },
    ]) expect(verifyRough(overrides)).toBeNull();
    expect(verifyRough({}, { ...roughFind, sourceUrl: roughFind.sourceUrl.replace(/#.*/, "#999") })).toBeNull();
  });
  it("requires the exact artist/album product path and panel scope", () => {
    for (const overrides of [
      { url: roughFind.sourceUrl.replace('/barrie/', '/another-artist/') },
      { url: roughFind.sourceUrl.replace('/barbara#', '/another-album#') },
      { purchaseBlockText: "Unobserved selected panel" },
      { selectedVariantEvidence: { ...roughPage.selectedVariantEvidence, visibleText: `${selectedText}\nNot present` } },
      { purchaseBlockText: roughBlock.replace('Barrie', 'Other Artist') },
    ]) expect(verifyRough(overrides)).toBeNull();
  });
  it("rejects mismatched format, another variant's price, and sold-out selected LPs", () => {
    expect(verifyRough({ productEvidence: { ...roughPage.productEvidence, format: 'LP - Black' } })).toBeNull();
    expect(verifyRough({ productEvidence: { ...roughPage.productEvidence, price: 2.99 } })).toBeNull();
    const unavailable = selectedText.replace('In stock ready for immediate dispatch\nADD TO CART', 'Sold out');
    expect(verifyRough({
      visibleText: roughPage.visibleText.replace(selectedText, unavailable),
      purchaseBlockText: roughBlock.replace(selectedText, unavailable),
      selectedVariantEvidence: { ...roughPage.selectedVariantEvidence, visibleText: unavailable },
    })).toBeNull();
    const cd = selectedText.replace(roughFind.shopifyVariantTitle, 'CD');
    expect(verifyRough({ visibleText: roughPage.visibleText.replace(selectedText, cd),
      purchaseBlockText: roughBlock.replace(selectedText, cd),
      selectedVariantEvidence: { ...roughPage.selectedVariantEvidence, visibleText: cd },
      productEvidence: { ...roughPage.productEvidence, format: 'CD' },
    })).toBeNull();
  });
});

describe("exact retail offers observed in the browser", () => {
  it("repairs pressing identity without inventing currency or a purchasable offer", () => {
    const editionText = "Limited edition translucent milk white double A-side 7” featuring the new mixes of The Beatles’ Anthology-associated hit singles:\nSide A: Free As A Bird (2025 mix)\nSide AA: Real Love (2025 mix)";
    const candidate = { ...find, sourceId: "capitol-records-store", artist: "The Beatles", title: 'Beatles - Free as a Bird/Real Love 7"',
      sourceUrl: "https://shop.capitolmusic.com/products/beatles-free-as-a-bird-real-love-7?variant=52362875044024", shopifyVariantId: "52362875044024", barcode: null,
      retailEditionText: "Unconfirmed older pressing", sourceCurrency: null, purchaseOfferVerification: "discovery_lead", costs: { inboundShipping: 5 } };
    const observed = { sourceId: candidate.sourceId, url: candidate.sourceUrl, outcome: "available", capturedAt: now.toISOString(),
      visibleText: `ARTIST:\nTHE BEATLES\nBEATLES - FREE AS A BIRD/REAL LOVE 7"\n$17.00\nShips on: November 3, 2026\nAdd to cart\nDESCRIPTION\n${editionText}`,
      productEvidence: { artist: candidate.artist, title: 'Free as a Bird/Real Love 7"', format: '7"', price: 17, currency: "USD", available: true, variantId: candidate.shopifyVariantId, editionText },
    };
    const capture = { captureMethod: "visible_browser", pages: [observed] };
    const repaired = browserObservedRetailIdentity(candidate, capture, now);
    expect(repaired).toEqual({ ...candidate, retailEditionText: editionText });
    expect(browserObservedRetailIdentity(repaired, capture, now)).toBe(repaired);
    expect(browserVerifiedRetailOffer(candidate, capture, now)).toBeNull();
    for (const patch of [
      { url: observed.url.replace("52362875044024", "999") },
      { sourceId: "another-store" },
      { url: observed.url.replace("beatles-free-as-a-bird-real-love-7", "another-record") },
      { capturedAt: "2026-09-04T18:59:59.999Z" },
      { productEvidence: { ...observed.productEvidence, artist: "Another Artist" } },
      { productEvidence: { ...observed.productEvidence, title: "Another Album" } },
      { productEvidence: { ...observed.productEvidence, editionText: undefined } },
    ]) expect(browserObservedRetailIdentity(candidate, { ...capture, pages: [{ ...observed, ...patch }] }, now)).toBe(candidate);
  });
  it("carries a selected product's observed pressing description without changing purchase checks", () => {
    const editionText = "Limited edition translucent milk white double A-side 7” featuring the new mixes of The Beatles’ Anthology-associated hit singles:\nSide A: Free As A Bird (2025 mix)\nSide AA: Real Love (2025 mix)";
    const product = {
      ...find, artist: "The Beatles", title: "Free As A Bird/Real Love", sourceId: "capitol-records",
      sourceUrl: "https://shop.capitolmusic.com/products/beatles-free-as-a-bird-real-love-7?variant=52362875044024",
      shopifyVariantId: "52362875044024", barcode: null, retailEditionText: "Older generic pressing",
    };
    const buy = 'The Beatles\nFree As A Bird/Real Love 7"\nPrice $17.00 USD\nAdd to cart';
    const observed = { sourceId: product.sourceId, url: product.sourceUrl, outcome: "available", capturedAt: now.toISOString(),
      purchaseBlockText: buy, visibleText: `${buy}\nDescription\n${editionText}\nEarlier releases were also issued on CD.\nYou may also like\nOther Product (Red Vinyl)`,
      productEvidence: { artist: product.artist, title: product.title, format: '7"', price: 17, currency: "USD", available: true, variantId: product.shopifyVariantId, editionText },
    };
    const result = browserVerifiedRetailOffer(product, { captureMethod: "visible_browser", pages: [observed] }, now);
    expect(result).toMatchObject({ retailEditionText: editionText, purchasePrice: 17, retailVerification: { status: "verified" } });
    for (const changed of [
      { productEvidence: { ...observed.productEvidence, editionText: "Invented blue pressing" } },
      { productEvidence: { ...observed.productEvidence, editionText: "Other Product (Red Vinyl)" } },
      { url: observed.url.replace("52362875044024", "999") },
      { url: observed.url.replace("beatles-free-as-a-bird-real-love-7", "another-record") },
      { productEvidence: { ...observed.productEvidence, format: "7 inch CD" } },
    ]) expect(browserVerifiedRetailOffer(product, { captureMethod: "visible_browser", pages: [{ ...observed, ...changed }] }, now)).toBeNull();
  });
  it("preserves existing edition metadata when the observation supplies none", () => {
    const candidate = { ...find, retailEditionText: "Existing exact pressing" };
    expect(verify({}, candidate)?.retailEditionText).toBe("Existing exact pressing");
    expect(verify({ productEvidence: { ...page.productEvidence, editionText: "Invented pressing" } }, candidate)).toBeNull();
  });
  it("accepts a fresh matching product, variant, displayed sale price and currency", () => {
    expect(verify()).toMatchObject({
      purchasePrice: 14.99,
      sourceCurrency: "USD",
      purchaseOfferVerification: "direct_retailer",
      retailVerification: {
        status: "verified",
        captureMethod: "visible_browser",
        checkedAt: now.toISOString(),
      },
    });
  });

  it("rejects stale, future, unavailable and non-browser observations", () => {
    for (const overrides of [
      { capturedAt: "2026-09-03T23:59:00.000Z" },
      { capturedAt: "2026-09-05T01:10:00.000Z" },
      { outcome: "blocked" },
      { productEvidence: { ...page.productEvidence, available: false } },
    ])
      expect(verify(overrides)).toBeNull();
    expect(
      browserVerifiedRetailOffer(
        find,
        { ...capture(), captureMethod: "http" },
        now,
      ),
    ).toBeNull();
  });

  it("rejects an unrelated retailer, product or artist even when the price matches", () => {
    for (const overrides of [
      { sourceId: "another-retailer" },
      {
        url: "https://other.example/products/the-fall-futures-and-pasts-lp?variant=11",
      },
      { url: "https://mvdshop.com/products/another-album?variant=11" },
      { productEvidence: { ...page.productEvidence, artist: "Another Band" } },
      { productEvidence: { ...page.productEvidence, title: "Another Album" } },
    ])
      expect(verify(overrides)).toBeNull();
  });

  it("requires visible barcode proof when an exact variant is unavailable", () => {
    const candidate = {
      ...find,
      shopifyVariantId: undefined,
      sourceUrl: "https://mvdshop.com/products/the-fall-futures-and-pasts-lp",
    };
    const observed = {
      ...page,
      url: candidate.sourceUrl,
      productEvidence: { ...page.productEvidence, variantId: undefined },
    };
    expect(verify(observed, candidate)).not.toBeNull();
    expect(
      verify(
        {
          ...observed,
          visibleText: page.visibleText.replace("UPC: 760137191872\n", ""),
        },
        candidate,
      ),
    ).toBeNull();
    expect(
      verify(
        {
          ...observed,
          visibleText: page.visibleText.replace("760137191872", "760137191873"),
        },
        candidate,
      ),
    ).toBeNull();
  });

  it("never lets a matching barcode override an explicitly different variant", () => {
    expect(
      verify({
        url: "https://mvdshop.com/products/the-fall-futures-and-pasts-lp?variant=22",
        productEvidence: { ...page.productEvidence, variantId: 22 },
      }),
    ).toBeNull();
    expect(
      verify({
        url: "https://mvdshop.com/products/the-fall-futures-and-pasts-lp?variant=22",
      }),
    ).toBeNull();
  });

  it("requires actual currency evidence and rejects a contradicted currency", () => {
    expect(
      verify({ visibleText: page.visibleText.replaceAll(" USD", "") }),
    ).toBeNull();
    expect(
      verify({ visibleText: page.visibleText.replaceAll(" USD", " CAD") }),
    ).toBeNull();
    expect(
      verify({
        visibleText: page.visibleText.replaceAll(" USD", "") + "\nCurrency USD",
        currencyEvidence: "Currency USD",
      }),
    ).not.toBeNull();
  });

  it("does not use a recommended product or shipping threshold as the purchase price", () => {
    expect(
      verify({
        visibleText:
          "The Fall\nFutures And Pasts (LP)\nPrice $24.99 USD\nAdd to cart\nYou may also like\nAnother Band\nSale price $14.99 USD\nAdd to cart",
      }),
    ).toBeNull();
    expect(
      verify({
        visibleText:
          "The Fall\nFutures And Pasts (LP)\nPrice $24.99 USD\nFree shipping over $14.99 USD\nAdd to cart",
      }),
    ).toBeNull();
    expect(
      verify({
        visibleText: page.visibleText,
        productEvidence: { ...page.productEvidence, price: 24.99 },
      }),
    ).toBeNull();
  });

  it("does not treat a savings amount or an unlabelled number as a product price", () => {
    expect(
      verify({
        visibleText:
          "The Fall\nFutures And Pasts (LP)\nPrice $29.99 USD\nSave $14.99\nAdd to cart",
      }),
    ).toBeNull();
    expect(
      verify({
        visibleText:
          "The Fall\nFutures And Pasts (LP)\nProduct SKU 14.99\nCurrency USD\nAdd to cart",
      }),
    ).toBeNull();
  });

  it("rejects CD/mixed-format captures and visible selected-format contradictions", () => {
    for (const format of ["CD", "Compact Disc", "LP / CD", "Cassette"]) {
      expect(
        verify({ productEvidence: { ...page.productEvidence, format } }),
      ).toBeNull();
    }
    expect(
      verify({
        visibleText: page.visibleText.replace("(LP)", "(Compact Disc)"),
      }),
    ).toBeNull();
  });

  it("rejects a sold-out product with add-to-cart text belonging to another page section", () => {
    expect(
      verify({
        visibleText:
          "The Fall\nFutures And Pasts (LP)\n$14.99 USD\nSold out\nYou may also like\nAnother Band Add to cart",
      }),
    ).toBeNull();
  });
});
