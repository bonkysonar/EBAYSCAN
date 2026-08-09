import { describe, expect, it } from "vitest";
import {
  canonicalizeRetailDealUrl,
  extractAmazonAsin,
  extractSlickdealsDealCards,
  extractVinylPriceDropCards,
  parseOldRedditDealPage,
  parseRedditAtomFeed,
  parseVinylPriceDropDetail,
  splitDealArtistTitle,
} from "../../scripts/lib/dealSourceAdapters.mjs";

describe("deal source adapters", () => {
  it("canonicalizes supported Amazon product links to a stable ASIN URL", () => {
    expect(
      canonicalizeRetailDealUrl(
        "https://www.amazon.com/gp/product/B0170A169Q?tag=affiliate-20&utm_source=feed&psc=1",
      ),
    ).toBe("https://www.amazon.com/dp/B0170A169Q");
    expect(extractAmazonAsin("https://www.amazon.com/gp/aw/d/B0170A169Q/ref=something")).toBe(
      "B0170A169Q",
    );
    expect(extractAmazonAsin("https://a.co/d/short")).toBeNull();
  });

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

  it("parses role-labelled Slickdeals prices without treating shipping thresholds as list prices", () => {
    const html = `
      <div class="dealCardListView" data-threadid="19819023" data-store-id="1">
        <a class="dealCardListView__imageContainer" href="/f/19819023-ignore-this-image-link"></a>
        <a class="dealCardListView__title dealCardListView__title--underline"
           href="/f/19819023-helluva-boss-season-1?src=SDSearchv3&amp;attrsrc=Thread%3AExpired%3AFalse"
           title="Helluva Boss: Season 1 (Vinyl+ MP3) $9.65 + Free Shipping w/ Prime or on $35+">
          Helluva Boss: Season 1 (Vinyl+ MP3) $9.65 + Free Shipping w/ Prime or on $35+
        </a>
        <span class="dealCardListView__finalPrice" title="$9">$9</span>
        <span class="dealCardListView__listPrice" title="$13">$13</span>
        <span class="dealCardListView__savings">25% off</span>
        <span class="slickdealsTimestamp" title="Jul 28, 2026 8:08 PM">Jul 28, 2026</span>
        <div class="dealCardListView__store">Amazon</div>
      </div>
    `;

    expect(extractSlickdealsDealCards(html)).toEqual([
      {
        currentPrice: 9.65,
        detailUrl:
          "https://slickdeals.net/f/19819023-helluva-boss-season-1?src=SDSearchv3&attrsrc=Thread%3AExpired%3AFalse",
        discountPercent: 25,
        expired: false,
        originalPrice: 13,
        publishedAt: "Jul 28, 2026 8:08 PM",
        storeName: "Amazon",
        threadId: "19819023",
        title:
          "Helluva Boss: Season 1 (Vinyl+ MP3) $9.65 + Free Shipping w/ Prime or on $35+",
      },
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
    expect(
      splitDealArtistTitle(
        'Janelle Monáe "Dirty Computer" (2LP Vinyl + MP3 Album) $16.99 + Free Shipping',
      ),
    ).toEqual({
      artist: "Janelle Monáe",
      title: "Dirty Computer",
    });
  });
});
