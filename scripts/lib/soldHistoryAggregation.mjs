const SOLD_CONDITIONS = ["new_sealed", "used", "unknown"];
const USED_GRADE_PATTERN =
  /\b(M|NM|EX|VG\+|VG|G\+|G|F|P)\s*\/\s*(M|NM|EX|VG\+|VG|G\+|G|F|P)(?![A-Z+])/i;
const SEALED_PATTERN =
  /\b(factory\s+sealed|brand\s+new(?:\s*\/\s*sealed)?|new\s*\/\s*sealed|new\s+sealed|sealed)\b/i;

export function buildSoldHistoryIndex(records, options = {}) {
  const asOf = parseAsOf(options.asOf);
  const comps = [...groupRecords(records, (record) => record.normalizedKey).entries()]
    .map(([normalizedKey, groupedRecords]) => toComp(normalizedKey, groupedRecords, asOf))
    .sort((left, right) => right.unitsSold - left.unitsSold || left.normalizedKey.localeCompare(right.normalizedKey));

  return {
    artistAggregates: buildArtistAggregates(records, asOf),
    comps,
    createdAt: asOf.toISOString(),
    recordCount: records.length,
    snapshotDate: asOf.toISOString().slice(0, 10),
    source: options.source ?? "ebay-sold-history",
    sourceSheets: options.sourceSheets ?? ["eBay API"],
    unitCount: soldUnits(records),
    grossUnitCount: grossSoldUnits(records),
    fullyRefundedUnitCount: grossSoldUnits(records) - soldUnits(records),
    version: 2,
  };
}

export function buildArtistAggregates(records, asOfValue = new Date()) {
  const asOf = parseAsOf(asOfValue);
  const eligible = records.filter((record) => record.inferredArtist);
  return [...groupRecords(eligible, (record) => normalizeSoldText(record.inferredArtist)).entries()]
    .filter(([normalizedArtist]) => Boolean(normalizedArtist))
    .map(([normalizedArtist, artistRecords]) => {
      const metrics = summarizeRecords(artistRecords, asOf);
      const representativeArtist =
        [...artistRecords]
          .sort((left, right) => right.quantity - left.quantity || left.inferredArtist.localeCompare(right.inferredArtist))
          .at(0)?.inferredArtist ?? normalizedArtist;
      return {
        artist: representativeArtist,
        averageTotal: metrics.averageTotal,
        conditionCounts: conditionCountsForRecords(artistRecords),
        distinctReleaseCount: new Set(artistRecords.map((record) => record.normalizedKey)).size,
        latestSaleDate: metrics.latestSaleDate,
        medianTotal: metrics.medianTotal,
        normalizedArtist,
        salesPerMonth90Days: metrics.salesPerMonth90Days,
        transactionCount: metrics.transactionCount,
        unitsSold: metrics.unitsSold,
        unitsSold30Days: metrics.unitsSold30Days,
        unitsSold90Days: metrics.unitsSold90Days,
        unitsSold365Days: metrics.unitsSold365Days,
      };
    })
    .sort(
      (left, right) =>
        right.unitsSold365Days - left.unitsSold365Days ||
        right.unitsSold - left.unitsSold ||
        left.normalizedArtist.localeCompare(right.normalizedArtist),
    );
}

export function enrichSoldRecordIdentity(record) {
  const title = String(record.title ?? "").replace(/\s+/g, " ").trim();
  const customLabel = String(record.customLabel ?? record.sku ?? "").trim();
  const grades = extractMediaSleeveGrades(title);
  const inferred = inferArtistAndRelease(title);
  return {
    ...record,
    conditionBucket: record.conditionBucket ?? inferSoldCondition(title, customLabel),
    inferredArtist: record.inferredArtist ?? inferred.artist,
    inferredReleaseTitle: record.inferredReleaseTitle ?? inferred.releaseTitle,
    mediaGrade: record.mediaGrade ?? grades.mediaGrade,
    normalizedKey: record.normalizedKey ?? soldHistoryKey(title),
    sleeveGrade: record.sleeveGrade ?? grades.sleeveGrade,
  };
}

export function inferSoldCondition(title, customLabel = "") {
  if (/^whole\b/i.test(String(customLabel).trim())) return "new_sealed";
  if (SEALED_PATTERN.test(String(title))) return "new_sealed";
  if (USED_GRADE_PATTERN.test(String(title))) return "used";
  return "unknown";
}

export function extractMediaSleeveGrades(title) {
  const match = String(title).match(USED_GRADE_PATTERN);
  if (!match) return {};
  return {
    mediaGrade: match[1].toUpperCase(),
    sleeveGrade: match[2].toUpperCase(),
  };
}

export function inferArtistAndRelease(title) {
  const cleaned = stripSalesTitleNoise(String(title));
  const dashMatch = cleaned.match(/^(.{2,80}?)\s+[-–—]\s+(.{2,})$/);
  if (!dashMatch) return { releaseTitle: cleaned.trim() || undefined };
  return {
    artist: dashMatch[1].trim(),
    releaseTitle: dashMatch[2].trim(),
  };
}

