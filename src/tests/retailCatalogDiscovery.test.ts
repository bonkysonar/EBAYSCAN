import { describe, expect, it } from "vitest";
import { discoverRetailCatalogLinks } from "../../scripts/lib/retailCatalogDiscovery.mjs";

describe("retailer catalog recovery", () => {
  it("finds same-store vinyl categories while ignoring products, accounts, and external links", () => {
    const html = `
      <a href="/collections/new-vinyl">Shop Vinyl Records</a>
      <a href="/music/vinyl">Vinyl</a>
      <a href="/products/album">Vinyl LP product</a>
      <a href="/collections/used-lps">Used LPs</a>
      <a href="/collections/pre-owned-vinyl">Pre-Owned Vinyl</a>
      <a href="/account">Vinyl account</a>
      <a href="https://other.example/collections/vinyl">External vinyl</a>
    `;

    expect(discoverRetailCatalogLinks(html, "https://shop.example/", 2)).toEqual([
      "https://shop.example/collections/new-vinyl",
      "https://shop.example/music/vinyl",
    ]);
  });

  it("does not turn broad music or unrelated navigation into a catalog recovery target", () => {
    expect(
      discoverRetailCatalogLinks(
        '<a href="/music">Music</a><a href="/pages/about">About our record store</a>',
        "https://shop.example/",
      ),
    ).toEqual([]);
  });
});
