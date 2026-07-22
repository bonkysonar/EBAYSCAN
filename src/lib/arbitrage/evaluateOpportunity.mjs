export const EVALUATION_VERSION = 6;

const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const defaultArbitrageSettings = Object.freeze({
  balancedMaxDaysToSell: 120,
  balancedMinNetProfitDollars: 7,
  balancedMinRoiRatio: 0.3,
  defaultDuty: 0,
  defaultFxFees: 0,
  defaultInboundShipping: 5,
  defaultMarketplaceFeeFixed: 0.3,
  defaultMarketplaceFeeRate: 0.15,
  defaultOtherAcquisitionCosts: 0,
  defaultOtherSellingCosts: 0,
  defaultOutboundShipping: 6,
  defaultPackaging: 1,
  defaultPromotedListingRate: 0.02,
  defaultReturnsReserveAmount: 0,
  defaultReturnsReserveRate: 0.03,
  fastTurnMaxDaysToSell: 45,
  fastTurnMinNetProfitDollars: 4,
  fastTurnMinRoiRatio: 0.2,
  highMarginMaxDaysToSell: 270,
  highMarginMinNetProfitDollars: 12,
  highMarginMinRoiRatio: 0.5,
  maxActiveListings: 50,
  maxActiveListingsForScarceSingle: 3,
  maxActiveSupplyMonths: 6,
  maxDaysSinceLastSale: 60,
  maxEvidenceAgeDays: 30,
  maxOfferAgeDays: 2,
  minAverageSoldPrice: 10,
  minBuyMatchConfidence: 0.8,
  minMarginDollars: 7,
  minMarginRatio: 0.25,
  minNetProfitDollars: 7,
  minOneSellerSoldCount: 10,
  minRoiRatio: 0.3,
  minSalesPerMonth: 1,
  minSellThroughRate: 0.2,
  minSoldUnits90Days: 3,
  minTotalSoldCount: 10,
  minPriorityScoreForBuy: 65,
  minPriorityScoreForTest: 50,
  sourceTaxRatePercent: 9.5,
  watchMinNetProfitDollars: 5,
  watchMinRoiRatio: 0.15,
});

