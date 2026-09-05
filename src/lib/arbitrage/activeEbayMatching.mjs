import { isMarketplaceNonRecordTitle } from "./marketplaceProductClassification.mjs";
import { buildBaseResearchQuery, normalizeResearchArtist, normalizeResearchTitle } from "./soldResearchLinks.mjs";
import { retailEligibility } from "../../../scripts/lib/retailIdentity.mjs";

const BLOCKED_PRODUCT_PATTERN =
  /\b(?:(?:\d+\s*)?cd|compact\s+disc|hoodie|shirt|t-shirt|tee\b|sweatshirt|trading\s+card|cassette|dvd|blu-ray|book|poster|slipmat|koozie|pizza\s+cutter|turntable|speaker|stylus|cartridge|tote|handbag|purse|shoulder\s+bag|messenger\s+bag|charger|cable|shampoo|conditioner|grocery|snack|food|hat|socks|pin|patch|sticker|gift\s+card|coupon|digital\s+download|bundle|lot of)\b/i;

const STOP_TOKENS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "new",
  "of",
  "on",
  "record",
  "records",
  "the",
  "vinyl",
  "with",
]);

const COLORS = [
  "amber",
  "apple red",
  "aquamarine",
  "beige",
  "black",
  "bone",
  "blue",
  "bronze",
  "brown",
  "clear",
  "coke bottle",
  "coral",
  "cream",
  "cyan",
  "ghostly blue",
  "gold",
  "gray",
  "green",
  "grey",
  "ivory",
  "lavender",
  "magenta",
  "maroon",
  "navy",
  "orange",
  "pearl",
  "pink",
  "platinum",
  "purple",
  "red",
  "ruby",
  "sea blue",
  "silver",
  "smoke",
  "tan",
  "tangerine",
  "teal",
  "transparent",
  "turquoise",
  "violet",
  "white",
  "yellow",
];

const RETAILERS = [
  ["urban outfitters", "urban-outfitters"],
  ["barnes and noble", "barnes-and-noble"],
  ["barnes & noble", "barnes-and-noble"],
  ["walmart", "walmart"],
  ["target", "target"],
  ["amazon", "amazon"],
  ["indie", "indie"],
];

const EDITION_SIGNAL_PATTERNS = [
  ["series-blue-note-essential", /\bblue\s+note\s+essentials?\b/i],
  ["series-blue-note-classic", /\bblue\s+note\s+classic\b/i],
  ["series-verve-vault", /\bverve\s+vault\b/i],
  ["series-tone-poet", /\btone\s+poet\b/i],
  ["series-classic-records", /\bclassic\s+records\b/i],
  ["series-music-matters", /\bmusic\s+matters\b/i],
  ["series-analogue-productions", /\banalogue\s+productions\b/i],
  ["series-mobile-fidelity", /\b(?:mofi|mobile\s+fidelity)\b/i],
  ["anniversary", /\banniversary\b/i],
  ["box-set", /\bbox\s*set\b/i],
  ["deluxe", /\bdeluxe\b/i],
  ["etched", /\betched\b/i],
  ["glow-in-the-dark", /\bglow\s+in\s+the\s+dark\b/i],
  ["marbled", /\bmarbl(?:e|ed)\b/i],
  ["numbered", /\b(?:hand\s*)?numbered\b|\bnumbered\s+edition\b/i],
  ["picture-disc", /\bpicture\s*disc\b/i],
  ["remastered", /\bremaster(?:ed)?\b|\bhalf[-\s]?speed\s+master/i],
  ["signed", /\b(?:hand\s*)?signed\b|\bautograph(?:ed)?\b/i],
  ["splatter", /\bsplatter\b/i],
  ["swirl", /\bswirl\b/i],
  ["translucent", /\btranslucent\b/i],
];

