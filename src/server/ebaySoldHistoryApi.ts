import {
  getEbayUserAccessToken,
  isLikelyExpiredEbayUserTokenError,
  resetEbayUserAccessTokenCache,
  type EbayUserAuthEnv,
} from "./ebayUserAuth.mjs";

type Amount = {
  currency?: string;
  value?: string;
};

type RawOrderLineItem = {
  deliveryCost?: {
    shippingCost?: Amount;
  };
  discountedLineItemCost?: Amount;
  legacyItemId?: string;
  lineItemCost?: Amount;
  lineItemId?: string;
  quantity?: number;
  refunds?: Array<{
    amount?: Amount;
    refundDate?: string;
  }>;
  sku?: string;
  title?: string;
  total?: Amount;
};

type RawOrder = {
  cancelStatus?: { cancelState?: string };
  creationDate?: string;
  lastModifiedDate?: string;
  lineItems?: RawOrderLineItem[];
  orderFulfillmentStatus?: string;
  orderId?: string;
  orderPaymentStatus?: string;
};

type RawOrdersResponse = {
  __ebayNoContent?: boolean;
  href?: string;
  limit?: number;
  next?: string;
  offset?: number;
  orders?: RawOrder[];
  total?: number;
};

type RawFinancialFee = {
  amount?: Amount;
  feeType?: string;
};

type RawFinancialLineItem = {
  feeBasisAmount?: Amount;
  lineItemId?: string;
  marketplaceFees?: RawFinancialFee[];
};

type RawFinancialTransaction = {
  amount?: Amount;
  bookingEntry?: string;
  feeType?: string;
  orderId?: string;
  orderLineItems?: RawFinancialLineItem[];
  references?: Array<{
    referenceId?: string;
    referenceType?: string;
  }>;
  totalFeeAmount?: Amount;
  totalFeeBasisAmount?: Amount;
  transactionDate?: string;
  transactionId?: string;
  transactionMemo?: string;
  transactionStatus?: string;
  transactionType?: string;
};

type RawTransactionsResponse = {
  __ebayNoContent?: boolean;
  href?: string;
  limit?: number;
  next?: string;
  offset?: number;
  total?: number;
  transactions?: RawFinancialTransaction[];
};

export type EbaySoldHistoryEnv = EbayUserAuthEnv & {
  EBAY_MARKETPLACE_ID?: string;
};

export type EbayDateRangeOptions = {
  fetchImpl?: typeof fetch;
  from?: string | Date;
  lookbackDays?: number;
  maxPagesPerSlice?: number;
  maxRetries?: number;
  now?: Date;
  pageSize?: number;
  requestTimeoutMs?: number;
  retryBaseDelayMs?: number;
  sliceDays?: number;
  to?: string | Date;
};

export type EbaySoldOrderLineItem = {
  currency: string;
  discountedLineItemCost?: number;
  legacyItemId?: string;
  lineItemCost: number;
  lineItemId: string;
  quantity: number;
  refunds: Array<{
    amount: number;
    date?: string;
    status?: string;
  }>;
  shippingCost: number;
  sku?: string;
  title: string;
  total?: number;
};

export type EbaySoldOrder = {
  cancelState?: string;
  creationDate: string;
  fulfillmentStatus?: string;
  lastModifiedDate?: string;
  lineItems: EbaySoldOrderLineItem[];
  orderId: string;
  paymentStatus?: string;
};

export type EbayFinancialFee = {
  amount: number;
  currency: string;
  feeType: string;
};

export type EbayFinancialLineItem = {
  feeBasisAmount?: number;
  fees: EbayFinancialFee[];
  lineItemId?: string;
};

export type EbayFinancialReference = {
  id: string;
  type: string;
};

export type EbayFinancialTransaction = {
  amount: number;
  bookingEntry?: string;
  chargeCategory: "advertising" | "other" | "selling_fee" | "shipping_label";
  currency: string;
  feeType?: string;
  lineItems: EbayFinancialLineItem[];
  orderId?: string;
  references: EbayFinancialReference[];
  totalFeeAmount: number;
  totalFeeBasisAmount: number;
  transactionDate: string;
  transactionId: string;
  transactionStatus?: string;
  transactionType: string;
};

