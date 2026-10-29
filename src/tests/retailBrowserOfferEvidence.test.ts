import { describe, expect, it } from "vitest";
import { retailerProductIdentity, validateRetailerOfferPage, verifyRetailerBrowserOffer, retailerBrowserOfferIsCurrent } from "../../scripts/lib/retailBrowserOfferEvidence.mjs";
import { validateBrowserRetailObservations, browserProductCandidates, browserSourceDiagnostics, browserObservationPage } from "../../scripts/lib/browserRetailObservations.mjs";
import { browserVerifiedRetailOffer } from "../../scripts/lib/browserRetailVerification.mjs";

const now = "2026-10-29T13:30:00.000Z";
const block = "Buy New\n$14.63\nIn Stock\nAdd to cart\nShipper / Seller\nAmazon.com\nFREE delivery Tomorrow, October 30.";
const page: any = {
  sourceId: "reddit-vinyl-deals", url: "https://www.amazon.com/dp/B0GFF1JP2X", capturedAt: now, outcome: "available",
  productHeadingText: "A Pound of Feathers (Amazon Exclusive)", artistText: "Black Crowes Format: Vinyl",
  visibleText: `A Pound of Feathers (Amazon Exclusive)\nBlack Crowes Format: Vinyl\nAmazon Exclusive Edition\nColor vinyl\n${block}\nUsed - Very Good $13.39`,
  purchaseBlockText: block,
  productEvidence: { artist: "The Black Crowes", title: "A Pound of Feathers", format: "Vinyl", price: 14.63, currency: "USD", available: true },
  retailerOfferEvidence: { retailerId: "amazon", productId: "B0GFF1JP2X", selectedFormat: true, selectedFormatText: "Black Crowes Format: Vinyl", editionText: "Amazon Exclusive Edition\nColor vinyl", condition: "new", conditionText: "Buy New", priceText: "$14.63", availabilityText: "In Stock", purchaseActionText: "Add to cart", sellerText: "Shipper / Seller\nAmazon.com", fulfillerText: "Shipper / Seller\nAmazon.com" },
};
const find: any = { id: "feed-offer", sourceId: page.sourceId, sourceUrl: page.url, artist: "The Black Crowes", title: "A Pound of Feathers", purchasePrice: 16.99, sourceCurrency: "USD", condition: "new/sealed", purchaseOfferVerification: "discovery_lead", amazonAsin: "B0GFF1JP2X" };
const sources = [{ id: page.sourceId, name: "Reddit VinylDeals", url: "https://www.reddit.com/r/VinylDeals/", group: "Discovery sources" }];
const doc = (value = page) => ({ version: 1, captureMethod: "visible_browser", pages: [value] });
const copy = () => structuredClone(page);

