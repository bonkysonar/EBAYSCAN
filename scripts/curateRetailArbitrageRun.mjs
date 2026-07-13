import { readFileSync, writeFileSync } from "node:fs";

const [sourcePath, rawResearchPath, dateStamp] = process.argv.slice(2);

if (!sourcePath || !rawResearchPath || !dateStamp) {
  throw new Error("Usage: node scripts/curateRetailArbitrageRun.mjs <scan-json> <raw-research-json> <YYYY-MM-DD>");
}

const raw = JSON.parse(readFileSync(rawResearchPath, "utf8"));
const payload = JSON.parse(readFileSync(sourcePath, "utf8"));
const createdAt = new Date().toISOString();

function price(value) {
  const match = String(value ?? "").match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function soldCount(value) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateIso(value) {
  const parsed = new Date(`${value} 00:00:00 GMT-0700`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function rowTitle(row) {
  return (row.title || String(row.cells?.[0] || "").split("\n").filter(Boolean).pop() || "").trim();
}

function parseRow(row) {
  return {
    title: rowTitle(row),
    avgSoldPrice: price(row.cells?.[2]),
    avgShipping: price(row.cells?.[3]),
    totalSold: soldCount(row.cells?.[4]),
    itemSales: price(row.cells?.[5]),
    dateLastSold: dateIso(row.cells?.[7]),
  };
}

function normalized(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function excludesBundleMerch(title) {
  return !/\b(?:poster|postcards|signed|three lps|bundle|lot of|shirt|cd|cassette|blu ray|dvd)\b/i.test(title);
}

const filters = {
  "cave-in-final-transmission": (title) => /cave in.+final transmission/i.test(title),
  "honeyglaze-real-deal": (title) => /honeyglaze.+real/i.test(title),
  "chocobo-final-fantasy-adventure": (title) => /chocobo|final fantasy adventure|drew wise/i.test(title),
  "anthony-ramos-love-and-lies": (title) => /anthony ramos.+love/i.test(title) && /lies/i.test(title),
  "stranger-things-5-soundtrack": (title, row) =>
    /stranger things/i.test(title) &&
    /(season 5|soundtrack|wsqk|vinyl)/i.test(title) &&
    excludesBundleMerch(title) &&
    (row.avgSoldPrice ?? 0) < 80,
  "mother-love-bone-shine": (title) => /mother love bone.+shine/i.test(title),
  "deadpool-wolverine-soundtrack": (title) =>
    /deadpool/i.test(title) && /wolverine/i.test(title) && /(ost|soundtrack|vinyl|2-?lp)/i.test(title) && excludesBundleMerch(title),
  "lionel-richie-lionel-richie": (title) =>
    /lionel richie/i.test(title) && /(self titled|self[- ]titled|6007)/i.test(title) && excludesBundleMerch(title),
  "three-days-grace-three-days-grace": (title) =>
    /three days grace/i.test(title) &&
    /(self titled|self[- ]titled|s\/t|three days grace \[new vinyl lp\]|black vinyl, 2016)/i.test(title) &&
    !/(one-x|one x|transit|outsider|explosions|life starts)/i.test(title) &&
    excludesBundleMerch(title),
};

function bestEvidence(key) {
  const runs = raw[key] || [];
  let best = null;
  const variants = runs.map((run) => run.query);

  for (const run of runs) {
    const rows = run.rows
      .map(parseRow)
      .filter((row) => row.totalSold > 0 && row.avgSoldPrice !== null)
      .filter((row) => !filters[key] || filters[key](row.title, row));

    const total = rows.reduce((sum, row) => sum + row.totalSold, 0);
    const avg = total ? rows.reduce((sum, row) => sum + row.avgSoldPrice * row.totalSold, 0) / total : null;
    const ship = total ? rows.reduce((sum, row) => sum + (row.avgShipping ?? 0) * row.totalSold, 0) / total : null;
    const latest = rows.map((row) => row.dateLastSold).filter(Boolean).sort().pop() || null;
    const top = rows.reduce((max, row) => Math.max(max, row.totalSold), 0);
    const evidence = {
      query: run.query,
      url: run.url,
      variants,
      rows,
      status: rows.length ? "validated" : "no_rows",
      total,
      top,
      avg,
      ship,
      latest,
    };

    if (!best || evidence.total > best.total || (evidence.total === best.total && evidence.top > best.top)) {
      best = evidence;
    }
  }

  return (
    best || {
      query: variants[0] || "",
      url: runs[0]?.url || "",
      variants,
      rows: [],
      status: "no_rows",
      total: 0,
      top: 0,
      avg: null,
      ship: null,
      latest: null,
    }
  );
}

const evidence = Object.fromEntries(Object.keys(raw).map((key) => [key, bestEvidence(key)]));

function keyForFind(find) {
  const text = normalized(`${find.artist} ${find.title} ${find.sourceListingTitle || ""}`);
  if (text.includes("cave in") && text.includes("final transmission")) return "cave-in-final-transmission";
  if (text.includes("honeyglaze") && text.includes("real")) return "honeyglaze-real-deal";
  if (text.includes("chocobo") || text.includes("final fantasy adventure")) return "chocobo-final-fantasy-adventure";
  if (text.includes("anthony ramos") && text.includes("love")) return "anthony-ramos-love-and-lies";
  if (text.includes("stranger things 5")) return "stranger-things-5-soundtrack";
  if (text.includes("mother love bone") && text.includes("shine")) return "mother-love-bone-shine";
  if (text.includes("deadpool") && text.includes("wolverine")) return "deadpool-wolverine-soundtrack";
  if (text.includes("lionel richie")) return "lionel-richie-lionel-richie";
  if (text.includes("three days grace")) return "three-days-grace-three-days-grace";
  return null;
}

function decide(find, evidenceRow) {
  if (find.opportunityType === "sitewide_sale") return "WATCH";
  if (!evidenceRow || evidenceRow.status !== "validated") return "REJECT";

  const sale = (evidenceRow.avg ?? 0) + (evidenceRow.ship ?? 0);
  const allInCost = find.purchasePrice * 1.095;
  const margin = sale - allInCost;
  const active = find.activeListingCount ?? null;

  if (evidenceRow.top >= 10 && margin >= 7) return "BUY";
  if (evidenceRow.total >= 10 && margin >= 7 && !(active && active > 50)) return "WATCH";
  if (evidenceRow.total < 3) return "REJECT";
  if (margin >= 5 && (!active || active <= 50)) return "REVIEW";
  return "REJECT";
}

const finds = payload.finds.map((find) => {
  const key = keyForFind(find);
  const research = key ? evidence[key] : null;
  const notes = [...(find.notes || [])];
  const output = { ...find, capturedAt: find.capturedAt || createdAt, ebayResearchUpdatedAt: createdAt };

  if (find.opportunityType === "sitewide_sale") {
    notes.push("Research status: sale alert only; no per-record Product Research rows required.");
    output.ebayResearchStatus = "pending";
  } else if (research) {
    output.ebayResearchStatus = research.status;
    output.ebayResearchQuery = research.query;
    output.ebayResearchUrl = research.url;
    output.ebayResearchKeywordVariants = research.variants;
    output.productResearchRows = research.rows.slice(0, 8);
    output.totalSoldCount = research.total;
    output.oneSellerSoldCount = research.top;
    output.averageSoldPrice = research.avg === null ? null : Number(research.avg.toFixed(2));
    output.averageSoldShipping = research.ship === null ? null : Number(research.ship.toFixed(2));
    output.latestSoldDate = research.latest;
    notes.push(
      research.status === "validated"
        ? `Product Research validated ${research.total} same-title new-vinyl sold copies; top one-seller row ${research.top}; weighted avg $${(research.avg ?? 0).toFixed(2)} + $${(research.ship ?? 0).toFixed(2)} shipping; latest ${research.latest ?? "n/a"}.`
        : `Product Research ${research.status}: checked ${research.variants.join(", ")} with no usable same-title new-vinyl sold rows.`,
    );
    if (research.status === "validated" && research.top < 10) {
      notes.push("Repeat-seller BUY rule not met: no one seller sold 10+ copies in the usable rows.");
    }
  } else {
    output.ebayResearchStatus = "pending";
    notes.push("Research pending/no usable normalized Product Research query; likely page/navigation noise from source scan.");
  }

  output.status = decide(output, research);
  if (output.status === "REJECT" && research?.status === "validated") {
    const margin = (research.avg ?? 0) + (research.ship ?? 0) - output.purchasePrice * 1.095;
    notes.push(`Rejected by current rules after Product Research: estimated margin $${margin.toFixed(2)} and/or repeat-sale evidence below threshold.`);
  }
  if (output.status === "REJECT" && (!research || research.status !== "validated")) {
    notes.push("Rejected from buy/watch queue until Product Research produces usable sold evidence.");
  }

  output.notes = [...new Set(notes)];
  return output;
});

const summary = { ...payload.summary, byDecision: { BUY: 0, WATCH: 0, REVIEW: 0, REJECT: 0 } };
for (const find of finds) {
  summary.byDecision[find.status] = (summary.byDecision[find.status] || 0) + 1;
}
summary.productResearch = {
  validated: Object.values(evidence).filter((entry) => entry.status === "validated").length,
  no_rows: Object.values(evidence).filter((entry) => entry.status === "no_rows").length,
  failed: 0,
  pending: finds.filter((find) => find.ebayResearchStatus === "pending").length,
};

const finalPayload = {
  ...payload,
  createdAt,
  source: "daily-vinyl-retail-arbitrage-scan",
  finds,
  summary,
};

const finalPath = `exports/arbitrage-finds/retail-arbitrage-${dateStamp}.json`;
const sidecarPath = `exports/arbitrage-finds/product-research-${dateStamp}.json`;

writeFileSync(
  sidecarPath,
  JSON.stringify(
    {
      createdAt,
      sourcePayload: finalPath,
      productResearchValidatedAt: createdAt,
      evidence,
    },
    null,
    2,
  ),
);
writeFileSync(finalPath, JSON.stringify(finalPayload, null, 2));

console.log(
  JSON.stringify(
    {
      finalPath,
      sidecarPath,
      byDecision: summary.byDecision,
      productResearch: summary.productResearch,
    },
    null,
    2,
  ),
);
