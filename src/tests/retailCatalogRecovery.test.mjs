import { describe, expect, it } from "vitest";
import { discoverRetailCatalogLinks, isMissingRetailPage } from "../../scripts/lib/retailCatalogDiscovery.mjs";

describe("catalog recovery from retired URLs", () => {
  it("recognizes an explicit soft 404 rather than calling it a healthy empty catalog", () => {
    expect(isMissingRetailPage('<h1>Page Not Found</h1><p>Sorry, the page does not exist. Try the home page.</p>')).toBe(true);
    expect(isMissingRetailPage('<h1>Album Store</h1><a href="/products/404">Page Not Found LP</a><p>$20</p>')).toBe(false);
  });
  it("follows observed mixed-format catalog navigation and rejects account/external links", () => {
    expect(discoverRetailCatalogLinks('<a href="/vinyl-cd">Music</a><a href="/account/vinyl">Vinyl</a><a href="https://other.example/vinyl">Vinyl</a>', 'https://bleep.com/')).toEqual(['https://bleep.com/vinyl-cd']);
  });
});
