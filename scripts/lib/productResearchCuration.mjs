import { verifiedWindowSales } from "./soldResearchWindow.mjs";
import { retailEligibility } from "./retailIdentity.mjs";
import { extractEditionIdentity } from "../../src/lib/arbitrage/activeEbayMatching.mjs";
import {
  buildEbayProductResearchUrl,
  buildEbayPublicSoldUrl,
  buildSoldResearchQueryVariants,
  normalizeResearchTitle as normalizeCanonicalResearchTitle,
} from "../../src/lib/arbitrage/soldResearchLinks.mjs";

const NON_RECORD_PATTERN =
  /\b(?:cd|compact\s+disc|cassette|dvd|blu[-\s]?ray|book|poster|shirt|t-?shirt|hoodie|sweatshirt|hat|pin|patch|sticker|slipmat|turntable|speaker|stylus|cartridge|gift\s+card|coupon|digital|download|mp3|flac|bundle|lot\s+of)\b/i;
const DAMAGED_PATTERN =
  /\b(?:damaged|opened|read\s+description|see\s+description|jacket\s+damage|sleeve\s+damage|shrink\s*wrap\s+tear|warped)\b/i;
const SIGNED_PATTERN = /\b(?:signed|autograph(?:ed)?)\b/i;
const BOX_SET_PATTERN = /\b(?:box\s*set|boxset)\b/i;
const PRODUCT_RESEARCH_PAGE_LIMIT = 50;
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
  const maxEntries = finiteOr(options.maxEntries, finds.length);
  return finds
    .filter(
      (find) =>
        retailEligibility(find).eligible &&
        find.identityStatus !== "unresolved",
    )
    .filter(isResearchableFind)
    .map((find) => {
      const variants = researchVariantDetails(find);
      return {
        artist: find.artist,
        capturedAt: find.capturedAt,
        findId: find.id,
        sourceId: find.sourceId,
        sourceListingTitle: find.sourceListingTitle,
        title: find.title,
        variants: variants.map((variant) => ({
          identitySignals: variant.identitySignals,
          kind: variant.kind,
          publicSoldUrl: buildPublicSoldSearchUrl(variant.query),
          query: variant.query,
          url: buildProductResearchUrl(variant.query),
        })),
      };
    })
    .filter((entry) => entry.variants.length > 0)
    .slice(0, maxEntries);
}

export function curateResearchForFind(find, rawResearch, now = new Date()) {
  const entries = researchEntries(rawResearch);
  const exactEntries = entries.filter((entry) =>
    isExactResearchEntry(find, entry),
  );
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
      recentEvidenceRank(evidence) > recentEvidenceRank(best) ||
      (recentEvidenceRank(evidence) === recentEvidenceRank(best) && evidence.totalSoldCount > best.totalSoldCount) ||
      (recentEvidenceRank(evidence) === recentEvidenceRank(best) && evidence.totalSoldCount === best.totalSoldCount &&
        (evidence.matchScore > best.matchScore ||
          (evidence.status === "failed" && best.status === "no_rows")))
    ) {
      best = evidence;
    }
  }

  return best;
}

