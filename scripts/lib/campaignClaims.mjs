import { decodeHtmlEntities } from "./retailListingParsing.mjs";

// Shared by ingestion, pricing, and display so old observations cannot bypass
// conservative interpretation when a newly discovered wording case is fixed.
export function reviewCampaignClaim(campaign) {
  if (campaign.campaignTerms?.version !== 1) return campaign;
  const text = decodeHtmlEntities(
    String(campaign.evidence ?? campaign.saleEvidence ?? ""),
  );
  if (
    !/\b(?:music|vinyl|records?|lps?)\b/i.test(text) &&
    /off\s+["'][^"']*everything\b/i.test(text)
  )
    return null;
  const amount = Number(
    campaign.discountPercent ?? campaign.saleDiscountPercent,
  );
  const ranges = [...text.matchAll(/(\d{1,2})\s*%\s*[-–]\s*(\d{1,2})\s*%/g)];
  const upTo = ranges.some((match) => amount === Number(match[2]));
  let scope = campaign.scope ?? campaign.saleScope;
  const explicitWide =
    /\b(?:site[ -]?wide|store[ -]?wide|all\s+(?:music|vinyl|records?|lps?)|music\s*(?:&|and)\s*merch)\b/i.test(
      text,
    );
  if (!explicitWide && /\/collections\//i.test(campaign.sourceUrl ?? ""))
    scope = "collection";
  const claim = String(campaign.signal ?? campaign.saleSignal ?? text);
  const priceClaim = claim.replace(
    /free\s+(?:US\s+|domestic\s+)?shipping[^.;|]*/gi,
    "",
  );
  const minimumSpend = priceClaim.match(
    /\borders?\s*\$(\d+(?:\.\d{2})?)\s*\+/i,
  )?.[1];
  const maximumSpend = claim.match(
    /\borders?\s+under\s*\$(\d+(?:\.\d{2})?)/i,
  )?.[1];
  const minimumQuantity = text.match(
    /\b(\d+)\s*or\s*more\s*(?:vinyl|records?)/i,
  )?.[1];
  const codes = new Set(
    [...text.matchAll(/\bcode\s*:\s*['"]?([a-z0-9_-]{3,24})/gi)].map((m) =>
      m[1].toUpperCase(),
    ),
  );
  const terms = {
    ...campaign.campaignTerms,
    ...(minimumSpend ? { minimumSpend: Number(minimumSpend) } : {}),
    ...(maximumSpend ? { maximumSpend: Number(maximumSpend) } : {}),
    ...(minimumQuantity ? { minimumQuantity: Number(minimumQuantity) } : {}),
    ...(codes.size > 1 ? { termsUnresolved: true } : {}),
  };
  return {
    ...campaign,
    campaignTerms: terms,
    ...(Object.hasOwn(campaign, "scope") ? { scope } : { saleScope: scope }),
    ...(upTo
      ? Object.hasOwn(campaign, "discountQualifier")
        ? { discountQualifier: "up_to" }
        : { saleDiscountQualifier: "up_to" }
      : {}),
  };
}
