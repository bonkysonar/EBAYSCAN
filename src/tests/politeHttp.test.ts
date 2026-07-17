import { describe, expect, it } from "vitest";
import { createPoliteFetcher } from "../../scripts/lib/politeHttp.mjs";

describe("polite HTTP scheduling", () => {
  it("retries retryable responses with bounded backoff", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const politeFetch = createPoliteFetcher({
      baseRetryDelayMs: 25,
      fetchImpl: async () => {
        attempts += 1;
        return { headers: new Headers(), status: attempts === 1 ? 503 : 200 };
      },
      maxRetries: 2,
      minHostDelayMs: 0,
      sleep: async (milliseconds: number) => {
        delays.push(milliseconds);
      },
    });

    const response = await politeFetch("https://shop.example/sale");
    expect(response.status).toBe(200);
    expect(attempts).toBe(2);
    expect(delays).toEqual([25]);
  });

  it("clamps extreme Retry-After and exponential backoff delays", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const politeFetch = createPoliteFetcher({
      baseRetryDelayMs: 1_000,
      fetchImpl: async () => {
        attempts += 1;
        return {
          headers: new Headers(attempts === 1 ? { "retry-after": "86400" } : {}),
          status: attempts <= 2 ? 503 : 200,
        };
      },
      maxRetries: 2,
      maxRetryDelayMs: 50,
      minHostDelayMs: 0,
      sleep: async (milliseconds: number) => {
        delays.push(milliseconds);
      },
    });

    const response = await politeFetch("https://shop.example/rate-limited");
    expect(response.status).toBe(200);
    expect(attempts).toBe(3);
    expect(delays).toEqual([50, 50]);
  });

  it("retries a timed-out attempt", async () => {
    let attempts = 0;
    const politeFetch = createPoliteFetcher({
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw new DOMException("timed out", "TimeoutError");
        return { headers: new Headers(), status: 200 };
      },
      maxRetries: 1,
      minHostDelayMs: 0,
      sleep: async () => undefined,
    });

    expect((await politeFetch("https://shop.example/slow")).status).toBe(200);
    expect(attempts).toBe(2);
  });

  it("never overlaps requests to the same host", async () => {
    let activeForHost = 0;
    let maxActiveForHost = 0;
    const politeFetch = createPoliteFetcher({
      fetchImpl: async () => {
        activeForHost += 1;
        maxActiveForHost = Math.max(maxActiveForHost, activeForHost);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeForHost -= 1;
        return { headers: new Headers(), status: 200 };
      },
      maxConcurrency: 3,
      maxPerHost: 1,
      maxRetries: 0,
      minHostDelayMs: 0,
    });

    await Promise.all([
      politeFetch("https://shop.example/a"),
      politeFetch("https://shop.example/b"),
      politeFetch("https://shop.example/c"),
    ]);
    expect(maxActiveForHost).toBe(1);
  });
});
