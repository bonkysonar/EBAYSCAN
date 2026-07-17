import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const cli = parseCli(process.argv.slice(2));
const inputPath = cli.positionals[0];
const outputDir = cli.positionals[1] ?? "exports/sold-history";
const sourceSheet = cli.positionals[2] ?? basename(inputPath ?? "ebay-orders.csv", ".csv");
const asOf = parseAsOf(cli.options.get("as-of") ?? process.env.SOLD_HISTORY_AS_OF);

if (!inputPath) {
  console.error("Usage: node scripts/buildSoldHistoryFromEbayCsv.mjs <orders.csv> [output-dir] [source-sheet] [--as-of=YYYY-MM-DD]");
  process.exit(1);
}

const csv = readFileSync(inputPath, "utf8");
const rows = parseCsv(csv);
const headerRowIndex = rows.findIndex((row) => row.includes("Sales Record Number") && row.includes("Item Title"));

if (headerRowIndex < 0) {
  console.error("Could not find the eBay order header row.");
  process.exit(1);
}

const headers = rows[headerRowIndex].map((header) => header.trim());
const index = {
  orderNumber: firstHeaderIndex(headers, "Order Number"),
  itemNumber: firstHeaderIndex(headers, "Item Number"),
  itemTitle: firstHeaderIndex(headers, "Item Title"),
  customLabel: firstHeaderIndex(headers, "Custom Label"),
  quantity: firstHeaderIndex(headers, "Quantity"),
  soldFor: firstHeaderIndex(headers, "Sold For"),
  shipping: firstHeaderIndex(headers, "Shipping And Handling"),
  totalPrice: firstHeaderIndex(headers, "Total Price"),
  saleDate: firstHeaderIndex(headers, "Sale Date"),
};

const orderShipping = new Map();
for (const row of rows.slice(headerRowIndex + 1)) {
  const title = cell(row, index.itemTitle);
  const orderNumber = cell(row, index.orderNumber);
  const shipping = parseMoney(cell(row, index.shipping));
  const quantity = parseNumber(cell(row, index.quantity)) ?? 0;
  if (!title && orderNumber && shipping !== null && quantity > 1) {
    orderShipping.set(orderNumber, { perItemShipping: roundMoney(shipping / quantity), quantity });
  }
}

const records = rows
  .slice(headerRowIndex + 1)
  .map((row) => toSoldRecord(row, index, orderShipping, sourceSheet))
  .filter(Boolean);

const comps = [...groupRecords(records).entries()]
  .map(([normalizedKey, groupedRecords]) => toComp(normalizedKey, groupedRecords, asOf))
  .sort((left, right) => right.unitsSold - left.unitsSold || left.normalizedKey.localeCompare(right.normalizedKey));

const soldHistoryIndex = {
  comps,
  createdAt: asOf.toISOString(),
  recordCount: records.length,
  snapshotDate: asOf.toISOString().slice(0, 10),
  source: "ebay-sold-history",
  sourceSheets: [sourceSheet],
  unitCount: records.reduce((sum, record) => sum + record.quantity, 0),
  version: 2,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, `sold-records-${slugify(sourceSheet)}.json`), JSON.stringify(records, null, 2));
writeFileSync(join(outputDir, "sold-comps-index.json"), JSON.stringify(soldHistoryIndex, null, 2));

console.log(
  `Wrote ${records.length} sanitized sold transactions (${soldHistoryIndex.unitCount} units) and ${comps.length} comps to ${outputDir}`,
);