export type EbayDateSlice = {
  from: string;
  to: string;
};

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 730;
const DEFAULT_SLICE_DAYS = 90;
const ORDER_PAGE_SIZE = 200;
const FINANCE_PAGE_SIZE = 1000;
const TARGET_TRANSACTION_TYPES = new Set(["NON_SALE_CHARGE", "REFUND", "SALE", "SHIPPING_LABEL"]);

export async function fetchEbayOrders(
  env: EbaySoldHistoryEnv,
  options: EbayDateRangeOptions = {},
): Promise<EbaySoldOrder[]> {
  const range = normalizeDateRange(options);
  const slices = buildEbayDateSlices(range.from, range.to, options.sliceDays);
  const orders: EbaySoldOrder[] = [];
  const seen = new Set<string>();

  for (const slice of slices) {
    const pageSize = normalizePageSize(options.pageSize, ORDER_PAGE_SIZE, ORDER_PAGE_SIZE);
    let offset = 0;
    let pageCount = 0;

    while (true) {
      pageCount += 1;
      enforcePageLimit(pageCount, options.maxPagesPerSlice);
      const url = new URL(`${ebayApiRoot(env)}/sell/fulfillment/v1/order`);
      url.searchParams.set("filter", `creationdate:[${slice.from}..${slice.to}]`);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));
      const payload = await fetchEbayUserJson<RawOrdersResponse>(env, url, options);
      if (payload.__ebayNoContent) break;
      if (!Array.isArray(payload.orders)) {
        throw new Error("eBay Fulfillment returned an unexpected successful response shape; refusing a partial sold-history sync.");
      }
      const rawOrders = payload.orders;
      let droppedOrders = 0;

      for (const rawOrder of rawOrders) {
        const order = sanitizeEbayOrder(rawOrder);
        if (!order) {
          droppedOrders += 1;
          continue;
        }
        if (seen.has(order.orderId)) continue;
        seen.add(order.orderId);
        orders.push(order);
      }
      if (droppedOrders > 0) {
        throw new Error(
          `eBay Fulfillment returned ${droppedOrders} order rows that could not be sanitized; refusing a partial sold-history sync.`,
        );
      }

      if (!hasNextPage(payload, rawOrders.length, offset, pageSize)) break;
      offset += pageSize;
    }
  }

  return orders.sort((left, right) => left.creationDate.localeCompare(right.creationDate) || left.orderId.localeCompare(right.orderId));
}

export async function fetchEbayFinancialTransactions(
  env: EbaySoldHistoryEnv,
  options: EbayDateRangeOptions = {},
): Promise<EbayFinancialTransaction[]> {
  const range = normalizeDateRange(options);
  const slices = buildEbayDateSlices(range.from, range.to, options.sliceDays);
  const transactions: EbayFinancialTransaction[] = [];
  const seen = new Set<string>();

  for (const slice of slices) {
    const pageSize = normalizePageSize(options.pageSize, FINANCE_PAGE_SIZE, FINANCE_PAGE_SIZE);
    let offset = 0;
    let pageCount = 0;

    while (true) {
      pageCount += 1;
      enforcePageLimit(pageCount, options.maxPagesPerSlice);
      const url = new URL(`${ebayFinancesApiRoot(env)}/sell/finances/v1/transaction`);
      url.searchParams.append("filter", `transactionDate:[${slice.from}..${slice.to}]`);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));
      const payload = await fetchEbayUserJson<RawTransactionsResponse>(env, url, options);
      if (payload.__ebayNoContent) break;
      if (!Array.isArray(payload.transactions)) {
        throw new Error("eBay Finances returned an unexpected successful response shape; refusing a partial sold-history sync.");
      }
      const rawTransactions = payload.transactions;
      let droppedTransactions = 0;

      for (const rawTransaction of rawTransactions) {
        const rawType = cleanEnum(rawTransaction.transactionType);
        const transaction = sanitizeEbayFinancialTransaction(rawTransaction);
        if (rawType && TARGET_TRANSACTION_TYPES.has(rawType) && !transaction) {
          droppedTransactions += 1;
          continue;
        }
        if (
          !transaction ||
          !TARGET_TRANSACTION_TYPES.has(transaction.transactionType) ||
          seen.has(`${transaction.transactionType}:${transaction.transactionId}`)
        ) {
          continue;
        }
        seen.add(`${transaction.transactionType}:${transaction.transactionId}`);
        transactions.push(transaction);
      }
      if (droppedTransactions > 0) {
        throw new Error(
          `eBay Finances returned ${droppedTransactions} target transaction rows that could not be sanitized; refusing a partial sold-history sync.`,
        );
      }

      if (!hasNextPage(payload, rawTransactions.length, offset, pageSize)) break;
      offset += pageSize;
    }
  }

  return transactions.sort(
    (left, right) =>
      left.transactionDate.localeCompare(right.transactionDate) ||
      left.transactionType.localeCompare(right.transactionType) ||
      left.transactionId.localeCompare(right.transactionId),
  );
}

