import { describe, expect, it } from 'vitest';
import { buildActiveSearchProfile } from '../lib/arbitrage/activeEbayMatching.mjs';
import { mergeActiveEvidenceCache, reuseActiveEvidence } from '../../scripts/lib/activeEvidenceCache.mjs';

const now = Date.parse('2026-10-04T04:00:00Z');
const options = { matchingVersion: 7, destinationKey: 'destination-95073' };
const offer = (extra = {}) => ({ id: 'offer', artist: 'Artist', title: 'Great Escape',
  sourceListingTitle: 'Artist Great Escape Red Vinyl LP', sourceUrl: 'https://shop.example/products/album',
  purchasePrice: 10, ...extra });
function checked(extra = {}, age = 3600000) {
  const find = offer(extra);
  const at = new Date(now - age).toISOString();
  return { ...find, ebayActiveProfileKey: buildActiveSearchProfile(find).key,
    ebayActiveMatchingVersion: 7, ebayActiveDestinationKey: options.destinationKey,
    ebayActiveSearchUpdatedAt: at, ebayActiveSearchStatus: 'available', ebayActiveSearchComplete: true,
    activeEvidence: { capturedAt: at, searchComplete: true, status: 'available', shippingDestinationVerified: true },
    lowestActivePrice: 22, lowestActiveTitle: 'Comparable', lowestActiveUrl: 'https://www.ebay.com/itm/111111111111',
    decision: 'BUY' };
}

describe('recent active evidence reuse', () => {
  it('reuses a completed identical check across offers without refreshing its age or copying decisions', () => {
    const original = checked();
    const cache = mergeActiveEvidenceCache([], [original], options, now);
    const target = offer({ id: 'new-scan-offer', purchasePrice: 30, decision: 'REVIEW' });
    expect(reuseActiveEvidence([target], cache, options, now)).toBe(1);
    expect(target.lowestActivePrice).toBe(22);
    expect(target.ebayActiveSearchUpdatedAt).toBe(original.ebayActiveSearchUpdatedAt);
    expect(target.activeEvidence.capturedAt).toBe(original.activeEvidence.capturedAt);
    expect(target).toMatchObject({ id: 'new-scan-offer', purchasePrice: 30, decision: 'REVIEW' });
    expect(cache[0].evidence.decision).toBeUndefined();
  });
  it('invalidates destination, matching-version, edition and source-listing exclusions independently', () => {
    const cache = mergeActiveEvidenceCache([], [checked()], options, now);
    expect(reuseActiveEvidence([offer()], cache, { ...options, destinationKey: 'another-zip' }, now)).toBe(0);
    expect(reuseActiveEvidence([offer()], cache, { ...options, matchingVersion: 8 }, now)).toBe(0);
    expect(reuseActiveEvidence([offer({ sourceListingTitle: 'Artist Great Escape Blue Vinyl LP' })], cache, options, now)).toBe(0);
    expect(reuseActiveEvidence([offer({ sourceUrl: 'https://www.ebay.com/itm/222222222222' })], cache, options, now)).toBe(0);
  });
  it('expires cross-scan evidence after six hours and rejects future, failed, partial and mismatched captures', () => {
    const partial = checked(); partial.activeEvidence.searchComplete = false;
    const mismatchedTime = checked(); mismatchedTime.activeEvidence.capturedAt = new Date(now).toISOString();
    const wrongProfile = checked(); wrongProfile.ebayActiveProfileKey = 'other-edition';
    const failed = checked(); failed.ebayActiveSearchStatus = 'failed';
    expect(mergeActiveEvidenceCache([], [checked({}, 6 * 3600000 + 1), checked({}, -300001), partial, mismatchedTime, wrongProfile, failed], options, now)).toEqual([]);
    expect(mergeActiveEvidenceCache([], [checked({}, 6 * 3600000)], options, now)).toHaveLength(1);
  });
  it('keeps the newest valid observation and never replaces newer live evidence', () => {
    const old = checked({}, 3600000), recent = checked({}, 1800000);
    recent.lowestActivePrice = 19;
    const cache = mergeActiveEvidenceCache([], [recent, old], options, now);
    expect(cache).toHaveLength(1);
    expect(cache[0].evidence.lowestActivePrice).toBe(19);
    const target = checked({}, 600000);
    expect(reuseActiveEvidence([target], cache, options, now)).toBe(0);
    expect(target.lowestActivePrice).toBe(22);
  });
  it('clears stale prices and errors when the completed result has no matching listings', () => {
    const empty = checked();
    empty.ebayActiveSearchStatus = 'no_results'; empty.activeEvidence.status = 'no_results';
    empty.lowestActivePrice = null; delete empty.lowestActiveTitle; delete empty.lowestActiveUrl;
    const target = offer({ lowestActivePrice: 90, lowestActiveTitle: 'Old', lowestActiveUrl: 'https://old.example', ebayActiveSearchError: '429' });
    expect(reuseActiveEvidence([target], mergeActiveEvidenceCache([], [empty], options, now), options, now)).toBe(1);
    expect(target.lowestActivePrice).toBeNull();
    expect(target.lowestActiveTitle).toBeUndefined();
    expect(target.lowestActiveUrl).toBeUndefined();
    expect(target.ebayActiveSearchError).toBeUndefined();
  });
  it('does not share mutable listings or evidence objects between offers and cache', () => {
    const source = checked(); source.ebayActiveListings = [{ totalPrice: 22 }];
    const cache = mergeActiveEvidenceCache([], [source], options, now);
    const one = offer(), two = offer(); reuseActiveEvidence([one, two], cache, options, now);
    one.ebayActiveListings[0].totalPrice = 1;
    expect(two.ebayActiveListings[0].totalPrice).toBe(22);
    expect(cache[0].evidence.ebayActiveListings[0].totalPrice).toBe(22);
  });
});
