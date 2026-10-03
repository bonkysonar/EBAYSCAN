import { describe, expect, it } from "vitest";
import { prefetchShopifyCatalog } from "../../scripts/lib/shopifyFeedPreflight.mjs";

const source = { url: "https://shop.example/collections/vinyl" };
describe("feed-first Shopify discovery", () => {
  it("retains every configured feed page before an optional theme failure", async () => {
    const calls = [];
    const pages = await prefetchShopifyCatalog(source, async url => {
      calls.push(url);
      return { url, html: JSON.stringify({ products: Array.from({ length: calls.length === 1 ? 250 : 2 }, (_, id) => ({ id })) }) };
    });
    expect(calls).toEqual([
      "https://shop.example/collections/vinyl/products.json?limit=250&page=1",
      "https://shop.example/collections/vinyl/products.json?limit=250&page=2",
    ]);
    expect([...pages.values()].every(value => value.page && !value.error)).toBe(true);
  });
  it("stops on rate limiting instead of probing the root feed", async () => {
    let calls = 0;
    const pages = await prefetchShopifyCatalog(source, async () => {
      calls++;
      throw Object.assign(new Error("Rate limited"), { status: 429 });
    }, { includeRootCatalog: true });
    expect(calls).toBe(1);
    expect([...pages.values()][0].error.status).toBe(429);
  });
  it("never treats a malformed feed as an empty catalog", async () => {
    const pages = await prefetchShopifyCatalog(source, async () => ({ html: "{}" }));
    expect([...pages.values()][0].error.message).toContain("products array");
  });
  it("honors the page cap and skips configured non-record collections", async () => {
    let calls = 0;
    const fetchPage = async () => { calls++; return { html: JSON.stringify({ products: Array(250).fill({}) }) }; };
    await prefetchShopifyCatalog(source, fetchPage, { maxPages: 2 });
    expect(calls).toBe(2);
    await prefetchShopifyCatalog({ url: "https://shop.example/collections/cds" }, fetchPage);
    expect(calls).toBe(2);
  });
});
