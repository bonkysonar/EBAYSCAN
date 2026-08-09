export const EBAY_RESEARCH_NEW_CONDITION_ID = "1000";
export const EBAY_RESEARCH_VINYL_CATEGORY_ID = "176985";

const QUERY_MAX_LENGTH = 180;
const VALID_BARCODE_LENGTHS = new Set([8, 12, 13, 14]);
const COLOR_TERMS = [
  "black",
  "blue",
  "clear",
  "gold",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "white",
  "yellow",
];

/**
 * Build a deterministic research ladder without navigating to or reading eBay.
 * Exact edition variants lead, a trustworthy barcode is next, and the broad
 * artist/title release query is always retained as the last fallback.
 */
export function buildSoldResearchQueryVariants(candidate = {}) {
  const artist = normalizeResearchArtist(candidate.artist ?? "");
  const rawTitle = preferredTitle(candidate);
  const baseTitle = normalizedCandidateTitle(rawTitle, candidate.sourceListingTitle ?? "", artist);
  const baseQuery = cleanResearchText(
    artist && !startsWithSameWords(baseTitle, artist) ? `${artist} ${baseTitle}` : baseTitle || artist,
  );
  const variants = [];
  const exactSignals = editionSignals(candidate, `${candidate.title ?? ""} ${candidate.sourceListingTitle ?? ""}`);

  for (const signalSet of exactSignalVariants(exactSignals)) {
    const exactQuery = truncateQuery(cleanResearchText(`${baseQuery} ${signalSet.join(" ")}`));
    if (exactQuery && normalizeKey(exactQuery) !== normalizeKey(baseQuery)) {
      variants.push({
        identitySignals: signalSet,
        kind: "exact",
        query: exactQuery,
      });
    }
  }

  const barcode = validBarcode(candidate.barcode);
  if (barcode) {
    variants.push({ identitySignals: [barcode], kind: "barcode", query: barcode });
  }

  if (baseQuery) {
    variants.push({ identitySignals: [], kind: "base", query: truncateQuery(baseQuery) });
  }

  return dedupeVariants(variants);
}

export function buildSoldResearchLinks(candidate = {}, options = {}) {
  const productResearchDayRange = positiveInteger(options.productResearchDayRange, 1095);
  const publicWindowDays = positiveInteger(options.publicWindowDays, 90);
  return buildSoldResearchQueryVariants(candidate).map((variant) => ({
    ...variant,
    productResearchUrl: buildEbayProductResearchUrl(variant.query, {
      dayRange: productResearchDayRange,
      timeZone: options.timeZone,
    }),
    productWindowDays: productResearchDayRange,
    publicSoldUrl: buildEbayPublicSoldUrl(variant.query),
    publicWindowDays,
  }));
}

export function buildEbayProductResearchUrl(query, options = {}) {
  const url = new URL("https://www.ebay.com/sh/research");
  url.searchParams.set("marketplace", "EBAY-US");
  url.searchParams.set("keywords", truncateQuery(cleanResearchText(query)));
  url.searchParams.set("dayRange", String(positiveInteger(options.dayRange, 1095)));
  url.searchParams.set("categoryId", EBAY_RESEARCH_VINYL_CATEGORY_ID);
  url.searchParams.set("conditionId", EBAY_RESEARCH_NEW_CONDITION_ID);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "50");
  url.searchParams.set("sorting", "-itemssold");
  url.searchParams.set("tabName", "SOLD");
  url.searchParams.set("tz", options.timeZone || "America/Los_Angeles");
  return url.toString();
}

export function buildEbayPublicSoldUrl(query) {
  const url = new URL("https://www.ebay.com/sch/i.html");
  url.searchParams.set("_nkw", truncateQuery(cleanResearchText(query)));
  url.searchParams.set("_sacat", EBAY_RESEARCH_VINYL_CATEGORY_ID);
  url.searchParams.set("LH_Complete", "1");
  url.searchParams.set("LH_Sold", "1");
  url.searchParams.set("LH_ItemCondition", EBAY_RESEARCH_NEW_CONDITION_ID);
  return url.toString();
}

export function buildBaseResearchQuery(artist, title) {
  const normalizedArtist = normalizeResearchArtist(artist);
  const normalizedTitle = normalizeResearchTitle(title);
  const titleWithoutArtist = withoutLeadingArtist(normalizedTitle, normalizedArtist);
  const usefulTitle = titleWithoutArtist || (normalizedArtist && normalizeKey(normalizedTitle) === normalizeKey(normalizedArtist)
    ? "self titled"
    : normalizedTitle);
  return truncateQuery(
    cleanResearchText(
      normalizedArtist && !startsWithSameWords(usefulTitle, normalizedArtist)
        ? `${normalizedArtist} ${usefulTitle}`
        : usefulTitle || normalizedArtist,
    ),
  );
}

