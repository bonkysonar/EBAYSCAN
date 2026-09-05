import { reviewCampaignClaim } from "./campaignClaims.mjs";
import { createHash } from "node:crypto";
import { retailEligibility } from "./retailIdentity.mjs";
import { decodeHtmlEntities } from "./retailListingParsing.mjs";

const clean = (value) =>
  decodeHtmlEntities(String(value ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const music = /\b(?:vinyl|records?|lps?|music)\b/i;
const nonMusic =
  /\b(?:funko|figures?|figurines?|home\s*decor|homeware|apparel|shirts?|hoodies?|merch|accessories)\b/i;
const percent =
  /\b(?:(up\s+to|as\s+much\s+as)\s+)?(\d{1,2})\s*(?:%|percent)\s*off\b/gi;
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

/** A claim is parsed inside one retailer content block, never across the page title and a banner. */
export function extractRetailCampaigns(
  source,
  html,
  pageUrl,
  capturedAt = new Date().toISOString(),
) {
  const safeHtml = String(html).replace(
    /<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  const blocks = [
    ...safeHtml.matchAll(
      /<(title|a|p|h[1-6]|li|div|section)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    ),
  ]
    .flatMap((match) => {
      const nested = [
        ...match[2].matchAll(/<(a|p|h[1-6]|li|div)\b[^>]*>([\s\S]*?)<\/\1>/gi),
      ];
      return nested.length
        ? nested.map((item) => clean(item[2]))
        : [clean(match[2])];
    })
    .filter((value) => value.length > 5 && value.length <= 1200);
  // Plain-text adapters may already provide a single evidence block.
  if (!/<[a-z]/i.test(safeHtml)) blocks.push(clean(safeHtml));
  const events = blocks.flatMap((block) =>
    parseCampaignBlock(source, block, pageUrl, capturedAt),
  );
  const unique = new Map();
  for (const event of events.map(reviewCampaignClaim).filter(Boolean)) {
    const key = `${event.scope}:${event.discountPercent}:${event.discountQualifier}:${event.promoCode}:${event.campaignTerms.kind}:${event.campaignTerms.minimumSpend}:${event.campaignTerms.fixedAmount}`;
    if (!unique.has(key)) unique.set(key, event);
  }
  return [...unique.values()];
}

export function parseCampaignBlock(
  source,
  raw,
  pageUrl,
  capturedAt = new Date().toISOString(),
) {
  const block = clean(raw);
  if (
    /\b(?:expired|sale\s+has\s+ended|offer\s+ended|funko|pop!\s*vinyl|vinyl\s+figures?)\b/i.test(
      block,
    )
  )
    return [];
  const musicStore = /(?:label|record|audiophile)/i.test(source.retailSourceType ?? source.sourceType ?? "") || /(?:labels|Major label|Audiophile)/i.test(source.group ?? "");
  const musicCollectionClaim = musicStore && /\/collections\/[^/?]*(?:sale|clearance|offers?)/i.test(pageUrl) && /\b(?:sale|clearance|offers?)\b/i.test(block);
  // Read each advertised basket tier independently. Do not apply the highest
  // percentage to every order or turn a dollar discount into a percentage.
  const basketTiers = musicStore && /\bspend\s*:/i.test(block)
    ? [...block.matchAll(/\$(\d+(?:\.\d{2})?)\s+for\s+(?:(\d{1,2})\s*%|\$(\d+(?:\.\d{2})?))\s+off/gi)]
    : [];
  if (basketTiers.length) return basketTiers.map((tier) => campaign(source, tier[0], block, pageUrl, capturedAt, {scope:"collection",kind:tier[2] ? "percent" : "fixed",discountPercent:tier[2] ? Number(tier[2]) : null,discountQualifier:"exact",minimumSpend:Number(tier[1]),fixedAmount:tier[3] ? Number(tier[3]) : null}));
  const matches = [...block.matchAll(percent)];
  const offers = matches
    .map((match, i) => {
      // The next offer starts a new scope. A percent elsewhere in this block cannot supply this offer's scope.
      const before = block
        .slice(
          i ? matches[i - 1].index + matches[i - 1][0].length : 0,
          match.index,
        )
        .split(/[,.;|]/)
        .at(-1)
        .slice(-80);
      const after = block.slice(
        match.index + match[0].length,
        matches[i + 1]?.index ?? block.length,
      );
      const claim = `${match[0]} ${after}`.split(/[.;|]/)[0].trim();
      const scopeText = `${before} ${claim}`;
      if (!music.test(scopeText) && nonMusic.test(scopeText)) return null;
      if (
        !music.test(scopeText) &&
        !(musicCollectionClaim || (musicStore && /\b(?:select(?:ed)?\s+titles?|albums?)\b/i.test(scopeText))) &&
        !/\b(?:site[ -]?wide|store[ -]?wide|everything|entire\s+(?:site|store))\b/i.test(
          scopeText,
        )
      )
        return null;
      let scope = /\b(?:select|selected)\b/i.test(claim)
        ? "collection"
        : /\b(?:site[ -]?wide|store[ -]?wide|everything|entire\s+(?:site|store))\b/i.test(
              scopeText,
            )
          ? "sitewide"
          : /\b(?:all\s+(?:music|vinyl|records?|lps?)|off\s+(?:all\s+)?(?:music|vinyl|records?|lps?))\b/i.test(
                claim,
              )
            ? "vinyl-wide"
            : "collection";
      return campaign(source, claim, block, pageUrl, capturedAt, {
        discountPercent: Number(match[2]),
        discountQualifier: match[1] ? "up_to" : "exact",
        scope,
        kind: "percent",
      });
    })
    .filter(Boolean);
  if (offers.length) return offers;
  if (
    !music.test(block) &&
    !/\b(?:site[ -]?wide|store[ -]?wide|everything)\b/i.test(block)
  )
    return [];
  const fixed = block.match(/(?:\$|USD\s*)(\d+(?:\.\d{2})?)\s+off\b/i);
  const bogo = block.match(
    /\bbuy\s+(one|two|three|[1-5])\s+(?:records?\s+)?get\s+(one|two|[1-3])(?:\s+(?:free|at\s+(\d{1,2})%\s+off))?\b/i,
  );
  if (fixed || bogo || /\bBOGO\b/i.test(block))
    return [
      campaign(source, block, block, pageUrl, capturedAt, {
        scope: /\b(?:site[ -]?wide|store[ -]?wide|everything)\b/i.test(block)
          ? "sitewide"
          : "collection",
        kind: fixed ? "fixed" : "bogo",
        discountPercent: null,
        discountQualifier: "exact",
        fixedAmount: fixed ? Number(fixed[1]) : null,
        buyQuantity: bogo ? numberWord(bogo[1]) : 1,
        freeQuantity: bogo ? numberWord(bogo[2]) : 1,
        freeDiscountPercent: bogo?.[3] ? Number(bogo[3]) : 100,
      }),
    ];
  return [];
}

function campaign(source, claim, block, sourceUrl, capturedAt, offer) {
  const code =
    block
      .match(
        /\b(?:use\s+(?:promo\s+)?code|promo\s+code|discount\s+code|code\s*:)\s*['"]?([A-Z0-9][A-Z0-9_-]{2,24})/i,
      )?.[1]
      ?.toUpperCase() ?? null;
  const freeShippingMinimum = block.match(
    /free\s+(?:US\s+|domestic\s+)?shipping\s+(?:on\s+)?(?:orders?\s+)?(?:over\s+|of\s+|above\s+)?\$(\d+(?:\.\d{2})?)\+?/i,
  )?.[1];
  const noShipping = block.replace(
    /free\s+(?:US\s+|domestic\s+)?shipping[^.;|]*/gi,
    "",
  );
  const minimumSpend = noShipping.match(
    /\b(?:spend|orders?\s+(?:over|above|of)|minimum\s+(?:order|purchase|spend))\s*\$(\d+(?:\.\d{2})?)/i,
  )?.[1];
  const excludes = [
    ...block.matchAll(/\b(?:exclud(?:e[sd]?|ing)|except)\s+([^.;|]{2,120})/gi),
  ].map((match) => clean(match[1]));
  const genericExclusions =
    /exclusions\s+apply|see\s+(?:details\s*(?:&|and)\s*)?exclusions|select\s+items\s+only/i.test(
      block,
    );
  const campaignTerms = {
    version: 1,
    kind: offer.kind,
    fixedAmount: offer.fixedAmount ?? null,
    buyQuantity: offer.buyQuantity ?? null,
    freeQuantity: offer.freeQuantity ?? null,
    freeDiscountPercent: offer.freeDiscountPercent ?? null,
    minimumSpend: offer.minimumSpend ?? (minimumSpend ? Number(minimumSpend) : null),
    freeShippingMinimum: freeShippingMinimum
      ? Number(freeShippingMinimum)
      : null,
    excludedTerms: excludes,
    exclusionsUnresolved: genericExclusions && excludes.length === 0,
    stacking:
      /(?:cannot|can't|may\s+not|not)\s+(?:be\s+)?combin|not\s+(?:valid|applicable)\s+(?:on|with)\s+(?:sale|other)/i.test(
        block,
      )
        ? "forbidden"
        : /extra|additional|stack|including\s+sale|sale\s+items\s+included/i.test(
              claim,
            )
          ? "allowed"
          : "unknown",
    priceMode:
      /prices?\s+as\s+marked|discount\s+(?:is\s+)?(?:already\s+)?(?:reflected|included)|already\s+(?:reduced|discounted)/i.test(
        block,
      )
        ? "marked"
        : code
          ? "code"
          : "advertised",
    startsAt: explicitDate(
      block,
      /(?:starts?|begins?|from)\s+(\d{4}-\d{2}-\d{2})/i,
    ),
    endsAt: explicitDate(
      block,
      /(?:ends?|expires?|through|until)\s+(\d{4}-\d{2}-\d{2})/i,
      true,
    ),
    dateText:
      block.match(
        /\b(?:through|until|ends?\s+(?:on|at)|expires?)\s+[^.;|]{3,70}/i,
      )?.[0] ?? null,
    membershipRequired:
      /members?\s+only|first\s+order|new\s+customers?|subscription|cardholders?|app.only/i.test(
        block,
      ),
  };
  const fingerprint = digest([
    source.id,
    new URL(sourceUrl).pathname,
    offer,
    code,
    campaignTerms,
  ]);
  return {
    id: `sale-${fingerprint}`,
    fingerprint,
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl,
    capturedAt,
    verification: "retailer-page",
    ...offer,
    promoCode: code,
    campaignTerms,
    evidence: block.slice(0, 1000),
    signal: `${source.name}: ${claim.slice(0, 250)}`,
    title: `${source.name}: ${offer.discountPercent ? `${offer.discountQualifier === "up_to" ? "Up to " : ""}${offer.discountPercent}% off` : offer.kind === "fixed" ? `$${offer.fixedAmount} off` : "Multi-record offer"}`,
  };
}

/** Price an actual eligible basket; never pretend extra items are free inventory. */
export function priceCampaignBasket(
  items,
  campaign,
  now = new Date().toISOString(),
) {
  campaign = reviewCampaignClaim(campaign);
  if (!campaign) return { eligible: false, reasons: ["not_a_record_campaign"] };
  const terms = campaign.campaignTerms ?? {};
  const reasons = [];
  const lines = items.map((item) => ({
    id: item.id,
    quantity: Math.max(1, Math.floor(item.quantity ?? 1)),
    price: Number(item.purchasePrice),
  }));
  if (
    !lines.length ||
    lines.some(
      (line) =>
        !Number.isFinite(line.price) || line.price <= 0 || line.quantity > 100,
    )
  )
    return { eligible: false, reasons: ["invalid_basket"] };
  if (terms.endsAt && Date.parse(terms.endsAt) < Date.parse(now))
    reasons.push("campaign_expired");
  if (terms.startsAt && Date.parse(terms.startsAt) > Date.parse(now))
    reasons.push("campaign_not_started");
  if (terms.termsUnresolved) reasons.push("campaign_terms_unresolved");
  if (terms.membershipRequired) reasons.push("membership_required");
  const scope = campaign.scope ?? campaign.saleScope;
  const collection = collectionId(campaign.sourceUrl);
  for (const item of items) {
    const memberships = new Set(
      [item.collectionContext, ...(item.collectionContexts ?? [])].filter(
        Boolean,
      ),
    );
    const exact = Boolean(collection && memberships.has(collection));
    if (
      items[0].sourceCurrency &&
      item.sourceCurrency !== items[0].sourceCurrency
    )
      reasons.push("mixed_currency");
    if (item.sourceId !== campaign.sourceId) reasons.push("different_retailer");
    if (!["sitewide", "vinyl-wide"].includes(scope) && !exact)
      reasons.push("outside_collection");
    if (terms.exclusionsUnresolved && !exact)
      reasons.push("exclusions_unresolved");
    const identity = clean(
      `${item.artist} ${item.title} ${item.sourceListingTitle}`,
    );
    if (
      (terms.excludedTerms ?? []).some((term) => excludedMatch(identity, term))
    )
      reasons.push("excluded_product");
    if (
      (Number(item.sourceOriginalPrice) > item.purchasePrice ||
        Number(item.sourceDiscountPercent) > 0) &&
      terms.priceMode !== "marked" &&
      terms.stacking !== "allowed"
    )
      reasons.push("stacking_unconfirmed");
  }
  const subtotal = round(
    lines.reduce((sum, line) => sum + line.price * line.quantity, 0),
  );
  if (terms.minimumSpend && subtotal < terms.minimumSpend)
    reasons.push("minimum_spend");
  if (
    (campaign.discountQualifier ?? campaign.saleDiscountQualifier) === "up_to"
  )
    reasons.push("up_to_unconfirmed");
  if (terms.maximumSpend && subtotal >= terms.maximumSpend)
    reasons.push("maximum_spend");
  if (
    terms.minimumQuantity &&
    lines.reduce((sum, line) => sum + line.quantity, 0) < terms.minimumQuantity
  )
    reasons.push("minimum_quantity");
  let discount = 0;
  if (terms.priceMode !== "marked") {
    if (terms.kind === "bogo") {
      const prices = lines
        .flatMap((line) =>
          Array.from(
            { length: Math.min(line.quantity, 100) },
            () => line.price,
          ),
        )
        .sort((a, b) => a - b);
      const freeCount =
        Math.floor(prices.length / (terms.buyQuantity + terms.freeQuantity)) *
        terms.freeQuantity;
      if (!freeCount) reasons.push("minimum_quantity");
      discount =
        prices.slice(0, freeCount).reduce((sum, price) => sum + price, 0) *
        (terms.freeDiscountPercent / 100);
    } else if (terms.kind === "fixed")
      discount = Math.min(subtotal, Number(terms.fixedAmount) || 0);
    else
      discount =
        (subtotal *
          (Number(campaign.discountPercent ?? campaign.saleDiscountPercent) ||
            0)) /
        100;
  }
  const total = round(subtotal - discount);
  return {
    eligible: !reasons.length,
    reasons: [...new Set(reasons)],
    subtotal,
    discount: round(discount),
    total,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    freeShipping:
      terms.freeShippingMinimum != null && total >= terms.freeShippingMinimum,
    additionalSpendRequired: round(
      Math.max(0, (terms.minimumSpend ?? 0) - subtotal),
    ),
    lines: lines.map((line) => ({
      ...line,
      unitPrice: round((line.price * total) / subtotal),
    })),
  };
}

export function applyCampaignOffers(
  candidates,
  campaigns,
  now = new Date().toISOString(),
) {
  return candidates.map((candidate) => {
    const applicable = campaigns.filter(
      (campaign) =>
        campaign.campaignTerms?.version === 1 &&
        campaign.sourceId === candidate.sourceId &&
        (campaign.verification ?? campaign.saleVerification) ===
          "retailer-page",
    );
    const scenarios = applicable.map((campaign) => ({
      campaign,
      price: priceCampaignBasket([candidate], campaign, now),
    }));
    const best = scenarios
      .filter((entry) => entry.price.eligible)
      .sort((a, b) => a.price.total - b.price.total)[0];
    const campaignChecks = scenarios.map(({ campaign, price }) => ({
      campaignId: campaign.saleCampaignId ?? campaign.id,
      reasons: price.reasons,
    }));
    if (!best || best.price.total >= candidate.purchasePrice)
      return { ...candidate, campaignChecks };
    const campaign = best.campaign;
    return {
      ...candidate,
      campaignChecks,
      listPrice: candidate.listPrice ?? candidate.purchasePrice,
      sourceOriginalPrice:
        candidate.sourceOriginalPrice ?? candidate.purchasePrice,
      advertisedPurchasePrice: candidate.purchasePrice,
      purchasePrice: best.price.total,
      sourceDiscountPercent: round(
        (1 -
          best.price.total /
            (candidate.sourceOriginalPrice ?? candidate.purchasePrice)) *
          100,
      ),
      appliedSaleCampaignId: campaign.saleCampaignId ?? campaign.id,
      appliedSaleCode: campaign.promoCode ?? campaign.saleCode ?? null,
      appliedSaleDiscountPercent:
        campaign.discountPercent ?? campaign.saleDiscountPercent,
      appliedSaleEvidence: campaign.evidence ?? campaign.saleEvidence,
      appliedSaleScope: campaign.scope ?? campaign.saleScope,
      appliedSaleUrl: campaign.sourceUrl,
      appliedCampaign: campaign,
      purchaseOfferVerification: "campaign_advertised",
      costs: {
        ...candidate.costs,
        ...(best.price.freeShipping ? { inboundShipping: 0 } : {}),
      },
    };
  });
}

function collectionId(value) {
  try {
    return new URL(value).pathname.match(/\/collections\/([^/]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}
function numberWord(value) {
  return { one: 1, two: 2, three: 3 }[value.toLowerCase()] ?? Number(value);
}
function explicitDate(text, pattern, end = false) {
  const match = text.match(pattern);
  return match ? `${match[1]}T${end ? "23:59:59" : "00:00:00"}.000Z` : null;
}
function excludedMatch(identity, terms) {
  return terms
    .split(/,|\band\b|&/i)
    .map(clean)
    .some(
      (term) =>
        term.length > 2 && identity.toLowerCase().includes(term.toLowerCase()),
    );
}

export function campaignBasketScenario(
  candidates,
  campaign,
  now = new Date().toISOString(),
) {
  campaign = reviewCampaignClaim(campaign);
  if (!campaign) return { eligible: false, reasons: ["not_a_record_campaign"] };
  const terms = campaign.campaignTerms ?? {};
  if (
    !terms.minimumSpend &&
    !terms.freeShippingMinimum &&
    !["fixed", "bogo"].includes(terms.kind)
  )
    return null;
  const minimum = terms.minimumSpend ?? terms.freeShippingMinimum ?? 0;
  const eligible = candidates.filter(
    (f) =>
      f.sourceId === campaign.sourceId &&
      retailEligibility(f).eligible &&
      !priceCampaignBasket([f], campaign, now).reasons.some(
        (r) => !["minimum_quantity", "minimum_spend"].includes(r),
      ),
  );
  const unique = [
    ...new Map(
      eligible.map((f) => [f.barcode || f.shopifyVariantId || f.id, f]),
    ).values(),
  ];
  const sorted = unique.sort((a, b) => a.purchasePrice - b.purchasePrice);
  const pool = sorted.filter((f) => f.purchasePrice >= minimum / 3).slice(0, 3);
  for (const f of sorted) {
    if (pool.length >= 3) break;
    if (!pool.includes(f)) pool.push(f);
  }
  if (pool.length < 2) return null;
  const priced = priceCampaignBasket(pool, campaign, now);
  return {
    ...priced,
    currency: pool[0].sourceCurrency ?? "unknown",
    additionalCash: round(priced.total - (priced.lines?.[0]?.unitPrice ?? 0)),
    items: pool.map((f) => ({
      id: f.id,
      title: f.title,
      sourceUrl: f.sourceUrl,
      price: f.purchasePrice,
    })),
    assumptions:
      "All extra records are paid inventory. Before tax and selling costs; shipping threshold is advertised, not checkout-verified.",
  };
}
