import { describe, expect, it } from "vitest";
import {
  extractVinylPriceDropCards,
  parseOldRedditDealPage,
  parseRedditAtomFeed,
  parseVinylPriceDropDetail,
  splitDealArtistTitle,
} from "../../scripts/lib/dealSourceAdapters.mjs";

describe("deal source adapters", () => {
  it("parses Reddit Atom entries and prefers a direct retailer URL", () => {
    const feed = `
      <feed>
        <entry>
          <title>[Amazon] Artist &amp; Friend - Great Album [2xLP] @ $15.45</title>
          <link href="https://www.reddit.com/r/VinylDeals/comments/abc/example/" />
          <updated>2026-07-13T14:26:13+00:00</updated>
          <content type="html">&lt;p&gt;&lt;a href=&quot;https://dealsonvinyl.com/asin/ABC&quot;&gt;helper&lt;/a&gt;&lt;a href=&quot;https://www.amazon.com/dp/ABC&quot;&gt;direct&lt;/a&gt;&lt;/p&gt;</content>
        </entry>
        <entry>
          <title>[Store] Expired Album - $12.00</title>
          <category term="EXPIRED" />
          <content type="html">expired</content>
        </entry>
      </feed>
    `;

    expect(parseRedditAtomFeed(feed)).toEqual([
      {
        directUrl: "https://www.amazon.com/dp/ABC",
        discussionUrl: "https://www.reddit.com/r/VinylDeals/comments/abc/example/",
        expired: false,
        price: 15.45,
        publishedAt: "2026-07-13T14:26:13+00:00",
        title: "[Amazon] Artist & Friend - Great Album [2xLP] @ $15.45",
      },
      {
        directUrl: null,
        discussionUrl: null,
        expired: true,
        price: 12,
        publishedAt: null,
        title: "[Store] Expired Album - $12.00",
      },
    ]);
  });

  it("falls back to old Reddit title links", () => {
    const html = `<a class="title may-blank outbound" href="https://record-store.example/products/album">[Store] Artist - Album - $14.99</a>`;
    expect(parseOldRedditDealPage(html)).toEqual([
      {
        directUrl: "https://record-store.example/products/album",
        discussionUrl: null,
        expired: false,
        price: 14.99,
        publishedAt: null,
        title: "[Store] Artist - Album - $14.99",
      },
    ]);
  });

  it("extracts Vinyl Price Drop cards without navigation links", () => {
    const html = `
      <a href="/deals/type/sitewide">Sitewide Deals</a>
      <a href="/deals/album-artist" class="card"><div><h2 class="title">Artist – Album (2xLP)</h2></div></a>
    `;
    expect(extractVinylPriceDropCards(html)).toEqual([
      { detailUrl: "https://vinylpricedrop.com/deals/album-artist", title: "Artist – Album (2xLP)" },
    ]);
  });

  it("parses current and original prices from a Vinyl Price Drop detail page", () => {
    const html = `
      <h1><a href="/artists/artist">Artist</a> – <a href="https://www.amazon.com/dp/ABC?tag=affiliate-20&amp;utm_source=feed">Album [2xLP]</a> Label</h1>
      <a href="https://www.amazon.com/dp/ABC">$15.00 $25.00</a>
      <h2>Price history</h2>
      <span>$10.00</span>
    `;
    expect(parseVinylPriceDropDetail(html, "https://vinylpricedrop.com/deals/album-artist", "Artist – Album (2xLP)")).toEqual({
      currentPrice: 15,
      detailUrl: "https://vinylpricedrop.com/deals/album-artist",
      directUrl: "https://www.amazon.com/dp/ABC",
      discountPercent: 40,
      expired: false,
      originalPrice: 25,
      title: "Artist – Album (2xLP)",
    });
  });

  it("marks expired sitewide details and normalizes artist/title", () => {
    const html = `<h1><a href="https://store.example/sale">Store Extra 40% Off Vinyl</a></h1><p>Drop expired!</p>`;
    expect(parseVinylPriceDropDetail(html, "https://vinylpricedrop.com/deals/store-sale", "Store Extra 40% Off Vinyl").expired).toBe(true);
    expect(splitDealArtistTitle("[Amazon] [Regional] Artist - Album [2xLP] @ $19.99")).toEqual({
      artist: "Artist",
      title: "Album [2xLP]",
    });
  });
});
