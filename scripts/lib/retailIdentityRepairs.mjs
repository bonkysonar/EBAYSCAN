import { parseAcousticSoundsListingIdentity } from './retailListingParsing.mjs';
import { browserObservedRetailIdentity, browserVerifiedRetailOffer } from './browserRetailVerification.mjs';
import { resetPressingSoldEvidence, resetPressingActiveEvidence } from './productResearchCuration.mjs';

// Apply observed identity before research planning and active-market searches.
// Reusing prices or supply from the previous pressing would corrupt the margin.
export function repairRetailCandidateIdentity(find, browserCaptures = {}, now = new Date()) {
  const parsed = parseAcousticSoundsListingIdentity(find.sourceListingTitle, find);
  let repaired = parsed ? { ...find, ...parsed } : find;
  repaired = browserObservedRetailIdentity(repaired, browserCaptures, now);
  repaired = browserVerifiedRetailOffer(repaired, browserCaptures, now) ?? repaired;
  const albumChanged = repaired.artist !== find.artist || repaired.title !== find.title;
  const pressingChanged = repaired.retailEditionText !== find.retailEditionText || repaired.barcode !== find.barcode;
  if (!albumChanged && !pressingChanged) return repaired;
  repaired = resetPressingActiveEvidence(resetPressingSoldEvidence(repaired));
  if (albumChanged) {
    for (const field of ['albumDemand', 'albumPriceBenchmark', 'researchQuery', 'researchRunQuery', 'ebayResearchStatus', 'ebayResearchUpdatedAt']) delete repaired[field];
  }
  return repaired;
}
