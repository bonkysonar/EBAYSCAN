import { createHash } from "node:crypto";
import { buildSoldHistoryIndex, enrichSoldRecordIdentity } from "./soldHistoryAggregation.mjs";

const ECONOMIC_FIELDS = [
  "ebayAdFees",
  "ebaySaleFeeCredits",
  "ebaySaleFeesGross",
  "financialRefundAmount",
  "otherEbayCharges",
  "shippingLabelCredits",
  "shippingLabelDebits",
];
const DEFAULT_API_CLOCK_SKEW_SAFETY_MS = 5 * 60 * 1000;

export function ordersToSoldRecords(orders) {
  const records = [];
  for (const order of orders) {
    if (!isCompletedSaleOrder(order)) continue;
    for (const lineItem of order.lineItems ?? []) {
      const quantity = Math.max(1, Math.floor(Number(lineItem.quantity) || 1));
      const soldFor = roundMoney(numberOrZero(lineItem.lineItemCost) / quantity);
      const shippingPaid = roundMoney(numberOrZero(lineItem.shippingCost) / quantity);
      const fulfillmentRefundAmount = roundMoney(
        (lineItem.refunds ?? []).reduce((sum, refund) => sum + numberOrZero(refund.amount), 0) / quantity,
      );
      const title = String(lineItem.title ?? "").replace(/\s+/g, " ").trim();
      if (!order.orderId || !lineItem.lineItemId || !title) continue;

      records.push(
        enrichSoldRecordIdentity({
          currency: lineItem.currency ?? "USD",
          customLabel: lineItem.sku || undefined,
          ebayAdFees: 0,
          ebaySaleFeeCredits: 0,
          ebaySaleFees: 0,
          ebaySaleFeesGross: 0,
          economicsAttribution: emptyAttribution(),
          estimatedNetAfterEbayCosts: roundMoney(soldFor + shippingPaid - fulfillmentRefundAmount),
          financialRefundAmount: 0,
          fulfillmentRefundAmount,
          itemNumber: lineItem.legacyItemId || undefined,
          lineItemId: lineItem.lineItemId,
          orderNumber: order.orderId,
          otherEbayCharges: 0,
          quantity,
          recordKey: `${order.orderId}:${lineItem.lineItemId}`,
          refundAmount: fulfillmentRefundAmount,
          saleDate: order.creationDate.slice(0, 10),
          shippingLabelCost: 0,
          shippingLabelCredits: 0,
          shippingLabelDebits: 0,
          shippingPaid,
          sku: lineItem.sku || undefined,
          soldFor,
          sourceSheet: "eBay API",
          title,
          totalBuyerPaid: roundMoney(soldFor + shippingPaid),
        }),
      );
    }
  }
  return records.map(recalculateRecordEconomics).sort(compareRecords);
}

export function mergeApiSoldRecords(existingRecords, freshRecords, options = {}) {
  const fromDate = dateOnly(options.replaceFrom);
  const toDate = dateOnly(options.replaceTo);
  const existingByKey = new Map(existingRecords.map((record) => [record.recordKey, record]));
  const freshByKey = new Map(
    freshRecords.map((record) => {
      const existing = existingByKey.get(record.recordKey);
      return [record.recordKey, existing ? preserveEconomics(record, existing) : record];
    }),
  );

  for (const existing of existingRecords) {
    const withinReplacementRange =
      fromDate && toDate && existing.saleDate && existing.saleDate >= fromDate && existing.saleDate <= toDate;
    if (!withinReplacementRange && !freshByKey.has(existing.recordKey)) {
      freshByKey.set(existing.recordKey, existing);
    }
  }

  return [...freshByKey.values()].map(recalculateRecordEconomics).sort(compareRecords);
}