export function normalizeResearchArtist(rawArtist = "") {
  const raw = decodeEntities(String(rawArtist));
  if (/^\s*(?:unknown\s+artist|various(?:\s+artists?)?)\s*$/i.test(raw)) return "";
  return cleanResearchText(
    raw
      .replace(/[|:]+/g, " ")
      .replace(/\b(?:official\s+store|sound\s+of\s+vinyl|def\s+jam\s+official|recordings?\s+store|music\s+store)\b/gi, " ")
      .replace(/^\s*(?:def\s+jam|store|shop)\s*$/gi, " "),
  );
}

/** Base release title only. Edition terms are recovered separately for exact queries. */
export function normalizeResearchTitle(rawTitle = "") {
  let title = decodeEntities(String(rawTitle))
    .replace(/\$\s*[0-9.,]+/g, " ")
    .replace(/\bmusic\s*(?:&|and)\s*performance\b.*$/gi, " ")
    .replace(/\bmusic\s+(?:on|from|by)\s+vinyl\b.*$/gi, " ")
    .replace(/\bwas\s*\/\s*ea\b.*$/gi, " ")
    .replace(/\bparental\s+advisory(?:\s+label)?\b/gi, " ")
    .replace(/\bfree\s+shipping\b.*$/gi, " ")
    .replace(/\bat\s+(?:amazon|target|walmart|urban\s+outfitters|barnes\s*&\s*noble|deep\s+discount)\b.*$/gi, " ")
    .replace(/\s+-\s+(?:(?:opaque|transparent|translucent)\s+)?(?:black|blue|clear|gold|green|orange|pink|purple|red|silver|white|yellow)\s*$/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*(?:vinyl|lp|record|edition|exclusive|color|colour|soundtrack|remaster|sale|deal)[^)]*\)/gi, " ")
    .replace(/\boriginal\s+(?:motion\s+picture\s+)?soundtrack\b/gi, " ")
    .replace(/\bmotion\s+picture\s+soundtrack\b/gi, " ")
    .replace(/\b(?:soundtrack|ost)\b/gi, " ")
    .replace(/\b(?:limited|deluxe|anniversary|collector'?s?|exclusive|import|indie|target|walmart|urban\s+outfitters|uo)\s+edition\b/gi, " ")
    .replace(/\b(?:limited|deluxe|anniversary|collector'?s?|exclusive|import|indie|target|walmart|urban\s+outfitters|uo)\b/gi, " ")
    .replace(/\b(?:(?:opaque|transparent|translucent)\s+)?(?:colored|colour|color|clear|red|blue|green|yellow|pink|purple|orange|white|black|gold|silver|splatter|swirl|marbled)\s+vinyl\b/gi, " ")
    .replace(/\b(?:vinyl|record|records|album|(?:[1-9]\s*(?:x|-)?)?\s*lps?|ep|single)\b/gi, " ")
    .replace(/\b(?:180\s*(?:g|grams?)|heavyweight|remaster(?:ed)?|half[-\s]?speed\s+master(?:ed)?)\b/gi, " ")
    .replace(/\b(?:pre[-\s]?order|sale|clearance|new|sealed|brand\s+new|staff\s+pick)\b/gi, " ")
    .replace(/\s+-\s+(?:r\s*&\s*b|rock|pop|country|jazz|rap|hip[-\s]?hop)(?:\s+-\s*)*$/gi, " ")
    .replace(/[()]/g, " ")
    .replace(/[|:]+/g, " ")
    .replace(/\s+-\s+/g, " ");

  return cleanResearchText(title);
}

function preferredTitle(candidate) {
  const title = String(candidate.title ?? "").trim();
  const sourceTitle = String(candidate.sourceListingTitle ?? "").trim();
  if (normalizeResearchTitle(title)) return title;
  return sourceTitle || title;
}

function normalizedCandidateTitle(title, sourceTitle, artist) {
  let normalized = normalizeResearchTitle(title);
  if (!normalized || normalizeKey(withoutLeadingArtist(normalized, artist)) === "") {
    normalized = normalizeResearchTitle(sourceTitle);
  }
  const withoutArtist = withoutLeadingArtist(normalized, artist);
  if (withoutArtist) return withoutArtist;
  if (artist && normalized && normalizeKey(normalized) === normalizeKey(artist)) return "self titled";
  return normalized;
}

function editionSignals(candidate, rawText) {
  const identity = candidate.ebayActiveEditionIdentity ?? {};
  const signals = [];
  const raw = decodeEntities(String(rawText));

  for (const color of Array.isArray(identity.colors) ? identity.colors : []) {
    const normalized = cleanResearchText(color).toLowerCase();
    if (COLOR_TERMS.includes(normalized)) signals.push(normalized);
  }

  const structuredFormat = cleanResearchText(identity.format ?? "");
  if (structuredFormat) signals.push(structuredFormat);
  const formatMatch = raw.match(/\b([2-9])\s*(?:x|-)?\s*lp\b/i);
  if (formatMatch) signals.push(`${formatMatch[1]}LP`);

  const structuredRetailer = cleanResearchText(identity.retailerExclusive ?? "");
  const retailerMatch = raw.match(/\b(walmart|target|urban\s+outfitters|uo|indie)\b.{0,24}\bexclusive\b/i);
  const retailer = structuredRetailer || cleanResearchText(retailerMatch?.[1] ?? "");
  if (retailer) signals.push(retailer.toLowerCase(), "exclusive");

  for (const signal of Array.isArray(identity.signals) ? identity.signals : []) {
    const normalized = normalizeEditionSignal(signal);
    if (normalized) signals.push(normalized);
  }

  const anniversary = raw.match(/\b((?:\d{1,3})(?:st|nd|rd|th)\s+anniversary)\b/i);
  if (anniversary) signals.push(cleanResearchText(anniversary[1]).toLowerCase());
  if (/\bdeluxe\b/i.test(raw)) signals.push("deluxe");
  if (/\bhalf[-\s]?speed\b/i.test(raw)) signals.push("half speed");
  if (/\b180\s*(?:g|grams?)\b/i.test(raw)) signals.push("180g");
  if (/\bmono\b/i.test(raw)) signals.push("mono");
  if (/\bstereo\b/i.test(raw)) signals.push("stereo");
  if (/\bremaster(?:ed)?\b/i.test(raw)) {
    const remasterYear = raw.match(/\b((?:19|20)\d{2})\b.{0,18}\bremaster(?:ed)?\b/i)?.[1];
    if (remasterYear) signals.push(remasterYear);
    signals.push("remastered");
  }

  const rawColor = raw.match(
    new RegExp(`\\b(?:opaque|transparent|translucent)?\\s*(${COLOR_TERMS.join("|")})\\b.{0,18}\\bvinyl\\b`, "i"),
  );
  if (rawColor) signals.push(rawColor[1].toLowerCase());
  const rawPattern = raw.match(/\b(splatter|marbled|swirl|picture\s+disc)\b.{0,18}\bvinyl\b/i);
  if (rawPattern) signals.push(rawPattern[1].toLowerCase());
  if (/\b(?:soundtrack|original\s+motion\s+picture|\bost\b)/i.test(raw)) signals.push("soundtrack");

  return uniqueSignals(signals);
}

function exactSignalVariants(signals) {
  if (!signals.length) return [];
  if (!signals.includes("soundtrack")) return [signals];
  const withoutSoundtrack = signals.filter((signal) => signal !== "soundtrack");
  return [[...withoutSoundtrack, "Soundtrack"], [...withoutSoundtrack, "OST"]];
}

function normalizeEditionSignal(signal) {
  const normalized = cleanResearchText(signal).toLowerCase();
  if (/^remaster(?:ed)?$/.test(normalized)) return "remastered";
  if (/^(?:deluxe|mono|stereo|splatter|transparent|translucent|marbled|swirl)$/.test(normalized)) return normalized;
  if (/^\d{1,3}(?:st|nd|rd|th) anniversary$/.test(normalized)) return normalized;
  return "";
}

function validBarcode(value) {
  const barcode = String(value ?? "").replace(/[\s-]/g, "");
  return /^\d+$/.test(barcode) && VALID_BARCODE_LENGTHS.has(barcode.length) ? barcode : "";
}

function withoutLeadingArtist(title, artist) {
  if (!title || !artist) return title;
  const titleWords = title.split(/\s+/);
  const artistWords = artist.split(/\s+/);
  const prefix = titleWords.slice(0, artistWords.length).join(" ");
  return normalizeKey(prefix) === normalizeKey(artist)
    ? cleanResearchText(titleWords.slice(artistWords.length).join(" "))
    : title;
}

function startsWithSameWords(value, prefix) {
  if (!value || !prefix) return false;
  return value.toLowerCase().split(/\s+/).slice(0, 4).join(" ") === prefix.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
}

function dedupeVariants(variants) {
  const seen = new Set();
  return variants.filter((variant) => {
    const key = normalizeKey(variant.query);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueSignals(signals) {
  const seen = new Set();
  return signals.filter((signal) => {
    const cleaned = cleanResearchText(signal);
    const key = normalizeKey(cleaned);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanResearchText(value) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, " ")
    .replace(/[^A-Za-z0-9&'./\s-]/g, " ")
    .replace(/(?:\s+-)+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return cleanResearchText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function truncateQuery(query) {
  if (query.length <= QUERY_MAX_LENGTH) return query;
  return query.slice(0, QUERY_MAX_LENGTH).replace(/\s+\S*$/, "").trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}
