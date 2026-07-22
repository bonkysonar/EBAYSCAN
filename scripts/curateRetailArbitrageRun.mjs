import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { evaluateOpportunity } from "../src/lib/arbitrage/evaluateOpportunity.mjs";
import { curateResearchForFind } from "./lib/productResearchCuration.mjs";

const [sourceArgument, rawResearchArgument, requestedDateStamp] = process.argv.slice(2);
const pendingOnly = rawResearchArgument === "--pending";
if (!sourceArgument || !rawResearchArgument) {
  throw new Error(
    "Usage: node scripts/curateRetailArbitrageRun.mjs <scan-json> <raw-research-json|--pending> [YYYY-MM-DD]",
  );
}

const workspace = process.cwd();
const sourcePath = resolve(workspace, sourceArgument);
const rawResearchPath = pendingOnly ? null : resolve(workspace, rawResearchArgument);
const payload = JSON.parse(readFileSync(sourcePath, "utf8"));
const rawResearch = pendingOnly ? {} : JSON.parse(readFileSync(rawResearchPath, "utf8"));
const scanCreatedAt = validIsoTimestamp(payload.createdAt)
  ? payload.createdAt
  : new Date().toISOString();
const curatedAt = new Date().toISOString();
const dateStamp = requestedDateStamp || scanCreatedAt.slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStamp)) {
  throw new Error(`Invalid date stamp: ${dateStamp}`);
}

const runId =
  cleanText(payload.runId) ||
  `daily-${dateStamp}-${basename(sourcePath, ".json").replace(/[^a-z0-9_-]+/gi, "-")}`;
const evidenceByFindId = {};
const finds = (payload.finds ?? []).map((find) => curateFind(find));
const summary = buildSummary(finds);
const finalPath = resolve(workspace, "exports", "arbitrage-finds", `retail-arbitrage-${dateStamp}.json`);
const sidecarPath = resolve(
  workspace,
  "exports",
  "arbitrage-finds",
  `product-research-${dateStamp}.json`,
);
const finalPayload = {
  ...payload,
  createdAt: scanCreatedAt,
  curatedAt,
  evaluatedAt: curatedAt,
  finds,
  phase: "final",
  publicationStatus: "final",
  runId,
  saleObservations: Array.isArray(payload.saleObservations)
    ? payload.saleObservations
    : payload.saleEvents ?? [],
  schemaVersion: 2,
  source: "daily-vinyl-retail-arbitrage-scan",
  summary: {
    ...(payload.summary ?? {}),
    ...summary,
  },
};

writeJsonAtomically(sidecarPath, {
  createdAt: curatedAt,
  evidenceByFindId,
  pendingOnly,
  runId,
  sourcePayload: relative(workspace, finalPath),
  sourceResearch: rawResearchPath ? relative(workspace, rawResearchPath) : null,
});
writeJsonAtomically(finalPath, finalPayload);

console.log(
  JSON.stringify(
    {
      byDecision: summary.byDecision,
      finalPath,
      productResearch: summary.productResearch,
      runId,
      sidecarPath,
    },
    null,
    2,
  ),
);

