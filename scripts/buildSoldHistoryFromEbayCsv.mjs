import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const inputPath = process.argv[2];
const outputDir = process.argv[3] ?? "exports/sold-history";
const sourceSheet = process.argv[4] ?? basename(inputPath ?? "ebay-orders.csv", ".csv");

if (!inputPath) {
  console.error("Usage: node scripts/buildSoldHistoryFromEbayCsv.mjs <orders.csv> [output-dir] [source-sheet]");
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
  .map(([normalizedKey, groupedRecords]) => toComp(normalizedKey, groupedRecords))
  .sort((left, right) => right.count - left.count || left.normalizedKey.localeCompare(right.normalizedKey));

const soldHistoryIndex = {
  comps,
  createdAt: new Date().toISOString(),
  recordCount: records.length,
  source: "ebay-sold-history",
  sourceSheets: [sourceSheet],
  version: 1,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, `sold-records-${slugify(sourceSheet)}.json`), JSON.stringify(records, null, 2));
writeFileSync(join(outputDir, "sold-comps-index.json"), JSON.stringify(soldHistoryIndex, null, 2));

console.log(`Wrote ${records.length} sanitized sold records and ${comps.length} comps to ${outputDir}`);

function toSoldRecord(row, index, orderShipping, sourceSheet) {
  const title = cell(row, index.itemTitle);
  const soldFor = parseMoney(cell(row, index.soldFor));
  if (!title || soldFor === null) return null;

  const orderNumber = cell(row, index.orderNumber);
  const customLabel = cell(row, index.customLabel);
  const shippingFromRow = parseMoney(cell(row, index.shipping));
  const allocatedShipping = shippingFromRow ?? orderShipping.get(orderNumber)?.perItemShipping ?? 0;
  const quantity = parseNumber(cell(row, index.quantity)) ?? 1;
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

function toComp(normalizedKey, records) {
  const totals = records.map((record) => record.totalBuyerPaid).sort((left, right) => left - right);
  const soldFors = records.map((record) => record.soldFor);
  const shipping = records.map((record) => record.shippingPaid);
  const exampleTitles = [...new Set(records.map((record) => record.title))].slice(0, 3);
  const latestSaleDate = records
    .map((record) => record.saleDate)
    .filter(Boolean)
    .sort()
    .at(-1);

  return {
    averageShipping: average(shipping),
    averageSoldFor: average(soldFors),
    averageTotal: average(totals),
    conditionCounts: {
      new_sealed: records.filter((record) => record.conditionBucket === "new_sealed").length,
      used: records.filter((record) => record.conditionBucket === "used").length,
      unknown: records.filter((record) => record.conditionBucket === "unknown").length,
    },
    count: records.length,
    exampleTitles,
    inferredArtist: records.find((record) => record.inferredArtist)?.inferredArtist,
    inferredReleaseTitle: records.find((record) => record.inferredReleaseTitle)?.inferredReleaseTitle,
    latestSaleDate,
    maxTotal: totals.at(-1) ?? 0,
    medianTotal: median(totals),
    minTotal: totals[0] ?? 0,
    normalizedKey,
    records,
  };
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

function average(values) {
  return roundMoney(values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1));
}

function median(sortedValues) {
  if (sortedValues.length === 0) return 0;
  const midpoint = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2) return sortedValues[midpoint];
  return roundMoney((sortedValues[midpoint - 1] + sortedValues[midpoint]) / 2);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