export function buildEbayDateSlices(
  fromValue: string | Date,
  toValue: string | Date,
  requestedSliceDays = DEFAULT_SLICE_DAYS,
): EbayDateSlice[] {
  const from = parseDateBoundary(fromValue, "from");
  const to = parseDateBoundary(toValue, "to");
  if (from.getTime() > to.getTime()) throw new Error("eBay sold-history range start must be before its end.");

  const sliceDays = Math.min(DEFAULT_SLICE_DAYS, Math.max(1, Math.floor(requestedSliceDays)));
  const sliceDuration = sliceDays * DAY_MS;
  const slices: EbayDateSlice[] = [];
  let cursor = from.getTime();

  while (cursor <= to.getTime()) {
    const sliceEnd = Math.min(to.getTime(), cursor + sliceDuration - 1);
    slices.push({
      from: new Date(cursor).toISOString(),
      to: new Date(sliceEnd).toISOString(),
    });
    cursor = sliceEnd + 1;
  }

  return slices;
}

export function sanitizeEbayOrder(rawOrder: RawOrder): EbaySoldOrder | null {
  const orderId = cleanIdentifier(rawOrder.orderId);
  const creationDate = cleanIsoDate(rawOrder.creationDate);
  if (!orderId || !creationDate) return null;

  const lineItems = (rawOrder.lineItems ?? [])
    .map(sanitizeEbayOrderLineItem)
    .filter((lineItem): lineItem is EbaySoldOrderLineItem => Boolean(lineItem));
  if (lineItems.length === 0) return null;

  return {
    cancelState: cleanEnum(rawOrder.cancelStatus?.cancelState),
    creationDate,
    fulfillmentStatus: cleanEnum(rawOrder.orderFulfillmentStatus),
    lastModifiedDate: cleanIsoDate(rawOrder.lastModifiedDate),
    lineItems,
    orderId,
    paymentStatus: cleanEnum(rawOrder.orderPaymentStatus),
  };
}

export function sanitizeEbayFinancialTransaction(
  rawTransaction: RawFinancialTransaction,
): EbayFinancialTransaction | null {
  const transactionType = cleanEnum(rawTransaction.transactionType);
  const transactionDate = cleanIsoDate(rawTransaction.transactionDate);
  const transactionId = cleanIdentifier(rawTransaction.transactionId);
  const amount = moneyValue(rawTransaction.amount);
  if (!transactionType || !transactionDate || !transactionId || amount === null) return null;

  const feeType = cleanEnum(rawTransaction.feeType);
  const memo = typeof rawTransaction.transactionMemo === "string" ? rawTransaction.transactionMemo : "";
  return {
    amount,
    bookingEntry: cleanEnum(rawTransaction.bookingEntry),
    chargeCategory: classifyCharge(transactionType, feeType, memo),
    currency: moneyCurrency(rawTransaction.amount),
    feeType,
    lineItems: (rawTransaction.orderLineItems ?? []).map((lineItem) => ({
      feeBasisAmount: moneyValue(lineItem.feeBasisAmount) ?? undefined,
      fees: (lineItem.marketplaceFees ?? [])
        .map((fee) => {
          const feeAmount = moneyValue(fee.amount);
          const normalizedFeeType = cleanEnum(fee.feeType);
          if (feeAmount === null || !normalizedFeeType) return null;
          return {
            amount: feeAmount,
            currency: moneyCurrency(fee.amount),
            feeType: normalizedFeeType,
          };
        })
        .filter((fee): fee is EbayFinancialFee => Boolean(fee)),
      lineItemId: cleanIdentifier(lineItem.lineItemId),
    })),
    orderId: cleanIdentifier(rawTransaction.orderId),
    references: (rawTransaction.references ?? [])
      .map((reference) => {
        const id = cleanIdentifier(reference.referenceId);
        const type = cleanEnum(reference.referenceType);
        return id && type ? { id, type } : null;
      })
      .filter((reference): reference is EbayFinancialReference => Boolean(reference)),
    totalFeeAmount: moneyValue(rawTransaction.totalFeeAmount) ?? 0,
    totalFeeBasisAmount: moneyValue(rawTransaction.totalFeeBasisAmount) ?? 0,
    transactionDate,
    transactionId,
    transactionStatus: cleanEnum(rawTransaction.transactionStatus),
    transactionType,
  };
}

