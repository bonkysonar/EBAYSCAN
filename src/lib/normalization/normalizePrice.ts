export function normalizePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

export function totalPrice(price: unknown, shippingPrice: unknown = 0): number | null {
  const normalizedPrice = normalizePrice(price);
  const normalizedShipping = normalizePrice(shippingPrice) ?? 0;
  return normalizedPrice === null ? null : normalizedPrice + normalizedShipping;
}