function curateFind(find) {
  if (find.opportunityType === "sitewide_sale") {
    return evaluateOpportunity(
      {
        ...find,
        capturedAt: find.capturedAt || scanCreatedAt,
        notes: unique([
          ...(find.notes ?? []),
          "Sale campaign only; evaluate individual records before purchasing.",
        ]),
      },
      {},
      curatedAt,
    );
  }

  const research = curateResearchForFind(find, rawResearch, new Date(curatedAt));
  evidenceByFindId[find.id] = research;
  const notes = [...(find.notes ?? [])];
  const output = {
    ...find,
    capturedAt: find.capturedAt || scanCreatedAt,
    condition: find.condition || "new/sealed",
    ebayResearchKeyword: research.query || research.variants?.[0] || "",
    ebayResearchKeywordVariants: research.variants ?? [],
    ebayResearchLatestSaleDate: research.latestSoldDate ?? null,
    ebayResearchRows: (research.rows ?? []).slice(0, 12),
    ebayResearchStatus: research.status,
    ebayResearchUpdatedAt: curatedAt,
    ebayResearchUrl: research.url || find.ebayResearchUrl,
    latestSoldDate: research.latestSoldDate ?? find.latestSoldDate ?? null,
    notes,
    productResearchRows: (research.rows ?? []).slice(0, 12),
  };

  if (research.status === "validated") {
    output.averageSoldPrice = research.averageSoldPrice;
    output.averageSoldShipping = research.averageSoldShipping;
    output.oneSellerSoldCount = research.oneSellerSoldCount;
    output.totalSoldCount = research.totalSoldCount;
    output.ebaySoldCondition = "new_sealed";
    output.ebaySoldMatchConfidence = research.matchConfidence ?? "unknown";
    output.soldEvidence = mergeAggregateResearchWithDatedEvidence(find.soldEvidence, research);
    notes.push(
      `Product Research matched ${research.aggregateUnitsSold ?? research.totalSoldCount} sold units across ${
        research.rows.length
      } usable row${research.rows.length === 1 ? "" : "s"}; weighted average ${money(
        research.averageSoldPrice,
      )} + ${money(research.averageSoldShipping)} shipping; latest sale ${
        research.latestSoldDate ?? "unknown"
      }.`,
      research.velocityStatus === "dated_single_unit_rows"
        ? "Every accepted Product Research row was a unique, individually dated single-unit observation, so those rows can support dated 30/90/365-day velocity."
        : "Aggregate Product Research quantities remain long-window evidence only; they cannot prove recent velocity or create a BUY by themselves.",
    );
  } else if (research.status === "no_rows") {
    output.averageSoldPrice = null;
    output.averageSoldShipping = null;
    output.oneSellerSoldCount = 0;
    output.totalSoldCount = 0;
    if (!hasDatedVelocityEvidence(find.soldEvidence)) {
      output.soldEvidence = {
        capturedAt: curatedAt,
        condition: "new_sealed",
        latestSaleDate: null,
        matchConfidence: "unknown",
        source: "ebay-product-research",
        status: "no_rows",
        supportsMarketplaceSellerRepeatProof: false,
        unitsSold30Days: null,
        unitsSold90Days: null,
        unitsSold365Days: null,
        unitsSold1095Days: 0,
        velocityEvidence: "unknown",
      };
    }
    notes.push(
      `Product Research checked ${research.variants?.join(", ") || "the normalized query"} but found no usable same-record new-vinyl rows.`,
    );
  } else {
    if (!hasDatedVelocityEvidence(find.soldEvidence)) {
      output.soldEvidence = {
        ...(find.soldEvidence ?? {}),
        capturedAt: find.soldEvidence?.capturedAt ?? null,
        condition: find.soldEvidence?.condition ?? "new_sealed",
        matchConfidence: find.soldEvidence?.matchConfidence ?? "unknown",
        source: find.soldEvidence?.source ?? "ebay-product-research",
        status: research.status === "failed" ? "failed" : "pending",
        velocityEvidence: find.soldEvidence?.velocityEvidence ?? "unknown",
      };
    }
    notes.push(
      "Product Research is still pending or failed; the candidate remains a validation task rather than being converted into a false reject.",
    );
  }

  output.notes = unique(notes);
  return evaluateOpportunity(output, {}, curatedAt);
}

function mergeAggregateResearchWithDatedEvidence(existing, research) {
  if (hasDatedVelocityEvidence(existing)) {
    return {
      ...existing,
      supportsMarketplaceSellerRepeatProof:
        existing.supportsMarketplaceSellerRepeatProof === true,
      unitsSold1095Days:
        research.aggregateUnitsSold ?? existing.unitsSold1095Days ?? null,
    };
  }

  const hasSafeDatedRows =
    research.velocityStatus === "dated_single_unit_rows" &&
    research.sales30Days !== null &&
    research.sales90Days !== null &&
    research.sales365Days !== null;
  return {
    capturedAt: curatedAt,
    condition: "new_sealed",
    conservativeResalePrice: null,
    latestSaleDate: research.latestSoldDate ?? null,
    matchConfidence: research.matchConfidence ?? "unknown",
    source: "ebay-product-research",
    status: "validated",
    supportsMarketplaceSellerRepeatProof: false,
    transactionCount: hasSafeDatedRows ? research.rows.length : null,
    unitsSold30Days: hasSafeDatedRows ? research.sales30Days : null,
    unitsSold90Days: hasSafeDatedRows ? research.sales90Days : null,
    unitsSold365Days: hasSafeDatedRows ? research.sales365Days : null,
    unitsSold1095Days: research.aggregateUnitsSold ?? null,
    velocityEvidence: hasSafeDatedRows
      ? "dated_transactions"
      : "aggregate_last_sale_only",
  };
}

function hasDatedVelocityEvidence(evidence) {
  return Boolean(
    evidence &&
      (evidence.velocityEvidence === "dated_transactions" ||
        evidence.source === "local-own-sales-history"),
  );
}

function buildSummary(curatedFinds) {
  const byDecision = { BUY: 0, REVIEW: 0, REJECT: 0, WATCH: 0 };
  const productFinds = curatedFinds.filter((find) => find.opportunityType !== "sitewide_sale");
  for (const find of curatedFinds) {
    const decision = find.decision ?? find.status ?? "REVIEW";
    byDecision[decision] = (byDecision[decision] ?? 0) + 1;
  }
  return {
    byDecision,
    findCount: curatedFinds.length,
    productResearch: {
      failed: productFinds.filter((find) => find.ebayResearchStatus === "failed").length,
      no_rows: productFinds.filter((find) => find.ebayResearchStatus === "no_rows").length,
      pending: productFinds.filter((find) => !find.ebayResearchStatus || find.ebayResearchStatus === "pending").length,
      validated: productFinds.filter((find) => find.ebayResearchStatus === "validated").length,
      velocityValidated: productFinds.filter((find) => find.gates?.soldEvidence).length,
    },
  };
}

function writeJsonAtomically(path, value) {
  const temporaryPath = resolve(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  renameSync(temporaryPath, path);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function money(value) {
  return value === null || value === undefined ? "n/a" : `$${Number(value).toFixed(2)}`;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
