export const EBAY_RESEARCH_NEW_CONDITION_ID = "1000";
export const EBAY_RESEARCH_VINYL_CATEGORY_ID = "176985";

const QUERY_MAX_LENGTH = 180;
/**
 * Search the release using only artist and album names. Pressing identifiers
 * remain on the candidate for validating returned sales; they are not keywords.
 * Retain the array contract so saved research checkpoints remain readable.
 */
export function buildSoldResearchQueryVariants(candidate = {}) {
  const artist = normalizeResearchArtist(candidate.artist ?? "");
  const title = preferredTitle(candidate);
  const query = buildBaseResearchQuery(artist, title);
  return query ? [{ identitySignals: [], kind: "base", query }] : [];
}

export function buildSoldResearchLinks(candidate = {}, options = {}) {
  const productResearchDayRange = positiveInteger(
    options.productResearchDayRange,
    1095,
  );
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
  const dayRange = positiveInteger(options.dayRange, 1095);
  const endDate = Math.floor(Date.now() / 86400000) * 86400000;
  url.searchParams.set("dayRange", String(dayRange));
  url.searchParams.set("startDate", String(endDate - dayRange * 86400000));
  url.searchParams.set("endDate", String(endDate));
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
  const normalizedTitle = normalizeResearchTitle(
    withoutLeadingArtist(decodeEntities(String(title ?? "")), normalizedArtist),
  );
  const withoutArtist = withoutLeadingArtist(normalizedTitle, normalizedArtist);
  return truncateQuery(
    cleanResearchText(
      normalizedArtist
        ? `${normalizedArtist} ${withoutArtist}`
        : normalizedTitle,
    ),
  );
}

export function normalizeResearchArtist(rawArtist = "") {
  const raw = decodeEntities(String(rawArtist));
  if (/^\s*(?:unknown\s+artist|various(?:\s+artists?)?)\s*$/i.test(raw))
    return "";
  return cleanResearchText(
    raw
      .replace(/[|:]+/g, " ")
      .replace(
        /\b(?:official\s+store|sound\s+of\s+vinyl|def\s+jam\s+official|recordings?\s+store|music\s+store)\b/gi,
        " ",
      )
      .replace(/^\s*(?:def\s+jam|store|shop)\s*$/gi, " "),
  );
}

/** Remove merchandising suffixes while preserving words that can be album names. */
export function normalizeResearchTitle(rawTitle = "") {
  let title = decodeEntities(String(rawTitle))
    .replace(/\$\s*[0-9.,]+/g, " ")
    .replace(/\bmusic\s*(?:&|and)\s*performance\b.*$/gi, " ")
    .replace(/\bmusic\s+(?:on|from|by)\s+vinyl\b.*$/gi, " ")
    .replace(/\bwas\s*\/\s*ea\b.*$/gi, " ")
    .replace(/\bparental\s+advisory(?:\s+label)?\b/gi, " ")
    .replace(/\bfree\s+shipping\b.*$/gi, " ")
    .replace(
      /\bat\s+(?:amazon|target|walmart|urban\s+outfitters|barnes\s*&\s*noble|deep\s+discount)\b.*$/gi,
      " ",
    )
    .replace(/[[(]([^\])]+)[\])]/g, (whole, inside) =>
      /\b(?:vinyl|lps?|remaster(?:ed)?|reissue|edition|version|grams?|swirl|splatter|exclusive|variant|walmart|target)\b/i.test(
        inside,
      )
        ? " "
        : ` ${inside} `,
    )
    .replace(
      /\s+[[(](?:ltd\.?|limited|exclusive|opaque|transparent|translucent)\b[^\])]*$/i,
      " ",
    )
    .replace(/^\s*(?:limited|exclusive)\s+edition\s+/i, "")
    .replace(/\s+alternate\s+artwork\b.*$/i, " ")
    .replace(/\boriginal\s+(?:motion\s+picture\s+)?soundtrack\b/gi, " ")
    .replace(/\bmotion\s+picture\s+soundtrack\b/gi, " ")
    .replace(/\b(?:soundtrack|ost)\s*$/gi, " ");

  // Retailers separate the album from format/color/edition with a dash, colon
  // or pipe. Only discard a suffix made entirely of merchandising descriptors.
  const chunks = title.split(/\s+[-–—|]\s+|:\s+/);
  while (
    chunks.length > 1 &&
    isEditionDescription(chunks.at(-1)) &&
    (chunks.length > 2 ||
      isExplicitEditionTail(chunks.at(-1)) ||
      /^(?:r\s*&\s*b|rock|pop|country|jazz|rap|hip[-\s]?hop)\s*-*$/i.test(
        chunks.at(-1),
      ) ||
      /^(?:clear|black|white|red|blue|green|tan|pink|purple|yellow)\s+(?:7|10|12)\s*(?:[ -]?inch|["”])/i.test(
        chunks.at(-1),
      ))
  )
    chunks.pop();
  title = chunks.join(" ");

  // Without a separator require a format/edition marker before dropping a tail.
  // Ordinary title words such as New, Blue, Red, Record, Album and EP survive.
  const tokens = title.trim().split(/\s+/);
  for (let index = 0; index < tokens.length; index += 1) {
    const tail = tokens.slice(index).join(" ");
    if (
      (isExplicitEditionTail(tail) ||
        (index > 0 &&
          /^(?:baby|royal|cloudy|milky|neon|hot|light|dark|black|white|red|blue|pink|purple|orange|yellow|green|gold|silver|bone|tan|tangerine|amber|ruby|coral|brown|cream|clear|navy|teal|grey|gray|half)\b.*\b(?:vinyl|lp|inch)\b/i.test(
            tail,
          ) &&
          !/\b(?:album|record|ep|single)\b/i.test(
            tail.split(/\b(?:vinyl|lp|inch)\b/i)[0],
          ))) &&
      isEditionDescription(tail)
    ) {
      title = tokens.slice(0, index).join(" ");
      break;
    }
  }
  return cleanResearchText(
    title
      .replace(
        /\s+(?:[-–—|:]\s*)?(?:rsd|record\s+store\s+day)(?:\s+black\s+friday)?(?:\s+(?:19|20)\d{2})?\s*$/i,
        " ",
      )
      .replace(/[|:]+/g, " ")
      .replace(/\s+-\s*$/g, " "),
  );
}

