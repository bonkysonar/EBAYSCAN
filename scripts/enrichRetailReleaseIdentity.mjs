import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { getEbayApplicationToken, verifyEbayPurchaseCandidateDetails } from "./lib/ebayPurchaseDiscovery.mjs";
import { retailEligibility } from "./lib/retailIdentity.mjs";
import { resolveRetailBarcodeIdentity, RETAIL_BARCODE_IDENTITY_VERSION } from "./lib/retailBarcodeIdentity.mjs";

// Read-only API repair for the retained research pool. A listing's promotional
// suffix must not become the album sent to sold research.
const path = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Pass an unpublished retail draft path");
const payload = JSON.parse(readFileSync(path, "utf8"));
if (payload.phase !== "scan") throw new Error("Identity repair requires an unpublished scan draft");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const pool = payload.researchCandidates ?? payload.finds ?? [];
const now = Date.now();
const identityVersion = 2;
const queue = pool.filter(find => find.sourceId === "ebay-purchase" &&
  retailEligibility(find.releaseIdentityStatus === 'rejected' ? {...find,physicalFormatConfirmed:undefined} : find).eligible &&
  !(find.releaseIdentityVersion === identityVersion && ["resolved", "unknown", "rejected"].includes(find.releaseIdentityStatus) && now - Date.parse(find.releaseIdentityCheckedAt) >= -300000 && now - Date.parse(find.releaseIdentityCheckedAt) < 24 * 3600000));
const retailerQueue = pool.filter(find => find.shopifyVariantId && (find.identityStatus === 'unresolved' || !find.artist || /^unknown artist$/i.test(find.artist)) && retailEligibility(find).eligible &&
  !(find.retailIdentityVersion === RETAIL_BARCODE_IDENTITY_VERSION && ['resolved','unknown'].includes(find.retailIdentityStatus) && now - Date.parse(find.retailIdentityCheckedAt) >= -300000 && now - Date.parse(find.retailIdentityCheckedAt) < 24 * 3600000));
if (!queue.length && !retailerQueue.length) { console.log(JSON.stringify({ checked: 0, pending: 0 })); process.exit(0); }
const endpointRoot = process.env.EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const auth = await getEbayApplicationToken({ endpointRoot, env: process.env, fetchImpl: fetch });
if (!auth.available) throw new Error(auth.reason);
let checked = 0, resolved = 0, rejected = 0, failed = 0;
let apiHalted = false;
for (let offset = 0; offset < queue.length; offset += 10) {
  const batch = queue.slice(offset, offset + 10);
  const result = await verifyEbayPurchaseCandidateDetails(batch, {
    fetchImpl: fetch, maxDetailRequests: batch.length, token: auth.token, requestTimeoutMs: 15000,
    requestOptions: { endpointRoot, marketplaceId: process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US" },
  });
  const byId = new Map(result.candidates.map(find => [find.id, find]));
  const errors = new Set(result.diagnostics.errors.map(error => error.itemId));
  const updates = new Map(batch.map(find => {
    const updated = byId.get(find.id);
    if (!updated) { rejected++; return [find.id, { ...find, physicalFormatConfirmed: false, releaseIdentityStatus: "rejected", releaseIdentityVersion:identityVersion, releaseIdentityCheckedAt:new Date().toISOString() }]; }
    if (errors.has(find.ebayItemId)) { failed++; return [find.id, { ...find, releaseIdentityStatus: "failed" }]; }
    if (updated === find) return [find.id, find];
    if (updated.identitySource === "ebay_detail_aspects") resolved++;
    return [find.id, { ...updated, releaseIdentityVersion:identityVersion, releaseIdentityCheckedAt: new Date().toISOString(), releaseIdentityStatus: updated.identitySource === "ebay_detail_aspects" ? "resolved" : "unknown" }];
  }));
  for (const rows of [pool, ...(pool === payload.finds ? [] : [payload.finds ?? []])])
    for (let index = 0; index < rows.length; index++) if (updates.has(rows[index].id)) rows[index] = updates.get(rows[index].id);
  checked += result.diagnostics.attemptedCandidateCount;
  payload.releaseIdentityProgress = { checked, resolved, rejected, failed, remaining: queue.length - checked, checkedAt: new Date().toISOString() };
  writeFileSync(`${path}.tmp`, JSON.stringify(payload, null, 2)); renameSync(`${path}.tmp`, path);
  console.log(JSON.stringify(payload.releaseIdentityProgress));
  if (["rate_limited", "authentication_error"].includes(result.diagnostics.stopReason)) { apiHalted = true; break; }
}

const retailCache = new Map(), ebayCache = new Map(), blockedRetailHosts = new Set();
async function readJson(url, isEbay) {
  const target = new URL(url), cache = isEbay ? ebayCache : retailCache;
  if (apiHalted || (!isEbay && blockedRetailHosts.has(target.host))) throw new Error('Access deferred after authentication or rate-limit failure');
  if (cache.has(url)) return cache.get(url);
  const response = await fetch(url,{signal:AbortSignal.timeout(15000),headers:isEbay ? {Authorization:`Bearer ${auth.token}`,'X-EBAY-C-MARKETPLACE-ID':process.env.EBAY_MARKETPLACE_ID ?? 'EBAY_US'} : {Accept:'application/json'}});
  if ([401,403,429].includes(response.status)) { if (isEbay) apiHalted = true; else blockedRetailHosts.add(target.host); }
  if (!response.ok) throw new Error(`Metadata request HTTP ${response.status}`);
  if (new URL(response.url).origin !== target.origin) throw new Error('Metadata redirected outside requested origin');
  const data = await response.json(); cache.set(url,data); return data;
}
let retailChecked = 0, retailResolved = 0, retailFailed = 0;
for (const find of retailerQueue) {
  if (apiHalted) break;
  let update;
  try {
    update = await resolveRetailBarcodeIdentity(find,{readRetailJson:url=>readJson(url,false),readEbayJson:path=>readJson(`${endpointRoot}${path}`,true)});
    if (update.retailIdentityStatus === 'resolved') retailResolved++;
  } catch(error) {
    retailFailed++;
    update = {...find,retailIdentityStatus:'failed',retailIdentityCheckedAt:new Date().toISOString(),retailIdentityReason:String(error?.message ?? error).slice(0,160)};
  }
  for (const rows of [pool,...(pool === payload.finds ? [] : [payload.finds ?? []])])
    for (let index=0;index<rows.length;index++) if (rows[index].id === find.id) rows[index]=update;
  retailChecked++;
  payload.retailIdentityProgress = {checked:retailChecked,resolved:retailResolved,failed:retailFailed,remaining:retailerQueue.length-retailChecked,checkedAt:new Date().toISOString()};
  if (retailChecked % 10 === 0 || retailChecked === retailerQueue.length || apiHalted) {
    writeFileSync(`${path}.tmp`,JSON.stringify(payload,null,2));renameSync(`${path}.tmp`,path);
    console.log(JSON.stringify(payload.retailIdentityProgress));
  }
}
