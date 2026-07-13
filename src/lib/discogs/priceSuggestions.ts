import type { MoneyValue } from "../ebay/types";

export type DiscogsPriceSuggestion = MoneyValue & {
  condition: string;
};

export type DiscogsPriceSuggestionsResponse = Record<
  string,
  {
    currency?: string;
    value?: number | string;
  }
>;

const USED_CONDITION_PREFERENCE = [
  "Very Good (VG)",
  "Very Good Plus (VG+)",
  "Good Plus (G+)",
  "Near Mint (NM or M-)",
  "Good (G)",
  "Mint (M)",
  "Fair (F)",
  "Poor (P)",
];

export function selectUsedDiscogsPriceSuggestion(
  suggestions: DiscogsPriceSuggestionsResponse,
): DiscogsPriceSuggestion | undefined {
  for (const condition of USED_CONDITION_PREFERENCE) {
    const suggestion = suggestions[condition];
    if (!suggestion) continue;

    const value = typeof suggestion.value === "number" ? suggestion.value : Number.parseFloat(suggestion.value ?? "");
    if (!Number.isFinite(value) || value <= 0) continue;

    return {
      condition,
      currency: suggestion.currency?.trim() || "USD",
      value: Math.round(value * 100) / 100,
    };
  }

  return undefined;
}
