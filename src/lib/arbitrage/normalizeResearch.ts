const EDITION_NOISE = [
  /\boriginal\s+motion\s+picture\s+soundtrack\b/gi,
  /\bmotion\s+picture\s+soundtrack\b/gi,
  /\boriginal\s+soundtrack\b/gi,
  /\bsoundtrack\b/gi,
  /\bmusic\s+(?:on|and|from|by|performance)\b.*$/gi,
  /\bmusic\s*(?:&|and)\s*performance\b.*$/gi,
  /\bwas\s*\/\s*ea\b.*$/gi,
  /\b(?:limited|deluxe|anniversary|collector'?s?|exclusive|import|indie|target|walmart|urban outfitters|uo)\s+edition\b/gi,
  /\b(?:limited|deluxe|anniversary|collector'?s?|exclusive|import|indie|target|walmart|urban outfitters|uo)\b/gi,
  /\b(?:colored|colour|color|clear|red|blue|green|yellow|pink|purple|orange|white|black|gold|silver|splatter|swirl|marbled|translucent|transparent)\s+vinyl\b/gi,
  /\b(?:vinyl|record|records|album|lp|2lp|3lp|4lp|ep|single)\b/gi,
  /\b(?:180g|180gram|180grams|heavyweight|remaster(?:ed)?|half-speed\s+master)\b/gi,
  /\b(?:pre[-\s]?order|sale|clearance|new|sealed|brand\s+new)\b/gi,
  /\bstaff\s+pick\b/gi,
  /\[[^\]]*\]/g,
  /\([^)]*(?:vinyl|lp|record|edition|exclusive|color|colour|soundtrack|remaster|sale|deal)[^)]*\)/gi,
];

export const EBAY_RESEARCH_NEW_CONDITION_ID = "1000";
export const EBAY_RESEARCH_VINYL_CATEGORY_ID = "176985";

export function normalizeResearchTitle(rawTitle: string): string {
  const title = rawTitle
    .replace(/[|:]+/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/\$\s*[0-9.,]+/g, " ")
    .trim();

  const firstUsefulSegment = title.split(/\s+(?:music\s+(?:on|and|from|by|performance)|was\s*\/\s*ea)\b/i)[0] ?? title;

  return cleanResearchText(
    EDITION_NOISE.reduce((current, pattern) => current.replace(pattern, " "), firstUsefulSegment)
      .replace(/\bat\s+(?:amazon|target|walmart|urban outfitters|barnes\s*&\s*noble|deep discount)\b.*$/gi, " ")
      .replace(/[()]/g, " "),
  );
}

export function normalizeResearchArtist(rawArtist: string): string {
  const artist = cleanResearchText(
    rawArtist
      .replace(/\b(?:def\s+jam|official\s+store|records?|recordings|music|shop|store|sound\s+of\s+vinyl)\b/gi, " ")
      .replace(/\b(?:unknown\s+artist|various\s+artists?)\b/gi, " "),
  );
  return artist;
}

export function buildResearchKeywords(artist: string, title: string): string {
  const normalizedArtist = normalizeResearchArtist(artist);
  const normalizedTitle = normalizeResearchTitle(title);
  const titleAlreadyHasArtist =
    normalizedArtist &&
    startsWithSameWords(normalizedTitle, normalizedArtist);
  return cleanResearchText(titleAlreadyHasArtist || !normalizedArtist ? normalizedTitle : `${normalizedArtist} ${normalizedTitle}`);
}

export function buildResearchKeywordVariants(artist: string, title: string): string[] {
  const primary = buildResearchKeywords(artist, title);
  const variants = new Set([primary]);
  const rawTitle = cleanResearchText(title.replace(/[()]/g, " "));

  if (/\bsoundtrack\b|\bmotion\s+picture\b/i.test(rawTitle)) {
    const baseTitle = normalizeResearchTitle(title);
    const normalizedArtist = normalizeResearchArtist(artist);
    const prefix = normalizedArtist && !startsWithSameWords(baseTitle, normalizedArtist) ? `${normalizedArtist} ` : "";
    if (baseTitle) {
      variants.add(cleanResearchText(`${prefix}${baseTitle}`));
      variants.add(cleanResearchText(`${prefix}${baseTitle} Soundtrack`));
      variants.add(cleanResearchText(`${prefix}${baseTitle} OST`));
    }
  }

  return [...variants].filter(Boolean);
}

export function buildNewVinylResearchUrl(artist: string, title: string): string {
  const url = new URL("https://www.ebay.com/sh/research");
  url.searchParams.set("marketplace", "EBAY-US");
  url.searchParams.set("keywords", buildResearchKeywords(artist, title));
  url.searchParams.set("dayRange", "1095");
  url.searchParams.set("categoryId", EBAY_RESEARCH_VINYL_CATEGORY_ID);
  url.searchParams.set("conditionId", EBAY_RESEARCH_NEW_CONDITION_ID);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "50");
  url.searchParams.set("sorting", "-itemssold");
  url.searchParams.set("tabName", "SOLD");
  url.searchParams.set("tz", "America/Los_Angeles");
  return url.toString();
}

function startsWithSameWords(value: string, prefix: string): boolean {
  return value.toLowerCase().split(/\s+/).slice(0, 4).join(" ") === prefix.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
}

function cleanResearchText(value: string): string {
  return value
    .replace(/[\u2013\u2014]/g, " ")
    .replace(/[–—]/g, " ")
    .replace(/[^A-Za-z0-9&'./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
