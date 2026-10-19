import type { CandidateListing, SearchResult } from "../ebay/types";
import { mediaGradeFromListing, sellerCondition, sellerSearchQuery } from "./search";
import type { SellerListing } from "./types";

export function sellerListingBlocker(listing: SellerListing): string | undefined {
  if (/\b(?:lot|bundle|trading cards?|baseball card|basketball card|songbook|sheet music|cassette|CD)\b/i.test(listing.title)) return "Non-record item or mixed lot needs a different pricing model.";
  if (listing.hasVariations || (listing.listingType && !["FixedPriceItem", "StoresFixedPrice"].includes(listing.listingType))) return "Auction or variation listing requires individual review.";
  if (sellerCondition(listing) === "new" && /\b(?:VG[+-]?|EX\+?|G[+-]?)\s*\//i.test(listing.title)) return "The title says new/sealed but also gives a used media grade; confirm condition.";
  return undefined;
}

export function diagnoseSellerComparables(listing: SellerListing, result: SearchResult, ownIds: Iterable<string> = []) {
  const excluded = new Set([...ownIds, listing.id].map(legacyId));
  const seen = new Set<string>();
  const queryTokens = sellerTitleTokens(sellerSearchQuery(listing.title));
  const grade = mediaGradeFromListing({ ...listing, condition: listing.condition ?? "" });
  const condition = sellerCondition(listing);
  const rejected: Record<string, number> = {};
  const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; return false; };
  const comparables = result.listings.filter(comp => {
    const id = legacyId(comp.id);
    if (excluded.has(id)) return reject("own_inventory");
    if (seen.has(id)) return reject("duplicate");
    seen.add(id);
    if (comp.source !== "ebay" || comp.currency !== listing.currency || !Number.isFinite(comp.price) || comp.price <= 0) return reject("source_currency_price");
    if (/\b(cd|cassette|8.track|shellac|78\s*rpm|lot|bundle|sleeve\s*only|cover\s*only|you choose|pick your)\b/i.test(comp.title)) return reject("format_or_bundle");
    if (/\b(?:no|without|missing)\s+(?:sleeve|cover|jacket)\b|\b(?:record|disc)\s+only\b/i.test(comp.title)) return reject("incomplete_copy");
    if (isSevenInch(comp.title) !== isSevenInch(listing.title)) return reject("format_or_bundle");
    const ownDiscs = discCount(listing.title), otherDiscs = discCount(comp.title);
    if (ownDiscs !== null && otherDiscs !== null && ownDiscs !== otherDiscs) return reject("disc_count");
    const compQuery = sellerSearchQuery(comp.title);
    const candidateTokens = new Set(sellerTitleTokens(compQuery));
    if (queryTokens.length < 2 || !queryTokens.every(token => candidateTokens.has(token))) return reject("title_identity");
    const identityParts = sellerSearchQuery(listing.title).split(/\s+-\s*/);
    const artistTokens = sellerTitleTokens(identityParts[0]);
    const albumTokens = sellerTitleTokens(identityParts.slice(1).join(" "));
    if (albumTokens.length && albumTokens.every(token => artistTokens.includes(token))) {
      // Eponymous albums otherwise match every album by this artist. Require an
      // explicit self-titled marker or repeated album identity in the candidate.
      const words = compQuery.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/);
      if (!/\bself[ -]?titled\b|\bs\s*\/\s*t\b/i.test(comp.title) && !albumTokens.every(token => words.filter(word => word === token).length >= 2)) return reject("ambiguous_self_titled");
    }
    // Extra album names separated by / or + are a bundle, whereas 2LP alone can
    // simply be the normal format of this album. Missing disc count stays unknown.
    const extra = [...candidateTokens].filter(token => !queryTokens.includes(token) && !/^\d+$/.test(token) && !["vg", "ex", "nm", "mint"].includes(token));
    if (/\s[\/+ ]*[\/+][\/+ ]*\s/.test(compQuery) && extra.length >= 1 && !/[\/+]/.test(sellerSearchQuery(listing.title))) return reject("format_or_bundle");
    const options = comp.buyingOptions ?? (comp.raw as { buyingOptions?: string[] } | undefined)?.buyingOptions;
    if (options && !options.includes("FIXED_PRICE")) return reject("auction");
    if (condition !== "both" && sellerCondition(comp) !== condition) return reject("condition");
    if (sellerCondition(comp) === "new" && /\b(?:VG[+-]?|EX\+?|G[+-]?)\s*\//i.test(comp.title)) return reject("condition");
    const compGrade = mediaGradeFromListing(comp);
    if (compGrade === "Unknown") return reject("grade_unknown");
    if (grade !== "Unknown" && compGrade !== grade) return reject("grade_mismatch");
    if (editionSignature(listing.title) !== editionSignature(comp.title)) return reject("edition");
    return true;
  }).sort((a, b) => a.price - b.price);
  return { comparables, rejected, returnedCount: result.listings.length };
}

export function sellerTitleTokens(title: string): string[] {
  const noise = new Set(["the", "and", "a", "an", "lp", "vinyl", "record", "records", "album", "stereo", "used", "sealed", "original"]);
  return [...new Set(title.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[’']/g, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(token => token && !noise.has(token)))];
}
function legacyId(id: string): string { return id.match(/^v1\|([^|]+)\|/)?.[1] ?? id; }
function discCount(title: string): number | null {
  if (/\b(?:double|two)\s*(?:lp|album|record)/i.test(title)) return 2;
  if (/\b(?:triple|three)\s*(?:lp|album|record)/i.test(title)) return 3;
  const found = title.match(/\b([2-9]|[1-9]\d)\s*(?:x|-)?\s*(?:lps?\b|records?\b|albums?\b)/i);
  return found ? Number(found[1]) : null;
}
function isSevenInch(title: string): boolean {
  return /\b7\s*(?:inch|["″]|''|in\b)/i.test(title) || (/\b45(?:\s*rpm)?\b/i.test(title) && !/\b12\s*(?:inch|["″]|''|in\b)/i.test(title));
}
function editionSignature(title: string): string {
  const normalized = title.toLowerCase().replace(/promotional/g, "promo").replace(/remastered/g, "remaster").replace(/japanese/g, "japan").replace(/mobile fidelity|mofi/g, "mfsl").replace(/coloured/g, "colored");
  const tags = [...normalized.matchAll(/\b(mono|promo|test pressing|mfsl|picture disc|colored|japan|half[ -]speed|audiophile|180\s*g|200\s*g|remaster)\b/gi)].map(m => m[1].replace(/[ -]/g, ""));
  for (const match of normalized.matchAll(/\b(red|blue|white|green|yellow|orange|purple|pink|clear|silver|gold|bone|splatter|marbled)\s+(?:colou?r(?:ed)?\s+)?(?:vinyl|edition|records?)\b/g)) tags.push(`color:${match[1]}`);
  return [...new Set(tags)].sort().join("|");
}
