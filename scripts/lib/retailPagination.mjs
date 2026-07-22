const PAGE_PARAM_NAMES = new Set(["page", "p", "pg", "pagenumber", "offset", "start"]);
const NEXT_TEXT = /^(?:next|next page|older|more results|[>\u203a\u00bb\u2192]+)$/i;
const PREVIOUS_TEXT = /^(?:back|newer|prev(?:ious)?|previous page|[<\u2039\u00ab\u2190]+)$/i;

export function discoverRetailPaginationLinks(html, pageUrl, limit = 5) {
  let currentUrl;
  try {
    currentUrl = new URL(pageUrl);
  } catch {
    return [];
  }

  const scored = new Map();
  const anchors = String(html ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const anchor of anchors) {
    const attributes = anchor[1] ?? "";
    const href = readAttribute(attributes, "href");
    if (!href) continue;

    let candidate;
    try {
      candidate = new URL(decodeHtml(href), currentUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/i.test(candidate.protocol) || candidate.origin !== currentUrl.origin) continue;
    candidate.hash = "";
    if (candidate.href === currentUrl.href) continue;

    const text = cleanText(stripTags(anchor[2]));
    const rel = cleanText(readAttribute(attributes, "rel")).toLowerCase();
    const ariaLabel = cleanText(readAttribute(attributes, "aria-label"));
    const title = cleanText(readAttribute(attributes, "title"));
    const label = cleanText(`${text} ${ariaLabel} ${title}`);
    if (PREVIOUS_TEXT.test(label)) continue;

    const samePath = normalizePath(candidate.pathname) === normalizePath(currentUrl.pathname);
    const pageSignal = pageParameterSignal(currentUrl, candidate);
    const pathSignal = pathPageSignal(currentUrl, candidate);
    const explicitlyNext = rel.split(/\s+/).includes("next") || NEXT_TEXT.test(label);
    if (!explicitlyNext && !pageSignal && !pathSignal) continue;
    if (!samePath && !pathSignal) continue;

    let score = 0;
    if (rel.split(/\s+/).includes("next")) score += 100;
    if (NEXT_TEXT.test(label)) score += 80;
    if (samePath) score += 30;
    if (pageSignal) score += 25;
    if (pathSignal) score += 20;
    const current = scored.get(candidate.href);
    if (!current || score > current.score) {
      scored.set(candidate.href, {
        pageNumber: pageSignal?.target ?? pathSignal?.target ?? Number.POSITIVE_INFINITY,
        score,
        url: candidate.href,
      });
    }
  }

  return [...scored.values()]
    .sort((left, right) => right.score - left.score || left.pageNumber - right.pageNumber || left.url.localeCompare(right.url))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.url);
}

function pageParameterSignal(currentUrl, candidate) {
  for (const name of PAGE_PARAM_NAMES) {
    if (!candidate.searchParams.has(name)) continue;
    const target = Number(candidate.searchParams.get(name));
    if (!Number.isFinite(target) || target < 0) continue;
    const current = Number(currentUrl.searchParams.get(name));
    if (Number.isFinite(current) && target <= current) continue;
    if (!Number.isFinite(current) && name !== "offset" && name !== "start" && target < 2) continue;
    if (!Number.isFinite(current) && (name === "offset" || name === "start") && target <= 0) continue;
    return { name, target };
  }
  return null;
}

function pathPageSignal(currentUrl, candidate) {
  const target = pageNumberFromPath(candidate.pathname);
  if (target === null) return null;
  const current = pageNumberFromPath(currentUrl.pathname) ?? 1;
  return target > current ? { target } : null;
}

function pageNumberFromPath(pathname) {
  const match = String(pathname).match(/(?:^|\/)page[-_/]?(\d+)(?:\/|$)/i);
  return match ? Number(match[1]) : null;
}

function normalizePath(value) {
  return String(value ?? "").replace(/\/+$/, "") || "/";
}

function readAttribute(attributes, name) {
  const match = String(attributes).match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ");
}

function cleanText(value) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&nbsp;|&#160;/gi, " ");
}