export function buildActiveSearchProfile(find) {
  if (!find || find.opportunityType === "sitewide_sale" || Number(find.purchasePrice) <= 0 || !retailEligibility(find).eligible) return null;
  const rawSourceText = find.sourceListingTitle || find.title || "";
  const shopifyVariantTitle = explicitShopifyVinylVariant(find.shopifyVariantTitle);
  const profileSourceText = shopifyVariantTitle
    ? stripCompactDiscTaxonomy(rawSourceText)
    : rawSourceText;
  const sourceText = dealCoreText(profileSourceText);
  if (BLOCKED_PRODUCT_PATTERN.test(sourceText)) return null;
  const sourceParts = artistTitleFromSource(sourceText);
  const artist = normalizeResearchArtist(
    find.identityStatus === "resolved" ? find.artist : sourceParts.artist || find.artist || "",
  );
  const rawTitle = find.title && find.title !== rawSourceText
    ? find.title : sourceParts.title || find.title || sourceText;
  const primary = buildBaseResearchQuery(artist, dealCoreText(rawTitle));
  const title = normalizeResearchTitle(
    artist && primary.toLowerCase().startsWith(`${artist.toLowerCase()} `)
      ? primary.slice(artist.length + 1) : primary,
  );
  if (!title || isSkippableTitle(title)) return null;

  const edition = extractEditionIdentity(
    shopifyVariantTitle
      ? appendVariantIfMissing(profileSourceText, shopifyVariantTitle)
      : rawSourceText,
    `${artist} ${title}`,
  );
  // One broad release query finds listings whose sellers omit color, barcode,
  // format, or edition wording. The separate edition profile still gates every
  // returned listing before it contributes to exact supply or price evidence.
  const variantList = [primary];
  if (!primary) return null;
  const excludedItemIdentityTokens = ebayItemIdentityTokens(
    find.ebayItemId,
    find.sourceEbayItemId,
    find.sourceUrl,
  );
  const exclusionKey = excludedItemIdentityTokens.length
    ? `::exclude=${excludedItemIdentityTokens.join(",")}`
    : "";
  return {
    artist,
    edition,
    excludedItemIdentityTokens,
    key: `${primary.toLowerCase()}::${edition.key}${exclusionKey}`,
    primary,
    title,
    variants: variantList,
  };
}

export function ebayItemIdentityTokens(...values) {
  const tokens = new Set();
  for (const value of values) collectEbayItemIdentityTokens(value, tokens);
  return [...tokens].sort();
}

export function isExcludedEbayActiveListing(item, profile) {
  const excluded = new Set(profile?.excludedItemIdentityTokens ?? []);
  if (excluded.size === 0) return false;
  return ebayItemIdentityTokens(item).some((token) => excluded.has(token));
}

export function activeSearchKey(find) {
  return buildActiveSearchProfile(find)?.key ?? null;
}

export function matchActiveListing(title, profile) {
  const listingTitle = cleanActiveSearchText(title);
  if (
    !listingTitle ||
    BLOCKED_PRODUCT_PATTERN.test(listingTitle) ||
    isMarketplaceNonRecordTitle(listingTitle)
  ) {
    return {
      confidence: "low",
      editionSignals: [],
      matched: false,
      reasons: ["blocked-product-type"],
      score: 0,
    };
  }

  const artistPrefix = `${profile.artist} `;
  const listingReleaseTitle = profile.artist && listingTitle.toLowerCase().startsWith(artistPrefix.toLowerCase())
    ? listingTitle.slice(artistPrefix.length).replace(/^\s*-\s*/, "") : listingTitle;
  const listingTokens = new Set(searchTokens(normalizeResearchTitle(listingReleaseTitle), { preserveTitleWords: true }));
  const listingArtistTokens = new Set(searchTokens(listingTitle));
  const expectedTitleTokens = searchTokens(profile.title, { preserveTitleWords: true });
  const expectedArtistTokens = searchTokens(profile.artist);
  const matchedTitleTokens = expectedTitleTokens.filter((token) => listingTokens.has(token)).length;
  const matchedArtistTokens = expectedArtistTokens.filter((token) => listingArtistTokens.has(token)).length;
  const titleCoverage = expectedTitleTokens.length === 0 ? 0 : matchedTitleTokens / expectedTitleTokens.length;
  const artistCoverage = expectedArtistTokens.length === 0 ? 1 : matchedArtistTokens / expectedArtistTokens.length;
  const requiredTitleMatches =
    expectedTitleTokens.length <= 2
      ? expectedTitleTokens.length
      : Math.max(2, Math.ceil(expectedTitleTokens.length * 0.6));
  const requiredNumbers = expectedTitleTokens.filter((token) => /^\d+$/.test(token));
  const hasRequiredNumbers = requiredNumbers.every((token) => listingTokens.has(token));
  const reasons = [];

  if (matchedTitleTokens < requiredTitleMatches || !hasRequiredNumbers) reasons.push("release-title-mismatch");
  // A one-word album named Blue/Red cannot borrow a color suffix from another
  // release whose actual title precedes it ("Some Other Release Blue Vinyl").
  if (expectedTitleTokens.length === 1 && COLORS.includes(expectedTitleTokens[0]) &&
      searchTokens(normalizeResearchTitle(listingReleaseTitle), { preserveTitleWords: true })[0] !== expectedTitleTokens[0]) reasons.push("release-title-mismatch");
  if (expectedArtistTokens.length > 0 && artistCoverage < 0.5) reasons.push("artist-mismatch");

  const listingEdition = extractEditionIdentity(listingTitle, `${profile.artist} ${profile.title}`);
  const editionResult = compareEditionIdentity(profile.edition, listingEdition);
  reasons.push(...editionResult.reasons);
  const score = round(
    titleCoverage * 0.65 +
      artistCoverage * 0.2 +
      (editionResult.exact ? 1 : editionResult.compatible ? 0.5 : 0) * 0.15,
    3,
  );
  const matched =
    reasons.length === 0 &&
    titleCoverage >= 0.6 &&
    artistCoverage >= 0.5 &&
    editionResult.exact &&
    score >= 0.8;

  return {
    confidence: matched ? "high" : score >= 0.65 && editionResult.compatible ? "medium" : "low",
    editionSignals: editionSummary(listingEdition),
    matched,
    reasons: [...new Set(reasons)],
    score,
  };
}

