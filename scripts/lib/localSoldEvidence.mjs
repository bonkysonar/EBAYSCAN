import {
  buildActiveSearchProfile,
  extractEditionIdentity,
} from "../../src/lib/arbitrage/activeEbayMatching.mjs";
import { createAlbumDemandIndex, ownSaleMatchesAlbum } from "./albumDemand.mjs";

const localDemandIndexes = new WeakMap();

/** Recheck a retained draft against current matching rules without refreshing its retail observation. */
export function revalidateCandidateLocalSold(find, index, referenceAt = new Date().toISOString()) {
  if (!index?.comps || find.soldEvidence?.source === "ebay-product-research") return find;
  let cached = localDemandIndexes.get(index);
  if (!cached || cached.referenceAt !== referenceAt) {
    cached = { referenceAt, demand: createAlbumDemandIndex(index, { now: referenceAt }) };
    localDemandIndexes.set(index, cached);
  }
  let best = null;
  for (const comp of cached.demand.matchingComps(find)) {
    const result = buildLocalSoldEvidence({ comp, matchScore: 1 }, index, { candidate: find, condition: "new_sealed", referenceAt });
    if (!best || Number(result.soldEvidence?.status === "validated") > Number(best.soldEvidence?.status === "validated") ||
      (result.soldEvidence?.status === best.soldEvidence?.status && (result.metrics?.unitsSold90Days ?? 0) > (best.metrics?.unitsSold90Days ?? 0))) best = result;
  }
  const hadLocal = find.soldEvidence?.source === "local-own-sales-history";
  const notes = (find.notes ?? []).filter((note) => !/^Local (?:new\/sealed sold-history match|sold-history|CSV history)|^Condition evidence:/.test(note));
  const metrics = best?.metrics;
  notes.push(metrics ? `Revalidated exact local artist/album/edition: ${metrics.unitsSold} New/Sealed units; ${metrics.unitsSold90Days} within 90 days.` : "No exact local pressing comp after revalidation; album purchases remain a research signal only.");
  return {
    ...find,
    albumDemand: cached.demand.match(find),
    averageSoldPrice: metrics?.averageSoldFor ?? null,
    averageSoldShipping: metrics?.averageShipping ?? null,
    totalSoldCount: metrics?.unitsSold ?? null,
    soldEvidence: best?.soldEvidence ?? (hadLocal ? undefined : find.soldEvidence),
    notes,
  };
}

export function buildLocalSoldEvidence(compMatch, index, options = {}) {
  if (!compMatch?.comp) return { metrics: null, soldEvidence: undefined };
  const condition = options.condition ?? "new_sealed";
  const referenceAt = options.referenceAt ?? index?.createdAt ?? new Date().toISOString();
  const artistConfirmation = confirmCandidateArtist(options.candidate, compMatch.comp);
  const artistMatchedRecords = candidateArtistMatchedRecords(options.candidate, compMatch.comp);
  const albumMatchedRecords = artistMatchedRecords.filter((record) => ownSaleMatchesAlbum(options.candidate, record));
  const albumConfirmed = albumMatchedRecords.length > 0;
  const editionConfirmation = confirmCandidateEdition(
    options.candidate,
    compMatch.comp,
    albumMatchedRecords,
  );
  const metrics = conditionMatchedSoldMetrics(
    { records: editionConfirmation.matchedRecords },
    index,
    condition,
    referenceAt,
  );
  const usableMetrics =
    artistConfirmation.confirmed && albumConfirmed && editionConfirmation.confirmed ? metrics : null;
  const matchConfidence = artistConfirmation.confirmed && albumConfirmed && editionConfirmation.confirmed
    ? Math.min(1, Number(compMatch.matchScore) || 0)
    : Math.min(0.65, Number(compMatch.matchScore) || 0);

  return {
    metrics: usableMetrics,
    soldEvidence: {
      albumMatchConfirmed: albumConfirmed,
      albumMismatchReasons: albumConfirmed ? [] : ["album_title_not_confirmed"],
      artistMatchConfirmed: artistConfirmation.confirmed,
      artistMismatchReasons: artistConfirmation.reasons,
      capturedAt: index?.createdAt ?? referenceAt ?? null,
      condition,
      conservativeResalePrice: usableMetrics
        ? usableMetrics.conservativeResalePrice ?? usableMetrics.priceP25_90Days ?? usableMetrics.priceP25
        : null,
      daysSinceLastSale: usableMetrics?.daysSinceLastSale ?? null,
      editionMatchConfirmed: editionConfirmation.confirmed,
      editionMismatchReasons: editionConfirmation.reasons,
      latestSaleDate: usableMetrics?.latestSaleDate ?? null,
      matchConfidence,
      salesPerMonth: usableMetrics?.salesPerMonth90Days ?? null,
      source: "local-own-sales-history",
      status:
        compMatch.matchScore >= 0.8 &&
        Boolean(usableMetrics && usableMetrics.unitsSold > 0) &&
        artistConfirmation.confirmed &&
        albumConfirmed &&
        editionConfirmation.confirmed
          ? "validated"
          : "candidate",
      supportsMarketplaceSellerRepeatProof: false,
      transactionCount: usableMetrics?.transactionCount ?? null,
      unitsSold30Days: usableMetrics?.unitsSold30Days ?? null,
      unitsSold90Days: usableMetrics?.unitsSold90Days ?? null,
      unitsSold365Days: usableMetrics?.unitsSold365Days ?? null,
    },
  };
}

