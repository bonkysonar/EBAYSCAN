import { assessEbayPurchaseDetail, ebayDetailReleaseIdentity } from './ebayPurchaseDiscovery.mjs';
import { retailEligibility, shopifyIdentity } from './retailIdentity.mjs';

export const RETAIL_BARCODE_IDENTITY_VERSION = 1;
export function normalizedGtin(value) {
  const digits = String(value ?? '').trim();
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits) || /^0+$/.test(digits)) return null;
  const sum = [...digits.slice(0,-1)].reverse().reduce((total,digit,index)=>total + Number(digit) * (index % 2 ? 1 : 3),0);
  return (10-sum%10)%10 === Number(digits.at(-1)) ? digits.padStart(14,'0') : null;
}
const key = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const known = identity => identity?.identityStatus === 'resolved' && identity.artist && !/^unknown artist$/i.test(identity.artist);

/** Identity only. Active prices, ordering and seller popularity never supply value evidence. */
export async function resolveRetailBarcodeIdentity(find, { readRetailJson, readEbayJson, now = new Date().toISOString() }) {
  const base = { ...find, retailIdentityVersion:RETAIL_BARCODE_IDENTITY_VERSION, retailIdentityCheckedAt:now };
  const unknown = reason => ({...base,retailIdentityStatus:'unknown',retailIdentityReason:reason});
  if (!find.shopifyVariantId || !retailEligibility(find).eligible) return unknown('unsupported_or_ineligible');
  const url = new URL(find.sourceUrl), handle = url.pathname.match(/^\/products\/([^/]+)\/?$/)?.[1];
  if (url.protocol !== 'https:' || !handle || url.hostname.replace(/^www\./,'') !== String(find.sourceDomain ?? '').replace(/^www\./,'')) return unknown('unsupported_store_url');
  const product = await readRetailJson(`${url.origin}/products/${handle}.js`);
  const variant = product.variants?.find(row => String(row.id) === String(find.shopifyVariantId));
  if (product.handle !== decodeURIComponent(handle) || !variant) return unknown('variant_identity_changed');
  if (!key(product.title) || !key(find.sourceListingTitle).includes(key(product.title))) return unknown('retailer_title_changed');
  if (variant.available !== true || variant.requires_shipping === false) return {...unknown('variant_unavailable'),available:false};
  const ownIdentity = shopifyIdentity(product,variant,find);
  if (ownIdentity.physicalFormatConfirmed !== true || !retailEligibility({...find,...ownIdentity,sourceListingTitle:product.title,shopifyVariantTitle:variant.title}).eligible) return unknown('physical_variant_unverified');
  const gtin = normalizedGtin(variant.barcode);
  if (find.barcode && normalizedGtin(find.barcode) !== gtin) return unknown('barcode_changed');
  if (known(ownIdentity)) return {...base,...ownIdentity,barcode:variant.barcode || find.barcode,retailIdentityStatus:'resolved',retailIdentityReason:'retailer_metadata'};
  if (!gtin) return unknown('valid_barcode_missing');
  base.barcode = String(variant.barcode);
  const params = new URLSearchParams({gtin:base.barcode,category_ids:'176985',filter:'conditions:{NEW}',limit:'10'});
  const search = await readEbayJson(`/buy/browse/v1/item_summary/search?${params}`);
  const identities = [], details = search.itemSummaries ?? [];
  // A bounded metadata cross-check is distinct from exhaustive active/sold research.
  for (const summary of details.slice(0,5)) {
    if (!summary.itemId) continue;
    const detail = await readEbayJson(`/buy/browse/v1/item/${encodeURIComponent(summary.itemId)}`);
    const barcodes = [detail.gtin,...(detail.localizedAspects ?? []).filter(a=>/^(?:UPC|EAN|GTIN)$/i.test(a.name)).flatMap(a=>Array.isArray(a.value)?a.value:[a.value])].map(normalizedGtin).filter(Boolean);
    // This is a catalog-identity cross-check, not approval to purchase this eBay
    // listing. The retailer supplies physical stock evidence. Seller shipping
    // boilerplate about sleeves must not override explicit record aspects here.
    const metadata = {...detail,description:null,shortDescription:null};
    if (!barcodes.includes(gtin) || barcodes.some(value=>value!==gtin) || assessEbayPurchaseDetail(metadata).status !== 'verified') continue;
    const identity = ebayDetailReleaseIdentity(detail);
    if (!known(identity)) continue;
    // Require agreement with both the eBay listing and the retailer's own title.
    const ownAgreement = ebayDetailReleaseIdentity(detail,product.title);
    if (!known(ownAgreement)) return unknown('barcode_identity_conflict');
    identities.push(identity);
  }
  if (!identities.length) return unknown('barcode_identity_unconfirmed');
  if (new Set(identities.map(i=>`${key(i.artist)}|${key(i.title)}`)).size !== 1) return unknown('barcode_identity_conflict');
  const identity = identities[0];
  return {...base,artist:identity.artist,title:identity.title,identityStatus:'resolved',identitySource:'retailer_barcode_ebay_aspects',retailIdentityStatus:'resolved',retailIdentityReason:'exact_variant_gtin_and_title_agree',
    retailIdentityEvidence:{version:RETAIL_BARCODE_IDENTITY_VERSION,checkedAt:now,gtin,retailTitle:product.title,variantId:String(variant.id),matchedDetailCount:identities.length}};
}

/** Preserve a corroborated identity only while the exact retailer SKU and title still agree. */
export function reconciledShopifyIdentity(find, product, variant) {
  const own = shopifyIdentity(product,variant,find), evidence = find.retailIdentityEvidence;
  if (known(own) || find.identitySource !== 'retailer_barcode_ebay_aspects' || !known(find) || !evidence) return own;
  if (evidence.version !== RETAIL_BARCODE_IDENTITY_VERSION || evidence.gtin !== normalizedGtin(variant.barcode) || evidence.variantId !== String(variant.id) || key(evidence.retailTitle) !== key(product.title)) return own;
  return {...own,artist:find.artist,title:find.title,identityStatus:'resolved',identitySource:find.identitySource};
}