export function evaluateOpportunity(find, settingsOverrides = {}, nowInput = new Date()) {
  const settings = normalizedSettings(settingsOverrides);
  const sourceMinNetProfit = finiteNonNegative(find.sourceMinNetProfit);
  const sourceMinRoi = finiteNonNegative(find.sourceMinROI);
  if (find.opportunityType === "sitewide_sale") {
    const decision = find.status ?? "WATCH";
    return {
      ...find,
      allInCost: 0,
      cashReturnPer30Days: null,
      costLedger: buildCostLedger(
        0,
        null,
        {
          marketplaceFeeFixed: 0,
          otherSellingCosts: 0,
          outboundShipping: 0,
          packaging: 0,
          returnsReserveAmount: 0,
        },
        settings,
      ),
      decision,
      estimatedDaysToSell: null,
      estimatedMargin: null,
      evaluationVersion: EVALUATION_VERSION,
      expectedNetProfit: null,
      gates: emptyGates(),
      longTermSalesPerMonth: null,
      longTermSupplyMonths: null,
      marginRatio: null,
      priorityBand: "REJECT",
      priorityBreakdown: emptyPriorityBreakdown(),
      priorityScore: 0,
      profitPer30Days: null,
      reasonCodes: ["SITEWIDE_SALE_REQUIRES_PRODUCT_REVIEW"],
      reasons: [
        find.saleSignal ? `Sale signal: ${find.saleSignal}` : "Site-wide or broad sale detected.",
        "Review individual records before buying; this alert has no record-level market evidence.",
      ],
      recommendedMaxPurchasePrice: null,
      recommendedStrategy: null,
      roiRatio: null,
      status: decision,
      strategyOptions: [],
    };
  }

  const now = validDate(nowInput) ?? new Date();
  const sold = canonicalSoldEvidence(find, now);
  const active = canonicalActiveEvidence(find);
  const lowestActiveMarketPrice = finitePositive(find.lowestActivePrice);
  const resalePrice = canonicalResalePrice(find);
  const sourceCurrency =
    normalizeCurrency(find.sourceCurrency) ?? defaultCurrencyForCountry(find.sourceCountry);
  const sourceCurrencyUnknown = sourceCurrency === null;
  const sourcePurchasePrice = finiteNonNegative(find.purchasePrice);
  const conversionRate = finitePositive(find.currencyConversionRate);
  const conversionUpdatedAt = validDate(find.currencyConversionUpdatedAt);
  const conversionAgeDays = ageInDays(conversionUpdatedAt, now);
  const convertedPurchasePrice =
    sourcePurchasePrice !== null && conversionRate !== null
      ? roundMoney(sourcePurchasePrice * conversionRate)
      : null;
  const conversionFresh =
    convertedPurchasePrice !== null &&
    conversionRate !== null &&
    conversionAgeDays !== null &&
    conversionAgeDays <= settings.maxEvidenceAgeDays;
  const currencyConversionRequired =
    sourceCurrencyUnknown || Boolean(sourceCurrency !== "USD" && !conversionFresh);
  const purchasePriceForLedger =
    sourceCurrency && sourceCurrency !== "USD" && conversionFresh
      ? convertedPurchasePrice
      : find.purchasePrice;
  const costLedger = buildCostLedger(
    purchasePriceForLedger,
    currencyConversionRequired ? null : resalePrice,
    find.costs,
    settings,
  );
  const sellThroughRate =
    sold.units90 !== null && active.exactCount !== null
      ? ratio(sold.units90, sold.units90 + active.exactCount, sold.units90 === 0 && active.exactCount === 0 ? 0 : null)
      : finiteNonNegative(find.sellThroughRate);
  const salesPerMonth = sold.salesPerMonth ?? finiteNonNegative(find.salesPerMonth);
  const activeSupplyMonths =
    active.exactCount !== null && salesPerMonth !== null
      ? salesPerMonth > 0
        ? round(active.exactCount / salesPerMonth, 2)
        : null
      : finiteNonNegative(find.activeSupplyMonths);
  const longTermSalesPerMonth =
    sold.units1095 !== null
      ? round(sold.units1095 / 36, 2)
      : finiteNonNegative(find.longTermSalesPerMonth);
  const longTermSupplyMonths =
    active.exactCount !== null && longTermSalesPerMonth !== null
      ? longTermSalesPerMonth > 0
        ? round(active.exactCount / longTermSalesPerMonth, 2)
        : null
      : finiteNonNegative(find.longTermSupplyMonths);
  const estimatedDaysToSell = estimateDaysToSell(
    active.exactCount,
    activeSupplyMonths,
    longTermSupplyMonths,
    salesPerMonth,
    longTermSalesPerMonth,
  );
  const profitPer30Days =
    costLedger.expectedNetProfit !== null && estimatedDaysToSell !== null
      ? roundMoney(costLedger.expectedNetProfit * (30 / estimatedDaysToSell))
      : null;
  const cashReturnPer30Days =
    costLedger.roiRatio !== null && estimatedDaysToSell !== null
      ? round(costLedger.roiRatio * (30 / estimatedDaysToSell), 4)
      : null;
  const soldEvidenceAge = ageInDays(sold.capturedAt, now);
  const activeEvidenceAge = ageInDays(active.capturedAt, now);
  const marketEvidenceFreshness =
    soldEvidenceAge !== null &&
    activeEvidenceAge !== null &&
    soldEvidenceAge <= settings.maxEvidenceAgeDays &&
    activeEvidenceAge <= settings.maxEvidenceAgeDays;
  const offerAge = ageInDays(find.capturedAt, now);
  const offerFreshness =
    offerAge !== null &&
    offerAge <= settings.maxOfferAgeDays;
  const purchaseOfferVerified = ["direct_retailer", "official_api"].includes(
    String(find.purchaseOfferVerification ?? "").trim().toLowerCase(),
  );
  const evidenceFreshness = marketEvidenceFreshness && offerFreshness;
  const soldConditionMatches = sold.condition === expectedSoldCondition(find.condition);
  const soldEvidence =
    sold.status === "validated" &&
    sold.units90 !== null &&
    sold.latestSaleDate !== null &&
    sold.velocityValidated &&
    soldConditionMatches;
  const activeEvidence =
    (active.status === "available" || active.status === "no_results") &&
    active.searchComplete &&
    active.exactCount !== null;
  const matchConfidence =
    sold.matchConfidence >= settings.minBuyMatchConfidence &&
    active.matchConfidence >= settings.minBuyMatchConfidence;
  const strategyOptions = buildStrategyOptions({
    activeSupplyMonths,
    costLedger,
    currencyConversionRequired,
    estimatedDaysToSell,
    find,
    longTermSalesPerMonth,
    longTermSupplyMonths,
    matchConfidence,
    marketEvidenceFreshness,
    offerFreshness,
    resalePrice,
    salesPerMonth,
    sellThroughRate,
    settings,
    sold,
    soldEvidence,
    sourceMinNetProfit,
    sourceMinRoi,
  });
  const demand = strategyOptions.some((option) => option.demandQualified);
  const supply =
    active.exactCount !== null &&
    active.exactCount <= settings.maxActiveListings &&
    estimatedDaysToSell !== null &&
    estimatedDaysToSell <= settings.highMarginMaxDaysToSell;
  const recommendedStrategy =
    strategyOptions.find((option) => option.eligible)?.id ?? null;
  const economics = strategyOptions.some((option) => option.economicsQualified);
  const priority = buildPriorityScore({
    active,
    activeEvidence,
    activeSupplyMonths,
    costLedger,
    currencyConversionRequired,
    evidenceFreshness,
    find,
    longTermSalesPerMonth,
    longTermSupplyMonths,
    matchConfidence,
    profitPer30Days,
    salesPerMonth,
    sold,
    soldEvidence,
  });
  const recommendedMaxPurchasePrice =
    resalePrice === null || currencyConversionRequired
      ? null
      : maximumPurchasePriceForStrategies(
          resalePrice,
          find.costs,
          settings,
          sourceMinNetProfit,
          sourceMinRoi,
          strategyOptions,
        );

  const gates = {
    activeEvidence,
    demand,
    economics,
    evidenceFreshness,
    matchConfidence,
    offerFreshness,
    purchaseOffer: purchaseOfferVerified,
    soldEvidence,
    supply,
  };
  const { decision, reasonCodes } = decideOpportunity({
    active,
    activeEvidence,
    costLedger,
    currencyConversionRequired,
    demand,
    economics,
    estimatedDaysToSell,
    lowestActiveMarketPrice,
    priority,
    recommendedStrategy,
    marketEvidenceFreshness,
    matchConfidence,
    offerFreshness,
    purchaseOfferVerified,
    recommendedMaxPurchasePrice,
    resalePrice,
    settings,
    sourceCurrencyUnknown,
    sold,
    soldConditionMatches,
    soldEvidence,
    strategyOptions,
    supply,
  });
  const reasons = describeDecision({
    active,
    activeEvidenceAge,
    activeSupplyMonths,
    estimatedDaysToSell,
    longTermSalesPerMonth,
    longTermSupplyMonths,
    lowestActiveMarketPrice,
    priority,
    profitPer30Days,
    recommendedStrategy,
    costLedger,
    currencyConversionRequired,
    marketEvidenceFreshness,
    offerAge,
    offerFreshness,
    purchaseOfferVerified,
    reasonCodes,
    recommendedMaxPurchasePrice,
    resalePrice,
    salesPerMonth,
    sellThroughRate,
    settings,
    sourceCurrencyUnknown,
    sold,
    soldConditionMatches,
    soldEvidenceAge,
    strategyOptions,
  });
  return {
    ...find,
    activeSupplyMonths,
    allInCost: costLedger.totalCost,
    cashReturnPer30Days,
    conservativeResalePrice: resalePrice,
    costLedger,
    currencyConversionRequired,
    daysSinceLastSale: sold.daysSinceLastSale,
    decision,
    estimatedDaysToSell,
    estimatedMargin: costLedger.expectedNetProfit,
    evaluationVersion: EVALUATION_VERSION,
    exactActiveListingCount: active.exactCount,
    expectedNetProfit: costLedger.expectedNetProfit,
    gates,
    longTermSalesPerMonth,
    longTermSupplyMonths,
    marginRatio: costLedger.marginRatio,
    priorityBand: priority.band,
    priorityBreakdown: priority.breakdown,
    priorityScore: priority.score,
    profitPer30Days,
    reasonCodes,
    reasons,
    recommendedMaxPurchasePrice,
    recommendedStrategy,
    roiRatio: costLedger.roiRatio,
    salesPerMonth,
    sellThroughRate,
    soldUnits30Days: sold.units30,
    soldUnits90Days: sold.units90,
    soldUnits365Days: sold.units365,
    soldUnits1095Days: sold.units1095,
    sourceCurrency,
    purchasePriceUsd:
      sourceCurrency && sourceCurrency !== "USD" ? convertedPurchasePrice : find.purchasePriceUsd,
    status: decision,
    strategyOptions,
  };
}