export function applyFinancialTransactions(records, transactions, previousState = {}) {
  const state = normalizeSyncState(previousState);
  const appliedDigests = new Set(state.appliedFinancialEventDigests);
  const indexes = buildRecordIndexes(records);
  const stats = {
    applied: 0,
    duplicate: 0,
    unattributed: 0,
  };

  for (const transaction of transactions) {
    const digest = financialEventDigest(transaction);
    const contentDigest = financialEventContentDigest(transaction);
    const previousContentDigest = state.financialEventContentDigests[digest];
    if (previousContentDigest && previousContentDigest !== contentDigest) {
      throw new Error("A previously applied eBay financial event changed; a full sold-history rebuild is required.");
    }
    if (appliedDigests.has(digest)) {
      state.financialEventContentDigests[digest] = contentDigest;
      stats.duplicate += 1;
      continue;
    }

    const result = applyFinancialTransaction(records, indexes, transaction, state);
    if (!result.attributed) stats.unattributed += 1;
    appliedDigests.add(digest);
    state.financialEventContentDigests[digest] = contentDigest;
    stats.applied += 1;
  }

  for (const record of records) recalculateRecordEconomics(record);
  state.appliedFinancialEventDigests = [...appliedDigests].sort();
  return { records: records.sort(compareRecords), state, stats };
}

export function buildEbayEconomicsSummary(records, stateValue, options = {}) {
  const state = normalizeSyncState(stateValue);
  const totalsByCurrency = {};
  for (const record of records) {
    const currency = record.currency ?? "USD";
    const totals = (totalsByCurrency[currency] ??= emptyEconomicsTotals());
    const quantity = Math.max(1, Math.floor(Number(record.quantity) || 1));
    totals.adFees = roundMoney(totals.adFees + numberOrZero(record.ebayAdFees) * quantity);
    totals.buyerPaidShipping = roundMoney(totals.buyerPaidShipping + numberOrZero(record.shippingPaid) * quantity);
    totals.estimatedNetAfterEbayCosts = roundMoney(
      totals.estimatedNetAfterEbayCosts + numberOrZero(record.estimatedNetAfterEbayCosts) * quantity,
    );
    totals.grossItemSales = roundMoney(totals.grossItemSales + numberOrZero(record.soldFor) * quantity);
    totals.otherEbayCharges = roundMoney(totals.otherEbayCharges + numberOrZero(record.otherEbayCharges) * quantity);
    totals.refunds = roundMoney(totals.refunds + numberOrZero(record.refundAmount) * quantity);
    totals.saleFees = roundMoney(totals.saleFees + numberOrZero(record.ebaySaleFees) * quantity);
    totals.shippingLabelsAttributed = roundMoney(
      totals.shippingLabelsAttributed + numberOrZero(record.shippingLabelCost) * quantity,
    );
    totals.totalBuyerPaid = roundMoney(totals.totalBuyerPaid + numberOrZero(record.totalBuyerPaid) * quantity);
    totals.units += quantity;
  }

  const shippingLabelCalibration = buildShippingLabelCalibration(state.unattributedShippingLabelSamples);
  const saleDates = records.map((record) => record.saleDate).filter(Boolean).sort();
  return {
    attribution: {
      recordsWithAdFees: records.filter((record) => numberOrZero(record.ebayAdFees) !== 0).length,
      recordsWithRefunds: records.filter((record) => numberOrZero(record.refundAmount) > 0).length,
      recordsWithSaleFees: records.filter((record) => numberOrZero(record.ebaySaleFees) > 0).length,
      recordsWithShippingLabels: records.filter((record) => numberOrZero(record.shippingLabelCost) !== 0).length,
      unattributedTotalsByCurrency: state.unattributedTotalsByCurrency,
    },
    createdAt: parseDate(options.createdAt ?? new Date()).toISOString(),
    economicsCompleteness: {
      advertisingFees: "joinable eBay advertising charges plus account-level unmatched totals",
      estimatedNetAfterEbayCosts:
        "subtracts only attributable eBay costs; it does not impute unlinked shipping-label batches or labels bought outside eBay",
      refunds: "joinable Fulfillment and Finances refunds plus account-level unmatched totals",
      saleFees: "joinable eBay sale fees plus account-level unmatched totals",
      shippingLabels:
        "partial: linked transactions are recorded as adjustments; unlinked transactions are aggregate batches and no per-label denominator is available",
      otherTransactions:
        "partial: DISPUTE, CREDIT, and ADJUSTMENT transactions are not yet joined to individual records or included in estimated net",
    },
    lastSyncRange: {
      from: options.from,
      to: options.to,
    },
    ledgerCoverage: {
      from: saleDates[0] ?? null,
      to: saleDates.at(-1) ?? null,
    },
    recordCount: records.length,
    shippingLabelCalibration,
    source: "ebay-fulfillment-finances",
    totalsByCurrency,
    unitCount: records.reduce((sum, record) => sum + Math.max(1, Math.floor(Number(record.quantity) || 1)), 0),
    version: 1,
  };
}

