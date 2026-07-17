import { describe, expect, it } from "vitest";
import { discoverRetailPaginationLinks } from "../../scripts/lib/retailPagination.mjs";

describe("retailer-neutral pagination discovery", () => {
  it("finds forward same-category page links and decodes query strings", () => {
    const html = `
      <a href="/b/vinyl-special-offer/_/N-308r?Nrpp=40&amp;page=2">2</a>
      <a href="/b/vinyl-special-offer/_/N-308r?Nrpp=40&amp;page=3">3</a>
      <a href="/b/vinyl-special-offer/_/N-308r?Nrpp=40&amp;page=1">Previous</a>
    `;

    expect(
      discoverRetailPaginationLinks(
        html,
        "https://www.barnesandnoble.com/b/vinyl-special-offer/_/N-308r?Nrpp=40&page=1",
      ),
    ).toEqual([
      "https://www.barnesandnoble.com/b/vinyl-special-offer/_/N-308r?Nrpp=40&page=2",
      "https://www.barnesandnoble.com/b/vinyl-special-offer/_/N-308r?Nrpp=40&page=3",
    ]);
  });

  it("prioritizes rel=next and next labels", () => {
    const html = `
      <a href="?page=9">9</a>
      <a rel="next" href="?page=2">Next</a>
    `;

    expect(discoverRetailPaginationLinks(html, "https://store.example/vinyl?page=1", 1)).toEqual([
      "https://store.example/vinyl?page=2",
    ]);
  });

  it("rejects external, backward, and unrelated links", () => {
    const html = `
      <a href="https://ads.example/page=2">Next</a>
      <a href="/vinyl?page=1">Previous</a>
      <a href="/shirts?page=2">2</a>
      <a href="/account">Next</a>
      <a href="/p/38141411/some-product">Next</a>
    `;

    expect(discoverRetailPaginationLinks(html, "https://store.example/vinyl?page=3")).toEqual([]);
  });
});
