const PRICE_PATTERN =
  /(?:\$|USD\s*)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/gi;
const UNIT_SUFFIX_PATTERN =
  /^\s*(?:\/\s*|per\s+)(?:ea(?:ch)?|unit|item|lb|oz|fl\.?\s*oz|kg|g|100g|ct|count)\b/i;

export function decodeHtmlEntities(value) {
  let decoded = String(value ?? "");
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decoded
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeCodePoint(code, 16))
      .replace(/&#([0-9]+);/g, (_, code) => safeCodePoint(code, 10));
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function parseRetailProductPrices(value) {
  const text = cleanRetailText(value);
  return [...text.matchAll(PRICE_PATTERN)]
    .filter((match) => {
      const index = match.index ?? 0;
      const before = text.slice(Math.max(0, index - 96), index);
      const after = text.slice(
        index + match[0].length,
        Math.min(text.length, index + match[0].length + 28),
      );
      return (
        !isShippingOrOrderThreshold(before, after) &&
        !/\b(?:delivery|shipping|s\s*(?:&|and|\/)\s*h|save|savings|coupon|orders?\s+over)\s*[:\-]?\s*$/i.test(before) &&
        !/^\s*(?:delivery|shipping|s\s*(?:&|and|\/)\s*h|off\s+coupon)\b/i.test(after) &&
        !UNIT_SUFFIX_PATTERN.test(after)
      );
    })
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter(Number.isFinite);
}

export function inferRetailArtist(value) {
  const split = splitRetailArtistTitle(value);
  return split.artist ? cleanRetailArtist(split.artist) : "Unknown Artist";
}

export function inferRetailTitle(value) {
  return cleanRetailTitle(splitRetailArtistTitle(value).title);
}

/** Acoustic Sounds prints Artist / Album, including colons inside subtitles.
 * Keep this publisher convention out of the generic collaboration parser. */
export function parseAcousticSoundsListingIdentity(value, source = {}) {
  const sourceId = source.sourceId ?? source.id;
  const sourceUrl = source.sourceUrl ?? source.url ?? source.baseUrl;
  let publisherHost = false;
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      publisherHost = url.protocol === "https:" && !url.username && !url.password && !url.port &&
        /^(?:www\.|store\.)?acousticsounds\.com$/i.test(url.hostname);
      if (!publisherHost) return null;
    } catch { return null; }
  }
  if (sourceId !== "acoustic-sounds" && !publisherHost) return null;
  const text = cleanRetailText(value);
  const parts = text.split(/\s+\/\s+/);
  // Several delimiters might describe multiple performers or a split release.
  // They need structured metadata instead of guessing which slash is the album.
  if (parts.length !== 2 || parts[0].length < 2 || parts[0].length > 100) return null;
  const artist = cleanRetailArtist(parts[0]);
  const release = parts[1].trim();
  const formatSuffix = release.search(/\s+(?:(?:\d{2,3}\s*(?:grams?|g)\s+)(?:(?:clarity|super|colou?red|black)\s+)?(?:vinyl|(?:[1-9]\s*)?lp)\b|(?:[1-9]\s*)?lp(?:\s+record)?\b|vinyl\s+record\b)/i);
  const title = (formatSuffix < 0 ? release : release.slice(0, formatSuffix)).trim();
  if (artist.length < 2 || title.length < 2 || /^(?:unknown artist|vinyl|records?)$/i.test(artist)) return null;
  return { artist, title, retailEditionText: release, identityStatus: "resolved", identitySource: "acoustic_sounds_listing" };
}