export function extractEditionIdentity(value, releaseTitle = "") {
  const originalText = cleanActiveSearchText(value).toLowerCase();
  const text = originalText
    .replace(/\bblue\s+note(?=\s+(?:essential|classic|tone\s+poet|vinyl|series))/g, "label");
  const normalizedReleaseTitle = cleanActiveSearchText(releaseTitle).toLowerCase();
  const colors = extractColors(text).filter(
    (color) =>
      countPhrase(text, color) > countPhrase(normalizedReleaseTitle, color),
  );
  const format = extractFormat(text);
  const retailerExclusive = extractRetailerExclusive(text);
  // Blue Note is suppressed only for color parsing; its named pressing series
  // must remain present when comparing exact supply.
  const signals = EDITION_SIGNAL_PATTERNS.filter(([, pattern]) => pattern.test(originalText)).map(([name]) => name);
  const hardColors = colors.filter((color) => color !== "black");
  const keyParts = [
    format ? `format=${format}` : "",
    hardColors.length > 0 ? `colors=${hardColors.sort().join("+")}` : "",
    retailerExclusive ? `retailer=${retailerExclusive}` : "",
    signals.length > 0 ? `signals=${signals.sort().join("+")}` : "",
  ].filter(Boolean);

  return {
    colors,
    format,
    key: keyParts.join("|") || "standard",
    retailerExclusive,
    signals,
  };
}

export function cleanActiveSearchText(value) {
  return normalizeMojibakePunctuation(value)
    .replace(/(?:\u2013|\u2014|â€“|â€”)/g, " - ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\p{L}\p{N}&$'./"()[\]\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMojibakePunctuation(value) {
  return String(value ?? "")
    .replace(/\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u201e\u00a2/g, "'")
    .replace(/\u00e2\u20ac[\u2122\u02dc]/g, "'")
    .replace(/\u00e2\u20ac[\u0153\u009d\ufffd]/g, '"')
    .replace(/\u00e2\u20ac[\u201c\u201d]/g, " - ")
    .replace(/\u00e2\u20ac\u00a6/g, "...");
}

function collectEbayItemIdentityTokens(value, tokens) {
  if (Array.isArray(value)) {
    for (const entry of value) collectEbayItemIdentityTokens(entry, tokens);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of ["itemId", "legacyItemId", "itemWebUrl", "sourceUrl"]) {
      collectEbayItemIdentityTokens(value[key], tokens);
    }
    return;
  }
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return;

  let decoded = cleaned;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    // Keep the original value when it is not URI encoded.
  }
  const normalized = decoded.toLowerCase().replace(/\s+/g, "");
  if (!normalized) return;

  try {
    const url = new URL(decoded);
    if (/(?:^|\.)ebay\.[a-z.]+$/i.test(url.hostname)) {
      const legacyId = url.pathname.match(/\/itm\/(?:[^/]+\/)?([a-z0-9_-]+)/i)?.[1];
      if (legacyId) tokens.add(`legacy:${legacyId.toLowerCase()}`);
    }
    return;
  } catch {
    // Non-URL item IDs are handled below.
  }

  tokens.add(`item:${normalized}`);
  const parts = normalized.split("|");
  if (/^v\d+$/.test(parts[0]) && parts[1]) tokens.add(`legacy:${parts[1]}`);
  if (/^[0-9]{8,20}$/.test(normalized)) tokens.add(`legacy:${normalized}`);
}