export function buildCostLedger(purchasePrice, expectedResalePrice, costs = {}, settingsOverrides = {}) {
  const settings = normalizedSettings(settingsOverrides);
  const price = finiteNonNegative(purchasePrice) ?? 0;
  const resale = finiteNonNegative(expectedResalePrice);
  const taxRatePercent = finiteNonNegative(costs?.taxRatePercent) ?? settings.sourceTaxRatePercent;
  const salesTax =
    finiteNonNegative(costs?.taxAmount) ??
    roundMoney(price * (taxRatePercent / 100));
  const inboundShipping = amount(costs?.inboundShipping, settings.defaultInboundShipping);
  const duty = amount(costs?.duty, settings.defaultDuty);
  const fxFees = amount(costs?.fxFees, settings.defaultFxFees);
  const otherAcquisitionCosts = amount(costs?.otherAcquisitionCosts, settings.defaultOtherAcquisitionCosts);
  const marketplaceFeeRate = rate(costs?.marketplaceFeeRate, settings.defaultMarketplaceFeeRate);
  const marketplaceFeeFixed = amount(costs?.marketplaceFeeFixed, settings.defaultMarketplaceFeeFixed);
  const promotedListingRate = rate(costs?.promotedListingRate, settings.defaultPromotedListingRate);
  const outboundShipping = amount(costs?.outboundShipping, settings.defaultOutboundShipping);
  const packaging = amount(costs?.packaging, settings.defaultPackaging);
  const returnsReserveRate = rate(costs?.returnsReserveRate, settings.defaultReturnsReserveRate);
  const otherSellingCosts = amount(costs?.otherSellingCosts, settings.defaultOtherSellingCosts);
  const returnsReserveAmount = amount(costs?.returnsReserveAmount, settings.defaultReturnsReserveAmount);
  const landedCost = roundMoney(price + salesTax + inboundShipping + duty + fxFees + otherAcquisitionCosts);
  const marketplaceFee = resale === null ? 0 : roundMoney(resale * marketplaceFeeRate + marketplaceFeeFixed);
  const promotedListingFee = resale === null ? 0 : roundMoney(resale * promotedListingRate);
  const returnsReserve = resale === null ? returnsReserveAmount : roundMoney(resale * returnsReserveRate + returnsReserveAmount);
  const sellingCosts = roundMoney(
    marketplaceFee +
      promotedListingFee +
      outboundShipping +
      packaging +
      returnsReserve +
      otherSellingCosts,
  );
  const totalCost = roundMoney(landedCost + sellingCosts);
  const expectedNetProfit = resale === null ? null : roundMoney(resale - totalCost);
  const roiRatio = expectedNetProfit === null || landedCost <= 0 ? null : round(expectedNetProfit / landedCost, 4);
  const marginRatio = expectedNetProfit === null || resale === null || resale <= 0 ? null : round(expectedNetProfit / resale, 4);

  return {
    duty,
    expectedNetProfit,
    expectedResalePrice: resale,
    fxFees,
    inboundShipping,
    landedCost,
    marketplaceFee,
    marketplaceFeeFixed,
    marketplaceFeeRate,
    marginRatio,
    otherAcquisitionCosts,
    otherSellingCosts,
    outboundShipping,
    packaging,
    promotedListingFee,
    promotedListingRate,
    purchasePrice: price,
    returnsReserve,
    returnsReserveRate,
    roiRatio,
    salesTax,
    sellingCosts,
    totalCost,
  };
}

function canonicalSoldEvidence(find, now) {
  const hasStructuredEvidence = isStructuredEvidence(find.soldEvidence);
  const evidence = hasStructuredEvidence ? find.soldEvidence : {};
  const latestSaleDate = isoDate(
    hasStructuredEvidence
      ? evidence.latestSaleDate
      : find.latestSoldDate ?? find.ebayResearchLatestSaleDate,
  );
  const units90 = finiteNonNegative(
    hasStructuredEvidence ? evidence.unitsSold90Days : find.soldUnits90Days,
  );
  const evidenceDays = finiteNonNegative(
    hasStructuredEvidence ? evidence.daysSinceLastSale : find.daysSinceLastSale,
  );
  const daysSinceLastSale =
    latestSaleDate !== null
      ? daysBetween(latestSaleDate, now)
      : evidenceDays;
  return {
    capturedAt: isoTimestamp(
      hasStructuredEvidence ? evidence.capturedAt : find.ebayResearchUpdatedAt,
    ),
    condition:
      (hasStructuredEvidence ? evidence.condition : find.ebaySoldCondition) ?? "unknown",
    daysSinceLastSale,
    latestSaleDate,
    matchConfidence: confidenceScore(
      hasStructuredEvidence ? evidence.matchConfidence : find.ebaySoldMatchConfidence,
    ),
    salesPerMonth:
      monthlyVelocity(units90, 3) ??
      finiteNonNegative(
        hasStructuredEvidence ? evidence.salesPerMonth : find.salesPerMonth,
      ),
    status:
      (hasStructuredEvidence ? evidence.status : find.ebayResearchStatus) ?? "pending",
    units30: finiteNonNegative(
      hasStructuredEvidence ? evidence.unitsSold30Days : find.soldUnits30Days,
    ),
    units90,
    units365: finiteNonNegative(
      hasStructuredEvidence ? evidence.unitsSold365Days : find.soldUnits365Days,
    ),
    units1095: finiteNonNegative(
      hasStructuredEvidence ? evidence.unitsSold1095Days : find.soldUnits1095Days,
    ),
    velocityValidated:
      hasStructuredEvidence &&
      units90 !== null &&
      (evidence.velocityEvidence === "dated_transactions" ||
        evidence.source === "local-own-sales-history"),
  };
}

function canonicalActiveEvidence(find) {
  const hasStructuredEvidence = isStructuredEvidence(find.activeEvidence);
  const evidence = hasStructuredEvidence ? find.activeEvidence : {};
  const explicitExact = finiteNonNegative(
    hasStructuredEvidence ? evidence.exactMatchedListingCount : find.exactActiveListingCount,
  );
  const legacyExact =
    !hasStructuredEvidence && find.activeListingCountIsExactMatch
      ? finiteNonNegative(find.activeListingCount)
      : null;
  return {
    capturedAt: isoTimestamp(
      hasStructuredEvidence ? evidence.capturedAt : find.ebayActiveSearchUpdatedAt,
    ),
    exactCount: explicitExact ?? legacyExact,
    matchConfidence: confidenceScore(
      hasStructuredEvidence ? evidence.matchConfidence : find.ebayActiveMatchConfidence,
    ),
    searchComplete:
      (hasStructuredEvidence
        ? evidence.searchComplete
        : find.ebayActiveSearchComplete ?? find.activeListingCountIsExactMatch) ?? false,
    status:
      hasStructuredEvidence ? evidence.status : find.ebayActiveSearchStatus,
  };
}

function canonicalResalePrice(find) {
  const hasStructuredEvidence = isStructuredEvidence(find.soldEvidence);
  const evidence = hasStructuredEvidence ? find.soldEvidence : {};
  const explicit = finiteNonNegative(
    evidence.conservativeResalePrice ??
      evidence.priceP25 ??
      (hasStructuredEvidence ? null : find.conservativeResalePrice),
  );
  if (explicit !== null) return explicit;

  const rows = find.ebayResearchRows ?? find.productResearchRows ?? [];
  const rowPrices = [];
  for (const row of rows) {
    const price = finiteNonNegative(row.avgSoldPrice);
    if (price === null) continue;
    const total = roundMoney(price + (finiteNonNegative(row.avgShipping) ?? 0));
    const quantity = Math.max(1, Math.floor(finiteNonNegative(row.totalSold) ?? 1));
    rowPrices.push({ quantity, value: total });
  }
  if (rowPrices.length > 0) return weightedPercentile(rowPrices, 0.25);

  if (hasStructuredEvidence) return null;
  const averagePrice = finiteNonNegative(find.averageSoldPrice);
  if (averagePrice === null) return null;
  return roundMoney((averagePrice + (finiteNonNegative(find.averageSoldShipping) ?? 0)) * 0.85);
}