function splitRetailArtistTitle(value) {
  const source = cleanRetailText(value)
    .replace(/^best\s+seller\s+/i, "")
    .replace(/^\[(?:pre[\s-]?order|preorder)\]\s*/i, "")
    .replace(/^\$\s*[0-9][0-9,.]*\s*\*?\s*\|\s*/i, "");
  // Label storefronts also use Artist 'Album' EP/LP. Require the closing
  // quote to precede the format so apostrophes in names stay intact. Parse
  // this before a trailing dash introducing the selected color variant.
  const singleQuoted = source.match(/^(.{2,100}?)\s+['‘](.{2,}?)['’]\s+(?:EP|LP|Vinyl|(?:7|10|12)["”])(?:\s|$)/i);
  if (singleQuoted && !/\s[-\u2013\u2014]\s/.test(singleQuoted[1])) return { artist: singleQuoted[1], title: singleQuoted[2] };

  const dash = source.match(/^(.{2,100}?)\s+[-\u2013\u2014]\s+(.{2,})$/);
  if (dash) return { artist: dash[1], title: dash[2] };

  const quoted = source.match(/^(.{2,100}?)\s+["“]([^"”]{2,})["”](?:\s|$)/);
  if (quoted) return { artist: quoted[1], title: quoted[2] };

  const selfTitled = source.match(/^(.{2,100}?)\s+(?:s\s*\/\s*t|self[- ]titled)(?=\s|$|\()/i);
  if (selfTitled) return { artist: selfTitled[1], title: selfTitled[1] };

  const colon = source.match(/^([^:]{2,80}):\s+(.{2,})$/);
  if (colon) return { artist: colon[1], title: colon[2] };

  return { artist: null, title: source };
}

function cleanRetailArtist(value) {
  return cleanRetailText(value)
    .replace(/^best\s+seller\s+/i, "")
    .replace(/^[\s\-:|]+|[\s\-:|]+$/g, "")
    .trim();
}

function cleanRetailTitle(value) {
  return cleanRetailText(value)
    .replace(/^best\s+seller\s+/i, "")
    .replace(/\bMusic\s*(?:&|and)\s*Performance\b/gi, " ")
    .replace(/\s*(?:\+|\||[-\u2013\u2014])\s*(?:free\s+)?(?:shipping|delivery|s\s*(?:&|and|\/)\s*h)\b.*$/i, " ")
    .replace(/\s+or\s+less\b.*$/i, " ")
    .replace(/\bat\s+(?:amazon|target|walmart|urban\s+outfitters|barnes\s*(?:&|and)\s*noble|deep\s+discount)\b.*$/i, " ")
    .replace(/\([^)]*(?:vinyl|lp|record|sale|deal)[^)]*\)/gi, " ")
    .replace(/\b(?:vinyl|records?|album|[234]?\s*lp)\b/gi, " ")
    .replace(/\b(?:sale|deal|clearance|limited|edition|exclusive|colored|colour|color)\b/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\bwas\b(?=\s*(?:\$|USD))/gi, " ")
    .replace(PRICE_PATTERN, " ")
    .replace(/(?:\/\s*|per\s+)(?:ea(?:ch)?|unit|item|lb|oz|fl\.?\s*oz|kg|g|100g|ct|count)\b/gi, " ")
    .replace(/\(\s*(?:walmart)?\s*\)/gi, " ")
    .replace(/\s*-\s*(?=\()/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:|]+|[\s\-:|]+$/g, "")
    .trim();
}

function isShippingOrOrderThreshold(before, after) {
  const hasThresholdSuffix = /^\s*(?:\+|or\s+(?:more|above)|minimum\b)/i.test(after);
  const shippingClause = before.match(
    /\b(?:free\s+)?(?:shipping|delivery|s\s*(?:&|and|\/)\s*h)\b([^$]{0,80})$/i,
  )?.[1] ?? null;
  if (
    shippingClause !== null &&
    (hasThresholdSuffix || /\b(?:on|over|above|orders?|purchases?|minimum|prime|or)\b/i.test(shippingClause))
  ) {
    return true;
  }
  return /\b(?:orders?|purchases?)\s+(?:(?:over|above|of|at\s+least|total(?:ing)?)\s+)?$/i.test(before);
}

function cleanRetailText(value) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function safeCodePoint(value, radix) {
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "";
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}
