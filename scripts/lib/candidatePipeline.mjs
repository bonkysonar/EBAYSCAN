const NAVIGATION_LABEL =
  /^(?:all|back|browse|cart|clearance|contact|deals?|discover|explore|featured|filter\s+amazon(?:\s+by\s+price)?|home|learn\s+more|log\s*in|lps?|menu|more|new|new\s+releases|next|previous|records?|sale|search|shop|shop\s+(?:all|now)|sign\s+in|specials?|view\s+(?:all|details|more)|vinyl)[\s!\u2192\u203a\u00bb]*$/i;
const PRODUCT_PATH =
  /\/(?:albums?|catalog|dp|ip|items?|music|p|product-detail|products?|releases?|sku|title|w)\//i;
const VINYL_FORMAT =
  /\b(?:vinyl|phonograph\s+record|record\s+album|(?:[1-9]\s*(?:[x\u00d7-]\s*)?)?lp|ep|(?:7|10|12)\s*(?:inch|in\.|["\u201d]))\b/i;
const MUSIC_SHAPE =
  /(?:\s[-\u2013\u2014:|]\s)|\b(?:album|anniversary|audiophile|edition|exclusive|gatefold|mono|remaster(?:ed)?|soundtrack|stereo)\b/i;
const PHYSICAL_NON_RECORD =
  /\b(?:4k\s+uhd|bag|blanket|blu[\s-]?ray|book|bottle|calendar|cassette|(?:\d+\s*x?\s*)?cds?|compact\s+disc|deck\s+bundle|dvd|earrings?|figurine|gift\s+card|guitar\s+picks?|hat|hoodie|jewelry|keychain|koozie|magazine|merch(?:andise)?\s+bundle|mug|necklace|ornament|patch|pin|pizza\s+cutter|placemat|poster|record\s+players?|shirt|slip\s*mat|socks|steelbook|sticker|sweatshirt|t[\s-]?shirts?|tee|tote|trading\s+card|turntables?|uhd|wallet|zine)\b/i;
const DIGITAL_NON_RECORD = /\b(?:digital|download|flac|mp3|streaming|wav)\b/i;
const RETAIL_NOISE =
  /\b(?:air\s+fryer|apparel|automotive|baby|bathing\s+suits?|beauty|bedding|bicycles?|bikinis?|bra(?:lette)?|bucket|cable|car\s+wash|cat\s+treats?|charger|cleaning|clothing|coffee|comforter|coolers?|cosmetics|decorations?|dish\s+soap|electronics?|eyeshadow|fitness\s+tracker|food|gimmicks?|goggles|granola|grocery|groceries|hair|handbags?|headphones?|ice\s+packs?|kitchen|knife|laundry|laptop|makeup|manicure|mattress|nail\s+colou?r|ornament|pants|paprika|pencils?|pens?|phone|protein|purse|sauce|screwdrivers?|shampoo|shoes?|shorts|skin\s*care|smart\s*watch|smartwatch|snacks?|speaker|supplement|swimdress|swimsuits?|swimwear|tablet|toothpaste|toys?|tuna|underwear|webcam|wipes?)\b/i;
const RECORD_ACCESSORY =
  /\b(?:45\s+adapter|cartridge|cleaning\s+(?:brush|fluid|kit)|coasters?|decal|display\s+frame|inner\s+sleeves?|label\s+decal|needle|non[- ]?adhesive\s+label|outer\s+sleeves?|paper\s+label|platter\s+mat|record\s+bowl|record\s+cleaner|replacement\s+(?:cover|jacket|sleeve|stylus)|slip\s*mat|stylus|storage\s+crate|turntable\s+(?:platter\s+)?mat|wall\s+clock)\b/i;
const PROMOTION_LABEL =
  /^(?:bogo|buy\s+(?:one|1)|extra\s+\d|free\s+shipping|get\s+(?:one|1)|members?\s+only|prime\s+members?|save\s+\d|select\s+(?:accounts?|items?|titles?)|up\s+to\s+\d|\d+\s*%\s*off)\b/i;
const NON_NEW_PRODUCT =
  /(?:^\s*[\[(]?\s*damaged\b|\b(?:damaged|used|pre[-\s]?owned)\s+(?:copy|lp|record|vinyl)\b|\b(?:open[\s-]?box|scratch\s+and\s+dent|shopworn)\b|\/(?:collections|products?)\/(?:damaged|pre[-_]?owned|used)(?:[-_/]|$))/i;
const DEFAULT_PURCHASE_TAX_RATE = 0.095;

export function assessRecordCandidate({ context = "", productType = "", source = {}, tags = "", title = "", url = "" } = {}) {
  const cleanTitle = cleanText(title);
  const directEvidence = cleanText(`${cleanTitle} ${productType} ${tags}`);
  const urlEvidence = safePathname(url).replace(/[-_/]+/g, " ");
  const negativeEvidence = cleanText(`${directEvidence} ${urlEvidence}`);
  const reasons = [];

  if (cleanTitle.length < 3) return rejected("title_too_short");
  if (NAVIGATION_LABEL.test(cleanTitle)) return rejected("navigation_label");
  if (isExpiredDealUrl(url)) return rejected("expired_deal");
  if (NON_NEW_PRODUCT.test(`${directEvidence} ${urlEvidence}`)) return rejected("non_new_condition");
  if (isMarketplaceNonRecordTitle(negativeEvidence)) return rejected("record_accessory");
  if (RECORD_ACCESSORY.test(negativeEvidence)) return rejected("record_accessory");

  const explicitVinyl = VINYL_FORMAT.test(directEvidence);
  const contextualVinyl = explicitVinyl || VINYL_FORMAT.test(context);
  const sourceIdentity = cleanText(`${source.id ?? ""} ${source.name ?? source.displayName ?? ""}`).toLowerCase();
  const marketplaceRetailer =
    source.sourceType === "marketplace_retailer" ||
    /\b(?:barnes-noble|barnes\s+&\s+noble|target|urban-outfitters|urban\s+outfitters|walmart)\b/i.test(sourceIdentity);
  if (marketplaceRetailer && !explicitVinyl) return rejected("marketplace_requires_explicit_vinyl");
  if (/(?:[?&]ean=)(?:978|979)\d{10}\b/i.test(String(url))) return rejected("isbn_book_listing");
  if (
    /\bcheap-vinyl\b|\bcheap\s+vinyl\b/i.test(sourceIdentity) &&
    /^(?:filter\s+amazon(?:\s+vinyl\s+records?)?\s+by\s+price|(?:vinyl\s+)?records?\s+under\s+\$?\d+|vinyl\s+under\s+\$?\d+|under)$/i.test(cleanTitle)
  ) {
    return rejected("deal_category_navigation");
  }
  if (
    /\bcheap-vinyl\b|\bcheap\s+vinyl\b/i.test(sourceIdentity) &&
    !explicitVinyl &&
    !MUSIC_SHAPE.test(cleanTitle)
  ) {
    return rejected("deal_aggregator_requires_record_title");
  }
  if (/\/[^/?#]*digital[-_/]album(?:[/?#]|$)/i.test(String(url))) {
    return rejected("digital_only_product");
  }
  if (PHYSICAL_NON_RECORD.test(negativeEvidence)) return rejected("non_vinyl_format");
  if (DIGITAL_NON_RECORD.test(directEvidence) && !explicitVinyl) return rejected("non_vinyl_format");
  if (RETAIL_NOISE.test(negativeEvidence) && !explicitVinyl) return rejected("non_music_retail_category");

  const productUrl = PRODUCT_PATH.test(safePathname(url));
  const sourceFocused = sourceIsVinylFocused(source);
  const musicShaped = MUSIC_SHAPE.test(cleanTitle);
  if (PROMOTION_LABEL.test(cleanTitle) && !musicShaped) return rejected("promotion_label");
  if (!explicitVinyl && !musicShaped && RETAIL_NOISE.test(context)) return rejected("non_music_retail_context");

  if (!explicitVinyl && !productUrl) return rejected("no_product_or_format_signal");
  if (!contextualVinyl && !sourceFocused && !musicShaped) return rejected("weak_record_signal");

  let score = 20;
  if (explicitVinyl) {
    score += 35;
    reasons.push("explicit_vinyl_format");
  }
  if (!explicitVinyl && contextualVinyl) {
    score += 10;
    reasons.push("contextual_vinyl_format");
  }
  if (productUrl) {
    score += 15;
    reasons.push("product_url");
  }
  if (musicShaped) {
    score += 8;
    reasons.push("music_title_shape");
  }
  if (sourceFocused) {
    score += 8;
    reasons.push("vinyl_focused_source");
  }

  score += sourceMetadataScore(source);
  return { accepted: true, reasons, score: clamp(score, 0, 100) };

  function rejected(reason) {
    return { accepted: false, reasons: [reason], score: 0 };
  }
}

export function candidateQualityScore(candidate) {
  const embeddedQuality = Number(candidate.candidateQualityScore);
  const hasEmbeddedQuality =
    candidate.candidateQualityScore !== null &&
    candidate.candidateQualityScore !== undefined &&
    Number.isFinite(embeddedQuality);
  // Parser confidence answers "is this a real record listing?"; it should not
  // outweigh demand, price, and market evidence when ordering the buy queue.
  let score = hasEmbeddedQuality ? embeddedQuality * 0.35 : sourceMetadataScore(candidate);

  const originalPrice = Number(candidate.sourceOriginalPrice);
  const purchasePrice = Number(candidate.purchasePrice);
  if (Number.isFinite(originalPrice) && Number.isFinite(purchasePrice) && originalPrice > purchasePrice) {
    score += Math.min(20, Math.round(((originalPrice - purchasePrice) / originalPrice) * 40));
  }

  const averageSoldPrice = Number(candidate.averageSoldPrice);
  const soldTotal =
    candidate.averageSoldPrice !== null &&
    candidate.averageSoldPrice !== undefined &&
    candidate.averageSoldPrice !== "" &&
    Number.isFinite(averageSoldPrice) &&
    averageSoldPrice > 0
      ? averageSoldPrice + (Number(candidate.averageSoldShipping) || 0)
      : null;
  if (soldTotal !== null && Number.isFinite(purchasePrice)) {
    score += Math.min(30, Math.max(-20, Math.round((soldTotal - purchasePrice) * 1.5)));
  }
  const validatedRecentUnits =
    candidate.soldEvidence?.status === "validated"
      ? Math.max(0, Number(candidate.soldEvidence?.unitsSold90Days) || 0)
      : 0;
  if (validatedRecentUnits > 0) {
    score += Math.min(12, Math.log2(1 + validatedRecentUnits) * 3);
  }
  const artistSoldUnits365Days = Math.max(0, Number(candidate.artistSoldUnits365Days) || 0);
  if (artistSoldUnits365Days >= 20) score += 25;
  else if (artistSoldUnits365Days >= 10) score += 20;
  else if (artistSoldUnits365Days >= 5) score += 14;
  else if (artistSoldUnits365Days >= 2) score += 7;
  const listingIdentity = cleanText(
    `${candidate.artist ?? ""} ${candidate.title ?? ""} ${candidate.sourceListingTitle ?? ""}`,
  );
  if (/^unknown artist$/i.test(cleanText(candidate.artist))) {
    score -= /\b(?:soundtrack|score)\b/i.test(listingIdentity) ? 8 : 25;
  }
  if (/\b(?:7\s*(?:inch|in\.|["\u201d])|7-inch|single)\b/i.test(listingIdentity)) score -= 15;
  if (/\bpromo\b/i.test(listingIdentity)) score -= 12;
  if (/\b(?:bundle|lot)\b/i.test(listingIdentity)) score -= 8;
  if (Number.isFinite(purchasePrice)) {
    if (purchasePrice <= 13) score += 12;
    else if (purchasePrice <= 15) score += 9;
    else if (purchasePrice <= 20) score += 5;
    else if (purchasePrice > 35) score -= 15;
    else if (purchasePrice > 25) score -= 10;
    else score -= 5;
  }
  const sourceCurrency = String(candidate.sourceCurrency ?? "").trim().toUpperCase();
  if (sourceCurrency && sourceCurrency !== "USD") score -= 8;
  if (candidate.discoveryUrl) score += 4;
  if (candidate.barcode) score += 4;
  if (candidate.sku) score += 2;
  if (candidate.availableVariantCount > 0) score += 2;
  if (candidate.retailerSoldBySource === true) score += 6;
  if (candidate.retailerBestSeller) score += 6;
  if (candidate.retailerCustomerPick) score += 4;
  const reviewCount = Math.max(0, Number(candidate.retailerReviewCount) || 0);
  if (reviewCount >= 100) score += 6;
  else if (reviewCount >= 20) score += 3;
  return score;
}

export function isHighSignalProductFind(find) {
  const sourceEvidence = `${find.sourceUrl ?? ""} ${find.discoveryUrl ?? ""} ${find.collectionContext ?? ""}`;
  const walmartSource = /\bwalmart\b/i.test(
    `${find.sourceId ?? ""} ${find.sourceName ?? ""} ${sourceEvidence}`,
  );
  const discoveryOnlySource = isDiscoveryOnlySource(find);
  const explicitUnavailable =
    find.available === false ||
    /\b(?:discontinued|out[_ -]?of[_ -]?stock|sold[_ -]?out|unavailable)\b/i.test(
      String(find.walmartStockStatus ?? find.stockStatus ?? ""),
    );
  if (
    walmartSource &&
    (find.retailerSoldBySource === false ||
      explicitUnavailable)
  ) {
    return false;
  }
  const directUsAbsolutePriceCandidate =
    Number.isFinite(Number(find.purchasePrice)) &&
    Number(find.purchasePrice) > 0 &&
    Number(find.purchasePrice) <= 20 &&
    !explicitUnavailable &&
    isVerifiedDirectUsNewRetailOffer(find);
  const fromFinalDealSource = isFinalDealSource(find.sourceId, find.sourceName, sourceEvidence);
  const trustedFinalDealSource = fromFinalDealSource && !discoveryOnlySource;
  const productSaleSignal = hasProductSaleSignal(`${find.sourceListingTitle ?? ""} ${sourceEvidence}`);
  const observedDiscount =
    Number.isFinite(Number(find.sourceDiscountPercent))
      ? Number(find.sourceDiscountPercent) / 100
      : Number.isFinite(Number(find.sourceOriginalPrice)) && Number(find.sourceOriginalPrice) > find.purchasePrice
        ? (Number(find.sourceOriginalPrice) - find.purchasePrice) / Number(find.sourceOriginalPrice)
        : 0;
  const configuredDiscount = Number(find.sourceDefaultDiscountThreshold);
  const meetsConfiguredDiscount =
    Number.isFinite(configuredDiscount) && configuredDiscount > 0 && observedDiscount >= configuredDiscount;
  const hasRealCompareAtPrice =
    Number.isFinite(Number(find.sourceOriginalPrice)) &&
    Number(find.sourceOriginalPrice) > Number(find.purchasePrice);
  const exploratoryMarkdownThreshold =
    Number.isFinite(configuredDiscount) && configuredDiscount > 0
      ? Math.max(0.25, configuredDiscount - 0.15)
      : 0.3;
  const hasCredibleExploratoryMarkdown =
    hasRealCompareAtPrice &&
    observedDiscount >= exploratoryMarkdownThreshold &&
    Number(find.candidateQualityScore ?? 0) >= 70;
  if (
    !trustedFinalDealSource &&
    !productSaleSignal &&
    !meetsConfiguredDiscount &&
    !hasCredibleExploratoryMarkdown &&
    !directUsAbsolutePriceCandidate
  ) {
    return false;
  }

  const volumeOfferWithoutNormalizedItemPrice =
    /\b(?:bogo|buy-more-save-more|buy\s+more\s+save\s+more|volume-sale|volume\s+sale)\b/i.test(
      sourceEvidence,
    ) && observedDiscount <= 0;
  if (volumeOfferWithoutNormalizedItemPrice) return false;
  if (directUsAbsolutePriceCandidate) return true;

  const sale = soldTotal(find);
  const margin = estimatedMargin(find);
  if (sale !== null) {
    return (
      (margin >= 5 && (find.totalSoldCount ?? 0) >= 2) ||
      margin >= 10 ||
      (sale >= 25 && find.purchasePrice <= 15)
    );
  }

  if (meetsConfiguredDiscount || hasCredibleExploratoryMarkdown) {
    return find.purchasePrice <= (find.sourceNoiseLevel === "high" ? 30 : 100);
  }
  const exploratoryPriceCeiling = find.sourceNoiseLevel === "high" ? 30 : 45;
  return find.purchasePrice <= exploratoryPriceCeiling && (trustedFinalDealSource || productSaleSignal);
}

export function applyVerifiedSaleCampaigns(candidates, campaigns) {
  const campaignsBySource = new Map();
  for (const campaign of campaigns ?? []) {
    const sourceId = cleanText(campaign?.sourceId);
    const discountPercent = Number(
      campaign?.discountPercent ?? campaign?.saleDiscountPercent,
    );
    const verification = cleanText(
      campaign?.verification ?? campaign?.saleVerification,
    ).toLowerCase();
    const evidence = campaignEvidence(campaign);
    if (!sourceId || verification !== "retailer-page") continue;
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 90) continue;
    if (/\b(?:up\s+to|as\s+much\s+as)\s+\d+\s*(?:%|percent\b)/i.test(evidence)) continue;
    if (/\b(?:bogo|buy\s+(?:one|1|2)\s+get|buy\s+more\s+save\s+more)\b/i.test(evidence)) continue;
    if (hasConditionalDiscountRequirement(evidence)) continue;

    const sourceCampaigns = campaignsBySource.get(sourceId) ?? [];
    sourceCampaigns.push({
      campaign,
      collectionId: collectionIdFromUrl(campaign?.sourceUrl),
      discountPercent,
      evidence,
      scope: cleanText(campaign?.scope ?? campaign?.saleScope).toLowerCase(),
    });
    campaignsBySource.set(sourceId, sourceCampaigns);
  }

  return (candidates ?? []).map((candidate) => {
    if (candidate?.appliedSaleCampaignId) return candidate;
    const currentPrice = finitePositive(candidate?.purchasePrice);
    if (currentPrice === null) return candidate;
    const existingListPrice = finitePositive(
      candidate?.sourceOriginalPrice ?? candidate?.listPrice,
    );
    const alreadyMarkedDown =
      (existingListPrice !== null && existingListPrice > currentPrice) ||
      Number(candidate?.sourceDiscountPercent) > 0;
    if (alreadyMarkedDown) return candidate;

    const candidateCollectionIds = new Set(
      [
        candidate?.collectionContext,
        ...(candidate?.collectionContexts ?? []),
        collectionIdFromUrl(candidate?.discoveryUrl),
        ...(candidate?.discoveryUrls ?? []).map(collectionIdFromUrl),
      ]
        .map(normalizedCollectionId)
        .filter(Boolean),
    );
    const applicable = (campaignsBySource.get(candidateSourceId(candidate)) ?? [])
      .map((entry) => ({
        ...entry,
        exactCollectionMatch:
          Boolean(entry.collectionId) && candidateCollectionIds.has(entry.collectionId),
      }))
      .filter(
        (entry) =>
          entry.exactCollectionMatch ||
          entry.scope === "sitewide" ||
          entry.scope === "vinyl-wide",
      )
      .sort(
        (left, right) =>
          Number(right.exactCollectionMatch) - Number(left.exactCollectionMatch) ||
          right.discountPercent - left.discountPercent,
      );
    const applied = applicable[0];
    if (!applied) return candidate;

    const listPrice = finitePositive(candidate?.listPrice) ?? currentPrice;
    const effectivePrice = roundMoney(listPrice * (1 - applied.discountPercent / 100));
    if (effectivePrice <= 0 || effectivePrice >= currentPrice) return candidate;
    const campaign = applied.campaign;

    return {
      ...candidate,
      appliedSaleCampaignId:
        cleanText(campaign.saleCampaignId ?? campaign.campaignId ?? campaign.id ?? campaign.fingerprint) ||
        null,
      appliedSaleCode: campaignPromoCode(campaign),
      appliedSaleDiscountPercent: applied.discountPercent,
      appliedSaleEvidence: applied.evidence,
      appliedSaleScope: applied.scope || null,
      appliedSaleUrl: campaign.sourceUrl ?? null,
      listPrice,
      purchasePrice: effectivePrice,
      purchaseOfferVerification: "campaign_advertised",
      sourceDiscountPercent: applied.discountPercent,
      sourceOriginalPrice: listPrice,
    };
  });
}

export function purchaseOfferVerificationForSource(candidate = {}, source = {}) {
  const explicit = cleanText(candidate?.purchaseOfferVerification).toLowerCase();
  if (["campaign_advertised", "direct_retailer", "discovery_lead", "official_api"].includes(explicit)) {
    return explicit;
  }
  const crawlType = cleanText(source?.crawlType ?? source?.sourceType).toLowerCase();
  const group = cleanText(source?.group).toLowerCase();
  const retailSourceType = cleanText(source?.retailSourceType ?? source?.sourceType).toLowerCase();
  if (crawlType === "deal-aggregator" || crawlType === "social-feed" || group === "discovery sources") {
    return "discovery_lead";
  }
  if (
    retailSourceType === "marketplace_retailer" &&
    cleanText(source?.id).toLowerCase() !== "ebay-purchase" &&
    candidate?.retailerSoldBySource !== true
  ) {
    return "discovery_lead";
  }
  return cleanText(source?.id).toLowerCase() === "ebay-purchase" ? "official_api" : "direct_retailer";
}

function hasConditionalDiscountRequirement(value) {
  return /\b(?:members?\s+only|membership\s+(?:only|required)|(?:rewards?|loyalty|club)\s+members?|prime\s+members?|app(?:-?only|\s+exclusive)|mobile\s+app|first\s+(?:order|purchase)|new\s+customers?|subscribe(?:rs?|\s+and\s+save)?|subscription\s+(?:only|required)|cardholders?|with\s+(?:the\s+)?(?:store|credit)\s+card|spend\s+\$?\d+|orders?\s+(?:over|above|of)\s+\$?\d+|minimum\s+(?:order|purchase|spend)|when\s+you\s+(?:buy|purchase)\s+\d+|(?:buy|purchase)\s+\d+\s+(?:or\s+more|items?|titles?)|tiered\s+(?:sale|discount|savings?))\b/i.test(
    String(value ?? ""),
  );
}

function campaignEvidence(campaign) {
  return cleanText(
    `${campaign?.evidence ?? campaign?.saleEvidence ?? ""} ${campaign?.signal ?? campaign?.saleSignal ?? ""} ${campaign?.title ?? campaign?.sourceListingTitle ?? ""}`,
  );
}

function campaignPromoCode(campaign) {
  const explicit = cleanText(
    campaign?.promoCode ?? campaign?.saleCode ?? campaign?.couponCode ?? campaign?.code,
  );
  if (explicit) return explicit;
  const match = campaignEvidence(campaign).match(
    /\b(?:promo(?:tional)?\s+code|discount\s+code|coupon\s+code|use\s+code|code)\s*[:\-]?\s*([a-z0-9][a-z0-9_-]{2,19})\b/i,
  );
  return match?.[1] ?? null;
}

function collectionIdFromUrl(value) {
  if (!value) return null;
  try {
    const match = new URL(String(value)).pathname.match(/\/collections\/([^/?#]+)/i);
    return normalizedCollectionId(match?.[1]);
  } catch {
    const match = String(value).match(/\/collections\/([^/?#]+)/i);
    return normalizedCollectionId(match?.[1]);
  }
}

function normalizedCollectionId(value) {
  if (!value) return null;
  try {
    return decodeURIComponent(String(value)).trim().toLowerCase() || null;
  } catch {
    return String(value).trim().toLowerCase() || null;
  }
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function rankAndSelectCandidates(candidates, options = {}) {
  return rankAndSelectCandidatesWithDiagnostics(candidates, options).selected;
}

export function rankAndSelectCandidatesWithDiagnostics(candidates, options = {}) {
  const inputCandidates = [...candidates];
  const dedupeResult =
    options.dedupePressings === false
      ? { candidates: inputCandidates, excluded: [] }
      : dedupePressingOffersWithDiagnostics(inputCandidates);
  const compareCandidates = options.compareCandidates ?? compareRankedCandidates;
  const ranked = dedupeResult.candidates.sort(compareCandidates);
  const requestedLimit = options.limit ?? ranked.length;
  const finiteRequestedLimit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.floor(requestedLimit))
    : null;
  const limit = Math.min(ranked.length, finiteRequestedLimit ?? ranked.length);
  const limitApplied = finiteRequestedLimit !== null && finiteRequestedLimit < ranked.length;
  const familyKey = (candidate) =>
    cleanText(options.familyKey?.(candidate)) || candidateSourceFamily(candidate);

  if (!limitApplied || limit <= 0 || ranked.length === 0) {
    const selected = limit <= 0 ? [] : ranked.slice(0, limit);
    const selectionPhases = new Map(selected.map((candidate) => [candidate, "ranked_fill"]));
    return {
      diagnostics: buildCandidateSelectionDiagnostics({
        dedupeExcluded: dedupeResult.excluded,
        familyKey,
        inputCandidates,
        limit,
        limitApplied,
        maxPerFamily: Number.POSITIVE_INFINITY,
        maxPerSource: Number.POSITIVE_INFINITY,
        options,
        ranked,
        requestedLimit: finiteRequestedLimit,
        selected,
        selectionPhases,
      }),
      selected,
    };
  }

  const sourceCount = new Set(ranked.map(candidateSourceId)).size;
  const maxPerSource =
    options.maxPerSource !== undefined
      ? Math.max(1, Math.floor(options.maxPerSource))
      : options.perSourceShare !== undefined
        ? Math.max(1, Math.ceil(limit * options.perSourceShare))
        : Math.max(
            Math.min(5, limit),
            Math.ceil(limit * 0.2),
            Math.ceil(limit / Math.max(1, sourceCount)),
          );
  const useFamilyExploration = options.familyExploration !== false;
  const familyCount = new Set(ranked.map(familyKey)).size;
  const maxPerFamily = useFamilyExploration
    ? Math.max(
        1,
        options.maxPerFamily ?? 0,
        Math.ceil(limit * (options.perFamilyShare ?? 0.5)),
        Math.ceil(limit / Math.max(1, familyCount)),
      )
    : Number.POSITIVE_INFINITY;
  const preserveTopCount = Math.min(
    limit,
    Math.max(
      0,
      options.preserveTopCount !== undefined
        ? Math.floor(options.preserveTopCount)
        : Math.ceil(limit * (options.preserveTopShare ?? 0.2)),
    ),
  );
  const selected = [];
  const selectedIds = new Set();
  const selectionPhases = new Map();
  const perSource = new Map();
  const perFamily = new Map();

  // Keep a tranche of the globally strongest opportunities before adding
  // diversity picks. Source and family caps still apply to this protected set.
  for (const candidate of ranked.slice(0, preserveTopCount)) {
    if (selected.length >= limit) break;
    add(candidate, "protected_quality", true);
  }

  if (useFamilyExploration) {
    const representedFamilies = new Set(perFamily.keys());
    for (const candidate of ranked) {
      if (selected.length >= limit) break;
      const familyId = familyKey(candidate);
      if (representedFamilies.has(familyId)) continue;
      if (add(candidate, "family_representation", true)) representedFamilies.add(familyId);
    }
  }

  // Give every eligible source its best remaining candidate when the visible
  // budget allows it. This is intentionally not limited to a small exploration
  // tranche: a source with many strong finds should not silently end at 0.
  addUnrepresentedSources(true);
  // If a family cap is the only thing preventing a source from appearing,
  // represent the source before using the remaining slots for repeated sources.
  addUnrepresentedSources(false);

  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    add(candidate, "ranked_fill", true);
  }

  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    add(candidate, "family_cap_relaxation", false);
  }

  selected.sort(compareCandidates);
  return {
    diagnostics: buildCandidateSelectionDiagnostics({
      dedupeExcluded: dedupeResult.excluded,
      familyKey,
      inputCandidates,
      limit,
      limitApplied,
      maxPerFamily,
      maxPerSource,
      options,
      ranked,
      requestedLimit: finiteRequestedLimit,
      selected,
      selectionPhases,
    }),
    selected,
  };

  function addUnrepresentedSources(enforceFamilyCap) {
    const representedSources = new Set(perSource.keys());
    for (const candidate of ranked) {
      if (selected.length >= limit) break;
      const sourceId = candidateSourceId(candidate);
      if (representedSources.has(sourceId)) continue;
      if (add(candidate, "source_representation", enforceFamilyCap)) {
        representedSources.add(sourceId);
      }
    }
  }

  function add(candidate, phase, enforceFamilyCap) {
    const sourceId = candidateSourceId(candidate);
    const familyId = familyKey(candidate);
    const identity = candidateSelectionIdentity(candidate, sourceId);
    if (selectedIds.has(identity)) return false;
    if ((perSource.get(sourceId) ?? 0) >= maxPerSource) return false;
    if (enforceFamilyCap && (perFamily.get(familyId) ?? 0) >= maxPerFamily) return false;
    selectedIds.add(identity);
    selected.push(candidate);
    selectionPhases.set(candidate, phase);
    perSource.set(sourceId, (perSource.get(sourceId) ?? 0) + 1);
    perFamily.set(familyId, (perFamily.get(familyId) ?? 0) + 1);
    return true;
  }
}

const CANDIDATE_SELECTION_PHASES = [
  "protected_quality",
  "family_representation",
  "source_representation",
  "ranked_fill",
  "family_cap_relaxation",
];
const CANDIDATE_EXCLUSION_REASONS = [
  "duplicate_pressing",
  "duplicate_candidate_identity",
  "source_cap",
  "family_cap",
  "selection_limit",
];

function buildCandidateSelectionDiagnostics({
  dedupeExcluded,
  familyKey,
  inputCandidates,
  limit,
  limitApplied,
  maxPerFamily,
  maxPerSource,
  options,
  ranked,
  requestedLimit,
  selected,
  selectionPhases,
}) {
  const rankByCandidate = new Map(ranked.map((candidate, index) => [candidate, index + 1]));
  const selectedSet = new Set(selected);
  const selectedIdentities = new Set(
    selected.map((candidate) =>
      candidateSelectionIdentity(candidate, candidateSourceId(candidate)),
    ),
  );
  const selectedPerSource = countBy(selected, candidateSourceId);
  const selectedPerFamily = countBy(selected, familyKey);
  const sourceDiagnostics = new Map();
  const excludedByReason = emptyCountRecord(CANDIDATE_EXCLUSION_REASONS);
  const selectedByPhase = emptyCountRecord(CANDIDATE_SELECTION_PHASES);
  const scoreCandidate = options.scoreCandidate ?? candidateQualityScore;

  for (const candidate of inputCandidates) {
    sourceDiagnostic(candidateSourceId(candidate)).inputCandidateCount += 1;
  }

  for (const { candidate } of dedupeExcluded) {
    recordExclusion(candidate, "duplicate_pressing");
  }

  for (const candidate of ranked) {
    const diagnostic = sourceDiagnostic(candidateSourceId(candidate));
    const rank = rankByCandidate.get(candidate) ?? null;
    diagnostic.eligibleCandidateCount += 1;
    if (diagnostic.bestCandidateRank === null || rank < diagnostic.bestCandidateRank) {
      diagnostic.bestCandidateRank = rank;
      const score = Number(scoreCandidate(candidate));
      diagnostic.bestCandidateScore = Number.isFinite(score) ? roundSelectionMetric(score) : null;
    }

    if (selectedSet.has(candidate)) {
      const phase = selectionPhases.get(candidate) ?? "ranked_fill";
      diagnostic.selectedCandidateCount += 1;
      diagnostic.selectedByPhase[phase] += 1;
      selectedByPhase[phase] += 1;
      if (diagnostic.bestSelectedRank === null || rank < diagnostic.bestSelectedRank) {
        diagnostic.bestSelectedRank = rank;
      }
      continue;
    }

    const sourceId = candidateSourceId(candidate);
    const familyId = familyKey(candidate);
    const identity = candidateSelectionIdentity(candidate, sourceId);
    const reason =
      selectedIdentities.has(identity)
        ? "duplicate_candidate_identity"
        : (selectedPerSource.get(sourceId) ?? 0) >= maxPerSource
          ? "source_cap"
          : selected.length >= limit
            ? "selection_limit"
            : (selectedPerFamily.get(familyId) ?? 0) >= maxPerFamily
              ? "family_cap"
              : "selection_limit";
    recordExclusion(candidate, reason);
  }

  const sources = [...sourceDiagnostics.values()]
    .map((diagnostic) => {
      const primaryExclusionReason = highestCountKey(diagnostic.excludedByReason);
      return {
        ...diagnostic,
        excludedCandidateCount:
          diagnostic.inputCandidateCount - diagnostic.selectedCandidateCount,
        primaryExclusionReason,
        selectedShare:
          selected.length > 0
            ? roundSelectionMetric(diagnostic.selectedCandidateCount / selected.length)
            : 0,
        selectionStatus:
          diagnostic.selectedCandidateCount > 0
            ? "selected"
            : primaryExclusionReason ?? "not_selected",
      };
    })
    .sort(
      (left, right) =>
        (left.bestCandidateRank ?? Number.POSITIVE_INFINITY) -
          (right.bestCandidateRank ?? Number.POSITIVE_INFINITY) ||
        left.sourceId.localeCompare(right.sourceId),
    );
  const representedSourceCount = sources.filter(
    (source) => source.selectedCandidateCount > 0,
  ).length;
  const eligibleSourceCount = sources.filter((source) => source.eligibleCandidateCount > 0).length;
  const largestSourceSelectedCount = Math.max(
    0,
    ...sources.map((source) => source.selectedCandidateCount),
  );
  const largestSourceShare =
    selected.length > 0
      ? roundSelectionMetric(largestSourceSelectedCount / selected.length)
      : 0;
  const sourceConcentrationHhi =
    selected.length > 0
      ? roundSelectionMetric(
          sources.reduce(
            (total, source) =>
              total + (source.selectedCandidateCount / selected.length) ** 2,
            0,
          ),
        )
      : 0;

  return {
    duplicatePressingCandidateCount: dedupeExcluded.length,
    effectiveLimit: limit,
    eligibleCandidateCount: ranked.length,
    eligibleSourceCount,
    excludedByReason,
    inputCandidateCount: inputCandidates.length,
    largestSourceSelectedCount,
    largestSourceShare,
    limitApplied,
    maxPerFamily: Number.isFinite(maxPerFamily) ? maxPerFamily : null,
    maxPerSource: Number.isFinite(maxPerSource) ? maxPerSource : null,
    representedSourceCount,
    requestedLimit,
    selectedByPhase,
    selectedCandidateCount: selected.length,
    sourceConcentrationHhi,
    sources,
    unrepresentedEligibleSourceCount: eligibleSourceCount - representedSourceCount,
  };

  function sourceDiagnostic(sourceId) {
    let diagnostic = sourceDiagnostics.get(sourceId);
    if (!diagnostic) {
      diagnostic = {
        bestCandidateRank: null,
        bestCandidateScore: null,
        bestSelectedRank: null,
        eligibleCandidateCount: 0,
        excludedByReason: emptyCountRecord(CANDIDATE_EXCLUSION_REASONS),
        inputCandidateCount: 0,
        selectedByPhase: emptyCountRecord(CANDIDATE_SELECTION_PHASES),
        selectedCandidateCount: 0,
        sourceId,
      };
      sourceDiagnostics.set(sourceId, diagnostic);
    }
    return diagnostic;
  }

  function recordExclusion(candidate, reason) {
    sourceDiagnostic(candidateSourceId(candidate)).excludedByReason[reason] += 1;
    excludedByReason[reason] += 1;
  }
}

function countBy(items, keyForItem) {
  const counts = new Map();
  for (const item of items) {
    const key = keyForItem(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function emptyCountRecord(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function highestCountKey(counts) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function roundSelectionMetric(value) {
  return Math.round(value * 10_000) / 10_000;
}

export function sourceMetadataScore(source) {
  let score = 0;
  const priority = Number(source.priority ?? source.sourcePriority);
  if (Number.isFinite(priority)) score += Math.max(0, 5 - priority) * 4;
  const saleLikelihood = source.saleLikelihood ?? source.sourceSaleLikelihood;
  const noiseLevel = source.noiseLevel ?? source.sourceNoiseLevel;
  if (saleLikelihood === "high") score += 8;
  else if (saleLikelihood === "medium") score += 4;
  if (noiseLevel === "low") score += 4;
  else if (noiseLevel === "high") score -= 6;
  if (source.sourceType === "deal-aggregator" || source.crawlType === "deal-aggregator") score -= 4;
  return score;
}

function sourceIsVinylFocused(source) {
  return /\b(?:vinyl|record|records|lps?|audiophile|soundtrack|label)\b/i.test(
    `${source.id ?? ""} ${source.name ?? source.displayName ?? ""} ${source.url ?? source.baseUrl ?? ""} ${source.group ?? ""} ${source.sourceType ?? ""}`,
  );
}

function hasProductSaleSignal(text) {
  return /\b(?:final\s+sale|clearance|closeout|super\s+sale|warehouse\s+(?:sale|overstock)|overstock|garage\s+sale|special\s+price|daily\s+deal|deep\s+discount|price\s+drop|vinyl\s+discount|buy\s+more\s+save\s+more|under\s+\$?\s*(?:10|15|20)|bogo|buy\s+(?:one|1|2)\s+get\s+(?:one|1)|[3-9][0-9]\s*%\s*off)\b/i.test(
    text,
  );
}

function isFinalDealSource(sourceId, sourceName, sourceUrl) {
  return /\b(?:final|clearance|closeout|super-sale|super\s+sale|deep-cuts|deep\s+cuts|deep-discount|deep\s+discount|on-sale|on\s+sale|deals?|daily-deal|specials?|special-price|price-drop|price\s+drop|cheap-vinyl|cheap\s+vinyl|slickdeals|discount|warehouse|overstock|garage|volume-sale|buy-more-save-more|under-?1?[0459]9?9?)\b/i.test(
    `${sourceId} ${sourceName} ${sourceUrl}`,
  );
}

function dedupePressingOffersWithDiagnostics(candidates) {
  const offersByPressing = new Map();
  const excluded = [];
  for (const [index, candidate] of candidates.entries()) {
    const identity =
      candidatePressingIdentity(candidate) ??
      `candidate:${candidateSelectionIdentity(candidate, candidateSourceId(candidate))}:${index}`;
    const current = offersByPressing.get(identity);
    if (!current) {
      offersByPressing.set(identity, { candidate, index });
      continue;
    }
    if (compareDuplicateOffers(candidate, current.candidate) < 0) {
      excluded.push(current);
      offersByPressing.set(identity, { candidate, index });
    } else {
      excluded.push({ candidate, index });
    }
  }
  return {
    candidates: [...offersByPressing.values()].map(({ candidate }) => candidate),
    excluded,
  };
}

function candidatePressingIdentity(candidate) {
  const gtin = normalizedGtin(
    candidate.barcode,
    candidate.upc,
    candidate.gtin,
    candidate.gtin14,
    candidate.gtin13,
    candidate.gtin12,
    candidate.gtin8,
  );
  if (gtin) return `gtin:${gtin}`;

  const artist = normalizeIdentityText(candidate.artist);
  const title = normalizedReleaseTitle(candidate, artist);
  if (artist.length < 2 || title.length < 2 || artist === "unknown artist") {
    const canonicalUrl = canonicalProductIdentityUrl(candidate.sourceUrl);
    return canonicalUrl ? `url:${canonicalUrl}` : null;
  }
  return `release:${artist}|${title}|${editionIdentity(candidate)}|${conditionIdentity(candidate.condition)}`;
}

function normalizedGtin(...values) {
  for (const value of values) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (![8, 12, 13, 14].includes(digits.length)) continue;
    let normalized = digits;
    while (normalized.length > 12 && normalized.startsWith("0")) normalized = normalized.slice(1);
    return normalized;
  }
  return null;
}

function normalizedReleaseTitle(candidate, normalizedArtist) {
  let value = cleanText(candidate.title ?? candidate.sourceListingTitle);
  value = value.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (group) =>
    hasEditionIdentitySignal(group) || /\b(?:ep|lp|record|vinyl)\b/i.test(group) ? " " : group,
  );
  value = value.replace(/\s+[-\u2013\u2014:|]\s+([^|]+)$/g, (group, suffix) =>
    hasEditionIdentitySignal(suffix) ? " " : group,
  );
  let normalized = normalizeIdentityText(value);
  if (normalizedArtist && normalized.startsWith(`${normalizedArtist} `)) {
    normalized = normalized.slice(normalizedArtist.length + 1);
  }
  return normalized
    .replace(/\b(?:on\s+)?(?:vinyl\s+record|vinyl\s+lp|record\s+lp|vinyl|record|lp)\b$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editionIdentity(candidate) {
  const raw = cleanText(
    [
      candidate.title,
      candidate.sourceListingTitle,
      candidate.shopifyVariantTitle,
      candidate.variantTitle,
    ].join(" "),
  );
  const normalized = normalizeIdentityText(raw);
  const parts = new Set();

  for (const match of normalized.matchAll(/\b(\d{1,3})(?:st|nd|rd|th)? anniversary\b/g)) {
    parts.add(`anniversary-${match[1]}`);
  }
  if (/\banniversary\b/.test(normalized) && ![...parts].some((part) => part.startsWith("anniversary-"))) {
    parts.add("anniversary");
  }
  for (const match of normalized.matchAll(/\b([2-9])\s*(?:x\s*)?lp\b/g)) parts.add(`${match[1]}lp`);
  for (const match of normalized.matchAll(/\b(180|200)\s*g\b/g)) parts.add(`${match[1]}g`);

  const fixedSignals = [
    ["audiophile", /\baudiophile\b/],
    ["box-set", /\bbox\s+set\b/],
    ["deluxe", /\bdeluxe\b/],
    ["expanded", /\bexpanded\b/],
    ["gatefold", /\bgatefold\b/],
    ["half-speed", /\bhalf\s+speed\b/],
    ["limited", /\blimited\b/],
    ["mono", /\bmono\b/],
    ["numbered", /\bnumbered\b/],
    ["picture-disc", /\bpicture\s+disc\b/],
    ["remastered", /\bremaster(?:ed)?\b/],
    ["reissue", /\breissue\b/],
    ["stereo", /\bstereo\b/],
  ];
  for (const [label, pattern] of fixedSignals) {
    if (pattern.test(normalized)) parts.add(label);
  }

  const exclusiveMatch = normalized.match(
    /\b(target|walmart|amazon|indie|urban outfitters|barnes and noble|barnes noble|b and n)\s+exclusive\b/,
  );
  if (exclusiveMatch) parts.add(`exclusive-${normalizeIdentityText(exclusiveMatch[1]).replace(/\s/g, "-")}`);
  else if (/\bexclusive\b/.test(normalized)) parts.add("exclusive");

  const colorNames = [
    "black",
    "blue",
    "brown",
    "clear",
    "cream",
    "gold",
    "gray",
    "green",
    "grey",
    "orange",
    "pink",
    "purple",
    "red",
    "silver",
    "transparent",
    "translucent",
    "white",
    "yellow",
  ];
  for (const color of colorNames) {
    if (
      new RegExp(`\\b${color}\\s+(?:colored\\s+)?(?:vinyl|lp)\\b|\\b(?:vinyl|lp)\\s+(?:in\\s+)?${color}\\b`).test(
        normalized,
      )
    ) {
      parts.add(`color-${color === "grey" ? "gray" : color}`);
    }
  }
  for (const texture of ["galaxy", "marble", "marbled", "smoke", "splatter", "swirl"]) {
    if (new RegExp(`\\b${texture}\\b`).test(normalized)) {
      parts.add(`texture-${texture === "marbled" ? "marble" : texture}`);
    }
  }

  return [...parts].sort().join(",") || "standard";
}

function hasEditionIdentitySignal(value) {
  return /\b(?:[2-9]\s*(?:x\s*)?lp|180\s*g|200\s*g|anniversary|audiophile|black\s+(?:vinyl|lp)|blue\s+(?:vinyl|lp)|box\s+set|clear\s+(?:vinyl|lp)|deluxe|expanded|exclusive|gatefold|gold\s+(?:vinyl|lp)|half\s+speed|limited|marbl(?:e|ed)|mono|numbered|orange\s+(?:vinyl|lp)|picture\s+disc|pink\s+(?:vinyl|lp)|purple\s+(?:vinyl|lp)|red\s+(?:vinyl|lp)|reissue|remaster(?:ed)?|silver\s+(?:vinyl|lp)|smoke|splatter|stereo|swirl|transparent\s+(?:vinyl|lp)|translucent\s+(?:vinyl|lp)|white\s+(?:vinyl|lp)|yellow\s+(?:vinyl|lp))\b/i.test(
    String(value ?? ""),
  );
}

function conditionIdentity(value) {
  const condition = String(value ?? "");
  if (/\b(?:pre[-\s]?owned|used|very\s+good|vg|near\s+mint|nm|fair|poor)\b/i.test(condition)) {
    return "used";
  }
  if (/\b(?:brand\s+new|factory\s+sealed|new|sealed)\b/i.test(condition)) return "new";
  return "unknown";
}

function normalizeIdentityText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareDuplicateOffers(left, right) {
  const leftUnavailable = left.available === false || /\b(?:out\s+of\s+stock|sold\s+out|unavailable)\b/i.test(String(left.stockStatus ?? ""));
  const rightUnavailable = right.available === false || /\b(?:out\s+of\s+stock|sold\s+out|unavailable)\b/i.test(String(right.stockStatus ?? ""));
  if (leftUnavailable !== rightUnavailable) return leftUnavailable ? 1 : -1;
  const leftThirdParty = left.retailerSoldBySource === false;
  const rightThirdParty = right.retailerSoldBySource === false;
  if (leftThirdParty !== rightThirdParty) return leftThirdParty ? 1 : -1;

  const leftPrice = finitePositive(left.purchasePrice);
  const rightPrice = finitePositive(right.purchasePrice);
  if (leftPrice !== null && rightPrice !== null && leftPrice !== rightPrice) return leftPrice - rightPrice;
  if (leftPrice !== null || rightPrice !== null) return leftPrice === null ? 1 : -1;
  return compareRankedCandidates(left, right);
}

function compareRankedCandidates(left, right) {
  return (
    candidateQualityScore(right) - candidateQualityScore(left) ||
    String(left.sourceName ?? "").localeCompare(String(right.sourceName ?? "")) ||
    String(left.title ?? "").localeCompare(String(right.title ?? ""))
  );
}

function candidateSourceId(candidate) {
  return String(candidate.sourceId ?? candidate.sourceName ?? "unknown");
}

function candidateSourceFamily(candidate) {
  const group = normalizeIdentityText(candidate.sourceGroup ?? candidate.group);
  const retailType = normalizeIdentityText(candidate.sourceRetailType);
  const crawlType = normalizeIdentityText(candidate.sourceCrawlType ?? candidate.crawlType);
  const sourceType = normalizeIdentityText(candidate.sourceType);
  const parts = [
    group ? `group:${group}` : null,
    retailType ? `retail:${retailType}` : null,
    crawlType ? `crawl:${crawlType}` : null,
    sourceType && sourceType !== crawlType ? `type:${sourceType}` : null,
  ].filter(Boolean);
  return parts.join("|") || `source:${normalizeIdentityText(candidateSourceId(candidate)) || "unknown"}`;
}

function candidateSelectionIdentity(candidate, sourceId) {
  return String(
    candidate.id ??
      `${sourceId}|${candidate.sourceUrl ?? ""}|${candidate.title ?? candidate.sourceListingTitle ?? ""}`,
  );
}

function finitePositive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function isVerifiedDirectUsNewRetailOffer(find) {
  if (!isUsCountry(find.sourceCountry)) return false;
  if (String(find.sourceCurrency ?? "").trim().toUpperCase() !== "USD") return false;
  if (!isNewCondition(find.condition)) return false;
  if (isDiscoveryOnlySource(find)) return false;
  if (hasExplicitThirdPartySeller(find)) return false;

  const productHost = normalizedHostname(find.sourceUrl);
  const configuredHost = normalizedHostname(find.sourceDomain);
  const directDomainMatch =
    Boolean(productHost) &&
    Boolean(configuredHost) &&
    (productHost === configuredHost || productHost.endsWith(`.${configuredHost}`));
  return directDomainMatch || (find.retailerSoldBySource === true && Boolean(productHost));
}

function isUsCountry(value) {
  return /^(?:us|usa|united states|united states of america)$/i.test(String(value ?? "").trim());
}

function isNewCondition(value) {
  const condition = String(value ?? "").trim();
  if (/\b(?:fair|near\s+mint|nm|poor|pre[-\s]?owned|used|very\s+good|vg)\b/i.test(condition)) {
    return false;
  }
  return /\b(?:brand\s+new|factory\s+sealed|new|sealed)\b/i.test(condition);
}

function isDiscoveryOnlySource(find) {
  const sourceFamily = [
    find.crawlType,
    find.sourceCrawlType,
    find.sourceGroup,
    find.sourceRetailType,
    find.sourceType,
    find.verification,
  ]
    .filter(Boolean)
    .join(" ");
  if (/\b(?:deal[-_\s]?aggregator|discovery[-_\s]?lead|discovery\s+sources?|distributor[-_\s]?discovery|social[-_\s]?feed)\b/i.test(sourceFamily)) {
    return true;
  }
  return /^(?:cheap-vinyl(?:$|-)|reddit-|slickdeals-vinyl-records(?:$|-)|vinyl-price-drop(?:$|-))/i.test(
    String(find.sourceId ?? ""),
  );
}

function hasExplicitThirdPartySeller(find) {
  if (find.retailerSoldBySource === false) return true;
  const seller = normalizedSellerIdentity(find.retailerSellerName);
  if (!seller || find.retailerSoldBySource === true) return false;

  const sourceIdentities = [find.sourceId, find.sourceName, find.sourceDomain]
    .map(normalizedSellerIdentity)
    .filter(Boolean);
  return !sourceIdentities.some(
    (sourceIdentity) =>
      sourceIdentity === seller ||
      sourceIdentity.includes(seller) ||
      seller.includes(sourceIdentity),
  );
}

function normalizedSellerIdentity(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:com|company|corp|corporation|inc|llc|online|store|stores)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizedHostname(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function canonicalProductIdentityUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const shopifyProduct = url.pathname.match(/(?:^|\/)collections\/[^/]+\/products\/([^/?#]+)/i);
    if (shopifyProduct) url.pathname = `/products/${shopifyProduct[1]}`;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key !== "variant") url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return null;
  }
}

function isExpiredDealUrl(value) {
  let decoded = String(value ?? "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original URL when malformed percent escapes prevent decoding.
  }
  return /\bthread:expired:true\b/i.test(decoded);
}

function estimatedMargin(find) {
  const sale = soldTotal(find);
  if (sale === null) return Number.NEGATIVE_INFINITY;
  return sale - find.purchasePrice * (1 + DEFAULT_PURCHASE_TAX_RATE);
}

function soldTotal(find) {
  if (find.averageSoldPrice === null || find.averageSoldPrice === undefined) return null;
  return find.averageSoldPrice + (find.averageSoldShipping ?? 0);
}

function safePathname(value) {
  try {
    return new URL(String(value), "https://invalid.local").pathname;
  } catch {
    return String(value ?? "");
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
import { isMarketplaceNonRecordTitle } from "../../src/lib/arbitrage/marketplaceProductClassification.mjs";