function decideOpportunity(context) {
  const {
    active,
    activeEvidence,
    costLedger,
    currencyConversionRequired,
    demand,
    economics,
    estimatedDaysToSell,
    lowestActiveMarketPrice,
    priority,
    recommendedStrategy,
    marketEvidenceFreshness,
    matchConfidence,
    offerFreshness,
    purchaseOfferVerified,
    recommendedMaxPurchasePrice,
    resalePrice,
    settings,
    sourceCurrencyUnknown,
    sold,
    soldConditionMatches,
    soldEvidence,
    strategyOptions,
    supply,
  } = context;
  const knownEconomicsHardFail =
    !currencyConversionRequired &&
    resalePrice !== null &&
    costLedger.expectedNetProfit !== null &&
    (costLedger.expectedNetProfit < 0 ||
      (costLedger.roiRatio !== null && costLedger.roiRatio < 0));
  const knownSupplyHardFail =
    activeEvidence &&
    soldEvidence &&
    active.exactCount !== null &&
    active.exactCount > settings.maxActiveListings &&
    estimatedDaysToSell !== null &&
    estimatedDaysToSell > settings.highMarginMaxDaysToSell;
  const activeMarketBelowBuyCost =
    !currencyConversionRequired &&
    activeEvidence &&
    active.matchConfidence >= settings.minBuyMatchConfidence &&
    lowestActiveMarketPrice !== null &&
    lowestActiveMarketPrice <= costLedger.purchasePrice;
  if (
    knownEconomicsHardFail ||
    knownSupplyHardFail ||
    activeMarketBelowBuyCost
  ) {
    const reasonCodes = [];
    if (knownEconomicsHardFail) reasonCodes.push("ECONOMICS_HARD_FAIL");
    if (knownSupplyHardFail) reasonCodes.push("SUPPLY_HARD_FAIL");
    if (activeMarketBelowBuyCost) {
      reasonCodes.push("ACTIVE_MARKET_BELOW_BUY_COST");
    }
    if (!marketEvidenceFreshness) reasonCodes.push("EVIDENCE_STALE_OR_UNDATED");
    if (!offerFreshness) reasonCodes.push("OFFER_STALE_OR_UNDATED");
    return {
      decision: "REJECT",
      reasonCodes,
    };
  }
  if (priority.avoided) {
    return {
      decision: "REJECT",
      reasonCodes: ["USER_AVOID_PREFERENCE"],
    };
  }

  const missingEvidence = [];
  if (sourceCurrencyUnknown) missingEvidence.push("SOURCE_CURRENCY_UNKNOWN");
  else if (currencyConversionRequired) missingEvidence.push("SOURCE_CURRENCY_UNCONVERTED");
  if (!soldEvidence) missingEvidence.push("SOLD_EVIDENCE_INCOMPLETE");
  if (!sold.velocityValidated) missingEvidence.push("SOLD_VELOCITY_UNVALIDATED");
  if (!activeEvidence) missingEvidence.push("ACTIVE_EVIDENCE_INCOMPLETE");
  if (!marketEvidenceFreshness) missingEvidence.push("EVIDENCE_STALE_OR_UNDATED");
  if (!offerFreshness) missingEvidence.push("OFFER_STALE_OR_UNDATED");
  if (!purchaseOfferVerified) missingEvidence.push("ACQUISITION_OFFER_UNVERIFIED");
  if (!soldConditionMatches) missingEvidence.push("SOLD_CONDITION_MISMATCH");
  if (sold.matchConfidence < settings.minBuyMatchConfidence) missingEvidence.push("SOLD_MATCH_CONFIDENCE_LOW");
  if (active.matchConfidence < settings.minBuyMatchConfidence) missingEvidence.push("ACTIVE_MATCH_CONFIDENCE_LOW");
  if (resalePrice === null) missingEvidence.push("CONSERVATIVE_RESALE_MISSING");

  if (missingEvidence.length > 0) {
    const explicitMismatch =
      (sold.matchConfidence > 0 && sold.matchConfidence < 0.5) ||
      (active.matchConfidence > 0 && active.matchConfidence < 0.5);
    return {
      decision: explicitMismatch ? "REJECT" : "REVIEW",
      reasonCodes: [...new Set(missingEvidence)],
    };
  }

  if (
    recommendedStrategy &&
    priority.score >= settings.minPriorityScoreForBuy
  ) {
    return {
      decision: "BUY",
      reasonCodes: ["ADAPTIVE_STRATEGY_PASSED", `STRATEGY_${recommendedStrategy.toUpperCase()}`],
    };
  }
  if (
    recommendedStrategy &&
    priority.score >= settings.minPriorityScoreForTest
  ) {
    return {
      decision: "REVIEW",
      reasonCodes: ["TEST_ONE_OPTION", `STRATEGY_${recommendedStrategy.toUpperCase()}`],
    };
  }
  if (recommendedStrategy) {
    return {
      decision: "WATCH",
      reasonCodes: [
        "LOW_PRIORITY_WATCH",
        `STRATEGY_${recommendedStrategy.toUpperCase()}`,
      ],
    };
  }

  const reasonCodes = [];
  if (!demand) reasonCodes.push("DEMAND_GATE_FAILED");
  if (!supply) reasonCodes.push("SUPPLY_GATE_FAILED");
  if (!economics) reasonCodes.push("ECONOMICS_GATE_FAILED");
  if (!matchConfidence) reasonCodes.push("MATCH_CONFIDENCE_GATE_FAILED");
  const watchOption = strategyOptions.find((option) => option.watchQualified);
  if (
    watchOption &&
    matchConfidence &&
    resalePrice >= settings.minAverageSoldPrice &&
    recommendedMaxPurchasePrice > 0
  ) {
    reasonCodes.push(
      watchOption.demandQualified
        ? "PRICE_TARGET_WATCH"
        : "SLOW_DEMAND_HIGH_MARGIN_WATCH",
    );
    return { decision: "WATCH", reasonCodes };
  }
  return { decision: "REJECT", reasonCodes };
}

