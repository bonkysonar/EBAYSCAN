export function extractRetailCampaigns(
  source: Record<string, any>,
  html: string,
  pageUrl: string,
  capturedAt?: string,
): any[];
export function parseCampaignBlock(
  source: Record<string, any>,
  raw: string,
  pageUrl: string,
  capturedAt?: string,
): any[];
export function priceCampaignBasket(
  items: any[],
  campaign: any,
  now?: string,
): any;
export function applyCampaignOffers<T>(
  candidates: T[],
  campaigns: any[],
  now?: string,
): Array<
  T & { appliedSaleCampaignId?: string; purchaseOfferVerification?: string }
>;

export function campaignBasketScenario(
  candidates: any[],
  campaign: any,
  now?: string,
): any;