export function bestEvidenceForEntry(
  find,
  entry,
  now = new Date(),
  options = {},
) {
  const variants = entry.runs.map((run) => run.query).filter(Boolean);
  const exactEntry = options.exactEntry === true;
  let best = null;

  for (const run of entry.runs) {
    const matchFind = {
      ...find,
      researchQuery: find.researchQuery || run.query,
      researchRunQuery: run.query,
    };
    const queryFailed =
      Boolean(run.error) ||
      ["failed", "unavailable", "blocked"].includes(run.status);
    const rows = (queryFailed ? [] : (run.rows ?? []))
      .map(parseProductResearchRow)
      .filter((row) => row.totalSold > 0 && row.avgSoldPrice !== null)
      .map((row) => ({
        ...row,
        matchScore: productResearchRowMatchScore(matchFind, row.title),
      }))
      .filter((row) => row.matchScore >= 0.68);

    const windowSales = exactEntry ? verifiedWindowSales(rows, run, now) : null;
    const datedSales = windowSales ?? (exactEntry ? datedSingleUnitSales(rows, run, now) : null);
    const aggregatePeriodDays =
      exactEntry && rows.length ? productResearchPeriodDays(run) : null;
    const totalSoldCount = rows.reduce((sum, row) => sum + row.totalSold, 0);
    const averageSoldPrice = weightedAverage(rows, "avgSoldPrice");
    const averageSoldShipping = weightedAverage(rows, "avgShipping");
    const latestSoldDate =
      rows
        .map((row) => row.dateLastSold)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
    const oneSellerSoldCount = rows.reduce(
      (maximum, row) => Math.max(maximum, row.totalSold),
      0,
    );
    const matchScore = rows.length
      ? (weightedAverage(rows, "matchScore") ?? 0)
      : 0;
    const evidence = {
      capturedAt: run.capturedAt ?? null,
      observedWindow: windowSales?.observedWindow ?? null,
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
      status: rows.length
        ? "validated"
        : run.error || ["failed", "unavailable", "blocked"].includes(run.status)
          ? "failed"
          : run.status === "pending"
            ? "pending"
            : "no_rows",
      totalSoldCount,
      url: run.url ?? "",
      variants,
      velocityStatus: windowSales
        ? "verified_window_totals"
        : datedSales
        ? "dated_single_unit_rows"
        : "unknown_from_aggregate_rows",
    };

    if (
      !best ||
      recentEvidenceRank(evidence) > recentEvidenceRank(best) ||
      (recentEvidenceRank(evidence) === recentEvidenceRank(best) && evidence.totalSoldCount > best.totalSoldCount) ||
      (recentEvidenceRank(evidence) === recentEvidenceRank(best) && evidence.totalSoldCount === best.totalSoldCount &&
        evidence.matchScore > best.matchScore)
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
      status: "pending",
      totalSoldCount: 0,
      url: entry.runs[0]?.url ?? "",
      variants,
      velocityStatus: "unknown_from_aggregate_rows",
    }
  );
}