function describeDecision(context) {
  const {
    active,
    activeEvidenceAge,
    activeSupplyMonths,
    costLedger,
    currencyConversionRequired,
    estimatedDaysToSell,
    longTermSalesPerMonth,
    longTermSupplyMonths,
    lowestActiveMarketPrice,
    marketEvidenceFreshness,
    offerAge,
    offerFreshness,
    purchaseOfferVerified,
    priority,
    profitPer30Days,
    reasonCodes,
    recommendedMaxPurchasePrice,
    recommendedStrategy,
    resalePrice,
    salesPerMonth,
    sellThroughRate,
    settings,
    sourceCurrencyUnknown,
    sold,
    soldConditionMatches,
    soldEvidenceAge,
    strategyOptions,
  } = context;
  const reasons = [];

  if (currencyConversionRequired) {
    reasons.push(
      sourceCurrencyUnknown
        ? "The source currency is unknown; profit and ROI are intentionally withheld until the currency is identified."
        : "The source price is not in USD and no fresh, dated USD conversion is available; profit and ROI are intentionally withheld.",
    );
  }

  if (resalePrice !== null) reasons.push(`Conservative resale estimate: ${money(resalePrice)}.`);
  else reasons.push("No conservative resale estimate is available.");

  if (!currencyConversionRequired) {
    reasons.push(
      `Expected net profit after tax, inbound shipping, marketplace fees, ads, outbound shipping, packaging, returns reserve, FX, and duty: ${
        costLedger.expectedNetProfit === null ? "n/a" : money(costLedger.expectedNetProfit)
      }.`,
    );
    reasons.push(
      `Cost ledger: ${money(costLedger.landedCost)} landed cost + ${money(costLedger.sellingCosts)} selling costs = ${money(costLedger.totalCost)} total.`,
    );
    if (costLedger.roiRatio !== null) reasons.push(`Expected ROI on landed cost: ${percent(costLedger.roiRatio)}.`);
    if (estimatedDaysToSell !== null) {
      reasons.push(
        `Estimated turn: about ${estimatedDaysToSell} days; velocity-adjusted profit ${
          profitPer30Days === null ? "n/a" : `${money(profitPer30Days)} per 30 days`
        }.`,
      );
    }
  }
  if (
    recommendedMaxPurchasePrice !== null &&
    costLedger.purchasePrice > recommendedMaxPurchasePrice
  ) {
    reasons.push(
      `Best current strategy supports a maximum buy price of ${money(recommendedMaxPurchasePrice)}.`,
    );
  }

  if (sold.units90 !== null) {
    reasons.push(
      `${sold.units90} condition-matched units sold in 90 days (${salesPerMonth === null ? "n/a" : salesPerMonth.toFixed(1)} per month); last sale ${
        sold.daysSinceLastSale === null ? "n/a" : `${sold.daysSinceLastSale} days ago`
      }.`,
    );
  } else {
    reasons.push("Quantity-weighted 90-day sold evidence is missing.");
  }

  if (active.exactCount !== null) {
    reasons.push(
      `${active.exactCount} exact matched active listings; sell-through ${
        sellThroughRate === null ? "n/a" : percent(sellThroughRate)
      }; supply ${activeSupplyMonths === null ? "n/a" : `${activeSupplyMonths.toFixed(1)} months`}.`,
    );
  } else {
    reasons.push("Exact matched active supply is missing.");
  }
  if (sold.units1095 !== null) {
    reasons.push(
      `${sold.units1095} exact matched units across the three-year research window (${longTermSalesPerMonth === null ? "n/a" : `${longTermSalesPerMonth.toFixed(2)}/mo`}); long-term supply ${
        longTermSupplyMonths === null ? "n/a" : `${longTermSupplyMonths.toFixed(1)} months`
      }.`,
    );
  }
  reasons.push(
    `Priority ${priority.band} (${priority.score}/100): demand ${priority.breakdown.demandDurability}/30, economics ${priority.breakdown.economics}/30, supply ${priority.breakdown.competitionAndSupply}/20, evergreen ${priority.breakdown.evergreenPrior}/15, evidence ${priority.breakdown.evidenceQuality}/5.`,
  );
  if (recommendedStrategy) {
    const option = strategyOptions.find((candidate) => candidate.id === recommendedStrategy);
    if (option) reasons.push(`Recommended option: ${option.label}. ${option.reason}`);
  } else if (strategyOptions.length > 0) {
    reasons.push(
      `No automatic strategy currently clears both demand and economics. ${strategyOptions
        .map((option) => `${option.label}: ${option.reason}`)
        .join(" ")}`,
    );
  }

  if (!soldConditionMatches) reasons.push("Sold evidence does not match the source record's condition.");
  if (!marketEvidenceFreshness) {
    reasons.push(
      `Market evidence must be dated within ${settings.maxEvidenceAgeDays} days (sold ${
        soldEvidenceAge === null ? "undated" : `${soldEvidenceAge}d`
      }, active ${activeEvidenceAge === null ? "undated" : `${activeEvidenceAge}d`}).`,
    );
  }
  if (!offerFreshness) {
    reasons.push(
      `The retailer offer must be dated within ${settings.maxOfferAgeDays} days (offer ${
        offerAge === null ? "undated or future-dated" : `${offerAge}d`
      }); refresh the source price and availability before buying.`,
    );
  }
  if (!purchaseOfferVerified) {
    reasons.push(
      "The acquisition price is an advertised campaign estimate or discovery-feed lead; confirm the live retailer price and availability before buying.",
    );
  }
  if (reasonCodes.includes("SOLD_MATCH_CONFIDENCE_LOW")) reasons.push("Sold-listing match confidence is too low for an automatic buy.");
  if (reasonCodes.includes("ACTIVE_MATCH_CONFIDENCE_LOW")) reasons.push("Active-listing match confidence is too low for an automatic buy.");
  if (reasonCodes.includes("SOLD_VELOCITY_UNVALIDATED")) {
    reasons.push("Recent sold counts must come from dated transactions; an aggregate total plus latest-sale date cannot prove 30/90-day velocity.");
  }
  if (reasonCodes.includes("ECONOMICS_HARD_FAIL")) {
    reasons.push("The conservative scenario loses money, so no margin/velocity tradeoff can rescue it.");
  }
  if (reasonCodes.includes("SUPPLY_HARD_FAIL")) {
    reasons.push(
      `Exact matched active supply (${active.exactCount}) exceeds the ${settings.maxActiveListings}-listing ceiling.`,
    );
  }
  if (
    reasonCodes.includes("ACTIVE_MARKET_BELOW_BUY_COST") &&
    lowestActiveMarketPrice !== null
  ) {
    reasons.push(
      `The exact active-market floor (${money(lowestActiveMarketPrice)}) is already at or below the source buy price (${money(costLedger.purchasePrice)}) before acquisition and selling costs.`,
    );
  }
  if (reasonCodes.includes("ADAPTIVE_STRATEGY_PASSED")) {
    reasons.push("At least one velocity-sensitive strategy clears its demand, supply, evidence, and economics requirements.");
  }
  if (reasonCodes.includes("TEST_ONE_OPTION")) {
    reasons.push("The evidence supports a one-copy test, but the overall priority score is not high enough for a normal restock.");
  }
  if (reasonCodes.includes("LOW_PRIORITY_WATCH")) {
    reasons.push("A velocity-sensitive option passes, but the broader durability score is too low for even a one-copy test; keep it on the watch list.");
  }
  if (reasonCodes.includes("PRICE_TARGET_WATCH")) {
    reasons.push("Demand supports an option, but the current price misses its velocity-adjusted economics; watch for the displayed maximum buy price.");
  }
  if (reasonCodes.includes("SLOW_DEMAND_HIGH_MARGIN_WATCH")) {
    reasons.push("The higher-margin economics are close enough to monitor, but item-level velocity is too thin for an automatic buy.");
  }
  if (reasonCodes.includes("USER_AVOID_PREFERENCE")) {
    reasons.push("This artist or catalog was marked as an avoid preference.");
  }
  return reasons;
}