function sanitizeEbayOrderLineItem(rawLineItem: RawOrderLineItem): EbaySoldOrderLineItem | null {
  const lineItemId = cleanIdentifier(rawLineItem.lineItemId);
  const title = cleanTitle(rawLineItem.title);
  const lineItemCost = moneyValue(rawLineItem.discountedLineItemCost ?? rawLineItem.lineItemCost);
  if (!lineItemId || !title || lineItemCost === null) return null;

  return {
    currency: moneyCurrency(rawLineItem.discountedLineItemCost ?? rawLineItem.lineItemCost),
    discountedLineItemCost: moneyValue(rawLineItem.discountedLineItemCost) ?? undefined,
    legacyItemId: cleanIdentifier(rawLineItem.legacyItemId),
    lineItemCost,
    lineItemId,
    quantity: Math.max(1, Math.floor(Number(rawLineItem.quantity) || 1)),
    refunds: (rawLineItem.refunds ?? []).flatMap((refund) => {
        const amount = moneyValue(refund.amount);
        if (amount === null) return [];
        const date = cleanIsoDate(refund.refundDate);
        return [
          {
            amount,
            ...(date ? { date } : {}),
          },
        ];
      }),
    shippingCost: moneyValue(rawLineItem.deliveryCost?.shippingCost) ?? 0,
    sku: cleanOperationalText(rawLineItem.sku),
    title,
    total: moneyValue(rawLineItem.total) ?? undefined,
  };
}

function normalizeDateRange(options: EbayDateRangeOptions): { from: Date; to: Date } {
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("Invalid current date for eBay sold-history synchronization.");
  const to = options.to ? parseDateBoundary(options.to, "to") : now;
  const lookbackDays = Math.min(DEFAULT_LOOKBACK_DAYS, Math.max(1, Math.floor(options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS)));
  const from = options.from
    ? parseDateBoundary(options.from, "from")
    : new Date(to.getTime() - Math.max(0, lookbackDays - 1) * DAY_MS);

  if (from.getTime() > to.getTime()) throw new Error("eBay sold-history range start must be before its end.");
  if (to.getTime() - from.getTime() > DEFAULT_LOOKBACK_DAYS * DAY_MS) {
    throw new Error(`eBay Fulfillment history is bounded to ${DEFAULT_LOOKBACK_DAYS} days per synchronization.`);
  }

  return { from, to };
}

