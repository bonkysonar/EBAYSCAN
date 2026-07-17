const NON_RECORD_PATTERN =
  /\b(?:cd|compact\s+disc|cassette|dvd|blu[-\s]?ray|book|poster|shirt|t-?shirt|hoodie|sweatshirt|hat|pin|patch|sticker|slipmat|turntable|speaker|stylus|cartridge|gift\s+card|coupon|digital|download|mp3|flac|bundle|lot\s+of)\b/i;
const DAMAGED_PATTERN =
  /\b(?:damaged|opened|read\s+description|see\s+description|jacket\s+damage|sleeve\s+damage|shrink\s*wrap\s+tear|warped)\b/i;
const SIGNED_PATTERN = /\b(?:signed|autograph(?:ed)?)\b/i;
const BOX_SET_PATTERN = /\b(?:box\s*set|boxset)\b/i;
const PRODUCT_RESEARCH_PAGE_LIMIT = 50;
const PRODUCT_RESEARCH_PERIOD_DAYS = 1095;
const TOKEN_NOISE = new Set([
  "a",
  "album",
  "an",
  "and",
  "at",
  "brand",
  "clearance",
  "colored",
  "colour",
  "edition",
  "for",
  "from",
  "gram",
  "grams",
  "limited",
  "lp",
  "new",
  "of",
  "preorder",
  "record",
  "records",
  "sale",
  "sealed",
  "soundtrack",
  "ost",
  "the",
  "vinyl",
  "with",
]);
const IDENTITY_TERMS = [
  "anniversary",
  "black",
  "blue",
  "clear",
  "deluxe",
  "exclusive",
  "gold",
  "green",
  "indie",
  "orange",
  "pink",
  "purple",
  "red",
  "remaster",
  "remastered",
  "silver",
  "splatter",
  "stereo",
  "mono",
  "transparent",
  "white",
  "yellow",
];

export function buildProductResearchPlan(finds, options = {}) {
  const maxEntries = finiteOr(options.maxEntries, 40);
  return finds
    .filter(isResearchableFind)
    .map((find) => {
      const variants = researchVariants(find);
      return {
        artist: find.artist,
        capturedAt: find.capturedAt,
        findId: find.id,
        sourceId: find.sourceId,
        sourceListingTitle: find.sourceListingTitle,
        title: find.title,
        variants: variants.map((query) => ({
          query,
          url: buildProductResearchUrl(query),
        })),
      };
    })
    .filter((entry) => entry.variants.length > 0)
    .slice(0, maxEntries);
}

export function curateResearchForFind(find, rawResearch, now = new Date()) {
  const entries = researchEntries(rawResearch);
  const exactEntries = entries.filter((entry) => isExactResearchEntry(find, entry));
  const candidates = (exactEntries.length > 0 ? exactEntries : entries)
    .map((entry) => ({
      entry,
      exactEntry: isExactResearchEntry(find, entry),
      score: exactEntries.length > 0 ? 1 : researchEntryScore(find, entry),
    }))
    .filter(({ score }) => score >= 0.58)
    .sort((left, right) => right.score - left.score);

  if (!candidates.length) {
    return {
      matchConfidence: null,
      rows: [],
      status: "pending",
      variants: researchVariants(find),
    };
  }

  let best = null;
  for (const candidate of candidates) {
    const evidence = bestEvidenceForEntry(find, candidate.entry, now, {
      exactEntry: candidate.exactEntry,
    });
    if (
      !best ||
      evidence.totalSoldCount > best.totalSoldCount ||
      (evidence.totalSoldCount === best.totalSoldCount && evidence.matchScore > best.matchScore)
    ) {
      best = evidence;
    }
  }

  return best;
}