export function parseProductResearchRow(row) {
  const cells = row?.cells ?? [];
  const avgPaidShipping = money(row?.avgPaidShipping ?? row?.avgShipping ?? cells[3]);
  const freeMatch = String(cells[3] ?? "").match(/(\d+(?:\.\d+)?)%\s*Free shipping/i);
  const freeShippingPercent = row?.freeShippingPercent ?? (freeMatch ? Number(freeMatch[1]) : null);
  // eBay's tooltip explicitly excludes free-shipping sales from Avg shipping.
  // Apply the displayed free-shipping share before adding shipping to proceeds.
  const avgShipping = avgPaidShipping !== null && freeShippingPercent !== null
    ? roundMoney(avgPaidShipping * (1 - Math.min(100, Math.max(0, freeShippingPercent)) / 100))
    : avgPaidShipping;
  return {
    avgPaidShipping,
    freeShippingPercent,
    avgShipping,
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
  if (
    !rowTitle ||
    NON_RECORD_PATTERN.test(rowTitle) ||
    DAMAGED_PATTERN.test(rowTitle)
  )
    return 0;

  const originalCandidateText = cleanText(
    `${find.artist ?? ""} ${find.title ?? ""} ${find.sourceListingTitle ?? ""} ${find.shopifyVariantTitle || find.variantTitle || ""}`,
  );
  if (hasIncompatibleRecordFormat(originalCandidateText, rowTitle)) return 0;
  if (hasUnconfirmedPressing(originalCandidateText, rowTitle)) return 0;
  const releaseName = `${find.artist ?? ""} ${normalizeCanonicalResearchTitle(find.title ?? "")}`;
  const candidateEdition = extractEditionIdentity(
    `${find.sourceListingTitle || releaseName} ${find.shopifyVariantTitle || find.variantTitle || ""}`, releaseName,
  );
  const rowEdition = extractEditionIdentity(rowTitle, releaseName);
  const candidateColors = candidateEdition.colors.filter((color) => color !== "black");
  const rowColors = rowEdition.colors.filter((color) => color !== "black");
  if (!rowColors.length && /\bcolou?red\s+vinyl\b/i.test(rowTitle)) return 0;
  if (candidateColors.some((color) => !rowColors.includes(color)) ||
    rowColors.some((color) => !candidateColors.includes(color))) return 0;
  const pressingSignals = new Set(["signed", "splatter", "swirl", "marbled", "etched", "glow-in-the-dark", "picture-disc", "box-set", "deluxe"]);
  if (candidateEdition.signals.some((signal) => pressingSignals.has(signal) && !rowEdition.signals.includes(signal)) ||
    rowEdition.signals.some((signal) => pressingSignals.has(signal) && !candidateEdition.signals.includes(signal))) return 0;

  const candidateText = cleanText(
    `${originalCandidateText} ${find.researchQuery ?? ""} ${find.researchRunQuery ?? ""}`,
  );
  const artistTokens = usefulTokens(meaningfulArtist(find.artist));
  const originalTitleTokens = usefulTokens(
    normalizeCanonicalResearchTitle(find.title || preferredResearchTitle(find)),
  );
  const titleTokens =
    originalTitleTokens.length > 0
      ? originalTitleTokens
      : usefulTokens(find.researchQuery || find.researchRunQuery);
  const rowTokenList = usefulTokens(rowTitle);
  const rowTokens = new Set(rowTokenList);
  if (titleTokens.length === 0) return 0;

  const titleCoverage = overlapRatio(titleTokens, rowTokens);
  const artistCoverage = artistTokens.length
    ? overlapRatio(artistTokens, rowTokens)
    : 1;
  const requiredTitleCoverage =
    titleTokens.length <= 2 ? 1 : titleTokens.length <= 4 ? 0.67 : 0.55;
  if (titleCoverage < requiredTitleCoverage) return 0;
  if (
    titleTokens.length === 2 &&
    !containsContiguousTokens(rowTokenList, titleTokens)
  )
    return 0;
  if (artistTokens.length && artistCoverage === 0 && titleTokens.length < 5)
    return 0;

  const candidateIdentity = identityTerms(candidateText, find);
  const rowIdentity = new Set(identityTerms(rowTitle, find));
  // A generic edition cannot inherit the resale price of an unconfirmed premium pressing.
  const unconfirmedEdition = [...rowIdentity].some(
    (term) =>
      !["black", "stereo", "remaster", "remastered"].includes(term) &&
      !candidateIdentity.includes(term),
  );
  if (unconfirmedEdition) return Math.min(0.66, titleCoverage);
  const identityConflict =
    candidateIdentity.length > 0 &&
    rowIdentity.size > 0 &&
    candidateIdentity.every((term) => !rowIdentity.has(term)) &&
    /\b(?:exclusive|deluxe|anniversary|mono|stereo|remaster|splatter|transparent|clear|red|blue|green|pink|yellow|white|black)\b/i.test(
      candidateText,
    );
  if (identityConflict) return 0;
  if (!SIGNED_PATTERN.test(candidateText) && SIGNED_PATTERN.test(rowTitle))
    return Math.min(0.66, titleCoverage);

  const formatBonus = /\b(?:vinyl|lp|record)\b/i.test(rowTitle) ? 0.06 : 0;
  const identityBonus = candidateIdentity.some((term) => rowIdentity.has(term))
    ? 0.06
    : 0;
  return Math.min(
    1,
    titleCoverage * 0.68 + artistCoverage * 0.2 + formatBonus + identityBonus,
  );
}

export function researchVariants(find) {
  return researchVariantDetails(find).map((variant) => variant.query);
}

export function researchCheckpointComplete(planEntry, entry) {
  const successful = new Set(
    (entry?.runs ?? [])
      .filter(
        (run) =>
          !run.error &&
          !["failed", "pending", "blocked", "unavailable"].includes(
            run.status,
          ) &&
          Array.isArray(run.rows),
      )
      .map((run) => cleanText(run.query).toLowerCase()),
  );
  return (
    planEntry.variants.length > 0 &&
    planEntry.variants.every((variant) =>
      successful.has(cleanText(variant.query).toLowerCase()),
    )
  );
}

export function buildProductResearchUrl(query) {
  return buildEbayProductResearchUrl(query);
}

export function buildPublicSoldSearchUrl(query) {
  return buildEbayPublicSoldUrl(query);
}

function researchVariantDetails(find) {
  return buildSoldResearchQueryVariants({
    artist: meaningfulArtist(find.artist),
    barcode: find.barcode,
    ebayActiveEditionIdentity: find.ebayActiveEditionIdentity,
    sourceListingTitle: find.sourceListingTitle,
    title: preferredResearchTitle(find),
  }).filter((variant) => variant.query.length >= 3);
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
  // Saved research can be reused across retail variants of the same album,
  // never merely because another album shares the artist's name.
  const key = (value) => cleanText(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
  const targetQueries = new Set(researchVariants(find).map(key));
  return [entry.key, ...entry.runs.map((run) => run.query)]
    .some((query) => targetQueries.has(key(query))) ? 1 : 0;
}

function isExactResearchEntry(find, entry) {
  return Boolean(
    find?.id && (entry.findId === find.id || entry.key === find.id),
  );
}

function isResearchableFind(find) {
  return (
    find &&
    find.opportunityType !== "sitewide_sale" &&
    Number(find.purchasePrice) > 0 &&
    cleanQuery(
      `${meaningfulArtist(find.artist)} ${normalizeResearchTitle(find.title || find.sourceListingTitle || "")}`,
    ).length >= 3
  );
}

function normalizeResearchTitle(value) {
  return cleanText(value)
    .replace(/\$\s*[0-9.,]+/g, " ")
    .replace(/\bfree\s+shipping\b.*$/gi, " ")
    .replace(
      /\bat\s+(?:amazon|target|walmart|urban\s+outfitters|barnes\s*&\s*noble|deep\s+discount)\b.*$/gi,
      " ",
    )
    .replace(
      /\b(?:music\s+(?:on|and|from|by|performance)|was\s*\/\s*ea)\b.*$/gi,
      " ",
    )
    .replace(
      /\b(?:pre[-\s]?order|sale|clearance|new|sealed|brand\s+new|staff\s+pick)\b/gi,
      " ",
    )
    .replace(
      /\b(?:vinyl|record|records|album|[1-9]?\s*[-x]?\s*lps?|ep|single)\b/gi,
      " ",
    )
    .replace(/\b(?:180g|180\s*grams?|180grams|heavyweight)\b/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[()]/g, " ");
}

function preferredResearchTitle(find) {
  const title = cleanText(find?.title);
  return normalizeCanonicalResearchTitle(title) ? title : cleanText(find?.sourceListingTitle);
}

function meaningfulArtist(value) {
  const artist = cleanQuery(value);
  if (/^(?:unknown\s+artist|various\s+artists?)$/i.test(artist)) return "";
  if (uniqueTokens(artist).length > 6) return "";
  if (/\b(?:album|motion\s+picture|soundtrack|vinyl|lp)\b/i.test(artist))
    return "";
  return artist;
}

function rowTitle(row) {
  return cleanText(
    row?.title ||
      String(row?.cells?.[0] || "")
        .split("\n")
        .filter(Boolean)
        .pop() ||
      "",
  );
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
    if (needle.every((token, offset) => haystack[index + offset] === token))
      return true;
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

function identityTerms(value, find = {}) {
  let text = cleanText(value).toLowerCase().replace(/\bblue\s+note\b/g, " ");
  for (const releasePart of [find.artist, normalizeCanonicalResearchTitle(find.title || "")]) {
    const tokens = String(releasePart || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    if (tokens.length) text = text.replace(new RegExp(`\\b${tokens.join("[^a-z0-9]+") }\\b`, "gi"), " ");
  }
  return IDENTITY_TERMS.filter((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(text),
  );
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

  if (candidateLooksLikeOrdinaryLp && rowLpCount !== null && rowLpCount > 1)
    return true;
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

function recentEvidenceRank(evidence) {
  return evidence?.sales90Days !== null && evidence?.sales90Days !== undefined &&
    ["dated_single_unit_rows", "verified_window_totals"].includes(evidence?.velocityStatus) ? 1 : 0;
}

function hasUnconfirmedPressing(candidate, row) {
  const markers = [
    /\bmusic\s+matters\b/i, /\banalogue\s+productions\b/i,
    /\b(?:mofi|mobile\s+fidelity)\b/i, /\b(?:promo|promotional)\b/i,
    /\b(?:japan|japanese|obi|hmv)\b/i, /\blenticular\b/i,
    /\b(?:orig(?:inal)?|first|1st)\s+press(?:ing)?\b/i, /\btest\s+press(?:ing)?\b/i,
    /\bpicture\s+(?:disc|vinyl)\b/i, /\bclub\s+press(?:ing)?\b/i,
    /\b(?:tone\s+poet)\b/i,
    /\bclassic\s+records\b/i, /\bhalf[-\s]?speed\b/i,
    /\b(?:anniversary|anniv|anni)\b/i,
  ];
  if (markers.some((marker) => marker.test(row) && !marker.test(candidate))) return true;
  const oldPressYear = row.match(/\b(?:19[5-9]\d)\b/g) ?? [];
  if (oldPressYear.some((year) => !candidate.includes(year)) && !/\b(?:reissue|repress|remaster(?:ed)?)\b/i.test(row)) return true;
  const series = (text) => /blue\s+note\s+essentials?/i.test(text) ? "essential" :
    /blue\s+note\s+classic/i.test(text) ? "classic" : null;
  return Boolean(series(candidate) && series(row) && series(candidate) !== series(row));
}

function datedSingleUnitSales(rows, run, now) {
  if (!rows.length || !validDate(now)) return null;
  const captured = Date.parse(run.capturedAt);
  if (run.observedWindow || run.complete !== true || run.condition !== "New" ||
    run.category !== "Vinyl Records" || !Number.isFinite(captured) ||
    captured > Number(now) + 300000 || Number(now) - captured > 7 * 86400000) return null;
  try {
    const url = new URL(run.url);
    if (url.protocol !== "https:" || url.hostname !== "www.ebay.com" || url.pathname !== "/sh/research" ||
      url.searchParams.get("categoryId") !== "176985" || url.searchParams.get("conditionId") !== "1000" ||
      url.searchParams.get("tabName") !== "SOLD") return null;
  } catch { return null; }
  const periodDays = productResearchPeriodDays(run);
  if (!periodDays) return null;
  const runRows = Array.isArray(run?.rows) ? run.rows : [];
  const pageLimit = productResearchPageLimit(run?.url);
  if (runRows.length >= pageLimit) return null;
  if (
    rows.some(
      (row) =>
        row.totalSold !== 1 ||
        !row.dateLastSold ||
        !Number.isFinite(Date.parse(row.dateLastSold)) || Date.parse(row.dateLastSold) > captured ||
        !productResearchListingIdentity(row.itemUrl),
    )
  ) {
    return null;
  }

  const identities = rows.map((row) =>
    productResearchListingIdentity(row.itemUrl),
  );
  if (new Set(identities).size !== identities.length) return null;
  const asOf = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const ages = rows.map((row) => {
    const soldAt = Date.parse(`${row.dateLastSold}T00:00:00Z`);
    return Math.floor((asOf - soldAt) / 86_400_000);
  });
  if (ages.some((age) => !Number.isFinite(age) || age < 0)) return null;

  return {
    sales30Days:
      periodDays >= 30 ? ages.filter((age) => age <= 30).length : null,
    sales90Days:
      periodDays >= 90 ? ages.filter((age) => age <= 90).length : null,
    sales365Days:
      periodDays >= 365 ? ages.filter((age) => age <= 365).length : null,
  };
}

function productResearchPageLimit(value) {
  try {
    const parsed = Number(new URL(value).searchParams.get("limit"));
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : PRODUCT_RESEARCH_PAGE_LIMIT;
  } catch {
    return PRODUCT_RESEARCH_PAGE_LIMIT;
  }
}

function productResearchPeriodDays(run) {
  const direct = Number(run?.periodDays);
  if (Number.isFinite(direct) && direct > 0) return direct;
  try {
    const params = new URL(run?.url).searchParams;
    const period =
      (Number(params.get("endDate")) - Number(params.get("startDate"))) /
      86400000;
    return Number.isFinite(period) && period > 0 ? Math.round(period) : null;
  } catch {
    return null;
  }
}

function productResearchListingIdentity(value) {
  try {
    const url = new URL(cleanText(value));
    if (url.protocol !== "https:" || !["ebay.com", "www.ebay.com"].includes(url.hostname)) return "";
    return url.pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{9,15})\/?$/)?.[1] ?? "";
  } catch { return ""; }
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
  return roundMoney(
    usable.reduce((sum, row) => sum + row[field] * row.totalSold, 0) / weight,
  );
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
  const parsed = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
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