function toSoldRecord(row, index, orderShipping, sourceSheet) {
  const title = cell(row, index.itemTitle);
  const soldFor = parseMoney(cell(row, index.soldFor));
  if (!title || soldFor === null) return null;

  const orderNumber = cell(row, index.orderNumber);
  const customLabel = cell(row, index.customLabel);
  const quantity = Math.max(1, Math.floor(parseNumber(cell(row, index.quantity)) ?? 1));
  const shippingFromRow = parseMoney(cell(row, index.shipping));
  const allocatedShipping =
    shippingFromRow === null
      ? orderShipping.get(orderNumber)?.perItemShipping ?? 0
      : roundMoney(shippingFromRow / Math.max(quantity, 1));
  const totalBuyerPaid = roundMoney(soldFor + allocatedShipping);
  const grades = extractMediaSleeveGrades(title);
  const inferred = inferArtistAndRelease(title);

  return {
    conditionBucket: inferSoldCondition(title, customLabel),
    customLabel: customLabel || undefined,
    inferredArtist: inferred.artist,
    inferredReleaseTitle: inferred.releaseTitle,
    itemNumber: cell(row, index.itemNumber) || undefined,
    mediaGrade: grades.mediaGrade,
    normalizedKey: soldHistoryKey(title),
    orderNumber: orderNumber || undefined,
    quantity,
    saleDate: parseEbayDate(cell(row, index.saleDate)),
    shippingPaid: allocatedShipping,
    sleeveGrade: grades.sleeveGrade,
    soldFor,
    sourceSheet,
    title,
    totalBuyerPaid,
  };
}

function groupRecords(records) {
  const grouped = new Map();
  for (const record of records) {
    const existing = grouped.get(record.normalizedKey) ?? [];
    existing.push(record);
    grouped.set(record.normalizedKey, existing);
  }
  return grouped;
}