export function bestEvidenceForEntry(find, entry, now = new Date(), options = {}) {
  const variants = entry.runs.map((run) => run.query).filter(Boolean);
  const exactEntry = options.exactEntry === true;
  let best = null;

  for (const run of entry.runs) {
    const matchFind = {
      ...find,
      researchQuery: find.researchQuery || run.query,
      researchRunQuery: run.query,
    };
    const rows = (run.rows ?? [])
      .map(parseProductResearchRow)
      .filter((row) => row.totalSold > 0 && row.avgSoldPrice !== null)
      .map((row) => ({ ...row, matchScore: productResearchRowMatchScore(matchFind, row.title) }))
      .filter((row) => row.matchScore >= 0.68);

    const datedSales = exactEntry ? datedSingleUnitSales(rows, run, now) : null;
    const aggregatePeriodDays = exactEntry && rows.length ? productResearchPeriodDays(run) : null;
    const totalSoldCount = rows.reduce((sum, row) => sum + row.totalSold, 0);
    const averageSoldPrice = weightedAverage(rows, "avgSoldPrice");
    const averageSoldShipping = weightedAverage(rows, "avgShipping");
    const latestSoldDate = rows.map((row) => row.dateLastSold).filter(Boolean).sort().at(-1) ?? null;
    const oneSellerSoldCount = rows.reduce((maximum, row) => Math.max(maximum, row.totalSold), 0);
    const matchScore = rows.length ? weightedAverage(rows, "matchScore") ?? 0 : 0;
    const evidence = {
      aggregatePeriodDays,
      aggregateUnitsSold: exactEntry && rows.length ? totalSoldCount : null,
      averageSoldPrice,
      averageSoldShipping,
      latestSoldDate,
      matchConfidence: confidenceForScore(matchScore),
      matchScore,
      oneSellerSoldCount,
      query: run.query ?? variants[0] ?? "",
      rows,
      sales30Days: datedSales?.sales30Days ?? null,
      sales90Days: datedSales?.sales90Days ?? null,
      sales365Days: datedSales?.sales365Days ?? null,
      status: rows.length ? "validated" : "no_rows",
      totalSoldCount,
      url: run.url ?? "",
      variants,
      velocityStatus: datedSales ? "dated_single_unit_rows" : "unknown_from_aggregate_rows",
    };

    if (
      !best ||
      evidence.totalSoldCount > best.totalSoldCount ||
      (evidence.totalSoldCount === best.totalSoldCount && evidence.matchScore > best.matchScore)
    ) {
      best = evidence;
    }
  }

  return (
    best ?? {
      aggregatePeriodDays: null,
      aggregateUnitsSold: null,
      averageSoldPrice: null,
      averageSoldShipping: null,
      latestSoldDate: null,
      matchConfidence: null,
      matchScore: 0,
      oneSellerSoldCount: 0,
      query: variants[0] ?? "",
      rows: [],
      sales30Days: null,
      sales90Days: null,
      sales365Days: null,
      status: "no_rows",
      totalSoldCount: 0,
      url: entry.runs[0]?.url ?? "",
      variants,
      velocityStatus: "unknown_from_aggregate_rows",
    }
  );
}

export function parseProductResearchRow(row) {
  const cells = row?.cells ?? [];
  return {
    avgShipping: money(row?.avgShipping ?? cells[3]),
    avgSoldPrice: money(row?.avgSoldPrice ?? cells[2]),
    dateLastSold: isoDate(row?.dateLastSold ?? cells[7]),
    itemUrl: cleanText(row?.itemUrl ?? row?.href ?? row?.url),
    itemSales: money(row?.itemSales ?? cells[5]),
    title: rowTitle(row),
    totalSold: wholeNumber(row?.totalSold ?? cells[4]),
  };
}