function buildStrategyOptions(context) {
  const {
    activeSupplyMonths,
    costLedger,
    currencyConversionRequired,
    estimatedDaysToSell,
    find,
    longTermSalesPerMonth,
    longTermSupplyMonths,
    matchConfidence,
    marketEvidenceFreshness,
    offerFreshness,
    resalePrice,
    salesPerMonth,
    sellThroughRate,
    settings,
    sold,
    soldEvidence,
    sourceMinNetProfit,
    sourceMinRoi,
  } = context;
  const evergreen = evergreenSupport(find, sold, longTermSalesPerMonth);
  const evidenceReady =
    soldEvidence &&
    matchConfidence &&
    marketEvidenceFreshness &&
    offerFreshness &&
    !currencyConversionRequired &&
    resalePrice !== null &&
    resalePrice >= settings.minAverageSoldPrice;
  const quickDemand =
    sold.velocityValidated &&
    sold.units90 !== null &&
    sold.units90 >= Math.max(6, settings.minSoldUnits90Days * 2) &&
    salesPerMonth !== null &&
    salesPerMonth >= Math.max(2, settings.minSalesPerMonth * 2) &&
    sold.daysSinceLastSale !== null &&
    sold.daysSinceLastSale <= Math.min(45, settings.maxDaysSinceLastSale) &&
    sellThroughRate !== null &&
    sellThroughRate >= Math.max(0.3, settings.minSellThroughRate) &&
    estimatedDaysToSell !== null &&
    estimatedDaysToSell <= settings.fastTurnMaxDaysToSell;
  const balancedDemand =
    sold.velocityValidated &&
    sold.units90 !== null &&
    sold.units90 >= settings.minSoldUnits90Days &&
    salesPerMonth !== null &&
    salesPerMonth >= settings.minSalesPerMonth &&
    sold.daysSinceLastSale !== null &&
    sold.daysSinceLastSale <= settings.maxDaysSinceLastSale &&
    sellThroughRate !== null &&
    sellThroughRate >= settings.minSellThroughRate &&
    estimatedDaysToSell !== null &&
    estimatedDaysToSell <= settings.balancedMaxDaysToSell;
  const highMarginDemand =
    sold.velocityValidated &&
    sold.units365 !== null &&
    sold.units365 >= Math.max(6, settings.minSoldUnits90Days * 2) &&
    sold.daysSinceLastSale !== null &&
    sold.daysSinceLastSale <= Math.max(120, settings.maxDaysSinceLastSale) &&
    (estimatedDaysToSell !== null
      ? estimatedDaysToSell <= settings.highMarginMaxDaysToSell
      : longTermSupplyMonths !== null &&
        longTermSupplyMonths * 30 <= settings.highMarginMaxDaysToSell) &&
    (longTermSalesPerMonth === null || longTermSalesPerMonth >= 0.15);
  const partialHighMarginDemand =
    sold.velocityValidated &&
    sold.daysSinceLastSale !== null &&
    sold.daysSinceLastSale <= 365 &&
    ((sold.units365 !== null && sold.units365 >= 1) ||
      evergreen.level === "strong") &&
    estimatedDaysToSell !== null &&
    estimatedDaysToSell <= settings.highMarginMaxDaysToSell * 2;
  const balancedEvergreenFlex =
    balancedDemand &&
    !quickDemand &&
    evergreen.level === "strong" &&
    activeSupplyMonths !== null &&
    activeSupplyMonths <= Math.min(3, settings.maxActiveSupplyMonths);
  const balancedMinNetProfitDollars = balancedEvergreenFlex
    ? roundMoney(
        Math.max(
          settings.fastTurnMinNetProfitDollars,
          settings.balancedMinNetProfitDollars * 0.8,
        ),
      )
    : settings.balancedMinNetProfitDollars;
  const balancedMinRoiRatio = balancedEvergreenFlex
    ? round(
        Math.max(
          settings.fastTurnMinRoiRatio,
          settings.balancedMinRoiRatio * 0.8,
        ),
        4,
      )
    : settings.balancedMinRoiRatio;
  const slowInventory =
    (estimatedDaysToSell !== null &&
      estimatedDaysToSell > settings.balancedMaxDaysToSell) ||
    (activeSupplyMonths !== null &&
      activeSupplyMonths > settings.maxActiveSupplyMonths);
  let highMarginMinNetProfitDollars = Math.max(
    settings.highMarginMinNetProfitDollars,
    sourceMinNetProfit ?? 0,
  );
  let highMarginMinRoiRatio = Math.max(
    settings.highMarginMinRoiRatio,
    sourceMinRoi ?? 0,
  );
  const highMarginThresholdReasons = [
    `Slower inventory starts at ${money(highMarginMinNetProfitDollars)} net and ${percent(highMarginMinRoiRatio)} ROI.`,
  ];
  if (slowInventory) {
    highMarginMinNetProfitDollars = roundMoney(
      highMarginMinNetProfitDollars + 2,
    );
    highMarginMinRoiRatio = round(highMarginMinRoiRatio + 0.05, 4);
    highMarginThresholdReasons.push(
      "Added a $2.00 net and 5-point ROI cushion because the estimated turn or active supply exceeds the balanced horizon.",
    );
  }
  if (slowInventory && evergreen.level === "none") {
    highMarginMinNetProfitDollars = roundMoney(
      highMarginMinNetProfitDollars + 1,
    );
    highMarginMinRoiRatio = round(highMarginMinRoiRatio + 0.05, 4);
    highMarginThresholdReasons.push(
      "Added a $1.00 net and 5-point ROI cushion because own-sales and long-term evidence do not show evergreen support.",
    );
  }

  return [
    strategyOption({
      costLedger,
      demandQualified: quickDemand,
      evidenceReady,
      estimatedDaysToSell,
      id: "fast_turn",
      label: "Fast turn / smaller margin",
      maxDaysToSell: settings.fastTurnMaxDaysToSell,
      minNetProfitDollars: settings.fastTurnMinNetProfitDollars,
      minRoiRatio: settings.fastTurnMinRoiRatio,
      partialDemand: false,
      thresholdReasons: [
        "The smallest margin floor is reserved for validated recent velocity, strong sell-through, and a short inventory horizon.",
      ],
    }),
    strategyOption({
      costLedger,
      demandQualified: balancedDemand,
      evidenceReady,
      estimatedDaysToSell,
      id: "balanced",
      label: balancedEvergreenFlex
        ? "Evergreen balanced buy"
        : "Balanced buy",
      maxDaysToSell: settings.balancedMaxDaysToSell,
      minNetProfitDollars: balancedMinNetProfitDollars,
      minRoiRatio: balancedMinRoiRatio,
      partialDemand: false,
      thresholdReasons: balancedEvergreenFlex
        ? [
            `Strong evergreen evidence and no more than three months of exact supply lowered the balanced floor by 20%, bounded by the fast-turn floor.`,
            ...evergreen.reasons,
          ]
        : [
            `The standard balanced floor is ${money(settings.balancedMinNetProfitDollars)} net and ${percent(settings.balancedMinRoiRatio)} ROI.`,
          ],
    }),
    strategyOption({
      costLedger,
      demandQualified: highMarginDemand,
      evidenceReady,
      estimatedDaysToSell,
      id: "high_margin",
      label: "Slower / higher margin",
      maxDaysToSell: settings.highMarginMaxDaysToSell,
      minNetProfitDollars: highMarginMinNetProfitDollars,
      minRoiRatio: highMarginMinRoiRatio,
      partialDemand: partialHighMarginDemand,
      thresholdReasons: highMarginThresholdReasons,
    }),
  ];
}

