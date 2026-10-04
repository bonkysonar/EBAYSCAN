import { buildActiveSearchProfile } from '../../src/lib/arbitrage/activeEbayMatching.mjs';

export const ACTIVE_EVIDENCE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const fields = [
  'ebayActiveSearchStatus', 'ebayActiveMatchingVersion', 'ebayActiveDestinationKey',
  'ebayActiveProfileKey', 'ebayActiveSearchUpdatedAt', 'ebayActiveSearchKeyword',
  'ebayActiveSearchUrl', 'ebayActiveSearchVariants', 'activeListingCount',
  'activeListingCountIsExactMatch', 'activeEvidence', 'ebayActiveEditionIdentity',
  'ebayActiveMatchConfidence', 'ebayActiveExcludedSourceListingCount',
  'ebayActiveRawListingsInspected', 'ebayActiveSearchComplete', 'exactActiveListingCount',
  'lowestActivePrice', 'lowestActivePriceDestinationVerified', 'lowestActiveItemPrice',
  'lowestActiveShippingPrice', 'lowestActiveTitle', 'lowestActiveUrl', 'ebayActiveListings',
];

function key(profile, options) {
  return JSON.stringify([options.matchingVersion, options.destinationKey, profile]);
}

function valid(record, options, now) {
  const evidence = record?.evidence;
  if (!evidence || !evidence.ebayActiveProfileKey) return false;
  const checked = Date.parse(evidence.ebayActiveSearchUpdatedAt);
  return Number.isFinite(checked) && checked <= now + 300000 &&
    now - checked <= ACTIVE_EVIDENCE_CACHE_MAX_AGE_MS &&
    evidence.ebayActiveMatchingVersion === options.matchingVersion &&
    evidence.ebayActiveDestinationKey === options.destinationKey &&
    record.key === key(evidence.ebayActiveProfileKey, options) &&
    ['available', 'no_results'].includes(evidence.ebayActiveSearchStatus) &&
    evidence.ebayActiveSearchComplete === true && evidence.activeEvidence?.searchComplete === true &&
    evidence.activeEvidence.status === evidence.ebayActiveSearchStatus &&
    Date.parse(evidence.activeEvidence.capturedAt) === checked;
}

function fromFind(find, options, now) {
  const profile = buildActiveSearchProfile(find);
  if (!profile || find.ebayActiveProfileKey !== profile.key) return null;
  const evidence = Object.fromEntries(fields.filter(field => Object.hasOwn(find, field)).map(field => [field, structuredClone(find[field])]));
  const record = { key: key(profile.key, options), evidence };
  return valid(record, options, now) ? record : null;
}

/** Keep original observation times and only complete checks for this destination/version. */
export function mergeActiveEvidenceCache(records, finds, options, now = Date.now()) {
  const merged = new Map();
  for (const record of [...records, ...finds.map(find => fromFind(find, options, now))]) {
    if (!valid(record, options, now)) continue;
    const previous = merged.get(record.key);
    if (!previous || Date.parse(record.evidence.ebayActiveSearchUpdatedAt) > Date.parse(previous.evidence.ebayActiveSearchUpdatedAt)) {
      merged.set(record.key, structuredClone(record));
    }
  }
  return [...merged.values()];
}

/** Exact profile keys include edition and acquisition-listing exclusions. Never copy decisions or identity. */
export function reuseActiveEvidence(finds, records, options, now = Date.now()) {
  const byKey = new Map(mergeActiveEvidenceCache(records, [], options, now).map(record => [record.key, record]));
  let reused = 0;
  for (const find of finds) {
    const profile = buildActiveSearchProfile(find);
    if (!profile) continue;
    const record = byKey.get(key(profile.key, options));
    if (!record) continue;
    const current = fromFind(find, options, now);
    if (current && Date.parse(current.evidence.ebayActiveSearchUpdatedAt) >= Date.parse(record.evidence.ebayActiveSearchUpdatedAt)) continue;
    for (const field of fields) {
      if (Object.hasOwn(record.evidence, field)) find[field] = structuredClone(record.evidence[field]);
      else delete find[field];
    }
    delete find.ebayActiveSearchError;
    reused++;
  }
  return reused;
}
