const MAX_AGE_MS = 24 * 3600000;
const normalizeHost = url => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

export function publicDiscoveryUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname) ||
        /(?:account|checkout|customer_authentication|cart|buyer_flags)/i.test(url.href)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(?:utm_.+|gclid|fbclid|srsltid)$/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return null; }
}

/** Search results are leads only. Never mint discounts, products or coverage from snippets. */
export function webSaleDiscovery(payload, sources, now = Date.now()) {
  if (!payload) return { status: "not_run", searches: [], leads: [], newRetailerLeads: [], sourceUrls: {} };
  if (payload.version !== 1 || payload.captureMethod !== "visible_browser" || !Array.isArray(payload.pages))
    throw new Error("Unsupported web discovery document");
  const sourceByHost = new Map(sources.map(source => [normalizeHost(source.url ?? source.baseUrl), source]));
  const leads = new Map(), searches = [];
  for (const page of payload.pages) {
    const age = Number(new Date(now)) - Date.parse(page.capturedAt);
    const searchUrl = publicDiscoveryUrl(page.url);
    if (!searchUrl || typeof page.query !== "string" || !Array.isArray(page.links) || !Number.isFinite(age) || age < -300000)
      throw new Error("Invalid web discovery observation");
    if (age > MAX_AGE_MS) continue;
    searches.push({ query: page.query.slice(0, 300), url: searchUrl, capturedAt: page.capturedAt, status: page.status === "access_failed" ? "access_failed" : "observed", resultCount: page.links.length });
    if (page.status === "access_failed") continue;
    for (const link of page.links.slice(0, 50)) {
      const url = publicDiscoveryUrl(link.url);
      if (!url || !link.text) continue;
      const host = normalizeHost(url);
      if (/^(?:www\.)?(?:google\.com|bing\.com|youtube\.com|instagram\.com|facebook\.com)$/.test(host)) continue;
      const source = sourceByHost.get(host);
      leads.set(url, { url, title: String(link.text).slice(0, 500), discoveryUrl: searchUrl, query: page.query.slice(0, 300), capturedAt: page.capturedAt,
        sourceId: source?.id ?? null, status: source?.resalePolicy === "prohibited" ? "policy_excluded" : source ? "retailer_verification_pending" : "new_retailer_review_required" });
    }
  }
  const sourceUrls = {};
  for (const lead of leads.values()) {
    if (lead.status !== "retailer_verification_pending" ||
        /\/(?:products?|dp|ip)\//i.test(new URL(lead.url).pathname) ||
        !/sale|clearance|sitewide|storewide|discount|blowout|offer/i.test(`${lead.url} ${lead.title}`)) continue;
    const urls = sourceUrls[lead.sourceId] ??= [];
    if (urls.length < 5) urls.push(lead.url);
  }
  return { status: searches.length ? "observed" : "stale", searches, leads: [...leads.values()],
    newRetailerLeads: [...leads.values()].filter(lead => lead.status === "new_retailer_review_required"), sourceUrls };
}