function toComp(normalizedKey, records, asOf) {
  const metrics = summarizeRecords(records, asOf);
  const exampleTitles = [...new Set(records.map((record) => record.title))].slice(0, 3);
  const conditionMetrics = Object.fromEntries(
    ["new_sealed", "used", "unknown"].map((condition) => [
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
    exampleTitles,
    inferredArtist: records.find((record) => record.inferredArtist)?.inferredArtist,
    inferredReleaseTitle: records.find((record) => record.inferredReleaseTitle)?.inferredReleaseTitle,
    latestSaleDate: metrics.latestSaleDate,
    maxTotal: metrics.maxTotal,
    medianTotal: metrics.medianTotal,
    minTotal: metrics.minTotal,
    normalizedKey,
    oneSellerSoldCount: null,
    priceP25: metrics.priceP25,
    records,
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

function summarizeRecords(records, asOf) {
  const datedRecords = records.filter((record) => record.saleDate && dateAgeDays(record.saleDate, asOf) !== null);
  const records30 = datedRecords.filter((record) => dateAgeDays(record.saleDate, asOf) <= 30);
  const records90 = datedRecords.filter((record) => dateAgeDays(record.saleDate, asOf) <= 90);
  const records365 = datedRecords.filter((record) => dateAgeDays(record.saleDate, asOf) <= 365);
  const totals = weightedValues(records, (record) => record.totalBuyerPaid);
  const soldFors = weightedValues(records, (record) => record.soldFor);
  const shipping = weightedValues(records, (record) => record.shippingPaid);
  const latestSaleDate = datedRecords
    .map((record) => record.saleDate)
    .sort()
    .at(-1);
  const unitsSold = soldUnits(records);
  const unitsSold90Days = soldUnits(records90);
  const prices30 = summarizePrices(records30);
  const prices90 = summarizePrices(records90);
  const prices365 = summarizePrices(records365);
  const allPrices = summarizePrices(records);

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
    transactionCount: records.length,
    unitsSold,
    unitsSold30Days: soldUnits(records30),
    unitsSold90Days,
    unitsSold365Days: soldUnits(records365),
  };
}

function summarizePrices(records) {
  const totals = weightedValues(records, (record) => record.totalBuyerPaid);
  return {
    averageTotal: weightedAverage(totals),
    medianTotal: weightedPercentile(totals, 0.5),
    priceP25: weightedPercentile(totals, 0.25),
  };
}

function weightedValues(records, valueForRecord) {
  return records.map((record) => ({
    quantity: Math.max(1, Math.floor(record.quantity)),
    value: valueForRecord(record),
  }));
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
  return records.reduce((sum, record) => sum + Math.max(1, Math.floor(record.quantity)), 0);
}

function dateAgeDays(value, asOf) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  const age = Math.floor((asOf.getTime() - date.getTime()) / 86_400_000);
  return age >= 0 ? age : null;
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const next = csv[index + 1];

    if (character === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function firstHeaderIndex(headers, name) {
  const found = headers.findIndex((header) => header === name);
  if (found < 0) throw new Error(`Missing required eBay column: ${name}`);
  return found;
}

function cell(row, index) {
  return (row[index] ?? "").trim();
}

function parseMoney(value) {
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumber(value) {
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEbayDate(value) {
  const match = String(value).trim().match(/^([A-Za-z]{3})-(\d{1,2})-(\d{2})$/);
  if (!match) return undefined;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].toLowerCase());
  if (month < 0) return undefined;
  return `${2000 + Number(match[3])}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function inferSoldCondition(title, customLabel = "") {
  if (/^whole\b/i.test(customLabel.trim())) return "new_sealed";
  if (/\b(factory\s+sealed|brand\s+new(?:\s*\/\s*sealed)?|new\s*\/\s*sealed|new\s+sealed|sealed)\b/i.test(title)) return "new_sealed";
  if (/\b(M|NM|EX|VG\+|VG|G\+|G|F|P)\s*\/\s*(M|NM|EX|VG\+|VG|G\+|G|F|P)(?![A-Z+])/i.test(title)) return "used";
  return "unknown";
}

function extractMediaSleeveGrades(title) {
  const match = title.match(/\b(M|NM|EX|VG\+|VG|G\+|G|F|P)\s*\/\s*(M|NM|EX|VG\+|VG|G\+|G|F|P)(?![A-Z+])/i);
  if (!match) return {};
  return {
    mediaGrade: match[1].toUpperCase(),
    sleeveGrade: match[2].toUpperCase(),
  };
}

function inferArtistAndRelease(title) {
  const cleaned = stripSalesTitleNoise(title);
  const dashMatch = cleaned.match(/^(.{2,80}?)(?:\s+[-–—]\s+|\s*[-–—]\s+)(.{2,})$/);
  if (!dashMatch) return { releaseTitle: cleaned.trim() || undefined };
  return {
    artist: dashMatch[1].trim(),
    releaseTitle: dashMatch[2].trim(),
  };
}

function soldHistoryKey(title) {
  const { artist, releaseTitle } = inferArtistAndRelease(title);
  const normalizedArtist = artist ? normalizeSoldText(artist) : "";
  const normalizedRelease = normalizeSoldText(releaseTitle ?? title);
  return normalizedArtist ? `${normalizedArtist}::${normalizedRelease}` : normalizedRelease;
}

function normalizeSoldText(value) {
  return stripSalesTitleNoise(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !["the", "a", "an", "lp", "vinyl", "record", "records", "album", "used"].includes(token))
    .join(" ")
    .replace(/\b(pressing|press|edition|limited|remastered|stereo|mono)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSalesTitleNoise(title) {
  return title
    .replace(/\|/g, " ")
    .replace(/\b(factory\s+sealed|brand\s+new(?:\s*\/\s*sealed)?|new\s*\/\s*sealed|new\s+sealed|sealed)\b/gi, " ")
    .replace(/\b(M|NM|EX|VG\+|VG|G\+|G|F|P)\s*\/\s*(M|NM|EX|VG\+|VG|G\+|G|F|P)(?![A-Z+])/gi, " ")
    .replace(/\bultrasonic(?:ally)?\s+clean(?:ed)?\b/gi, " ")
    .replace(/\bvinyl\s+record\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\b\d+\s*(?:gram|grams|g)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function roundTo(value, places) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseCli(argv) {
  const options = new Map();
  const positionals = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, value = "true"] = arg.slice(2).split("=");
      options.set(key, value);
    } else {
      positionals.push(arg);
    }
  }
  return { options, positionals };
}

function parseAsOf(value) {
  if (!value) return new Date();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --as-of value: ${value}`);
  return date;
}