const EDITION_WORDS =
  /^(?:(?:baby|royal|cloudy|ghostly|opaque|transparent|translucent|milky|neon|hot|light|dark|limited|exclusive|standard|version|deluxe|anniversary|collector'?s?|import|indie|edition|pressing|reissue|remaster(?:ed)?|heavyweight|half|speed|master(?:ed)?|black|white|red|blue|pink|purple|orange|yellow|green|gold|silver|bone|tan|tangerine|amber|ruby|coral|brown|cream|clear|navy|teal|grey|gray|beer|marble|marbled|galaxy|splatter|swirl|smoke|platinum|colour|color|colored|coloured|vinyl|lps?|ep|single|inch|in|gram(?:s)?|g|record|album|box|set|picture|disc|gatefold|soundtrack|ost|mono|stereo|new|sealed|brand|sale|clearance|preorder|pre|order|staff|pick|walmart|target|urban|outfitters|uo|r|b|rock|pop|country|jazz|rap|hip|hop|in|with|w|and|\d+(?:st|nd|rd|th|g|lp)?)|[\s/&()+.\-"”])+$/i;
function isEditionDescription(value) {
  const text = String(value ?? "").trim();
  return !text || EDITION_WORDS.test(text);
}
function isExplicitEditionTail(value) {
  return /^(?:(?:[1-9]\s*[x-]?\s*)?lps?\b|vinyl\b|box[ -]?set\b|picture\s+disc\b|(?:7|10|12)\s*(?:[ -]?inch|in\.?\b|["”])|(?:180|200)\s*(?:g|grams?)\b|(?:limited|deluxe|standard|exclusive|collector'?s?|import|indie|\d+(?:st|nd|rd|th)\s+anniversary)\s+(?:edition|version)\b|(?:limited|exclusive|opaque|transparent|translucent|heavyweight|remaster(?:ed)?|half[ -]speed)\b)/i.test(
    value,
  );
}

function preferredTitle(candidate) {
  const title = String(candidate.title ?? "").trim();
  const sourceTitle = String(candidate.sourceListingTitle ?? "").trim();
  if (normalizeResearchTitle(title)) return title;
  return sourceTitle || title;
}

function withoutLeadingArtist(title, artist) {
  if (!title || !artist) return title;
  const titleWords = title.split(/\s+/);
  const artistWords = artist.split(/\s+/);
  const prefix = titleWords.slice(0, artistWords.length).join(" ");
  return normalizeKey(prefix) === normalizeKey(artist)
    ? titleWords
        .slice(artistWords.length)
        .join(" ")
        .replace(/^\s*[-:|]\s*/, "")
        .trim()
    : title;
}

function cleanResearchText(value) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, " ")
    .replace(/[^\p{L}\p{N}&'./\s-]/gu, " ")
    .replace(/(?:\s+-)+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return cleanResearchText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function truncateQuery(query) {
  if (query.length <= QUERY_MAX_LENGTH) return query;
  return query
    .slice(0, QUERY_MAX_LENGTH)
    .replace(/\s+\S*$/, "")
    .trim();
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