describe("exact retailer offers observed after feed discovery", () => {
  it("verifies the selected New Amazon offer with normal outside-box byline/format and combined seller label", () => {
    const verified: any = verifyRetailerBrowserOffer(find, page, now);
    expect(verified).toMatchObject({ sourceId: find.sourceId, purchasePrice: 14.63, sourceCurrency: "USD", condition: "new/sealed", retailObservationMethod: "visible_browser_retailer_offer", purchaseOfferVerification: "direct_retailer", retailVerification: { status: "verified", productId: "B0GFF1JP2X" } });
    expect(verified.costs.inboundShipping).toBeUndefined();
    expect(verified.retailerOfferObservation.visibleText).not.toContain("Used - Very Good");
    expect(retailerBrowserOfferIsCurrent(verified, now)).toBe(true);
    expect(browserVerifiedRetailOffer(find, doc(), new Date(now))?.purchasePrice).toBe(14.63);
  });
  it("admits exact evidence without creating aggregator products or catalog coverage", () => {
    const accepted = validateBrowserRetailObservations(doc(), sources, now);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].retailerOfferEvidence.productId).toBe("B0GFF1JP2X");
    expect(browserProductCandidates(accepted, sources[0], () => "synthetic")).toEqual([]);
    expect(browserSourceDiagnostics(accepted, find.sourceId)).toEqual({});
    expect(() => browserObservationPage(accepted[0])).toThrow(/not a source catalog/);
    expect(() => validateBrowserRetailObservations(doc({ ...page, sourceId: "amazon" }), sources, now)).toThrow(/Unknown source/);
  });
  it("requires a current exact URL and rejects seller/condition overrides or another country", () => {
    expect(retailerProductIdentity("https://amazon.com/example/dp/B0GFF1JP2X?tag=tracking")).toMatchObject({ productId: "B0GFF1JP2X" });
    expect(retailerProductIdentity("https://www.target.com/p/album/-/A-90706313")).toMatchObject({ retailerId: "target", productId: "90706313" });
    expect(retailerProductIdentity("https://www.target.com/p/album/-/A-90706313?preselect=90706313&TCID=tracking#details")?.canonicalUrl).toBe("https://www.target.com/p/album/-/A-90706313");
    expect(retailerProductIdentity("https://www.target.com/p/album/-/A-90706313?preselect=12345678")).toBeNull();
    expect(retailerProductIdentity("https://www.walmart.com/ip/album/12345678")).toMatchObject({ retailerId: "walmart", productId: "12345678" });
    for (const url of ["https://amazon.co.uk/dp/B0GFF1JP2X", "https://amazon.com.evil.example/dp/B0GFF1JP2X", `${page.url}?smid=another`, `${page.url}?condition=used`, "https://amazon.com/gp/aw/d/B0GFF1JP2X", "https://amazon.com/s?k=vinyl"]) expect(retailerProductIdentity(url)).toBeNull();
    for (const candidate of [{ ...find, sourceUrl: "https://www.amazon.com/dp/B000ABCDEF" }, { ...find, amazonAsin: "B000ABCDEF" }, { ...find, sourceId: "target" }, { ...find, artist: "Other Artist" }, { ...find, title: "Other Album" }]) expect(verifyRetailerBrowserOffer(candidate, page, now)).toBeNull();
  });
  it("limits both intake and curator to six hours and rejects future captures", () => {
    for (const capturedAt of ["2026-10-29T07:29:59.999Z", "2026-10-29T13:35:00.001Z", "invalid"]) {
      expect(validateRetailerOfferPage({ ...page, capturedAt }, now)).toBeNull();
      expect(browserVerifiedRetailOffer(find, doc({ ...page, capturedAt }), new Date(now))).toBeNull();
    }
    expect(validateRetailerOfferPage({ ...page, capturedAt: "2026-10-29T07:30:00.000Z" }, now)).not.toBeNull();
  });
  it("accepts explicitly verified Target and Walmart first-party offers", () => {
    for (const [retailerId, productId, url, seller] of [
      ["target", "90706313", "https://www.target.com/p/album/-/A-90706313", "Target"],
      ["walmart", "12345678", "https://www.walmart.com/ip/album/12345678", "Walmart.com"],
    ]) {
      const observed = copy(); observed.url = url;
      observed.purchaseBlockText = block.replaceAll("Shipper / Seller\nAmazon.com", `Sold and shipped by ${seller}`);
      observed.visibleText = observed.visibleText.replace(block, observed.purchaseBlockText);
      Object.assign(observed.retailerOfferEvidence, { retailerId, productId, sellerText: `Sold and shipped by ${seller}`, fulfillerText: `Sold and shipped by ${seller}` });
      const candidate = { ...find, sourceUrl: url, amazonAsin: undefined };
      expect(verifyRetailerBrowserOffer(candidate, observed, now)?.purchaseRetailerDomain).toBe(`${retailerId}.com`);
      expect(verifyRetailerBrowserOffer(candidate, { ...observed, retailerOfferEvidence: { ...observed.retailerOfferEvidence, sellerText: undefined } }, now)).toBeNull();
    }
  });
  it("fails closed on missing selected format/new condition/seller, used or unavailable offers", () => {
    for (const field of ["selectedFormat", "selectedFormatText", "condition", "conditionText", "sellerText", "fulfillerText", "availabilityText", "purchaseActionText", "priceText"]) {
      const invalid = copy(); delete invalid.retailerOfferEvidence[field];
      expect(validateRetailerOfferPage(invalid, now), field).toBeNull();
    }
    for (const suffix of ["\nUsed - Very Good", "\nSold Out", "\nPre-order", "\nCurrently unavailable", "\nNot in stock", "\nNot available"]) {
      const invalid = copy(); invalid.purchaseBlockText += suffix; invalid.visibleText += `\n${invalid.purchaseBlockText}`;
      expect(validateRetailerOfferPage(invalid, now)).toBeNull();
    }
    const thirdParty = copy(); thirdParty.purchaseBlockText = thirdParty.purchaseBlockText.replaceAll("Amazon.com", "OtherSeller"); thirdParty.visibleText = thirdParty.purchaseBlockText;
    thirdParty.retailerOfferEvidence.sellerText = "Shipper / Seller\nOtherSeller";
    expect(validateRetailerOfferPage(thirdParty, now)).toBeNull();
  });
  it("does not borrow another format, used sibling price, savings or foreign currency", () => {
    const wrongPrice = copy(); wrongPrice.productEvidence.price = 13.39; wrongPrice.retailerOfferEvidence.priceText = "$13.39";
    expect(validateRetailerOfferPage(wrongPrice, now)).toBeNull();
    const cd = copy(); cd.productEvidence.format = "CD";
    expect(validateRetailerOfferPage(cd, now)).toBeNull();
    const partialTitle = copy(); partialTitle.productEvidence.title = "A Pound";
    expect(validateRetailerOfferPage(partialTitle, now)).toBeNull();
    const partialArtist = copy(); partialArtist.productEvidence.artist = "Black";
    expect(validateRetailerOfferPage(partialArtist, now)).toBeNull();
    for (const text of ["Save $14.63", "$114.63", "$14.630", "CA$14.63", "$14.63 CAD", "From $14.63"]) {
      const invalid = copy(); invalid.purchaseBlockText = block.replace("$14.63", text); invalid.visibleText = invalid.visibleText.replace(block, invalid.purchaseBlockText); invalid.retailerOfferEvidence.priceText = text;
      expect(validateRetailerOfferPage(invalid, now), text).toBeNull();
    }
  });
  it("does not strip conditional prices or personal delivery data into trusted public evidence", () => {
    for (const suffix of ["Prime exclusive price", "Apply coupon for price", "Member price", "With code SAVE"]) {
      const invalid = copy(); invalid.purchaseBlockText += `\n${suffix}`; invalid.visibleText += `\n${invalid.purchaseBlockText}`;
      expect(validateRetailerOfferPage(invalid, now), suffix).toBeNull();
    }
    const personal = copy(); personal.retailerOfferEvidence.availabilityText = "In Stock - Deliver to Example 90210";
    personal.purchaseBlockText += `\n${personal.retailerOfferEvidence.availabilityText}`; personal.visibleText += `\n${personal.purchaseBlockText}`;
    expect(validateRetailerOfferPage(personal, now)).toBeNull();
    const verified: any = verifyRetailerBrowserOffer(find, page, now);
    expect(retailerBrowserOfferIsCurrent({ ...verified, retailerOfferObservation: { ...verified.retailerOfferObservation, rawAccountText: "not product evidence" } }, now)).toBe(false);
  });
  it("keeps shipping unknown unless this selected offer visibly quotes an unconditional amount", () => {
    const staleCost = { ...find, costs: { inboundShipping: 0 }, checkoutQuote: { arbitrary: true }, shippingOffer: { arbitrary: true } };
    const unknown: any = verifyRetailerBrowserOffer(staleCost, page, now);
    expect(unknown.costs.inboundShipping).toBeUndefined(); expect(unknown.checkoutQuote).toBeUndefined(); expect(unknown.shippingOffer).toBeUndefined();
    const free = copy(); free.retailerOfferEvidence.shippingEvidence = { amount: 0, currency: "USD", visibleText: "FREE delivery Tomorrow, October 30." };
    expect(verifyRetailerBrowserOffer(find, free, now)?.costs.inboundShipping).toBe(0);
    for (const visibleText of ["Free shipping over $35", "Free shipping with Prime", "FREE delivery on orders $35", "FREE shipping on orders of $35", "Not eligible for free shipping", "No free shipping", "Free shipping at least $35"]) {
      const conditional = copy(); conditional.purchaseBlockText += `\n${visibleText}`; conditional.visibleText += `\n${conditional.purchaseBlockText}`;
      conditional.retailerOfferEvidence.shippingEvidence = { amount: 0, currency: "USD", visibleText };
      expect(validateRetailerOfferPage(conditional, now)).toBeNull();
    }
  });
  it("joins an observed followed discussion link but never an unrelated source page", () => {
    const linked = { ...page, sourceId: "slickdeals-vinyl-records", discoveryLinkEvidence: { sourceUrl: "https://slickdeals.net/f/12345678-record", linkUrl: "https://slickdeals.net/?adid=123", resolvedUrl: page.url, capturedAt: now, linkText: "See Deal", visibleText: "See Deal" } };
    const candidate = { ...find, sourceId: linked.sourceId, sourceUrl: linked.discoveryLinkEvidence.sourceUrl, amazonAsin: undefined };
    const verified: any = verifyRetailerBrowserOffer(candidate, linked, now);
    expect(verified?.sourceUrl).toBe(page.url); expect(verified?.discoveryUrl).toBe(candidate.sourceUrl);
    expect(retailerBrowserOfferIsCurrent(verified, now)).toBe(true);
    expect(verifyRetailerBrowserOffer({ ...candidate, sourceUrl: "https://slickdeals.net/f/99999999-other" }, linked, now)).toBeNull();
    expect(verifyRetailerBrowserOffer(candidate, { ...linked, discoveryLinkEvidence: undefined }, now)).toBeNull();
  });
  it("detects changed published fields instead of trusting a verified flag", () => {
    const verified: any = verifyRetailerBrowserOffer(find, page, now);
    for (const patch of [{ purchasePrice: 1 }, { sourceUrl: "https://www.amazon.com/dp/B000ABCDEF" }, { sourceCurrency: "CAD" }, { condition: "used" }, { available: false }, { physicalFormatConfirmed: false }, { costs: { inboundShipping: 0 } }, { retailObservationMethod: "visible_browser" }, { retailObservedAt: "2026-10-29T13:31:00.000Z" }, { retailerSellerName: "Other Seller" }]) expect(retailerBrowserOfferIsCurrent({ ...verified, ...patch }, now)).toBe(false);
  });
  it("resolves only a missing artist from the observed byline of the exact direct product", () => {
    const observed = copy();
    observed.artistText = "Various Artists Format: Vinyl";
    observed.visibleText = observed.visibleText.replaceAll("Black Crowes Format: Vinyl", observed.artistText);
    observed.productEvidence.artist = "Various Artists";
    observed.retailerOfferEvidence.selectedFormatText = observed.artistText;
    for (const artist of ["Unknown Artist", "", undefined]) {
      const result: any = verifyRetailerBrowserOffer({ ...find, artist }, observed, now);
      expect(result).toMatchObject({ artist: "Various Artists", identityStatus: "resolved", identitySource: "browser_product" });
      expect(retailerBrowserOfferIsCurrent(result, now)).toBe(true);
    }
    for (const candidate of [
      { ...find, artist: "Known Other Artist" },
      { ...find, artist: "Unknown Artist", sourceUrl: "https://www.amazon.com/dp/B000ABCDEF" },
      { ...find, artist: "Unknown Artist", title: "Different Album" },
    ]) expect(verifyRetailerBrowserOffer(candidate, observed, now)).toBeNull();
    const discussion = "https://www.reddit.com/r/VinylDeals/comments/abc123/record/";
    const followed = { ...observed, discoveryLinkEvidence: { sourceUrl: discussion, linkUrl: page.url, resolvedUrl: page.url, capturedAt: now, linkText: "Amazon", visibleText: "Amazon" } };
    expect(verifyRetailerBrowserOffer({ ...find, artist: "Unknown Artist", sourceUrl: discussion }, followed, now)).toBeNull();
  });
});
