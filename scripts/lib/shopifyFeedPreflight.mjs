import { selectShopifyCollectionLanes, shopifyCatalogUrls } from "./shopifyCatalog.mjs";

/** Read the configured public product feed before optional HTML discovery.
 * A theme-page failure must not discard products already returned by the feed.
 * fetchPage owns pacing and access-failure cooldowns; never bypass those here.
 */
export async function prefetchShopifyCatalog(source, fetchPage, {
  collectionLimit = 6, maxPages = 10, rootMaxPages = 2, includeRootCatalog = false,
} = {}) {
  const selection = selectShopifyCollectionLanes([], source.url, collectionLimit);
  const descriptors = selection.selected.flatMap(({ url }) =>
    shopifyCatalogUrls({ url }, 1, 250, { includeRootCatalog: false }));
  if (includeRootCatalog || (!descriptors.length && !selection.configuredExcluded)) {
    descriptors.push(...shopifyCatalogUrls({ url: new URL(source.url).origin }, 1)
      .filter(page => page.collectionContext === null));
  }
  const pages = new Map();
  for (const descriptor of descriptors) {
    const limit = descriptor.collectionContext ? maxPages : rootMaxPages;
    for (let number = 1; number <= limit; number++) {
      const url = new URL(descriptor.url);
      url.searchParams.set("page", String(number));
      try {
        const page = await fetchPage(url.href, { headers: { accept: "application/json" } });
        const data = JSON.parse(page.html);
        if (!Array.isArray(data.products)) throw new Error("Product feed did not return a products array");
        pages.set(url.href, { page });
        if (data.products.length < 250) break;
      } catch (error) {
        pages.set(url.href, { error });
        // Access failures stop all configured feed work, not only this lane.
        if ([403, 429].includes(error.status) || error.failureKind === "blocked") return pages;
        break;
      }
    }
  }
  return pages;
}
