import { describe, expect, it } from "vitest";
import {
  extractStructuredRetailPayloads,
  parseStructuredRetailCatalog,
} from "../../scripts/lib/structuredRetailCatalog.mjs";

describe("retailer-neutral structured catalog ingestion", () => {
  it("normalizes a nested JSON-LD Product and resolves relative product assets", () => {
    const payload = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          name: "Example Records",
          url: "/about",
        },
        {
          "@type": "Product",
          gtin13: "0194398781234",
          image: { url: "/images/duran-duran-rio.jpg" },
          listPrice: "$29.99",
          name: "Duran Duran - Rio (Vinyl LP)",
          offers: {
            "@type": "Offer",
            availability: "https://schema.org/InStock",
            price: "13.00",
            priceCurrency: "USD",
          },
          sku: "RIO-LP-2026",
          url: "/products/duran-duran-rio?utm_source=newsletter",
        },
      ],
    };
    const html = `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;

    const result = parseStructuredRetailCatalog({
      html,
      pageUrl: "https://records.example/collections/sale?page=1",
    });

    expect(result.payloadCount).toBe(1);
    expect(result.items).toEqual([
      {
        available: true,
        availability: "in_stock",
        canonicalUrl: "https://records.example/products/duran-duran-rio",
        currency: "USD",
        currentPrice: 13,
        gtin: "0194398781234",
        imageUrl: "https://records.example/images/duran-duran-rio.jpg",
        productId: null,
        regularPrice: 29.99,
        sku: "RIO-LP-2026",
        sourceKinds: ["json_ld"],
        stableId: "gtin:0194398781234",
        tcin: null,
        title: "Duran Duran - Rio (Vinyl LP)",
        upc: null,
      },
    ]);
  });

  it("recurses through __NEXT_DATA__ and application JSON, then merges duplicate evidence", () => {
    const nextData = {
      props: {
        pageProps: {
          shelves: [
            {
              cards: [
                {
                  availabilityStatusV2: { value: "LIMITED_STOCK" },
                  currentPrice: { displayValue: "$12.97" },
                  image: { src: "/images/cosmos-factory.jpg" },
                  productId: "album-42",
                  productTitle: "Creedence Clearwater Revival - Cosmo's Factory Vinyl",
                  product_url: "/p/cosmos-factory?campaign=sale",
                  regular_price: "$24.99",
                },
              ],
            },
          ],
        },
      },
    };
    const applicationData = {
      results: {
        products: [
          {
            availability: "In stock",
            canonical: "/p/cosmos-factory",
            current_price: 13.49,
            name: "Creedence Clearwater Revival - Cosmo's Factory (Vinyl LP)",
            productId: "album-42",
            sku: "CCR-COSMO-LP",
            upc: "888072123456",
          },
        ],
      },
    };
    const html = [
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`,
      `<script type="application/json">${JSON.stringify(applicationData)}</script>`,
    ].join("");

    const result = parseStructuredRetailCatalog(
      html,
      "https://shop.example/collections/vinyl-sale",
    );

    expect(result.payloadCount).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      available: true,
      availability: "in_stock",
      canonicalUrl: "https://shop.example/p/cosmos-factory",
      currentPrice: 12.97,
      gtin: "888072123456",
      imageUrl: "https://shop.example/images/cosmos-factory.jpg",
      productId: "album-42",
      regularPrice: 24.99,
      sku: "CCR-COSMO-LP",
      stableId: "product:album-42",
      upc: "888072123456",
    });
    expect(result.items[0].sourceKinds).toEqual(["next_data", "application_json"]);
    expect(result.items[0].title).toContain("Vinyl LP");
  });

  it("extracts an assigned __NEXT_DATA__ object without being confused by braces in strings", () => {
    const html = `
      <script>
        window.__NEXT_DATA__ = {
          "props": {
            "pageProps": {
              "products": [{
                "title": "Jimmy Smith - {The Sermon!} Vinyl LP",
                "buy_url": "/products/jimmy-smith-sermon?gclid=tracking",
                "sku": "JIMMY-SERMON-LP",
                "upc": "602547123456",
                "price": "$14.50",
                "available": false,
                "thumbnail": {"url": "/images/jimmy-smith.jpg"}
              }]
            }
          }
        };
      </script>
    `;

    expect(extractStructuredRetailPayloads(html)).toHaveLength(1);
    const result = parseStructuredRetailCatalog(
      html,
      "https://jazz.example/collections/records",
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      available: false,
      availability: "out_of_stock",
      canonicalUrl: "https://jazz.example/products/jimmy-smith-sermon",
      currentPrice: 14.5,
      gtin: "602547123456",
      imageUrl: "https://jazz.example/images/jimmy-smith.jpg",
      sku: "JIMMY-SERMON-LP",
      upc: "602547123456",
    });
  });

  it("requires product evidence and rejects schema, navigation, and account noise", () => {
    const payload = {
      navigation: {
        items: [
          {
            currentPrice: 9.99,
            productId: "nav-1",
            title: "Featured vinyl",
            url: "/collections/vinyl",
          },
        ],
      },
      nodes: [
        {
          "@type": "Offer",
          name: "Buy now",
          price: 12.99,
          url: "/products/not-a-product-node",
        },
        {
          name: "Sign in",
          price: 10,
          productId: "account-link",
          url: "/account/login",
        },
        {
          name: "Title and URL are not enough",
          product_url: "/products/missing-commerce",
        },
        {
          name: "Title and price are not enough",
          price: 13,
        },
        {
          "@type": "Product",
          image: "/images/duke-ellington.jpg",
          name: "Duke Ellington - Ellington at Newport (Vinyl LP)",
          sku: "DUKE-NEWPORT-LP",
        },
      ],
    };
    const html = [
      '<script type="application/json">{not-valid-json}</script>',
      `<script type="application/json">${JSON.stringify(payload)}</script>`,
      '<script type="text/javascript">{"title":"Not structured data","price":1}</script>',
    ].join("");

    expect(extractStructuredRetailPayloads(html)).toHaveLength(1);
    const result = parseStructuredRetailCatalog({
      html,
      pageUrl: "https://records.example/sale",
    });

    expect(result.payloadCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      currentPrice: null,
      sku: "DUKE-NEWPORT-LP",
      stableId: "sku:duke-newport-lp",
      title: "Duke Ellington - Ellington at Newport (Vinyl LP)",
    });
  });

  it("deduplicates direct JSON through overlapping IDs and keeps the strongest fields", () => {
    const result = parseStructuredRetailCatalog(
      [
        {
          availability: "In stock",
          price: 14.99,
          product_url: "/products/dave-brubeck-time-out/",
          sku: "BRUBECK-TIME-OUT",
          title: "Dave Brubeck - Time Out",
        },
        {
          currentPrice: 13,
          productId: "record-200",
          sku: "BRUBECK-TIME-OUT",
          title: "Dave Brubeck - Time Out Vinyl LP",
        },
        {
          imageUrl: "/images/time-out.jpg",
          listPrice: 27.99,
          price: 13.5,
          productId: "record-200",
          title: "The Dave Brubeck Quartet - Time Out (Vinyl)",
          upc: "888072654321",
        },
      ],
      "https://records.example/sale",
    );

    expect(result.payloadCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      availability: "in_stock",
      canonicalUrl: "https://records.example/products/dave-brubeck-time-out/",
      currentPrice: 13,
      gtin: "888072654321",
      imageUrl: "https://records.example/images/time-out.jpg",
      productId: "record-200",
      regularPrice: 27.99,
      sku: "BRUBECK-TIME-OUT",
      stableId: "product:record-200",
      upc: "888072654321",
    });
    expect(result.items[0].title).toContain("Vinyl");
  });
});