export function productResearchRowMatchScore(find, rowTitleValue) {
  const rowTitle = cleanText(rowTitleValue);
  if (!rowTitle || NON_RECORD_PATTERN.test(rowTitle) || DAMAGED_PATTERN.test(rowTitle)) return 0;

  const originalCandidateText = cleanText(
    `${find.artist ?? ""} ${find.title ?? ""} ${find.sourceListingTitle ?? ""}`,
  );
  if (hasIncompatibleRecordFormat(originalCandidateText, rowTitle)) return 0;

  const candidateText = cleanText(
    `${originalCandidateText} ${find.researchQuery ?? ""} ${find.researchRunQuery ?? ""}`,
  );
  const artistTokens = usefulTokens(meaningfulArtist(find.artist));
  const originalTitleTokens = usefulTokens(normalizeResearchTitle(preferredResearchTitle(find)));
  const titleTokens =
    originalTitleTokens.length > 0
      ? originalTitleTokens
      : usefulTokens(find.researchQuery || find.researchRunQuery);
  const rowTokenList = usefulTokens(rowTitle);
  const rowTokens = new Set(rowTokenList);
  if (titleTokens.length === 0) return 0;

  const titleCoverage = overlapRatio(titleTokens, rowTokens);
  const artistCoverage = artistTokens.length ? overlapRatio(artistTokens, rowTokens) : 1;
  const requiredTitleCoverage = titleTokens.length <= 2 ? 1 : titleTokens.length <= 4 ? 0.67 : 0.55;
  if (titleCoverage < requiredTitleCoverage) return 0;
  if (titleTokens.length === 2 && !containsContiguousTokens(rowTokenList, titleTokens)) return 0;
  if (artistTokens.length && artistCoverage === 0 && titleTokens.length < 5) return 0;

  const candidateIdentity = identityTerms(candidateText);
  const rowIdentity = new Set(identityTerms(rowTitle));
  const identityConflict =
    candidateIdentity.length > 0 &&
    rowIdentity.size > 0 &&
    candidateIdentity.every((term) => !rowIdentity.has(term)) &&
    /\b(?:exclusive|deluxe|anniversary|mono|stereo|remaster|splatter|transparent|clear|red|blue|green|pink|yellow|white|black)\b/i.test(
      candidateText,
    );
  if (identityConflict) return 0;
  if (!SIGNED_PATTERN.test(candidateText) && SIGNED_PATTERN.test(rowTitle)) return Math.min(0.66, titleCoverage);

  const formatBonus = /\b(?:vinyl|lp|record)\b/i.test(rowTitle) ? 0.06 : 0;
  const identityBonus = candidateIdentity.some((term) => rowIdentity.has(term)) ? 0.06 : 0;
  return Math.min(1, titleCoverage * 0.68 + artistCoverage * 0.2 + formatBonus + identityBonus);
}

export function researchVariants(find) {
  const artist = meaningfulArtist(find.artist);
  const normalizedTitle = normalizeResearchTitle(preferredResearchTitle(find));
  const titleWithoutArtist = withoutLeadingArtist(normalizedTitle, artist);
  const primaryTitle =
    artist && uniqueTokens(titleWithoutArtist).length === 0 ? "self titled" : titleWithoutArtist;
  const primary = cleanQuery(`${artist} ${primaryTitle}`);
  const variants = new Set([primary]);
  const raw = `${find.title ?? ""} ${find.sourceListingTitle ?? ""}`;
  const sourceOnly = cleanQuery(normalizeResearchTitle(find.sourceListingTitle || find.title || ""));

  if (sourceOnly && artist && overlapRatio(uniqueTokens(artist), new Set(uniqueTokens(sourceOnly))) < 1) {
    variants.add(sourceOnly);
  }

  if (/\b(?:soundtrack|ost|motion\s+picture)\b/i.test(raw)) {
    const core = cleanQuery(
      `${artist} ${withoutLeadingArtist(normalizedTitle, artist).replace(/\b(?:soundtrack|ost)\b/gi, " ")}`,
    );
    if (core) {
      variants.add(core);
      variants.add(cleanQuery(`${core} Soundtrack`));
      variants.add(cleanQuery(`${core} OST`));
    }
  }

  return [...variants].filter((query) => query.length >= 3);
}

export function buildProductResearchUrl(query) {
  const url = new URL("https://www.ebay.com/sh/research");
  url.searchParams.set("marketplace", "EBAY-US");
  url.searchParams.set("keywords", query);
  url.searchParams.set("dayRange", "1095");
  url.searchParams.set("categoryId", "176985");
  url.searchParams.set("conditionId", "1000");
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "50");
  url.searchParams.set("sorting", "-itemssold");
  url.searchParams.set("tabName", "SOLD");
  url.searchParams.set("tz", "America/Los_Angeles");
  return url.toString();
}

function researchEntries(rawResearch) {
  if (Array.isArray(rawResearch?.entries)) {
    return rawResearch.entries.map((entry) => ({
      findId: entry.findId ?? null,
      key: entry.key ?? entry.findId ?? "",
      runs: entry.runs ?? entry.variants ?? [],
      title: entry.title ?? "",
    }));
  }

  return Object.entries(rawResearch ?? {}).map(([key, runs]) => ({
    findId: null,
    key,
    runs: Array.isArray(runs) ? runs : [],
    title: "",
  }));
}

