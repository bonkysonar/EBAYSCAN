const CATALOG_PATH =
  /\/(?:browse|c|categories?|collections?|music|records?|shop|store)(?:\/|$)/i;
const NON_CATALOG_PATH =
  /\/(?:account|artists?|blog|cart|checkout|events?|login|pages\/contact|policies|products?|search)\b/i;
const NON_TARGET_CATALOG =
  /\b(?:damaged|pre\s*owned|second\s*hand|used)\b/i;

export function discoverRetailCatalogLinks(html, pageUrl, maxLinks = 2) {
  if (!html || !pageUrl || maxLinks <= 0) return [];
  let page;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }

  const pageHost = normalizedHost(page.hostname);
  const candidates = [];
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]{0,800}?)<\/a>/gi)) {
    const href = decodeHtml(attribute(match[1], "href"));
    if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel):/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, page);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || normalizedHost(url.hostname) !== pageHost) continue;
    if (NON_CATALOG_PATH.test(url.pathname)) continue;

    const label = cleanText(stripTags(match[2]));
    const pathText = decodeURIComponentSafe(url.pathname).replace(/[-_/]+/g, " ");
    const evidence = `${label} ${pathText}`;
    if (NON_TARGET_CATALOG.test(evidence)) continue;
    const explicitVinyl = /\b(?:vinyl|lps?)\b/i.test(evidence);
    const explicitRecords = /\brecords?\b/i.test(evidence);
    if (!explicitVinyl && !explicitRecords) continue;
    if (!CATALOG_PATH.test(url.pathname) && !/\b(?:shop|browse|all)\b/i.test(label)) continue;

    url.hash = "";
    const score =
      (/\bvinyl\s+records?\b/i.test(label) ? 140 : 0) +
      (/\bvinyl\b/i.test(label) ? 100 : 0) +
      (/\bvinyl\b/i.test(pathText) ? 90 : 0) +
      (/\blps?\b/i.test(label) ? 75 : 0) +
      (/\brecords?\b/i.test(label) ? 55 : 0) +
      (CATALOG_PATH.test(url.pathname) ? 25 : 0) +
      (/\b(?:sale|clearance|deals?)\b/i.test(evidence) ? 10 : 0) -
      (url.search ? 5 : 0);
    candidates.push({ score, url: url.toString() });
  }

  const byUrl = new Map();
  for (const candidate of candidates) {
    const current = byUrl.get(candidate.url);
    if (!current || candidate.score > current.score) byUrl.set(candidate.url, candidate);
  }
  return [...byUrl.values()]
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
    .slice(0, Math.max(0, Math.floor(maxLinks)))
    .map((candidate) => candidate.url);
}

function attribute(attributes, name) {
  const match = String(attributes ?? "").match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

function cleanText(value) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizedHost(value) {
  return String(value ?? "").toLowerCase().replace(/^www\./, "");
}
