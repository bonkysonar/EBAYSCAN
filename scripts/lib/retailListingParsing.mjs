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

function splitRetailArtistTitle(value) {
  const source = cleanRetailText(value)
    .replace(/^best\s+seller\s+/i, "")
    .replace(/^\[(?:pre[\s-]?order|preorder)\]\s*/i, "")
    .replace(/^\$\s*[0-9][0-9,.]*\s*\*?\s*\|\s*/i, "");
  const dash = source.match(/^(.{2,100}?)\s+[-\u2013\u2014]\s+(.{2,})$/);
  if (dash) return { artist: dash[1], title: dash[2] };

  const quoted = source.match(/^(.{2,100}?)\s+["“]([^"”]{2,})["”](?:\s|$)/);
  if (quoted) return { artist: quoted[1], title: quoted[2] };

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