function researchEntryScore(find, entry) {
  if (isExactResearchEntry(find, entry)) return 1;

  const targetTokens = uniqueTokens(
    `${meaningfulArtist(find.artist)} ${find.title ?? ""} ${find.sourceListingTitle ?? ""}`,
  );
  const titleTokens = uniqueTokens(
    `${meaningfulArtist(find.artist)} ${normalizeResearchTitle(preferredResearchTitle(find))}`,
  );
  if (!targetTokens.length || !titleTokens.length) return 0;
  const entryText = [entry.key, entry.title, ...entry.runs.map((run) => run.query)].join(" ");
  const entryTokenList = uniqueTokens(entryText);
  const entryTokens = new Set(entryTokenList);
  const targetTokenSet = new Set(targetTokens);
  const titleCoverage = overlapRatio(titleTokens, entryTokens);
  const entryCoverage = overlapRatio(entryTokenList, targetTokenSet);
  const harmonicCoverage =
    titleCoverage + entryCoverage > 0
      ? (2 * titleCoverage * entryCoverage) / (titleCoverage + entryCoverage)
      : 0;

  if (entryTokenList.length >= 2 && entryCoverage === 1) return Math.max(0.92, titleCoverage);
  return Math.max(titleCoverage, entryCoverage * 0.9, harmonicCoverage);
}

function isExactResearchEntry(find, entry) {
  return Boolean(find?.id && (entry.findId === find.id || entry.key === find.id));
}

function isResearchableFind(find) {
  return (
    find &&
    find.opportunityType !== "sitewide_sale" &&
    Number(find.purchasePrice) > 0 &&
    cleanQuery(`${meaningfulArtist(find.artist)} ${normalizeResearchTitle(find.title || find.sourceListingTitle || "")}`).length >= 3
  );
}

function normalizeResearchTitle(value) {
  return cleanText(value)
    .replace(/\$\s*[0-9.,]+/g, " ")
    .replace(/\bfree\s+shipping\b.*$/gi, " ")
    .replace(/\bat\s+(?:amazon|target|walmart|urban\s+outfitters|barnes\s*&\s*noble|deep\s+discount)\b.*$/gi, " ")
    .replace(/\b(?:music\s+(?:on|and|from|by|performance)|was\s*\/\s*ea)\b.*$/gi, " ")
    .replace(/\b(?:pre[-\s]?order|sale|clearance|new|sealed|brand\s+new|staff\s+pick)\b/gi, " ")
    .replace(/\b(?:vinyl|record|records|album|[2-4]?\s*[-x]?\s*lps?|ep|single)\b/gi, " ")
    .replace(/\b(?:180g|180\s*grams?|180grams|heavyweight)\b/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[()]/g, " ");
}

function preferredResearchTitle(find) {
  const title = cleanText(find?.title);
  const listing = cleanText(find?.sourceListingTitle);
  if (!listing) return title;
  if (!title) return listing;
  return usefulTokens(listing).length > usefulTokens(title).length ? listing : title;
}

function meaningfulArtist(value) {
  const artist = cleanQuery(value);
  if (/^(?:unknown\s+artist|various\s+artists?)$/i.test(artist)) return "";
  if (uniqueTokens(artist).length > 6) return "";
  if (/\b(?:album|motion\s+picture|soundtrack|vinyl|lp)\b/i.test(artist)) return "";
  return artist;
}

function rowTitle(row) {
  return cleanText(row?.title || String(row?.cells?.[0] || "").split("\n").filter(Boolean).pop() || "");
}

function usefulTokens(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !TOKEN_NOISE.has(token));
}

function uniqueTokens(value) {
  return [...new Set(usefulTokens(value))];
}

function containsContiguousTokens(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((token, offset) => haystack[index + offset] === token)) return true;
  }
  return false;
}

function withoutLeadingArtist(value, artist) {
  const title = cleanText(value);
  if (!artist) return title;
  const normalizedTitle = cleanText(title).toLowerCase();
  const normalizedArtist = cleanText(artist).toLowerCase();
  if (!normalizedTitle.startsWith(normalizedArtist)) return title;
  return title.slice(artist.length).replace(/^[\s:–—-]+/, "");
}

function identityTerms(value) {
  const text = cleanText(value).toLowerCase();
  return IDENTITY_TERMS.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(text));
}

