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
  if (!query) return [];
  const variants = [{ identitySignals: [], kind: "base", query }];
  // Sellers often name only the A-side of a single. Collect that search too;
  // the original release and pressing still govern sale matching.
  const sides = title.split(/\s+b\s*\/\s*w\s+/i);
  if (artist && sides.length === 2 && sides.every(side => side.trim().length >= 2)) {
    const aside = buildBaseResearchQuery(artist, sides[0]);
    if (aside && aside !== query) variants.push({ identitySignals: [], kind: "base", query: aside });
  }
  return variants;
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
  const timeZone = options.timeZone || "America/Los_Angeles";
  const dates = researchCalendarWindow(dayRange, timeZone);
  url.searchParams.set("dayRange", String(dayRange));
  url.searchParams.set("startDate", String(dates.start));
  url.searchParams.set("endDate", String(dates.end));
  url.searchParams.set("categoryId", EBAY_RESEARCH_VINYL_CATEGORY_ID);
  url.searchParams.set("conditionId", EBAY_RESEARCH_NEW_CONDITION_ID);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "50");
  url.searchParams.set("sorting", "-itemssold");
  url.searchParams.set("tabName", "SOLD");
  url.searchParams.set("tz", timeZone);
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
    .replace(/\s+all[ -]analog\s*$/i, " ")
    .replace(/\s+(?:brand\s+new|new\s+sealed|factory\s+sealed|sealed)(?:\s+U\.?S\.?)?\s*(?:\d+["”]?\s*)?(?:vinyl|lps?|records?)?\s*$/i, " ")
    .replace(/\s+\d+[ -]*LP[ -]*Set\s*$/i, " ")
    .replace(/\s+(?:rsd|record\s+store\s+day)(?:\s+black\s+friday)?(?:\s+(?:19|20)\d{2})?\s*$/i, " ")
    .replace(/\s+(?:180|200)\s*(?:g|grams?)\b[^)]*$/i, " ")
    .replace(/\s+signed\s*(?:\(\s*US\s+only\s*\))?\s+(?:vinyl\s+)?LP\b/i, " LP")
    .replace(/[•*]+/g, " ")
    .replace(/\s+new\s+sealed\s+(?:vinyl\s+)?lp\b.*$/i, " ")
    .replace(/\[(?:vinyl|lp)\]\s*new\s*$/i, " ")
    .replace(/\s+(?:brand\s+)?new\s+(?:sealed\s+)?(?:vinyl\s+)?lps?(?:\s+with\s+\d+[ -]page\s+booklet)?\s*$/i, " ")
    .replace(/\s+chess\s+\d+\s+series\s*$/i, " ")
    // eBay merchant titles put pressing shorthand after an explicit format.
    // Remove only a fully recognized suffix; preserve album title words.
    .replace(/\[\s*(?:brand\s+)?new\s+[^\]]*vinyl[^\]]*\]\s*([^\[\]]*)$/i, (whole, tail) =>
      isEditionDescription(tail.replace(/\b(?:ltd|ed|rmst|rpm)\b/gi, " ").replace(/,/g, " ")) ? " " : whole)
    .replace(/^\s*(?:soundtrack|ost)\s+[-–—]\s+/i, "")
    .replace(/\s*\((?:with\s+)?(?:autograph(?:ed)?|signed)(?:\s+(?:postcard|card|jacket|insert))?\)\s*$/i, " ")
    .replace(/\s+(?:with\s+(?:autographed|signed)\s+(?:postcard|card|jacket|insert)|[-–—]\s*(?:autographed|signed))\s*$/i, " ")
    // A trailing parenthesis after the explicit record format describes the
    // retailer's variant, including names outside our color vocabulary. Keep
    // the original candidate title unchanged for strict pressing validation.
    .replace(/\b((?:[1-9]\s*[x×-]?\s*)?lps?|vinyl)\s*[[(][^\])]+[\])]\s*$/i, " $1")
    // Keep the format marker until its trailing merchandising color label is
    // removed. Dropping "2LP" first would leave "Color" in the album query.
    .replace(/\b((?:[1-9]\s*[x×-]?\s*)?lps?)\s*(?:[-–—]\s*)?\(?colou?r(?:ed)?\)?\s*$/i, " $1")
    .replace(/\b[1-9]\s*[x×-]?\s*lps?\b/gi, " ")
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
      ) || /^(?:\d+(?:st|nd|rd|th)?(?:[ -]year)?\s+anniversary|alt(?:ernate)?\s+cover|US\s+only)$/i.test(inside.trim()) || /^(?:verve\s+vault|blue\s+note\s+(?:essentials?|classic))(?:\s+vinyl)?\s+series$/i.test(inside.trim()) ||
      /^(?:black|white|red|blue|green|yellow|orange|pink|purple|clear|silver|gold|tangerine|apple\s+red|ghostly\s+blue)$/i.test(inside.trim())
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

  const quotedAlbum = title.match(/^\s*(['"])(.+)\1\s+(.+)$/);
  if (quotedAlbum && isEditionDescription(quotedAlbum[3].replace(/\bsplit\b/gi, " "))) {
    title = quotedAlbum[2];
  }

  // Retailers separate the album from format/color/edition with a dash, colon
  // or pipe. Only discard a suffix made entirely of merchandising descriptors.
  const chunks = title.split(/\s+[-–—|]\s+|:\s+/);
  while (
    chunks.length > 1 &&
    isEditionDescription(chunks.at(-1)) &&
    (chunks.length > 2 ||
      isExplicitEditionTail(chunks.at(-1)) ||
      /^(?:apple\s+red|ghostly\s+blue|black|white|red|blue|green|tan|tangerine|amber|ruby|coral|pink|purple|yellow|clear)\b.*\b(?:vinyl|lp|inch)\b/i.test(chunks.at(-1)) ||
      /^(?:r\s*&\s*b|rock|pop|country|jazz|rap|hip[-\s]?hop)(?:\s*\/\s*(?:r\s*&\s*b|rock|pop|country|jazz|rap|hip[-\s]?hop))*\s*-*$/i.test(
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
    const repeatedColor = /^(?:black|white|red|blue|purple|green|yellow|orange|pink)\b/i.test(tail) &&
      tokens.slice(0, index).some((token) => token.toLowerCase() === tokens[index].toLowerCase());
    const whiteFormatTail = /^white\s+(?:vinyl\s+)?lps?\b/i.test(tail) && index > 0 &&
      !/^(?:and|or|in|of|to|it|the|on)$/i.test(tokens[index - 1]);
    if (
      (isExplicitEditionTail(tail) || repeatedColor || whiteFormatTail ||
        (index > 0 && /^(?:black|white|red|blue|green|tan|pink|purple|yellow|gold)\s+(?:7|10|12)\s*["”]$/.test(tail.toLowerCase())) ||
        (index > 0 &&
          /^(?:apple\s+red|ghostly\s+blue|baby|royal|cloudy|milky|neon|hot|light|dark|half)\b.*\b(?:vinyl|lp|inch)\b/i.test(
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
      .replace(/\s+all[ -]analog\s*$/i, " ")
      .replace(/\s+\d+-\s*set\s*$/i, " ")
      .replace(/\s+(?:verve\s+vault|blue\s+note\s+(?:essentials?|classic))(?:\s+vinyl)?\s+series\s*$/i, " ")
      .replace(
        /\s+(?:[-–—|:]\s*)?(?:rsd|record\s+store\s+day)(?:\s+black\s+friday)?(?:\s+(?:19|20)\d{2})?\s*$/i,
        " ",
      )
      .replace(/[|:]+/g, " ")
      .replace(/\s+-\s*$/g, " "),
  );
}

const EDITION_WORDS =
  /^(?:(?:baby|apple|royal|cloudy|ghostly|opaque|transparent|translucent|milky|neon|hot|light|dark|limited|exclusive|standard|version|deluxe|anniversary|collector'?s?|import|indie|edition|pressing|reissue|remaster(?:ed)?|heavyweight|half|speed|master(?:ed)?|black|white|red|blue|pink|purple|orange|yellow|green|gold|silver|bone|tan|tangerine|amber|ruby|coral|brown|cream|clear|navy|teal|grey|gray|beer|marble|marbled|galaxy|splatter|swirl|smoke|platinum|colour|color|colored|coloured|vinyl|lps?|ep|single|inch|in|gram(?:s)?|g|record|album|box|set|picture|disc|gatefold|soundtrack|ost|mono|stereo|new|sealed|brand|sale|clearance|preorder|pre|order|staff|pick|walmart|target|urban|outfitters|uo|r|b|rock|pop|country|jazz|rap|hip|hop|in|with|w|and|\d+(?:st|nd|rd|th|g|lp)?)|[\s/&()+.\-"”])+$/i;
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
  let title = String(candidate.title ?? "").trim();
  const sourceTitle = String(candidate.sourceListingTitle ?? "").trim();
  // A previous display-title cleanup may have removed "edition" but left its
  // modifier. Require the original listing's explicit edition suffix.
  const modifier = title.match(/\s+[-–—]\s+(FIRST|STANDARD)\s*$/i)?.[1];
  if (modifier && new RegExp(`\\s+[-–—]\\s+${modifier}\\s+EDITION(?:\\s*\\(Vinyl\\))?\\s*$`, 'i').test(sourceTitle)) {
    title = title.replace(/\s+[-–—]\s+(FIRST|STANDARD)\s*$/i, '');
  }
  if (normalizeResearchTitle(title)) return title;
  return sourceTitle || title;
}

function withoutLeadingArtist(title, artist) {
  if (!title || !artist) return title;
  const titleWords = title.split(/\s+/);
  const artistWords = artist.split(/\s+/);
  if (/^the$/i.test(artistWords[0])) {
    const shortArtist = artistWords.slice(1);
    if (normalizeKey(titleWords.slice(0, shortArtist.length).join(" ")) === normalizeKey(shortArtist.join(" ")) &&
        /^[-:|]$/.test(titleWords[shortArtist.length] ?? "")) {
      return titleWords.slice(shortArtist.length + 1).join(" ").trim();
    }
  }
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
    .replace(/&/g, " and ")
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

function researchCalendarWindow(days, timeZone) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = value => Object.fromEntries(format.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  const today = parts(Date.now());
  const endDay = Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day));
  const midnight = calendarDay => {
    let instant = calendarDay;
    // Resolve each local midnight independently so a DST transition cannot
    // shift the dates displayed by Seller Hub.
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = parts(instant);
      const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
      instant += calendarDay - local;
    }
    return instant;
  };
  return { start: midnight(endDay - days * 86400000), end: midnight(endDay) };
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}
