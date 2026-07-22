import { describe, expect, it } from "vitest";
import { extractRetailProductCards } from "../../scripts/lib/retailProductCards.mjs";

describe("retailer-neutral HTML product cards", () => {
  it("parses BigCommerce vinyl cards", () => {
    const html = `
      <li class="product" data-name="Miles Davis - Kind Of Blue (180g Vinyl 2LP)" data-id="75709">
        <article class="card" data-entity-id="75709" data-product-price="59.99">
          <h3 class="card-title">
            <a href="/music/vinyl/miles-davis-kind-of-blue/" aria-label="Miles Davis - Kind Of Blue (180g Vinyl 2LP), $59.99">
              <b>Miles Davis</b> - Kind Of Blue (180g Vinyl 2LP)
            </a>
          </h3>
          <div class="price"><span class="price">$59.99</span></div>
        </article>
      </li>
    `;

    expect(extractRetailProductCards(html, "https://www.musicdirect.com/music/vinyl/")).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.musicdirect.com/music/vinyl/miles-davis-kind-of-blue/",
        currentPrice: 59.99,
        productId: "75709",
        title: "Miles Davis - Kind Of Blue (180g Vinyl 2LP)",
      }),
    ]);
  });

  it("parses shared FieldStack-style sale cards and preserves compare-at pricing", () => {
    const html = `
      <div class="producttitlelink product-grid-variant">
        <a href="/p/38822017/czarface-czarface-meets-frankie-pulitzer" title="Czarface/Czarface Meets Frankie Pulitzer">
          <div class="product-variant-description">
            <span class="product-title">Czarface</span>
            <span class="product-artist"><br />Czarface Meets Frankie Pulitzer</span>
          </div>
          <span class="see-more-format">Vinyl LP</span>
          <div class="product-variant-price">
            <span style="display:none" itemprop="price">11.97</span>
            <span class="sale-price">$11.97</span>
            <span class="normal-price fontStrikethrough">$14.97</span>
          </div>
        </a>
      </div>
    `;

    expect(extractRetailProductCards(html, "https://www.bullmoose.com/c/695/vinyl-clearance")).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.bullmoose.com/p/38822017/czarface-czarface-meets-frankie-pulitzer",
        currentPrice: 11.97,
        productId: "38822017",
        regularPrice: 14.97,
        title: "Czarface - Czarface Meets Frankie Pulitzer (Vinyl LP)",
      }),
    ]);
  });

  it("rejects navigation links and cards without a usable price", () => {
    expect(
      extractRetailProductCards(
        '<a href="/c/695/vinyl-clearance">Vinyl Clearance</a><a href="/p/123/album">Album</a>',
        "https://store.example/",
      ),
    ).toEqual([]);
  });
});