function hasIncompatibleRecordFormat(candidateText, rowTitle) {
  const candidateIsBoxSet = BOX_SET_PATTERN.test(candidateText);
  const rowIsBoxSet = BOX_SET_PATTERN.test(rowTitle);
  if (!candidateIsBoxSet && rowIsBoxSet) return true;

  const candidateLpCount = explicitLpCount(candidateText);
  const rowLpCount = explicitLpCount(rowTitle);
  const candidateLooksLikeOrdinaryLp =
    candidateLpCount === null &&
    /\b(?:vinyl\s+)?lp\b/i.test(candidateText) &&
    !candidateIsBoxSet;

  if (candidateLooksLikeOrdinaryLp && rowLpCount !== null && rowLpCount > 1) return true;
  return (
    candidateLpCount !== null &&
    rowLpCount !== null &&
    candidateLpCount !== rowLpCount
  );
}

function explicitLpCount(value) {
  const text = cleanText(value);
  const numeric = text.match(/\b([1-9])\s*(?:x|-)?\s*lp\b|\b([1-9])lp\b/i);
  if (numeric) return Number(numeric[1] ?? numeric[2]);
  if (/\bdouble\s+lp\b/i.test(text)) return 2;
  if (/\btriple\s+lp\b/i.test(text)) return 3;
  return null;
}

function datedSingleUnitSales(rows, run, now) {
  if (!rows.length || !validDate(now)) return null;
  const runRows = Array.isArray(run?.rows) ? run.rows : [];
  const pageLimit = productResearchPageLimit(run?.url);
  if (runRows.length >= pageLimit) return null;
  if (
    rows.some(
      (row) =>
        row.totalSold !== 1 ||
        !row.dateLastSold ||
        !productResearchListingIdentity(row.itemUrl),
    )
  ) {
    return null;
  }

  const identities = rows.map((row) => productResearchListingIdentity(row.itemUrl));
  if (new Set(identities).size !== identities.length) return null;
  const asOf = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ages = rows.map((row) => {
    const soldAt = Date.parse(`${row.dateLastSold}T00:00:00Z`);
    return Math.floor((asOf - soldAt) / 86_400_000);
  });
  if (ages.some((age) => !Number.isFinite(age) || age < 0)) return null;

  return {
    sales30Days: ages.filter((age) => age <= 30).length,
    sales90Days: ages.filter((age) => age <= 90).length,
    sales365Days: ages.filter((age) => age <= 365).length,
  };
}

function productResearchPageLimit(value) {
  try {
    const parsed = Number(new URL(value).searchParams.get("limit"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : PRODUCT_RESEARCH_PAGE_LIMIT;
  } catch {
    return PRODUCT_RESEARCH_PAGE_LIMIT;
  }
}

function productResearchPeriodDays(run) {
  const direct = Number(run?.periodDays ?? run?.dayRange);
  if (Number.isFinite(direct) && direct > 0) return direct;
  try {
    const parsed = Number(new URL(run?.url).searchParams.get("dayRange"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : PRODUCT_RESEARCH_PERIOD_DAYS;
  } catch {
    return PRODUCT_RESEARCH_PERIOD_DAYS;
  }
}

function productResearchListingIdentity(value) {
  const text = cleanText(value);
  if (!text) return "";
  const itemId = text.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})(?:[/?#]|$)/i)?.[1];
  return itemId || text;
}

function validDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function overlapRatio(tokens, tokenSet) {
  if (!tokens.length) return 0;
  return tokens.filter((token) => tokenSet.has(token)).length / tokens.length;
}

function weightedAverage(rows, field) {
  const usable = rows.filter((row) => Number.isFinite(row[field]));
  const weight = usable.reduce((sum, row) => sum + row.totalSold, 0);
  if (!weight) return null;
  return roundMoney(usable.reduce((sum, row) => sum + row[field] * row.totalSold, 0) / weight);
}

function confidenceForScore(score) {
  if (score >= 0.88) return "high";
  if (score >= 0.76) return "medium";
  if (score > 0) return "low";
  return null;
}

function money(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value ?? "").match(/\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function wholeNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function isoDate(value) {
  if (!value) return null;
  const direct = new Date(String(value));
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);
  return null;
}

function cleanQuery(value) {
  return cleanText(value)
    .replace(/[\u2013\u2014]|[â€“â€”]/g, " ")
    .replace(/[^A-Za-z0-9&'./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