function strategyOption({
  costLedger,
  demandQualified,
  evidenceReady,
  estimatedDaysToSell,
  id,
  label,
  maxDaysToSell,
  minNetProfitDollars,
  minRoiRatio,
  partialDemand,
  thresholdReasons,
}) {
  const economicsQualified =
    costLedger.expectedNetProfit !== null &&
    costLedger.expectedNetProfit >= minNetProfitDollars &&
    costLedger.roiRatio !== null &&
    costLedger.roiRatio >= minRoiRatio;
  const netProfitGapDollars =
    costLedger.expectedNetProfit === null
      ? null
      : roundMoney(
          Math.max(0, minNetProfitDollars - costLedger.expectedNetProfit),
        );
  const roiGapRatio =
    costLedger.roiRatio === null
      ? null
      : round(Math.max(0, minRoiRatio - costLedger.roiRatio), 4);
  const nearEconomics =
    costLedger.expectedNetProfit !== null &&
    costLedger.expectedNetProfit >= Math.max(0, minNetProfitDollars * 0.75) &&
    costLedger.roiRatio !== null &&
    costLedger.roiRatio >= minRoiRatio * 0.75;
  const watchQualified =
    evidenceReady &&
    costLedger.expectedNetProfit !== null &&
    costLedger.expectedNetProfit >= 0 &&
    ((demandQualified && !economicsQualified) ||
      (!demandQualified &&
        partialDemand &&
        (economicsQualified || nearEconomics)));
  const eligible = evidenceReady && demandQualified && economicsQualified;
  let reason;
  if (!evidenceReady) {
    reason = "Needs exact, fresh sold and active evidence before it can become actionable.";
  } else if (!demandQualified) {
    if (partialDemand && (economicsQualified || nearEconomics)) {
      reason = `The observed turn only partially supports this option, so the economics are watch-list evidence rather than an automatic buy.`;
    } else {
      reason = `The observed turn does not support this option's ${maxDaysToSell}-day inventory horizon.`;
    }
  } else if (!economicsQualified) {
    const gaps = [];
    if (netProfitGapDollars > 0) {
      gaps.push(`${money(netProfitGapDollars)} more net profit`);
    }
    if (roiGapRatio > 0) {
      gaps.push(`${Math.round(roiGapRatio * 100)} more ROI points`);
    }
    reason = `Demand fits, but current economics need ${gaps.join(" and ")}.`;
  } else {
    reason = `Clears ${money(minNetProfitDollars)} net, ${percent(minRoiRatio)} ROI, and the ${maxDaysToSell}-day turn horizon.`;
  }
  reason = `${reason} ${thresholdReasons.join(" ")}`;
  return {
    demandSupport: demandQualified
      ? "qualified"
      : partialDemand
        ? "partial"
        : "unsupported",
    demandQualified,
    economicsQualified,
    eligible,
    estimatedDaysToSell,
    id,
    label,
    maxDaysToSell,
    minNetProfitDollars,
    minRoiRatio,
    netProfitGapDollars,
    reason,
    roiGapRatio,
    thresholdReasons,
    watchQualified,
  };
}

function evergreenSupport(find, sold, longTermSalesPerMonth) {
  const artistUnits365 = finiteNonNegative(find.artistSoldUnits365Days) ?? 0;
  const artistUnits1095 = finiteNonNegative(find.artistSoldUnits1095Days) ?? 0;
  const externalScore = clamp(
    finiteNonNegative(find.externalEvergreenScore) ?? 0,
    0,
    1,
  );
  const reasons = [];
  let strength = 0;

  if (artistUnits365 >= 20) {
    strength += 2;
    reasons.push(`${artistUnits365} own artist-level sales in the last year.`);
  } else if (artistUnits365 >= 8) {
    strength += 1;
    reasons.push(`${artistUnits365} own artist-level sales in the last year.`);
  }
  if (artistUnits1095 >= 60) {
    strength += 2;
    reasons.push(`${artistUnits1095} own artist-level sales across three years.`);
  } else if (artistUnits1095 >= 24) {
    strength += 1;
    reasons.push(`${artistUnits1095} own artist-level sales across three years.`);
  }
  if (
    sold.units1095 !== null &&
    sold.units1095 >= 24 &&
    longTermSalesPerMonth !== null &&
    longTermSalesPerMonth >= 0.67
  ) {
    strength += 2;
    reasons.push(
      `${sold.units1095} condition-matched item sales across three years.`,
    );
  }
  if (externalScore >= 0.8) {
    strength += 2;
    reasons.push("High external evergreen confidence.");
  } else if (externalScore >= 0.5) {
    strength += 1;
    reasons.push("Moderate external evergreen confidence.");
  }
  if (find.userEvergreenPreference === "prefer") {
    strength += 1;
    reasons.push("Catalog is explicitly marked evergreen/preferred.");
  }

  return {
    level: strength >= 2 ? "strong" : strength >= 1 ? "moderate" : "none",
    reasons,
  };
}

function buildPriorityScore(context) {
  const {
    active,
    activeEvidence,
    activeSupplyMonths,
    costLedger,
    currencyConversionRequired,
    evidenceFreshness,
    find,
    longTermSalesPerMonth,
    longTermSupplyMonths,
    matchConfidence,
    profitPer30Days,
    salesPerMonth,
    sold,
    soldEvidence,
  } = context;
  const demandDurability = round(
    clamp(scale(salesPerMonth, 0, 4) * 12, 0, 12) +
      clamp(scale(sold.units365, 0, 12) * 8, 0, 8) +
      clamp(scale(longTermSalesPerMonth, 0, 1) * 6, 0, 6) +
      recencyPoints(sold.daysSinceLastSale),
    1,
  );
  const economics = currencyConversionRequired
    ? 0
    : round(
        clamp(scale(costLedger.expectedNetProfit, 0, 12) * 20, 0, 20) +
          clamp(scale(costLedger.roiRatio, 0, 0.6) * 8, 0, 8) +
          clamp(scale(profitPer30Days, 0, 8) * 2, 0, 2),
        1,
      );
  const hasDemandEvidenceForSupply =
    soldEvidence &&
    ((salesPerMonth !== null && salesPerMonth > 0) ||
      (longTermSalesPerMonth !== null && longTermSalesPerMonth > 0));
  const competitionAndSupply = hasDemandEvidenceForSupply
    ? supplyPoints(
        activeSupplyMonths ?? longTermSupplyMonths,
        active.exactCount,
      )
    : 0;
  const preference = String(find.userEvergreenPreference ?? "neutral");
  const artistUnits365 = finiteNonNegative(find.artistSoldUnits365Days);
  const artistUnits1095 = finiteNonNegative(find.artistSoldUnits1095Days);
  const externalEvergreenScore = clamp(
    finiteNonNegative(find.externalEvergreenScore) ?? 0,
    0,
    1,
  );
  const retailerReviewCount = finiteNonNegative(find.retailerReviewCount) ?? 0;
  const evergreenPrior = round(
    clamp(scale(artistUnits365, 0, 20) * 6, 0, 6) +
      clamp(scale(artistUnits1095, 0, 60) * 2, 0, 2) +
      clamp(scale(longTermSalesPerMonth, 0, 1) * 4, 0, 4) +
      (find.retailerBestSeller || find.retailerCustomerPick ? 1.5 : 0) +
      clamp(Math.log10(1 + retailerReviewCount) / 3, 0, 0.5) +
      externalEvergreenScore * 4 +
      (preference === "prefer" ? 5 : 0),
    1,
  );
  const evidenceQuality = round(
    (soldEvidence ? 1 : 0) +
      (activeEvidence ? 1 : 0) +
      (matchConfidence ? 1 : 0) +
      (evidenceFreshness ? 1 : 0) +
      (find.barcode || find.sku ? 1 : 0),
    1,
  );
  const breakdown = {
    competitionAndSupply: clamp(competitionAndSupply, 0, 20),
    demandDurability: clamp(demandDurability, 0, 30),
    economics: clamp(economics, 0, 30),
    evergreenPrior: clamp(evergreenPrior, 0, 15),
    evidenceQuality: clamp(evidenceQuality, 0, 5),
  };
  let score = Math.round(Object.values(breakdown).reduce((sum, value) => sum + value, 0));
  if (/^unknown artist$/i.test(String(find.artist ?? "").trim())) score = Math.max(0, score - 3);
  if (currencyConversionRequired) score = Math.max(0, score - 3);
  const avoided = preference === "avoid";
  if (avoided) score = Math.min(score, 49);
  const band =
    score >= 80
      ? "A"
      : score >= 65
        ? "B"
        : score >= 50
          ? "C"
          : "REJECT";
  return { avoided, band, breakdown, score };
}