function confirmCandidateArtist(candidate, comp) {
  const candidateArtist = normalizeArtist(candidate?.artist);
  if (!candidateArtist) return { confirmed: false, reasons: ["candidate_artist_missing"] };
  if ((comp?.records ?? []).some((record) => ownSaleMatchesAlbum(candidate, record))) return { confirmed: true, reasons: [] };

  const compArtists = [
    comp?.inferredArtist,
    ...(comp?.records ?? []).map((record) => record.inferredArtist),
  ]
    .map(normalizeArtist)
    .filter(Boolean);
  if (compArtists.length === 0 && String(comp?.normalizedKey ?? "").includes("::")) {
    const normalizedKeyArtist = normalizeArtist(String(comp.normalizedKey).split("::")[0]);
    if (normalizedKeyArtist) compArtists.push(normalizedKeyArtist);
  }
  if (compArtists.length === 0) return { confirmed: false, reasons: ["comp_artist_missing"] };

  const confirmed = compArtists.some(
    (artist) => artist === candidateArtist || tokenSimilarity(artist, candidateArtist) >= 0.8,
  );
  return confirmed
    ? { confirmed: true, reasons: [] }
    : { confirmed: false, reasons: [`artist_not_confirmed:${candidateArtist}`] };
}

function candidateArtistMatchedRecords(candidate, comp) {
  const candidateArtist = normalizeArtist(candidate?.artist);
  if (!candidateArtist) return [];
  return (comp?.records ?? []).filter((record) => {
    if (ownSaleMatchesAlbum(candidate, record)) return true;
    const recordArtist = normalizeArtist(record?.inferredArtist ?? comp?.inferredArtist);
    return (
      recordArtist &&
      (recordArtist === candidateArtist || tokenSimilarity(recordArtist, candidateArtist) >= 0.8)
    );
  });
}

function confirmCandidateEdition(candidate, comp, records) {
  if (!candidate?.title && !candidate?.sourceListingTitle) {
    return {
      confirmed: false,
      matchedRecords: [],
      reasons: ["candidate_edition_missing"],
    };
  }
  const candidateText = String(candidate?.sourceListingTitle ?? candidate?.title ?? "");
  const profile = buildActiveSearchProfile({
    ...candidate,
    purchasePrice:
      Number.isFinite(Number(candidate?.purchasePrice)) && Number(candidate.purchasePrice) > 0
        ? Number(candidate.purchasePrice)
        : 1,
  });
  const releaseTitleBaseline = profile?.title ?? candidate?.title ?? "";
  const fullIdentityBaseline = `${profile?.artist ?? candidate?.artist ?? ""} ${releaseTitleBaseline}`;
  const expected =
    profile?.edition ?? extractEditionIdentity(candidateText, fullIdentityBaseline);
  const titledRecords = (records ?? []).filter((record) => record?.title);
  if (titledRecords.length === 0) {
    return {
      confirmed: false,
      matchedRecords: [],
      reasons: ["edition_evidence_missing"],
    };
  }

  const matchedRecords = titledRecords.filter(
    (record) =>
      extractEditionIdentity(
        record.title,
        fullIdentityBaseline,
      ).key === expected.key &&
      localPressingCompatible(candidateText, record.title, releaseTitleBaseline),
  );
  return matchedRecords.length > 0
    ? { confirmed: true, matchedRecords, reasons: [] }
    : {
        confirmed: false,
        matchedRecords: [],
        reasons: [`edition_not_confirmed:${expected.key}`],
      };
}

