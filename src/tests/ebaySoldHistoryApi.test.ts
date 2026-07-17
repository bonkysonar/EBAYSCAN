import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEbayDateSlices,
  fetchEbayFinancialTransactions,
  fetchEbayOrders,
} from "../server/ebaySoldHistoryApi";
import { resetEbayUserAccessTokenCache } from "../server/ebayUserAuth.mjs";

describe("eBay sold-history API", () => {
  beforeEach(() => {
    resetEbayUserAccessTokenCache();
  });

  it("splits long pulls into bounded non-overlapping 90-day ranges", () => {
    const slices = buildEbayDateSlices("2026-01-01", "2026-07-16");

    expect(slices.length).toBe(3);
    for (const slice of slices) {
      expect(new Date(slice.to).getTime() - new Date(slice.from).getTime()).toBeLessThan(90 * 86_400_000);
    }
    expect(new Date(slices[1].from).getTime()).toBe(new Date(slices[0].to).getTime() + 1);
  });

  it("paginates Fulfillment orders and immediately drops buyer and address data", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.host).toBe("api.ebay.com");
      const offset = Number(url.searchParams.get("offset"));
      expect(url.searchParams.get("filter")).toMatch(/^creationdate:\[/);
      return new Response(
        JSON.stringify({
          total: 2,
          orders: [
            {
              buyer: { username: `private-buyer-${offset}` },
              fulfillmentStartInstructions: [{ shippingStep: { shipTo: { addressLine1: "private address" } } }],
              creationDate: `2026-07-${offset === 0 ? "01" : "02"}T12:00:00.000Z`,
              lineItems: [
                {
                  deliveryCost: { shippingCost: { currency: "USD", value: "5.00" } },
                  legacyItemId: `item-${offset}`,
                  lineItemCost: { currency: "USD", value: "20.00" },
                  lineItemId: `line-${offset}`,
                  quantity: 1,
                  refunds:
                    offset === 0
                      ? [{ amount: { currency: "USD", value: "4.00" }, refundDate: "2026-07-03T10:00:00.000Z" }]
                      : [],
                  sku: "Whole A1",
                  title: "Artist - Album Brand New Vinyl",
                },
              ],
              orderId: `order-${offset}`,
              orderPaymentStatus: "PAID",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });

    const orders = await fetchEbayOrders(
      { EBAY_USER_ACCESS_TOKEN: "test-token" },
      {
        fetchImpl: fetchMock as typeof fetch,
        from: "2026-07-01",
        pageSize: 1,
        to: "2026-07-02",
      },
    );

    expect(orders).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(orders[0]).toMatchObject({
      orderId: "order-0",
      paymentStatus: "PAID",
      lineItems: [
        {
          lineItemCost: 20,
          refunds: [{ amount: 4, date: "2026-07-03T10:00:00.000Z" }],
          shippingCost: 5,
          sku: "Whole A1",
        },
      ],
    });
    expect(JSON.stringify(orders)).not.toMatch(/buyer|username|address/i);
  });

  it("paginates Finances transactions while retaining only joinable, sanitized fields", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.host).toBe("apiz.ebay.com");
      const offset = Number(url.searchParams.get("offset"));
      expect(url.searchParams.getAll("filter")).toHaveLength(1);
      return new Response(
        JSON.stringify({
          total: 2,
          transactions: [
            {
              amount: { currency: "USD", value: offset === 0 ? "2.50" : "7.25" },
              bookingEntry: "DEBIT",
              buyer: { username: "private-buyer" },
              feeType: offset === 0 ? "AD_FEE" : undefined,
              orderId: offset === 0 ? "order-1" : undefined,
              references: offset === 0 ? [{ referenceId: "item-1", referenceType: "ITEM_ID" }] : [],
              transactionDate: `2026-07-${offset === 0 ? "01" : "02"}T12:00:00.000Z`,
              transactionId: `transaction-${offset}`,
              transactionMemo: offset === 0 ? "Promoted Listing fee with private free text" : "label details",
              transactionType: offset === 0 ? "NON_SALE_CHARGE" : "SHIPPING_LABEL",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });

    const transactions = await fetchEbayFinancialTransactions(
      { EBAY_USER_ACCESS_TOKEN: "test-token" },
      {
        fetchImpl: fetchMock as typeof fetch,
        from: "2026-07-01",
        pageSize: 1,
        to: "2026-07-02",
      },
    );

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      chargeCategory: "advertising",
      orderId: "order-1",
      references: [{ id: "item-1", type: "ITEM_ID" }],
      transactionType: "NON_SALE_CHARGE",
    });
    expect(transactions[1].chargeCategory).toBe("shipping_label");
    expect(JSON.stringify(transactions)).not.toMatch(/buyer|username|transactionMemo|private free text/i);
  });

  it("refreshes and retries once when a read-only API token is rejected", async () => {
    let tokenCount = 0;
    let apiCount = 0;
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/identity/v1/oauth2/token")) {
        tokenCount += 1;
        return new Response(JSON.stringify({ access_token: `token-${tokenCount}`, expires_in: 7200 }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      apiCount += 1;
      const authorization = (init?.headers as Record<string, string>).Authorization;
      if (apiCount === 1) {
        expect(authorization).toBe("Bearer token-1");
        return new Response(JSON.stringify({ errors: [{ message: "Invalid access token" }] }), { status: 401 });
      }
      expect(authorization).toBe("Bearer token-2");
      return new Response(null, { status: 204 });
    });

    const transactions = await fetchEbayFinancialTransactions(
      {
        EBAY_CLIENT_ID: "client-id",
        EBAY_CLIENT_SECRET: "client-secret",
        EBAY_USER_REFRESH_TOKEN: "refresh-token",
      },
      {
        fetchImpl: fetchMock as typeof fetch,
        from: "2026-07-01",
        to: "2026-07-02",
      },
    );

    expect(transactions).toEqual([]);
    expect(tokenCount).toBe(2);
    expect(apiCount).toBe(2);
  });

  it("refuses malformed HTTP 200 responses instead of treating them as empty history", async () => {
    const malformedFetch = vi.fn(async () => new Response("<html>temporary CDN page</html>", { status: 200 }));
    await expect(
      fetchEbayOrders(
        { EBAY_USER_ACCESS_TOKEN: "test-token" },
        {
          fetchImpl: malformedFetch as typeof fetch,
          from: "2026-07-01",
          to: "2026-07-02",
        },
      ),
    ).rejects.toThrow(/not valid JSON/i);

    const wrongShapeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ total: 12 }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    await expect(
      fetchEbayFinancialTransactions(
        { EBAY_USER_ACCESS_TOKEN: "test-token" },
        {
          fetchImpl: wrongShapeFetch as typeof fetch,
          from: "2026-07-01",
          to: "2026-07-02",
        },
      ),
    ).rejects.toThrow(/unexpected successful response shape/i);
  });

  it("retries bounded transient failures and stops after exhaustion", async () => {
    let attempts = 0;
    const recoveringFetch = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response(JSON.stringify({ errors: [{ message: "Temporary outage" }] }), {
          headers: { "Content-Type": "application/json", "Retry-After": "0" },
          status: 503,
        });
      }
      return new Response(JSON.stringify({ total: 0, transactions: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    await expect(
      fetchEbayFinancialTransactions(
        { EBAY_USER_ACCESS_TOKEN: "test-token" },
        {
          fetchImpl: recoveringFetch as typeof fetch,
          from: "2026-07-01",
          maxRetries: 2,
          retryBaseDelayMs: 0,
          to: "2026-07-02",
        },
      ),
    ).resolves.toEqual([]);
    expect(attempts).toBe(3);

    const failingFetch = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ message: "Still unavailable" }] }), {
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
        status: 503,
      }),
    );
    await expect(
      fetchEbayOrders(
        { EBAY_USER_ACCESS_TOKEN: "test-token" },
        {
          fetchImpl: failingFetch as typeof fetch,
          from: "2026-07-01",
          maxRetries: 1,
          retryBaseDelayMs: 0,
          to: "2026-07-02",
        },
      ),
    ).rejects.toThrow(/503/);
    expect(failingFetch).toHaveBeenCalledTimes(2);
  });
});