function compareEditionIdentity(expected, actual) {
  const reasons = [];
  const expectedColors = expected.colors.filter((color) => color !== "black");
  const actualColors = actual.colors.filter((color) => color !== "black");
  const colorEffects = new Set(["clear", "smoke", "transparent"]);
  const expectedChromaticColors = expectedColors.filter((color) => !colorEffects.has(color));
  const actualChromaticColors = actualColors.filter((color) => !colorEffects.has(color));
  const expectedEffects = expectedColors.filter((color) => colorEffects.has(color));
  const actualEffects = actualColors.filter((color) => colorEffects.has(color));

  if (expected.format && actual.format !== expected.format) {
    reasons.push(actual.format ? "edition-format-conflict" : "edition-format-missing");
  } else if (!expected.format && actual.format && actual.format !== "1lp") {
    reasons.push("unexpected-edition-format");
  }

  if (expectedColors.length > 0) {
    if (actualColors.length === 0) reasons.push("edition-color-missing");
    else {
      if (
        expectedChromaticColors.length > 0 &&
        (!expectedChromaticColors.every((color) => actualChromaticColors.includes(color)) ||
          actualChromaticColors.some((color) => !expectedChromaticColors.includes(color)))
      ) {
        reasons.push("edition-color-conflict");
      }
      if (expectedEffects.some((effect) => !actualEffects.includes(effect))) reasons.push("edition-color-effect-missing");
    }
  } else if (actualColors.length > 0) {
    reasons.push("unexpected-color-edition");
  }

  if (expected.retailerExclusive && actual.retailerExclusive !== expected.retailerExclusive) {
    reasons.push(actual.retailerExclusive ? "retailer-exclusive-conflict" : "retailer-exclusive-missing");
  } else if (!expected.retailerExclusive && actual.retailerExclusive) {
    reasons.push("unexpected-retailer-exclusive");
  }

  const expectedSignals = new Set(expected.signals);
  const actualSignals = new Set(actual.signals);
  for (const signal of expectedSignals) {
    if (!actualSignals.has(signal)) reasons.push(`edition-signal-missing:${signal}`);
  }
  for (const signal of actualSignals) {
    if (!expectedSignals.has(signal)) reasons.push(`unexpected-edition-signal:${signal}`);
  }

  return {
    compatible: !reasons.some((reason) => /conflict|mismatch/.test(reason)),
    exact: reasons.length === 0,
    reasons,
  };
}

function extractColors(text) {
  if (!/\b(?:vinyl|(?:[1-9]\s*(?:x|-)?\s*)?lp|pressing|edition|exclusive|splatter|swirl|marble|marbled|smoke|transparent|translucent)\b/i.test(text)) {
    return [];
  }
  const colors = [];
  for (const color of COLORS) {
    const pattern = new RegExp(`\\b${escapeRegExp(color).replace(/\s+/g, "[\\s-]+")}\\b`, "i");
    if (pattern.test(text)) colors.push(color);
  }
  return [...new Set(colors)];
}

