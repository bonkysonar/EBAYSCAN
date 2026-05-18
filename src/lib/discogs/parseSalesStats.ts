import type { DiscogsSalesStats, MoneyValue } from "../ebay/types";

export function parseDiscogsSalesStats(input: string): DiscogsSalesStats | null {
  const text = normalizeText(input);
  const lastSold = matchValue(text, /last\s+sold\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i);
  const lowPrice = matchMoney(text, /low\s*:\s*(\$?\s*\d+(?:\.\d{1,2})?)/i);
  const medianPrice = matchMoney(text, /median\s*:\s*(\$?\s*\d+(?:\.\d{1,2})?)/i);
  const highPrice = matchMoney(text, /high\s*:\s*(\$?\s*\d+(?:\.\d{1,2})?)/i);

  if (!lastSold && !lowPrice && !medianPrice && !highPrice) {
    return null;
  }

  return {
    highPrice,
    importedAt: new Date().toISOString(),
    lastSold,
    lowPrice,
    medianPrice,
    source: "manual_import",
  };
}

function normalizeText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#36;/g, "$")
    .replace(/\s+/g, " ")
    .trim();
}

function matchValue(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1]?.trim();
}

function matchMoney(text: string, pattern: RegExp): MoneyValue | undefined {
  const raw = matchValue(text, pattern);
  if (!raw) return undefined;

  const value = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(value)) return undefined;

  return { currency: "USD", value: Math.round(value * 100) / 100 };
}