export function soldHistoryKey(title) {
  const { artist, releaseTitle } = inferArtistAndRelease(title);
  const normalizedArtist = artist ? normalizeSoldText(artist) : "";
  const normalizedRelease = normalizeSoldText(releaseTitle ?? title);
  return normalizedArtist ? `${normalizedArtist}::${normalizedRelease}` : normalizedRelease;
}

export function normalizeSoldText(value) {
  return stripSalesTitleNoise(String(value))
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        token &&
        ![
          "the",
          "a",
          "an",
          "lp",
          "vinyl",
          "record",
          "records",
          "album",
          "used",
          "pressing",
          "press",
          "edition",
          "limited",
          "remastered",
          "stereo",
          "mono",
        ].includes(token),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeRecords(records, asOfValue = new Date()) {
  const asOf = parseAsOf(asOfValue);
  const retainedRecords = records.filter((record) => retainedQuantity(record) > 0);
  const datedRecords = retainedRecords.filter((record) => record.saleDate && dateAgeDays(record.saleDate, asOf) !== null);
  const records30 = datedRecords.filter((record) => dateAgeDays(record.saleDate, asOf) <= 30);
  const records90 = datedRecords.filter((record) => dateAgeDays(record.saleDate, asOf) <= 90);
  const records365 = datedRecords.filter((record) => dateAgeDays(record.saleDate, asOf) <= 365);
  const totals = weightedValues(retainedRecords, (record) => numberOrZero(record.totalBuyerPaid));
  const soldFors = weightedValues(retainedRecords, (record) => numberOrZero(record.soldFor));
  const shipping = weightedValues(retainedRecords, (record) => numberOrZero(record.shippingPaid));
  const latestSaleDate = datedRecords
    .map((record) => record.saleDate)
    .sort()
    .at(-1);
  const unitsSold = soldUnits(retainedRecords);
  const unitsSold90Days = soldUnits(records90);
  const prices30 = summarizePrices(records30);
  const prices90 = summarizePrices(records90);
  const prices365 = summarizePrices(records365);
  const allPrices = summarizePrices(retainedRecords);
  const grossUnits = grossSoldUnits(records);
  const fullyRefundedUnits = Math.max(0, grossUnits - unitsSold);

  return {
    averageShipping: weightedAverage(shipping),
    averageSoldFor: weightedAverage(soldFors),
    averageTotal: allPrices.averageTotal,
    averageTotal30Days: prices30.averageTotal,
    averageTotal90Days: prices90.averageTotal,
    averageTotal365Days: prices365.averageTotal,
    conservativeResalePrice:
      (records90.length > 0 ? prices90.priceP25 : null) ??
      (records365.length > 0 ? prices365.priceP25 : null) ??
      allPrices.priceP25,
    daysSinceLastSale: latestSaleDate ? dateAgeDays(latestSaleDate, asOf) : null,
    latestSaleDate,
    maxTotal: totals.length > 0 ? Math.max(...totals.map((entry) => entry.value)) : 0,
    medianTotal: allPrices.medianTotal,
    medianTotal30Days: prices30.medianTotal,
    medianTotal90Days: prices90.medianTotal,
    medianTotal365Days: prices365.medianTotal,
    minTotal: totals.length > 0 ? Math.min(...totals.map((entry) => entry.value)) : 0,
    priceP25: allPrices.priceP25,
    priceP25_30Days: prices30.priceP25,
    priceP25_90Days: prices90.priceP25,
    priceP25_365Days: prices365.priceP25,
    salesPerMonth90Days: roundTo(unitsSold90Days / 3, 2),
    fullyRefundedTransactionCount: records.filter((record) => retainedQuantity(record) === 0).length,
    fullyRefundedUnits,
    grossTransactionCount: records.length,
    grossUnits,
    refundRate: grossUnits > 0 ? roundTo(fullyRefundedUnits / grossUnits, 4) : 0,
    transactionCount: retainedRecords.length,
    unitsSold,
    unitsSold30Days: soldUnits(records30),
    unitsSold90Days,
    unitsSold365Days: soldUnits(records365),
  };
}

function toComp(normalizedKey, records, asOf) {
  const metrics = summarizeRecords(records, asOf);
  const conditionMetrics = Object.fromEntries(
    SOLD_CONDITIONS.map((condition) => [
      condition,
      summarizeRecords(
        records.filter((record) => record.conditionBucket === condition),
        asOf,
      ),
    ]),
  );

  return {
    averageShipping: metrics.averageShipping,
    averageSoldFor: metrics.averageSoldFor,
    averageTotal: metrics.averageTotal,
    conditionMetrics,
    conditionCounts: {
      new_sealed: conditionMetrics.new_sealed.unitsSold,
      used: conditionMetrics.used.unitsSold,
      unknown: conditionMetrics.unknown.unitsSold,
    },
    conditionTransactionCounts: {
      new_sealed: conditionMetrics.new_sealed.transactionCount,
      used: conditionMetrics.used.transactionCount,
      unknown: conditionMetrics.unknown.transactionCount,
    },
    conservativeResalePrice: metrics.conservativeResalePrice,
    count: metrics.unitsSold,
    daysSinceLastSale: metrics.daysSinceLastSale,
    evidenceScope: "single-account-own-sales",
    exampleTitles: [...new Set(records.map((record) => record.title))].slice(0, 3),
    fullyRefundedTransactionCount: metrics.fullyRefundedTransactionCount,
    fullyRefundedUnits: metrics.fullyRefundedUnits,
    grossTransactionCount: metrics.grossTransactionCount,
    grossUnits: metrics.grossUnits,
    inferredArtist: records.find((record) => record.inferredArtist)?.inferredArtist,
    inferredReleaseTitle: records.find((record) => record.inferredReleaseTitle)?.inferredReleaseTitle,
    latestSaleDate: metrics.latestSaleDate,
    maxTotal: metrics.maxTotal,
    medianTotal: metrics.medianTotal,
    minTotal: metrics.minTotal,
    normalizedKey,
    oneSellerSoldCount: null,
    priceP25: metrics.priceP25,
    records: records.map(projectSoldHistoryRecord),
    refundRate: metrics.refundRate,
    salesPerMonth90Days: metrics.salesPerMonth90Days,
    sellerCountEvidence: null,
    supportsMarketplaceSellerRepeatProof: false,
    transactionCount: metrics.transactionCount,
    unitsSold: metrics.unitsSold,
    unitsSold30Days: metrics.unitsSold30Days,
    unitsSold90Days: metrics.unitsSold90Days,
    unitsSold365Days: metrics.unitsSold365Days,
  };
}

function summarizePrices(records) {
  const totals = weightedValues(records, (record) => numberOrZero(record.totalBuyerPaid));
  return {
    averageTotal: weightedAverage(totals),
    medianTotal: weightedPercentile(totals, 0.5),
    priceP25: weightedPercentile(totals, 0.25),
  };
}

function groupRecords(records, keyForRecord) {
  const grouped = new Map();
  for (const record of records) {
    const key = keyForRecord(record);
    const existing = grouped.get(key) ?? [];
    existing.push(record);
    grouped.set(key, existing);
  }
  return grouped;
}

function conditionCountsForRecords(records) {
  return Object.fromEntries(
    SOLD_CONDITIONS.map((condition) => [
      condition,
      soldUnits(records.filter((record) => record.conditionBucket === condition)),
    ]),
  );
}

function weightedValues(records, valueForRecord) {
  return records
    .map((record) => ({
      quantity: retainedQuantity(record),
      value: valueForRecord(record),
    }))
    .filter((entry) => entry.quantity > 0);
}

function weightedAverage(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  if (totalWeight === 0) return 0;
  return roundMoney(entries.reduce((sum, entry) => sum + entry.value * entry.quantity, 0) / totalWeight);
}

function weightedPercentile(entries, percentile) {
  if (entries.length === 0) return 0;
  const sorted = [...entries].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.quantity, 0);
  const threshold = Math.max(1, Math.ceil(totalWeight * percentile));
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.quantity;
    if (cumulative >= threshold) return roundMoney(entry.value);
  }
  return roundMoney(sorted.at(-1)?.value ?? 0);
}

