import { describe, it, expect } from "vitest";
import { validatedCheckoutQuote, checkoutBasketScenario } from "../lib/arbitrage/checkoutBasket.mjs";
import { evaluateOpportunity } from "../lib/arbitrage/evaluateOpportunity.mjs";

const now = "2026-10-01T18:00:00Z";
const url = "https://retailer.test/products/album?variant=123";
const quote = () => ({ captureMethod:"visible_browser", capturedAt:now, productUrl:url, variantId:"123", currency:"USD",
  quantity:2, unitPrice:18, subtotal:36, shipping:11, tax:2.61, total:49.61,
  productTitle:"Artist Album", variantTitle:"Red", productLineText:"Quantity\n2\nArtist Album\nRed\n2\n$36.00",
  costSummaryText:"Subtotal $36.00\nShipping $11.00\nEstimated taxes $2.61\nTotal USD $49.61" });
const product = { url, variantId:"123", currency:"USD", price:18, visibleText:"Artist Album Red Vinyl LP $18.00 Add to cart" };
const find = () => ({ id:"basket", artist:"Artist", title:"Album", sourceId:"retailer", sourceName:"Retailer", sourceUrl:url,
  sourceListingTitle:product.visibleText, shopifyVariantTitle:"Red LP", shopifyVariantId:"123", sourceCurrency:"USD", sourceCountry:"US",
  purchasePrice:18, available:true, identityStatus:"resolved", physicalFormatConfirmed:true, condition:"new/sealed", capturedAt:now,
  purchaseOfferVerification:"direct_retailer", requiresRetailVerification:true, retailVerification:{status:"verified"}, checkoutQuote:quote() });

describe("verified combined checkout shipping", () => {
  it("allocates shipping conservatively and preserves the tax setting", () => {
    const f=find(), scored=evaluateOpportunity(f, {}, now);
    expect(checkoutBasketScenario(f, now)).toMatchObject({quantity:2, perRecordShipping:5.5, observedTotal:49.61});
    expect(scored.costLedger).toMatchObject({inboundShipping:5.5, salesTax:1.71, landedCost:25.21});
    expect(scored.verifiedCheckoutBasket.modeledCashRequired).toBe(50.42);
    expect(scored.gates.purchaseOffer).toBe(true);
    expect(scored.gates.soldEvidence).toBe(false);
    expect(scored.decision).not.toBe("BUY");
    const odd={...f,checkoutQuote:{...quote(),shipping:10.99,total:49.60,costSummaryText:"Subtotal $36.00 Shipping $10.99 Estimated tax $2.61 Total USD $49.60"}};
    expect(checkoutBasketScenario(odd, now).perRecordShipping).toBe(5.5);
  });
  it.each([
    q=>({...q,quantity:3}),q=>({...q,variantId:"456"}),q=>({...q,unitPrice:17}),q=>({...q,total:40}),
    q=>({...q,productUrl:url.replace("retailer.test","other.test")}),q=>({...q,capturedAt:"2026-10-01T11:59:59Z"}),
    q=>({...q,currency:"CAD"}),q=>({...q,costSummaryText:"Free shipping"}),q=>({...q,productLineText:"Quantity 1 Artist Album Red $36.00"}),
  ])("rejects inconsistent, unrelated or expired quotes", change=>expect(validatedCheckoutQuote(change(quote()),product,now)).toBeNull());
  it("requires stock and rechecks freshness at scoring time", () => {
    expect(checkoutBasketScenario({...find(),quantityAvailable:1},now)).toBeNull();
    expect(checkoutBasketScenario({...find(),retailVerification:{status:"verified",customerLimit:1}},now)).toBeNull();
    const stale=evaluateOpportunity(find(),{},"2026-10-02T01:00:00Z");
    expect(stale.verifiedCheckoutBasket).toBeNull();
    expect(stale.gates.purchaseOffer).toBe(false);
    expect(stale.costLedger.inboundShipping).toBe(5);
  });
  it("whitelists cost evidence without retaining account or checkout metadata",()=>{
    const result=validatedCheckoutQuote({...quote(),address:"private",checkoutUrl:"private",account:"private"},product,now);
    expect(result).toEqual(quote());
  });
});