function localPressingCompatible(candidateText, saleTitle, releaseTitle) {
  const premiumMarkers = [
    /\b(?:mofi|mobile\s+fidelity)\b/i,
    /\banalogue\s+productions\b/i,
    /\bmusic\s+matters\b/i,
    /\b(?:original|first)\s+press(?:ing)?\b/i,
    /\btest\s+press(?:ing)?\b/i,
    /\b45\s*rpm\b/i,
    /\btone\s+poet\b/i,
    /\bblue\s+note\s+classics?\b/i,
    /\bblue\s+note\s+essentials?\b/i,
    /\b(?:japanese|japan|obi)\b/i,
  ];
  if (premiumMarkers.some((pattern) => pattern.test(candidateText) !== pattern.test(saleTitle))) return false;
  const escapedRelease = String(releaseTitle ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutRelease = (text) => escapedRelease ? String(text).replace(new RegExp(escapedRelease, "gi"), " ") : String(text);
  const years = (text) => new Set(withoutRelease(text).match(/\b(?:19|20)\d{2}\b/g) ?? []);
  const expectedYears = years(candidateText);
  const actualYears = years(saleTitle);
  // An older sealed pressing may have a very different value. An unspecified
  // current reissue cannot borrow that historical pressing's price.
  return [...actualYears].every((year) => expectedYears.has(year)) &&
    [...expectedYears].every((year) => actualYears.has(year));
}

function normalizeArtist(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:and|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized && normalized !== "unknown artist" ? normalized : "";
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

export function conditionMatchedSoldMetrics(comp, index, condition = "new_sealed", referenceAt) {
  const records = (comp?.records ?? []).filter((record) => record.conditionBucket === condition);
  if (records.length === 0) {
    const stored = comp?.conditionMetrics?.[condition];
    return stored && Number.isFinite(Number(stored.unitsSold)) ? stored : null;
  }
  const referenceDate = validDate(referenceAt) ?? validDate(index?.createdAt) ?? new Date();
  const recordAgeDays = (record) => {
    const saleDate = validDate(record.saleDate);
    if (!saleDate) return null;
    const age = Math.floor((referenceDate.getTime() - saleDate.getTime()) / 86_400_000);
    return age >= 0 ? age : null;
  };
  const datedRecords = records.filter((record) => recordAgeDays(record) !== null);
  const recordsInDays = (days) =>
    datedRecords.filter((record) => recordAgeDays(record) <= days);
  const records90 = recordsInDays(90);
  const unitsSold = records.reduce((sum, record) => sum + soldRecordQuantity(record), 0);
  const unitsSold30Days = recordsInDays(30).reduce((sum, record) => sum + soldRecordQuantity(record), 0);
  const unitsSold90Days = records90.reduce((sum, record) => sum + soldRecordQuantity(record), 0);
  const unitsSold365Days = recordsInDays(365).reduce((sum, record) => sum + soldRecordQuantity(record), 0);
  const latestSaleDate = datedRecords.map((record) => record.saleDate).sort().at(-1) ?? null;
  const soldFor = quantityWeightedValues(records, "soldFor");
  const shipping = quantityWeightedValues(records, "shippingPaid");
  const totalValues = quantityWeightedValues(records, "totalBuyerPaid").sort((left, right) => left - right);
  const totalValues90 = quantityWeightedValues(records90, "totalBuyerPaid").sort(
    (left, right) => left - right,
  );
  const priceP25 = percentile(totalValues, 0.25);
  const priceP25_90Days =
    totalValues90.length > 0 ? percentile(totalValues90, 0.25) : undefined;

  return {
    averageShipping: average(shipping),
    averageSoldFor: average(soldFor),
    averageTotal: average(totalValues),
    conservativeResalePrice: priceP25_90Days ?? priceP25,
    daysSinceLastSale: latestSaleDate
      ? Math.floor(
          (referenceDate.getTime() - new Date(latestSaleDate).getTime()) / 86_400_000,
        )
      : null,
    latestSaleDate,
    priceP25,
    priceP25_90Days,
    salesPerMonth90Days: Math.round((unitsSold90Days / 3) * 100) / 100,
    transactionCount: records.length,
    unitsSold,
    unitsSold30Days,
    unitsSold90Days,
    unitsSold365Days,
  };
}

function quantityWeightedValues(records, field) {
  return records.flatMap((record) => {
    const value = Number(record[field]);
    if (!Number.isFinite(value)) return [];
    return Array.from({ length: soldRecordQuantity(record) }, () => value);
  });
}

function soldRecordQuantity(record) {
  const retainedQuantity = Number(record.retainedQuantity);
  if (Number.isFinite(retainedQuantity) && retainedQuantity >= 0) {
    return Math.floor(retainedQuantity);
  }
  const quantity = Number(record.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.ceil(values.length * fraction) - 1);
  return values[index];
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}