export function buildApiSoldHistoryIndex(records, options = {}) {
  return buildSoldHistoryIndex(records, {
    asOf: options.asOf,
    source: options.source ?? "ebay-sold-history-api",
    sourceSheets: options.sourceSheets ?? ["eBay Fulfillment API", "eBay Finances API"],
  });
}

export function mergeSoldHistoryBaseline(apiRecords, baselineRecords) {
  const apiKeys = new Set(apiRecords.flatMap(dedupeKeysForRecord));
  const merged = [...apiRecords];
  for (const baselineRecord of baselineRecords) {
    const keys = dedupeKeysForRecord(baselineRecord);
    if (keys.some((key) => apiKeys.has(key))) continue;
    merged.push(baselineRecord);
  }
  return merged.sort(compareRecords);
}

export function normalizeSyncState(value = {}) {
  const state = typeof value === "object" && value !== null ? value : {};
  return {
    appliedFinancialEventDigests: Array.isArray(state.appliedFinancialEventDigests)
      ? state.appliedFinancialEventDigests.filter((digest) => /^[a-f0-9]{64}$/.test(digest))
      : [],
    financialEventContentDigests: normalizeDigestMap(state.financialEventContentDigests),
    lastSuccessfulAt: safeIso(state.lastSuccessfulAt),
    lastSuccessfulFrom: safeIso(state.lastSuccessfulFrom),
    lastSuccessfulTo: safeIso(state.lastSuccessfulTo),
    lookbackDays: positiveInteger(state.lookbackDays, 730),
    refreshOverlapDays: positiveInteger(state.refreshOverlapDays, 14),
    recordsDigest: /^[a-f0-9]{64}$/.test(String(state.recordsDigest ?? ""))
      ? state.recordsDigest
      : undefined,
    source: "ebay-fulfillment-finances",
    unattributedShippingLabelSamples: Array.isArray(state.unattributedShippingLabelSamples)
      ? state.unattributedShippingLabelSamples
          .map(normalizeShippingSample)
          .filter(Boolean)
          .slice(-10_000)
      : [],
    unattributedTotalsByCurrency: normalizeUnattributedTotals(state.unattributedTotalsByCurrency),
    version: 1,
  };
}

export function hasFinancialEventCorrections(transactions, stateValue = {}) {
  const state = normalizeSyncState(stateValue);
  return transactions.some((transaction) => {
    const identityDigest = financialEventDigest(transaction);
    const previousContentDigest = state.financialEventContentDigests[identityDigest];
    return Boolean(previousContentDigest && previousContentDigest !== financialEventContentDigest(transaction));
  });
}