function parseDateBoundary(value: string | Date, boundary: "from" | "to"): Date {
  if (value instanceof Date) {
    const copy = new Date(value);
    if (Number.isNaN(copy.getTime())) throw new Error(`Invalid eBay ${boundary} date.`);
    return copy;
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${boundary === "from" ? "00:00:00.000" : "23:59:59.999"}Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid eBay ${boundary} date: ${value}`);
  return date;
}

async function fetchEbayUserJson<T>(
  env: EbaySoldHistoryEnv,
  url: URL,
  options: Pick<EbayDateRangeOptions, "fetchImpl" | "maxRetries" | "requestTimeoutMs" | "retryBaseDelayMs">,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = normalizeNonNegativeInteger(options.maxRetries, 3);
  const requestTimeoutMs = normalizePositiveInteger(options.requestTimeoutMs, 30_000);
  const retryBaseDelayMs = normalizeNonNegativeInteger(options.retryBaseDelayMs, 500);
  const request = async (forceRefresh = false) => {
    const accessToken = await getEbayUserAccessToken(env, { fetchImpl, forceRefresh });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": env.EBAY_MARKETPLACE_ID ?? "EBAY_US",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 204) return { __ebayNoContent: true } as T;
    const text = await response.text();
    const payload = parseJsonObject(text);
    if (!response.ok) {
      throw new EbayApiRequestError(
        response.status,
        `eBay read-only API request failed (${response.status}): ${safeEbayErrorMessage(payload ?? {}, response.statusText)}`,
        parseRetryAfterMs(response.headers.get("Retry-After")),
      );
    }
    if (!payload) {
      throw new Error("eBay returned a successful response that was not valid JSON; refusing a partial sold-history sync.");
    }
    return payload as T;
  };

  let forceRefreshNextRequest = false;
  let tokenRefreshAttempted = false;
  let retryCount = 0;
  while (true) {
    try {
      const forceRefresh = forceRefreshNextRequest;
      forceRefreshNextRequest = false;
      return await request(forceRefresh);
    } catch (error) {
      if (!tokenRefreshAttempted && env.EBAY_USER_REFRESH_TOKEN && isLikelyExpiredEbayUserTokenError(error)) {
        resetEbayUserAccessTokenCache();
        forceRefreshNextRequest = true;
        tokenRefreshAttempted = true;
        continue;
      }
      if (!isRetryableRequestError(error) || retryCount >= maxRetries) throw error;
      const retryAfterMs = error instanceof EbayApiRequestError ? error.retryAfterMs : null;
      const delayMs = retryAfterMs ?? Math.min(10_000, retryBaseDelayMs * 2 ** retryCount);
      retryCount += 1;
      if (delayMs > 0) await delay(delayMs);
    }
  }
}

class EbayApiRequestError extends Error {
  retryAfterMs: number | null;
  status: number;

  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "EbayApiRequestError";
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

function hasNextPage(
  payload: { next?: string; total?: number },
  returnedCount: number,
  offset: number,
  pageSize: number,
): boolean {
  if (payload.next) return true;
  if (typeof payload.total === "number") return offset + returnedCount < payload.total;
  return returnedCount >= pageSize;
}

function enforcePageLimit(pageCount: number, configuredLimit: number | undefined) {
  const limit = configuredLimit && Number.isFinite(configuredLimit) ? Math.max(1, Math.floor(configuredLimit)) : 500;
  if (pageCount > limit) {
    throw new Error(`Stopped eBay sold-history pagination after ${limit} pages in one date slice.`);
  }
}

function normalizePageSize(value: number | undefined, fallback: number, maximum: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function isRetryableRequestError(error: unknown): boolean {
  if (error instanceof EbayApiRequestError) {
    return error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, Math.round(seconds * 1000));
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.min(30_000, Math.max(0, date.getTime() - Date.now()));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function classifyCharge(
  transactionType: string,
  feeType: string | undefined,
  transactionMemo: string,
): EbayFinancialTransaction["chargeCategory"] {
  if (transactionType === "SHIPPING_LABEL") return "shipping_label";
  const signal = `${feeType ?? ""} ${transactionMemo}`.toUpperCase();
  if (/\bAD[_ ]FEE\b|PROMOTED|ADVERTIS/.test(signal)) return "advertising";
  if (
    /FINAL_VALUE|FIXED_PER_ORDER|INTERNATIONAL_FEE|REGULATORY_OPERATING|INSERTION_FEE|BELOW_STANDARD|HIGH_ITEM_NOT_AS_DESCRIBED/.test(
      signal,
    )
  ) {
    return "selling_fee";
  }
  return "other";
}

function moneyValue(amount: Amount | undefined): number | null {
  if (!amount || typeof amount.value !== "string") return null;
  const parsed = Number(amount.value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function moneyCurrency(amount: Amount | undefined): string {
  const value = cleanEnum(amount?.currency);
  return value ?? "USD";
}

function cleanIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function cleanIdentifier(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 200) return undefined;
  return cleaned;
}

function cleanEnum(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().toUpperCase();
  return /^[A-Z0-9_ -]{1,100}$/.test(cleaned) ? cleaned : undefined;
}

function cleanTitle(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}

function cleanOperationalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\r\n\t]/g, " ").trim();
  return cleaned ? cleaned.slice(0, 200) : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function safeEbayErrorMessage(payload: Record<string, unknown>, fallback: string): string {
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const first = errors[0];
  if (typeof first === "object" && first !== null) {
    const message = "message" in first && typeof first.message === "string" ? first.message : undefined;
    const errorId = "errorId" in first ? String(first.errorId) : undefined;
    if (message) return `${errorId ? `${errorId}: ` : ""}${message.slice(0, 300)}`;
  }
  return fallback || "Unknown eBay API error";
}

function ebayApiRoot(env: EbaySoldHistoryEnv): string {
  return env.EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

function ebayFinancesApiRoot(env: EbaySoldHistoryEnv): string {
  return env.EBAY_ENV === "sandbox" ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com";
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
