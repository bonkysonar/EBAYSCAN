import { assessEbayPurchaseDetail, assessEbayPurchaseItem, ebayDetailReleaseIdentity, getEbayApplicationToken } from './ebayPurchaseDiscovery.mjs';

const key = value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
const fail = (find, reason, now, unavailable = false) => ({
  ...find, purchaseOfferVerification:'discovery_lead',
  ...(unavailable ? {available:false} : {}),
  retailVerification:{status:unavailable ? 'unavailable' : 'failed',reason,checkedAt:now},
});

/** Refresh acquisition evidence only. Keep sold research and record identity unchanged. */
export function verifiedEbayOffer(find, detail, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const reject = (reason, unavailable = false) => fail(find,reason,now,unavailable);
  if (!find.ebayItemId || detail.itemId !== find.ebayItemId) return reject('listing_identity_changed');
  if (!key(detail.title) || key(detail.title) !== key(find.sourceListingTitle)) return reject('listing_title_changed');
  if (!options.deliveryPostalCode || options.deliveryCountry !== 'US') return reject('shipping_destination_unverified');
  // Unlike discovery search, getItem has no request-side category filter.
  if (String(detail.categoryId) !== '176985') return reject('record_category_unverified');
  const stocks = detail.estimatedAvailabilities ?? [];
  const stock = stocks.find(stock => stock.estimatedAvailabilityStatus === 'IN_STOCK' &&
      stock.estimatedAvailableQuantity !== 0 && stock.estimatedRemainingQuantity !== 0);
  if (!stock) return reject('availability_unconfirmed',true);
  const physical = assessEbayPurchaseDetail(detail);
  if (physical.status !== 'verified') return reject(physical.reason ?? 'record_format_unverified',physical.status === 'rejected');
  const identity = ebayDetailReleaseIdentity(detail);
  if (identity.identityStatus !== 'resolved') return reject('record_identity_unconfirmed');
  if (find.identityStatus === 'resolved' && (key(identity.artist) !== key(find.artist) || key(identity.title) !== key(find.title))) return reject('record_identity_changed');
  const quote = assessEbayPurchaseItem(detail,{},options);
  if (!quote.accepted) return reject(quote.reason,quote.reason === 'unavailable');
  return {...find,...quote.candidate,id:find.id,artist:find.artist,title:find.title,
    costs:{...find.costs,inboundShipping:0},available:true,stockStatus:'in_stock',capturedAt:now,
    quantityAvailable:stock.estimatedRemainingQuantity ?? stock.estimatedAvailableQuantity ?? null,
    purchasePriceUsd:quote.candidate.purchasePrice,shippingDestinationVerified:true,
    productIdentityVerification:'detail_aspects',productIdentityEvidence:physical.evidence,
    purchaseOfferVerification:'official_api',
    retailVerification:{status:'verified',reason:'exact_listing_price_shipping_stock_confirmed',checkedAt:now,
      advertisedPrice:quote.candidate.sourceItemPrice,shippingPrice:quote.candidate.sourceShippingPrice,currency:quote.candidate.sourceCurrency}};
}

/** Serial, authenticated Browse reads; stop on access/rate failure and invalidate old verification. */
export async function refreshEbayPurchaseOffers(finds,{env = process.env,fetchImpl = fetch,now = new Date().toISOString(),onProgress} = {}) {
  const output = [...finds], indexes = output.map((f,i)=>f.sourceId === 'ebay-purchase' ? i : -1).filter(i=>i>=0);
  const progress = {planned:indexes.length,checked:0,verified:0,failed:0,deferred:0};
  if (!indexes.length) return {finds:output,progress};
  const endpointRoot = env.EBAY_ENV === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
  const auth = await getEbayApplicationToken({endpointRoot,env,fetchImpl});
  const options = {deliveryCountry:'US',deliveryPostalCode:env.EBAY_DELIVERY_POSTAL_CODE,currency:'USD',now};
  let stopped = !auth.available || !options.deliveryPostalCode;
  const unavailableReason = !auth.available ? 'automatic_authentication_unavailable' : !options.deliveryPostalCode ? 'shipping_destination_unverified' : 'access_deferred';
  for (const index of indexes) {
    const find = output[index];
    if (stopped) {
      output[index] = fail(find,unavailableReason,now); progress.deferred++;
      continue;
    }
    progress.checked++;
    try {
      if (!find.ebayItemId || /^https?:/i.test(find.ebayItemId)) throw new Error('Stable eBay item ID unavailable');
      const url = `${endpointRoot}/buy/browse/v1/item/${encodeURIComponent(find.ebayItemId)}`;
      const response = await fetchImpl(url,{signal:AbortSignal.timeout(15000),headers:{
        Accept:'application/json',Authorization:`Bearer ${auth.token}`,
        'X-EBAY-C-MARKETPLACE-ID':env.EBAY_MARKETPLACE_ID ?? 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX':`contextualLocation=${encodeURIComponent(`country=US,zip=${options.deliveryPostalCode}`)}`,
      }});
      if ([401,403,429].includes(response.status)) stopped = true;
      if (!response.ok) {
        output[index] = fail(find,`Purchase verification HTTP ${response.status}`,now,[404,410].includes(response.status));
      } else {
        if (response.url && new URL(response.url).origin !== endpointRoot) throw new Error('API redirected outside configured origin');
        output[index] = verifiedEbayOffer(find,await response.json(),options);
      }
    } catch(error) { output[index] = fail(find,String(error?.message ?? error).slice(0,160),now); }
    if (output[index].retailVerification?.status === 'verified') progress.verified++;
    else progress.failed++;
    if (onProgress && (progress.checked % 10 === 0 || progress.checked === indexes.length || stopped)) await onProgress(output,{...progress});
  }
  return {finds:output,progress};
}