function soldUnits(records) {
  return records.reduce((sum, record) => sum + retainedQuantity(record), 0);
}

function grossSoldUnits(records) {
  return records.reduce((sum, record) => sum + Math.max(1, Math.floor(Number(record.quantity) || 1)), 0);
}

function retainedQuantity(record) {
  const retained = Number(record.retainedQuantity);
  if (Number.isFinite(retained) && retained >= 0) return retained;
  return Math.max(1, Math.floor(Number(record.quantity) || 1));
}

function projectSoldHistoryRecord(record) {
  return Object.fromEntries(
    [
      "conditionBucket",
      "inferredArtist",
      "inferredReleaseTitle",
      "mediaGrade",
      "normalizedKey",
      "quantity",
      "refundRate",
      "retainedQuantity",
      "saleDate",
      "shippingPaid",
      "sleeveGrade",
      "soldFor",
      "title",
      "totalBuyerPaid",
    ]
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, record[key]]),
  );
}

function dateAgeDays(value, asOf) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  const age = Math.floor((asOf.getTime() - date.getTime()) / 86_400_000);
  return age >= 0 ? age : null;
}

function stripSalesTitleNoise(title) {
  return title
    .replace(/[|]/g, " ")
    .replace(SEALED_PATTERN, " ")
    .replace(USED_GRADE_PATTERN, " ")
    .replace(/\bultrasonic(?:ally)?\s+clean(?:ed)?\b/gi, " ")
    .replace(/\bvinyl\s+record\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\b\d+\s*(?:gram|grams|g)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAsOf(value) {
  if (value instanceof Date) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid sold-history as-of date.");
    return date;
  }
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid sold-history as-of date: ${value}`);
  return date;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundTo(value, places) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}
