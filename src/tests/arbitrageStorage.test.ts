import { afterEach, describe, expect, it } from "vitest";
import { loadArbitrageSettings, saveArbitrageSettings } from "../lib/arbitrage/storage";

const key = "record-scanner-arbitrage-settings-v1";
afterEach(() => localStorage.clear());

describe("arbitrage cost settings migration", () => {
  it("adds the owner's two purchase floors to existing preferences and preserves subsequent edits", () => {
    localStorage.setItem(key, JSON.stringify({ combinedOrderRecords: 5 }));
    const settings=loadArbitrageSettings();
    expect(settings).toMatchObject({considerationMinNetProfitDollars:4,considerationMinRoiRatio:.3,combinedOrderRecords:5});
    saveArbitrageSettings({...settings,considerationMinNetProfitDollars:6,considerationMinRoiRatio:.4});
    expect(loadArbitrageSettings()).toMatchObject({considerationMinNetProfitDollars:6,considerationMinRoiRatio:.4});
  });
  it("replaces saved legacy defaults while preserving purchase assumptions", () => {
    localStorage.setItem(key, JSON.stringify({
      defaultMarketplaceFeeFixed: 0.3, defaultMarketplaceFeeRate: 0.15,
      defaultOutboundShipping: 6, defaultPromotedListingRate: 0.02,
      combinedOrderRecords: 8, combinedOrderShipping: 10,
    }));
    expect(loadArbitrageSettings()).toMatchObject({
      defaultMarketplaceFeeFixed: 0.4, defaultMarketplaceFeeRate: 0.127,
      defaultOutboundShipping: 4.39, defaultPromotedListingRate: 0.06,
      defaultBuyerSalesTaxRatePercent: 9.5,
      combinedOrderRecords: 8, combinedOrderShipping: 10,
    });
  });

  it("preserves customized costs and does not remigrate saved current settings", () => {
    localStorage.setItem(key, JSON.stringify({
      defaultMarketplaceFeeRate: 0.12, defaultOutboundShipping: 7,
      defaultPromotedListingRate: 0,
    }));
    const settings = loadArbitrageSettings();
    expect(settings).toMatchObject({ defaultMarketplaceFeeRate: 0.12,
      defaultOutboundShipping: 7, defaultPromotedListingRate: 0 });
    saveArbitrageSettings({ ...settings, defaultOutboundShipping: 6,
      defaultBuyerSalesTaxRatePercent: 0 });
    expect(loadArbitrageSettings()).toMatchObject({ defaultOutboundShipping: 6,
      defaultBuyerSalesTaxRatePercent: 0, defaultPromotedListingRate: 0 });
  });
});