export function soldHistoryRecordsDigest(records) {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

export function resolveEbaySyncRange(options = {}) {
  const now = parseDate(options.now ?? new Date());
  const clockSkewSafetyMs = nonNegativeNumber(
    options.clockSkewSafetyMs,
    DEFAULT_API_CLOCK_SKEW_SAFETY_MS,
  );
  const apiSafeNow = new Date(now.getTime() - clockSkewSafetyMs);
  const requestedTo = parseDate(options.to ?? now, "to");
  const to = requestedTo.getTime() > apiSafeNow.getTime() ? apiSafeNow : requestedTo;
  const lookbackDays = positiveInteger(options.lookbackDays, 730);
  const refreshOverlapDays = positiveInteger(options.refreshOverlapDays, 14);
  let from;

  if (options.from) {
    from = parseDate(options.from, "from");
  } else if (options.lastSuccessfulTo) {
    const priorTo = parseDate(options.lastSuccessfulTo, "to");
    from = new Date(priorTo.getTime() - refreshOverlapDays * 86_400_000);
  } else {
    from = new Date(to.getTime() - Math.max(0, lookbackDays - 1) * 86_400_000);
  }

  const earliest = new Date(to.getTime() - Math.max(0, lookbackDays - 1) * 86_400_000);
  if (from.getTime() < earliest.getTime()) from = earliest;
  from = startOfUtcDay(from);
  if (from.getTime() > to.getTime()) throw new Error("eBay sold-history synchronization start must be before its end.");

  return {
    from: from.toISOString(),
    clockSkewSafetyMs,
    lookbackDays,
    refreshOverlapDays,
    to: to.toISOString(),
  };
}

export function finalizeSyncState(stateValue, range, completedAt = new Date()) {
  const state = normalizeSyncState(stateValue);
  const rangeTo = parseDate(range.to);
  const priorTo = state.lastSuccessfulTo ? parseDate(state.lastSuccessfulTo) : null;
  const advancesIncrementalCursor = !priorTo || rangeTo.getTime() >= priorTo.getTime();
  return {
    ...state,
    lastSuccessfulAt: parseDate(completedAt).toISOString(),
    lastSuccessfulFrom: advancesIncrementalCursor
      ? parseDate(range.from).toISOString()
      : state.lastSuccessfulFrom,
    lastSuccessfulTo: advancesIncrementalCursor ? rangeTo.toISOString() : priorTo.toISOString(),
    lookbackDays: range.lookbackDays,
    refreshOverlapDays: range.refreshOverlapDays,
  };
}

export function assertSanitizedSoldHistoryOutput(value) {
  const forbiddenKeys = new Set([
    "accesstoken",
    "address",
    "buyer",
    "buyeremail",
    "buyername",
    "buyerusername",
    "email",
    "phone",
    "phonenumber",
    "raw",
    "rawpayload",
    "recipient",
    "recipientname",
    "referenceid",
    "refreshtoken",
    "shippingaddress",
    "shipto",
    "taxaddress",
    "transactionid",
    "username",
  ]);
  const visit = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (forbiddenKeys.has(normalizedKey)) {
        throw new Error(`Refusing to persist sensitive eBay field at ${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "$");
}

function applyFinancialTransaction(records, indexes, transaction, state) {
  if (transaction.transactionType === "SALE") {
    return applySaleTransaction(records, indexes, transaction, state);
  }
  if (transaction.transactionType === "REFUND") {
    return applyRefundTransaction(records, indexes, transaction, state);
  }
  if (transaction.transactionType === "NON_SALE_CHARGE") {
    return applyChargeTransaction(records, indexes, transaction, state);
  }
  if (transaction.transactionType === "SHIPPING_LABEL") {
    return applyShippingLabelTransaction(records, indexes, transaction, state);
  }
  return { attributed: false };
}

function applySaleTransaction(records, indexes, transaction, state) {
  let attributedAmount = 0;
  let anyAttributed = false;
  for (const lineItem of transaction.lineItems ?? []) {
    const target = findLineTarget(indexes, transaction.orderId, lineItem.lineItemId, transaction.currency);
    for (const fee of lineItem.fees ?? []) {
      const amount = Math.abs(numberOrZero(fee.amount));
      attributedAmount += amount;
      if (!target) {
        addUnattributed(state, transaction.currency, feeCategory(fee.feeType), amount);
        continue;
      }
      addRecordAmount(
        target,
        feeCategory(fee.feeType) === "advertising" ? "ebayAdFees" : "ebaySaleFeesGross",
        amount / target.quantity,
        "exact_line_item",
      );
      anyAttributed = true;
    }
  }

  const residual = Math.max(0, Math.abs(numberOrZero(transaction.totalFeeAmount)) - attributedAmount);
  if (residual > 0) {
    const targetSet = findTransactionTargets(indexes, transaction);
    if (targetSet.records.length > 0) {
      allocateAcrossRecords(targetSet.records, residual, "ebaySaleFeesGross", targetSet.method);
      anyAttributed = true;
    } else {
      addUnattributed(state, transaction.currency, "sellingFees", residual);
    }
  }
  return { attributed: anyAttributed };
}

function applyRefundTransaction(records, indexes, transaction, state) {
  const targetSet = findTransactionTargets(indexes, transaction);
  const grossRefund = Math.abs(numberOrZero(transaction.totalFeeBasisAmount || transaction.amount));
  let anyAttributed = false;

  if (targetSet.records.length > 0 && grossRefund > 0) {
    allocateAcrossRecords(targetSet.records, grossRefund, "financialRefundAmount", targetSet.method);
    anyAttributed = true;
  } else if (grossRefund > 0) {
    addUnattributed(state, transaction.currency, "refunds", grossRefund);
  }

  let feeCredits = 0;
  for (const lineItem of transaction.lineItems ?? []) {
    const target = findLineTarget(indexes, transaction.orderId, lineItem.lineItemId, transaction.currency);
    for (const fee of lineItem.fees ?? []) {
      const credit = Math.abs(numberOrZero(fee.amount));
      feeCredits += credit;
      const category = feeCategory(fee.feeType);
      if (target && credit > 0) {
        addRecordAmount(
          target,
          category === "advertising" ? "ebayAdFees" : "ebaySaleFeeCredits",
          (category === "advertising" ? -credit : credit) / target.quantity,
          "exact_line_item",
        );
        anyAttributed = true;
      } else if (credit > 0) {
        addUnattributed(state, transaction.currency, category, -credit);
      }
    }
  }

  const residualCredit = Math.max(0, Math.abs(numberOrZero(transaction.totalFeeAmount)) - feeCredits);
  if (residualCredit > 0 && targetSet.records.length > 0) {
    allocateAcrossRecords(targetSet.records, residualCredit, "ebaySaleFeeCredits", targetSet.method);
    anyAttributed = true;
  } else if (residualCredit > 0) {
    addUnattributed(state, transaction.currency, "sellingFees", -residualCredit);
  }
  return { attributed: anyAttributed };
}

function applyChargeTransaction(records, indexes, transaction, state) {
  const targetSet = findTransactionTargets(indexes, transaction);
  const signedAmount = signedDebitAmount(transaction);
  const category = transaction.chargeCategory === "advertising" ? "advertising" : transaction.chargeCategory === "selling_fee" ? "sellingFees" : "otherCharges";
  const field =
    category === "advertising" ? "ebayAdFees" : category === "sellingFees" ? "ebaySaleFeesGross" : "otherEbayCharges";

  if (targetSet.records.length === 0) {
    addUnattributed(state, transaction.currency, category, signedAmount);
    return { attributed: false };
  }

  allocateAcrossRecords(targetSet.records, signedAmount, field, targetSet.method);
  return { attributed: true };
}

function applyShippingLabelTransaction(records, indexes, transaction, state) {
  const targetSet = findTransactionTargets(indexes, transaction);
  const amount = Math.abs(numberOrZero(transaction.amount));
  const isCredit = transaction.bookingEntry === "CREDIT";
  const signedAmount = isCredit ? -amount : amount;

  if (targetSet.records.length === 0) {
    addUnattributed(state, transaction.currency, "shippingLabels", signedAmount);
    if (!isCredit && amount > 0) {
      state.unattributedShippingLabelSamples.push({
        amount,
        currency: transaction.currency,
        date: transaction.transactionDate.slice(0, 10),
      });
      state.unattributedShippingLabelSamples = state.unattributedShippingLabelSamples.slice(-10_000);
    }
    return { attributed: false };
  }

  allocateAcrossRecords(
    targetSet.records,
    amount,
    isCredit ? "shippingLabelCredits" : "shippingLabelDebits",
    targetSet.method,
  );
  return { attributed: true };
}

function findTransactionTargets(indexes, transaction) {
  const orderId =
    transaction.orderId ??
    transaction.references?.find((reference) => /ORDER/.test(reference.type))?.id;
  const lineItemIds = new Set(
    (transaction.lineItems ?? []).map((lineItem) => lineItem.lineItemId).filter(Boolean),
  );
  for (const reference of transaction.references ?? []) {
    if (/LINE_ITEM/.test(reference.type)) lineItemIds.add(reference.id);
  }

  if (lineItemIds.size > 0) {
    const lineTargets = [...lineItemIds]
      .map((lineItemId) => findLineTarget(indexes, orderId, lineItemId, transaction.currency))
      .filter(Boolean);
    if (lineTargets.length > 0) return { method: "exact_line_item", records: uniqueRecords(lineTargets) };
  }

  if (orderId) {
    const orderTargets = (indexes.byOrder.get(orderId) ?? []).filter(
      (record) => (record.currency ?? "USD") === transaction.currency,
    );
    if (orderTargets.length > 0) return { method: "allocated_order", records: orderTargets };
  }

  const itemIds = (transaction.references ?? [])
    .filter((reference) => /ITEM/.test(reference.type) && !/LINE_ITEM/.test(reference.type))
    .map((reference) => reference.id);
  const itemTargets = uniqueRecords(
    itemIds.flatMap((itemId) => indexes.byItem.get(itemId) ?? []).filter(
      (record) => (record.currency ?? "USD") === transaction.currency,
    ),
  );
  if (itemTargets.length === 1) return { method: "exact_item_reference", records: itemTargets };
  return { method: "unavailable", records: [] };
}

function findLineTarget(indexes, orderId, lineItemId, currency) {
  if (!lineItemId) return null;
  if (orderId) {
    const exact = indexes.byKey.get(`${orderId}:${lineItemId}`);
    if (exact && (exact.currency ?? "USD") === currency) return exact;
  }
  const candidates = (indexes.byLineItem.get(lineItemId) ?? []).filter(
    (record) => (record.currency ?? "USD") === currency,
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function buildRecordIndexes(records) {
  const indexes = {
    byItem: new Map(),
    byKey: new Map(),
    byLineItem: new Map(),
    byOrder: new Map(),
  };
  for (const record of records) {
    if (record.recordKey) indexes.byKey.set(record.recordKey, record);
    appendIndex(indexes.byOrder, record.orderNumber, record);
    appendIndex(indexes.byLineItem, record.lineItemId, record);
    appendIndex(indexes.byItem, record.itemNumber, record);
  }
  return indexes;
}

function appendIndex(index, key, record) {
  if (!key) return;
  const values = index.get(key) ?? [];
  values.push(record);
  index.set(key, values);
}

function allocateAcrossRecords(records, amount, field, method) {
  const weights = records.map((record) => ({
    record,
    weight: Math.max(0.01, numberOrZero(record.totalBuyerPaid) * Math.max(1, Number(record.quantity) || 1)),
  }));
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let allocated = 0;

  weights.forEach((entry, index) => {
    const allocation =
      index === weights.length - 1 ? roundMoney(amount - allocated) : roundMoney((amount * entry.weight) / totalWeight);
    allocated = roundMoney(allocated + allocation);
    addRecordAmount(entry.record, field, allocation / Math.max(1, Number(entry.record.quantity) || 1), method);
  });
}

function addRecordAmount(record, field, perUnitAmount, method) {
  record[field] = roundMoney(numberOrZero(record[field]) + perUnitAmount);
  const attributionKey = attributionKeyForField(field);
  if (attributionKey) {
    record.economicsAttribution ??= emptyAttribution();
    record.economicsAttribution[attributionKey] = strongerAttribution(
      record.economicsAttribution[attributionKey],
      method,
    );
  }
}

function recalculateRecordEconomics(record) {
  record.ebayAdFees = roundMoney(Math.max(0, numberOrZero(record.ebayAdFees)));
  record.ebaySaleFeesGross = roundMoney(Math.max(0, numberOrZero(record.ebaySaleFeesGross)));
  record.ebaySaleFeeCredits = roundMoney(Math.max(0, numberOrZero(record.ebaySaleFeeCredits)));
  record.ebaySaleFees = roundMoney(Math.max(0, record.ebaySaleFeesGross - record.ebaySaleFeeCredits));
  record.financialRefundAmount = roundMoney(Math.max(0, numberOrZero(record.financialRefundAmount)));
  record.fulfillmentRefundAmount = roundMoney(Math.max(0, numberOrZero(record.fulfillmentRefundAmount)));
  record.refundAmount = roundMoney(Math.max(record.financialRefundAmount, record.fulfillmentRefundAmount));
  record.refundRate =
    numberOrZero(record.totalBuyerPaid) > 0
      ? roundTo(Math.min(1, record.refundAmount / numberOrZero(record.totalBuyerPaid)), 4)
      : 0;
  const fullyRefunded =
    record.financialRefundAmount >= numberOrZero(record.totalBuyerPaid) * 0.95 ||
    (record.financialRefundAmount === 0 &&
      record.fulfillmentRefundAmount >= numberOrZero(record.totalBuyerPaid) * 0.8);
  record.retainedQuantity = fullyRefunded ? 0 : Math.max(1, Math.floor(Number(record.quantity) || 1));
  record.shippingLabelDebits = roundMoney(Math.max(0, numberOrZero(record.shippingLabelDebits)));
  record.shippingLabelCredits = roundMoney(Math.max(0, numberOrZero(record.shippingLabelCredits)));
  record.shippingLabelCost = roundMoney(Math.max(0, record.shippingLabelDebits - record.shippingLabelCredits));
  record.otherEbayCharges = roundMoney(Math.max(0, numberOrZero(record.otherEbayCharges)));
  record.estimatedNetAfterEbayCosts = roundMoney(
    numberOrZero(record.totalBuyerPaid) -
      record.ebaySaleFees -
      record.ebayAdFees -
      record.refundAmount -
      record.shippingLabelCost -
      record.otherEbayCharges,
  );
  return record;
}

function preserveEconomics(fresh, existing) {
  const merged = { ...fresh };
  for (const field of ECONOMIC_FIELDS) {
    if (field in existing) merged[field] = existing[field];
  }
  merged.economicsAttribution = existing.economicsAttribution ?? fresh.economicsAttribution;
  return recalculateRecordEconomics(merged);
}

function addUnattributed(state, currency, category, amount) {
  const totals = (state.unattributedTotalsByCurrency[currency] ??= emptyUnattributedTotals());
  totals[category] = roundMoney(numberOrZero(totals[category]) + amount);
}

function buildShippingLabelCalibration(samples) {
  const byCurrency = {};
  for (const sample of samples) {
    (byCurrency[sample.currency] ??= []).push(sample);
  }
  return {
    perLabelCalibration: {
      reason:
        "Unattributed eBay SHIPPING_LABEL transactions are batched account debits and do not include a package-count denominator.",
      status: "unavailable",
    },
    unattributedBatchTransactionsByCurrency: Object.fromEntries(
      Object.entries(byCurrency).map(([currency, currencySamples]) => {
        const values = currencySamples.map((sample) => sample.amount).sort((left, right) => left - right);
        return [
          currency,
          {
            batchTransactionMedian: percentile(values, 0.5),
            batchTransactionP25: percentile(values, 0.25),
            batchTransactionP75: percentile(values, 0.75),
            batchTransactionTotal: roundMoney(values.reduce((sum, value) => sum + value, 0)),
            latestSampleDate: currencySamples.map((sample) => sample.date).sort().at(-1),
            sampleCount: values.length,
          },
        ];
      }),
    ),
    method: "unattributed-account-level-ebay-label-batch-debits",
    note:
      "Batch transaction percentiles are diagnostic account evidence only. They are never treated as per-package costs or assigned to individual records.",
  };
}

function financialEventDigest(transaction) {
  const stableIdentity =
    transaction.transactionId ||
    JSON.stringify([
      transaction.transactionType,
      transaction.transactionDate,
      transaction.orderId,
      transaction.amount,
      transaction.feeType,
    ]);
  return createHash("sha256").update(`${transaction.transactionType}:${stableIdentity}`).digest("hex");
}

function financialEventContentDigest(transaction) {
  const { transactionId: _transactionId, ...content } = transaction;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function isCompletedSaleOrder(order) {
  const cancelState = String(order.cancelState ?? "").toUpperCase();
  const paymentStatus = String(order.paymentStatus ?? "").toUpperCase();
  if (/CANCELLED|CANCELED/.test(cancelState) && !/PARTIAL/.test(cancelState)) return false;
  if (/FAILED|PENDING/.test(paymentStatus)) return false;
  return true;
}

function feeCategory(feeType) {
  return /AD[_ ]FEE|PROMOTED|ADVERTIS/i.test(String(feeType)) ? "advertising" : "sellingFees";
}

function attributionKeyForField(field) {
  if (field === "ebayAdFees") return "adFees";
  if (field === "ebaySaleFeesGross" || field === "ebaySaleFeeCredits") return "saleFees";
  if (field === "financialRefundAmount") return "refunds";
  if (field === "shippingLabelDebits" || field === "shippingLabelCredits") return "shippingLabels";
  if (field === "otherEbayCharges") return "otherCharges";
  return null;
}

function emptyAttribution() {
  return {
    adFees: "unavailable",
    otherCharges: "unavailable",
    refunds: "unavailable",
    saleFees: "unavailable",
    shippingLabels: "unavailable",
  };
}

function strongerAttribution(current, next) {
  const rank = {
    unavailable: 0,
    allocated_order: 1,
    exact_item_reference: 2,
    exact_line_item: 3,
  };
  return (rank[next] ?? 0) > (rank[current] ?? 0) ? next : current;
}

function normalizeUnattributedTotals(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).map(([currency, totals]) => [
      currency,
      {
        advertising: roundMoney(numberOrZero(totals?.advertising)),
        otherCharges: roundMoney(numberOrZero(totals?.otherCharges)),
        refunds: roundMoney(numberOrZero(totals?.refunds)),
        sellingFees: roundMoney(numberOrZero(totals?.sellingFees)),
        shippingLabels: roundMoney(numberOrZero(totals?.shippingLabels)),
      },
    ]),
  );
}

function normalizeDigestMap(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([identityDigest, contentDigest]) =>
        /^[a-f0-9]{64}$/.test(identityDigest) && /^[a-f0-9]{64}$/.test(String(contentDigest)),
    ),
  );
}

function normalizeShippingSample(sample) {
  if (!sample || typeof sample !== "object") return null;
  const amount = Number(sample.amount);
  const currency = typeof sample.currency === "string" ? sample.currency.toUpperCase() : "";
  const date = dateOnly(sample.date);
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency) || !date) return null;
  return { amount: roundMoney(amount), currency, date };
}

function emptyEconomicsTotals() {
  return {
    adFees: 0,
    buyerPaidShipping: 0,
    estimatedNetAfterEbayCosts: 0,
    grossItemSales: 0,
    otherEbayCharges: 0,
    refunds: 0,
    saleFees: 0,
    shippingLabelsAttributed: 0,
    totalBuyerPaid: 0,
    units: 0,
  };
}

function emptyUnattributedTotals() {
  return {
    advertising: 0,
    otherCharges: 0,
    refunds: 0,
    sellingFees: 0,
    shippingLabels: 0,
  };
}

function signedDebitAmount(transaction) {
  const amount = Math.abs(numberOrZero(transaction.amount));
  return transaction.bookingEntry === "CREDIT" ? -amount : amount;
}

function uniqueRecords(records) {
  return [...new Map(records.map((record) => [record.recordKey, record])).values()];
}

function dedupeKeysForRecord(record) {
  const order = String(record.orderNumber ?? "").trim();
  const item = String(record.itemNumber ?? "").trim();
  const normalizedKey = String(record.normalizedKey ?? "").trim();
  const date = String(record.saleDate ?? "").trim();
  const keys = [];
  if (order && item) keys.push(`order-item:${order}:${item}`);
  if (order && normalizedKey) keys.push(`order-release:${order}:${normalizedKey}`);
  if (!order && date && item && normalizedKey) keys.push(`date-item-release:${date}:${item}:${normalizedKey}`);
  return keys;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return roundMoney(sortedValues[index]);
}

function parseDate(value, boundary) {
  if (value instanceof Date) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === "string") {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T${boundary === "to" ? "23:59:59.999" : "00:00:00.000"}Z`)
      : new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  throw new Error(`Invalid sold-history sync date: ${value}`);
}

function safeIso(value) {
  if (!value) return undefined;
  try {
    return parseDate(value).toISOString();
  } catch {
    return undefined;
  }
}

function dateOnly(value) {
  if (!value) return undefined;
  try {
    return parseDate(value).toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function startOfUtcDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
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

function compareRecords(left, right) {
  return (
    String(left.saleDate ?? "").localeCompare(String(right.saleDate ?? "")) ||
    String(left.recordKey ?? "").localeCompare(String(right.recordKey ?? ""))
  );
}
