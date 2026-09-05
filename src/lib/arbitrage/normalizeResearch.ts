import {
  EBAY_RESEARCH_NEW_CONDITION_ID,
  EBAY_RESEARCH_VINYL_CATEGORY_ID,
  buildBaseResearchQuery,
  buildEbayProductResearchUrl,
  buildSoldResearchQueryVariants,
  normalizeResearchArtist as normalizeSharedResearchArtist,
  normalizeResearchTitle as normalizeSharedResearchTitle,
} from "./soldResearchLinks.mjs";

export { EBAY_RESEARCH_NEW_CONDITION_ID, EBAY_RESEARCH_VINYL_CATEGORY_ID };

export function normalizeResearchTitle(rawTitle: string): string {
  return normalizeSharedResearchTitle(rawTitle);
}

export function normalizeResearchArtist(rawArtist: string): string {
  return normalizeSharedResearchArtist(rawArtist);
}

/** Artist and album names only; pressing checks happen on returned sales. */
export function buildResearchKeywords(artist: string, title: string): string {
  return buildBaseResearchQuery(artist, title);
}

/** Single release query retained in an array for saved-checkpoint compatibility. */
export function buildResearchKeywordVariants(artist: string, title: string): string[] {
  return buildSoldResearchQueryVariants({ artist, sourceListingTitle: title, title }).map(
    (variant) => variant.query,
  );
}

export function buildNewVinylResearchUrl(artist: string, title: string): string {
  return buildEbayProductResearchUrl(buildResearchKeywords(artist, title));
}