function extractFormat(text) {
  const lpCount = text.match(/\b([1-9])\s*(?:x|-)?\s*lp\b|\b([1-9])lp\b/i);
  if (lpCount) return `${lpCount[1] ?? lpCount[2]}lp`;
  if (/\bdouble\s+lp\b/i.test(text)) return "2lp";
  if (/\btriple\s+lp\b/i.test(text)) return "3lp";
  if (/\b7\s*(?:[ -]?inch|")/i.test(text)) return "7-inch";
  if (/\b10\s*(?:[ -]?inch|")/i.test(text)) return "10-inch";
  if (/\b12\s*(?:[ -]?inch|")\s+(?:vinyl\s+)?single\b/i.test(text)) return "12-inch-single";
  if (/\b(?:vinyl\s+)?ep\b/i.test(text)) return "ep";
  return null;
}

function extractRetailerExclusive(text) {
  if (!/\bexclusive\b/i.test(text)) return null;
  for (const [pattern, id] of RETAILERS) {
    if (text.includes(pattern)) return id;
  }
  return null;
}

function editionSummary(identity) {
  return [
    ...(identity.format ? [identity.format] : []),
    ...identity.colors,
    ...(identity.retailerExclusive ? [`${identity.retailerExclusive}-exclusive`] : []),
    ...identity.signals,
  ];
}

function artistTitleFromSource(value) {
  const cleaned = cleanActiveSearchText(value).replace(/^\[[^\]]+\]\s*/, "");
  const quoted = cleaned.match(/^(.{2,80}?)\s+["]([^"]{2,})["]/);
  if (quoted) return { artist: quoted[1].trim(), title: quoted[2].trim() };
  const separated = cleaned.match(/^(.{2,80}?)(?:\s+-\s+|\s*:\s+)(.{2,})$/);
  if (separated) return { artist: separated[1].trim(), title: separated[2].trim() };
  return { title: cleaned };
}

function explicitShopifyVinylVariant(value) {
  const cleaned = cleanActiveSearchText(value);
  return /\b(?:vinyl|phonograph\s+record|record\s+album|(?:[1-9]\s*(?:x|-)?\s*)?lp|ep|(?:7|10|12)\s*(?:inch|in\.|"))\b/i.test(
    cleaned,
  )
    ? cleaned
    : "";
}

function stripCompactDiscTaxonomy(value) {
  return String(value)
    .replace(/\b(?:(?:\d+\s*)?cds?|compact\s+discs?)\b\s*(?:\/|&|and|or)\s*/gi, " ")
    .replace(/\s*(?:\/|&|and|or)\s*\b(?:(?:\d+\s*)?cds?|compact\s+discs?)\b/gi, " ")
    .replace(/\b(?:(?:\d+\s*)?cds?|compact\s+discs?)\b/gi, " ");
}

function appendVariantIfMissing(value, variantTitle) {
  const sourceIdentity = cleanActiveSearchText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  const variantIdentity = cleanActiveSearchText(variantTitle).toLowerCase().replace(/[^a-z0-9]/g, "");
  return variantIdentity && sourceIdentity.includes(variantIdentity)
    ? value
    : `${value} - ${variantTitle}`;
}

function dealCoreText(value) {
  return cleanActiveSearchText(value)
    .replace(/^(?:best\s+seller|overall\s+pick)\s+/i, "")
    .replace(/^\[[^\]]+\]\s*/g, " ")
    .replace(/\s+(?:@|for)\s+\$?\d[\d,.]*.*$/i, " ")
    .replace(/\s+\$\d[\d,.]*(?:\s+was\s+\$\d[\d,.]*)?.*$/i, " ")
    .replace(/\s+\+\s+free\s+shipping.*$/i, " ")
    .replace(/\bfree\s+shipping\b.*$/i, " ")
    .replace(/\bw\/\s*prime\b.*$/i, " ")
    .replace(/\bat\s+(?:amazon|target|walmart|urban outfitters|barnes\s*(?:&|and)\s*noble|deep discount)\b.*$/i, " ")
    .trim();
}

function searchTokens(value, { preserveTitleWords = false } = {}) {
  return cleanActiveSearchText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && (!STOP_TOKENS.has(token) ||
      (preserveTitleWords && ["new", "record", "records"].includes(token))));
}

function isSkippableTitle(title) {
  return /^(?:cheap|deals?|home|facebook page|filter amazon|click here|continue shopping|sign up|sign in(?: and earn rewards)?|order history|premium membership|shop now|see all formats(?: and| &) editions|view cart|my account|search|time|under)$/i.test(title);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countPhrase(value, phrase) {
  if (!value || !phrase) return 0;
  const pattern = new RegExp(`\\b${escapeRegExp(phrase).replace(/\s+/g, "[\\s-]+")}\\b`, "gi");
  return [...value.matchAll(pattern)].length;
}

function round(value, places) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}