function estimateDaysToSell(
  exactActiveCount,
  activeSupplyMonths,
  longTermSupplyMonths,
  salesPerMonth,
  longTermSalesPerMonth,
) {
  if (exactActiveCount === 0 && (salesPerMonth > 0 || longTermSalesPerMonth > 0)) return 7;
  const supplyMonths =
    activeSupplyMonths ??
    longTermSupplyMonths;
  if (supplyMonths === null || supplyMonths === undefined) return null;
  return Math.max(7, Math.round(supplyMonths * 30));
}

function recencyPoints(daysSinceLastSale) {
  if (daysSinceLastSale === null || daysSinceLastSale === undefined) return 0;
  if (daysSinceLastSale <= 30) return 4;
  if (daysSinceLastSale <= 60) return 3;
  if (daysSinceLastSale <= 120) return 2;
  if (daysSinceLastSale <= 365) return 1;
  return 0;
}

function supplyPoints(months, exactActiveCount) {
  if (exactActiveCount === 0) return 20;
  if (months === null || months === undefined) return 0;
  if (months <= 1) return 20;
  if (months <= 3) return 17;
  if (months <= 6) return 13;
  if (months <= 12) return 8;
  if (months <= 24) return 3;
  return 0;
}

function maximumPurchasePriceForStrategies(
  resalePrice,
  costs,
  settings,
  sourceMinNetProfit,
  sourceMinRoi,
  strategyOptions,
) {
  const actionableOptions = strategyOptions.filter(
    (option) => option.demandQualified || option.watchQualified,
  );
  if (actionableOptions.length === 0) return 0;
  return Math.max(
    0,
    ...actionableOptions.map((option) =>
      maximumPurchasePrice(
        resalePrice,
        costs,
        settings,
        option.id === "high_margin"
          ? Math.max(option.minNetProfitDollars, sourceMinNetProfit ?? 0)
          : option.minNetProfitDollars,
        option.id === "high_margin"
          ? Math.max(option.minRoiRatio, sourceMinRoi ?? 0)
          : option.minRoiRatio,
      ),
    ),
  );
}

function maximumPurchasePrice(
  resalePrice,
  costs,
  settings,
  minNetProfitDollars = settings.balancedMinNetProfitDollars,
  minRoiRatio = settings.balancedMinRoiRatio,
) {
  let low = 0;
  let high = Math.max(0, resalePrice);
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const candidate = (low + high) / 2;
    const ledger = buildCostLedger(candidate, resalePrice, costs, settings);
    const passes =
      ledger.expectedNetProfit !== null &&
      ledger.expectedNetProfit >= minNetProfitDollars &&
      ledger.roiRatio !== null &&
      ledger.roiRatio >= minRoiRatio;
    if (passes) low = candidate;
    else high = candidate;
  }
  const rounded = Math.floor(low * 100) / 100;
  const ledger = buildCostLedger(rounded, resalePrice, costs, settings);
  return ledger.expectedNetProfit !== null &&
    ledger.expectedNetProfit >= minNetProfitDollars &&
    ledger.roiRatio !== null &&
    ledger.roiRatio >= minRoiRatio
    ? rounded
    : 0;
}

function normalizedSettings(settingsOverrides = {}) {
  const settings = { ...defaultArbitrageSettings, ...settingsOverrides };
  if (
    !Object.prototype.hasOwnProperty.call(settingsOverrides, "balancedMinNetProfitDollars") &&
    Object.prototype.hasOwnProperty.call(settingsOverrides, "minNetProfitDollars")
  ) {
    settings.balancedMinNetProfitDollars = settings.minNetProfitDollars;
  }
  if (
    !Object.prototype.hasOwnProperty.call(settingsOverrides, "balancedMinRoiRatio") &&
    Object.prototype.hasOwnProperty.call(settingsOverrides, "minRoiRatio")
  ) {
    settings.balancedMinRoiRatio = settings.minRoiRatio;
  }
  settings.minNetProfitDollars = settings.balancedMinNetProfitDollars;
  settings.minRoiRatio = settings.balancedMinRoiRatio;
  return settings;
}

function expectedSoldCondition(condition) {
  if (/\b(?:new|sealed|factory sealed|brand new)\b/i.test(String(condition ?? ""))) return "new_sealed";
  if (/\b(?:used|vg|good|fair|poor|nm|near mint)\b/i.test(String(condition ?? ""))) return "used";
  return "unknown";
}

function weightedPercentile(entries, percentile) {
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

function confidenceScore(value) {
  const numeric = finiteNonNegative(value);
  if (numeric !== null) return Math.min(1, numeric);
  if (value === "high") return 1;
  if (value === "medium") return 0.65;
  if (value === "low") return 0.3;
  return 0;
}

function normalizeCurrency(value) {
  const currency = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function defaultCurrencyForCountry(value) {
  const country = String(value ?? "").trim().toUpperCase();
  if (["US", "USA", "UNITED STATES"].includes(country)) return "USD";
  if (["UK", "GB", "UNITED KINGDOM"].includes(country)) return "GBP";
  if (["CA", "CANADA"].includes(country)) return "CAD";
  if (["AU", "AUSTRALIA"].includes(country)) return "AUD";
  if (["JP", "JAPAN"].includes(country)) return "JPY";
  if (["EU", "EUROPEAN UNION"].includes(country)) return "EUR";
  return null;
}

function monthlyVelocity(units, months) {
  return units === null ? null : round(units / months, 2);
}

function amount(value, fallback) {
  return roundMoney(finiteNonNegative(value) ?? finiteNonNegative(fallback) ?? 0);
}

function rate(value, fallback) {
  return round(Math.min(1, finiteNonNegative(value) ?? finiteNonNegative(fallback) ?? 0), 6);
}

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finitePositive(value) {
  const parsed = finiteNonNegative(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function isStructuredEvidence(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function ageInDays(value, now) {
  const date = validDate(value);
  if (!date) return null;
  const elapsedMs = now.getTime() - date.getTime();
  if (elapsedMs < -MAX_FUTURE_CLOCK_SKEW_MS) return null;
  return Math.max(0, Math.floor(elapsedMs / 86_400_000));
}

function daysBetween(value, now) {
  const date = validDate(value);
  if (!date) return null;
  const elapsedMs = now.getTime() - date.getTime();
  if (elapsedMs < -MAX_FUTURE_CLOCK_SKEW_MS) return null;
  return Math.max(0, Math.floor(elapsedMs / 86_400_000));
}

function isoDate(value) {
  const date = validDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function isoTimestamp(value) {
  const date = validDate(value);
  return date ? date.toISOString() : null;
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function emptyGates() {
  return {
    activeEvidence: false,
    demand: false,
    economics: false,
    evidenceFreshness: false,
    matchConfidence: false,
    offerFreshness: false,
    purchaseOffer: false,
    soldEvidence: false,
    supply: false,
  };
}

function emptyPriorityBreakdown() {
  return {
    competitionAndSupply: 0,
    demandDurability: 0,
    economics: 0,
    evergreenPrior: 0,
    evidenceQuality: 0,
  };
}

function scale(value, minimum, maximum) {
  const numeric = finiteNonNegative(value);
  if (numeric === null || maximum <= minimum) return 0;
  return (numeric - minimum) / (maximum - minimum);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ratio(numerator, denominator, zeroFallback = null) {
  if (denominator <= 0) return zeroFallback;
  return round(numerator / denominator, 4);
}

function roundMoney(value) {
  return round(value, 2);
}

function round(value, places) {
  const multiplier = 10 ** places;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function money(value) {
  return `$${value.toFixed(2)}`;
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}
