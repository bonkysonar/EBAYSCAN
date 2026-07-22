import { describe, expect, it } from "vitest";
import {
  fieldstackResultsUrl,
  parseFieldstackResultTotal,
  parseFieldstackResultsPayload,
  parseFieldstackSearchConfig,
} from "../../scripts/lib/fieldstackCatalog.mjs";

describe("FieldStack catalog adapter", () => {
  it("extracts the page-provided search session without hardcoded credentials", () => {
    const html = `
      <script>
        searchFilterable.init({
          CategoryId: "44",
          AllowQParm: false,
          BaseUrl: '/c/44/featured-vinyl?',
          AppliedFilters: {},
          PageNumber: "1",
          SortType: "3",
          DisplayFilter: true,
          SearchId: 'fd321589-84ad-4e54-90a2-3f2d9c15504b',
          AllowRemoveSearchTerm: 0
        });
      </script>
    `;

    const config = parseFieldstackSearchConfig(
      html,
      "https://www.ziarecords.com/c/44/featured-vinyl",
    );
    expect(config).toMatchObject({
      allowQueryParam: false,
      categoryId: "44",
      pageNumber: 1,
      searchId: "fd321589-84ad-4e54-90a2-3f2d9c15504b",
      sortType: 3,
    });
    expect(fieldstackResultsUrl("https://www.ziarecords.com/c/44/featured-vinyl", config!, 2)).toBe(
      "https://www.ziarecords.com/gsrp/2?so=3&page=2",
    );
  });

  it("normalizes the JSON results envelope", () => {
    expect(
      parseFieldstackResultsPayload(
        JSON.stringify({
          data: {
            data: '<div class="product-list">Products</div>',
            itemcount: "<div>1-16 of 16 results</div>",
            pageNumber: "1",
            totalPages: "4",
          },
        }),
      ),
    ).toEqual({
      html: '<div class="product-list">Products</div>',
      itemCountHtml: "<div>1-16 of 16 results</div>",
      pageNumber: 1,
      totalPages: 4,
    });
  });

  it("reads the actual result total so empty sale categories do not become active alerts", () => {
    expect(parseFieldstackResultTotal("<div>1-0 of 0 results</div>")).toBe(0);
    expect(parseFieldstackResultTotal("<div>1-16 of 1,204 results</div>")).toBe(1204);
    expect(parseFieldstackResultTotal("Results unavailable")).toBeNull();
  });
});
