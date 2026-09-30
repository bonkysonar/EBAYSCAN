import { describe, expect, it, vi } from "vitest";
import { publicationConfiguration, publicationPreflight, publicationRequest, RETAIL_UPLOAD_URL } from "../../scripts/lib/retailPublicationClient.mjs";

const env = { ARBITRAGE_UPLOAD_TOKEN: "test-runner-secret" };

describe("automatic retail publication", () => {
  it("uses the production destination and runner credential automatically", () => {
    expect(publicationConfiguration(env)).toEqual({ uploadUrl: RETAIL_UPLOAD_URL, token: env.ARBITRAGE_UPLOAD_TOKEN });
    expect(() => publicationConfiguration({})).toThrow("runner environment");
  });
  it.each([
    "https://other.example/api/arbitrage/upload", "http://ebayscan.vercel.app/api/arbitrage/upload",
    "https://ebayscan.vercel.app/other", "https://user:password@ebayscan.vercel.app/api/arbitrage/upload",
    `${RETAIL_UPLOAD_URL}?redirect=other`, `${RETAIL_UPLOAD_URL}#fragment`, "invalid",
  ])("rejects a changed destination before sending credentials: %s", async (url) => {
    const fetchImpl = vi.fn();
    await expect(publicationRequest("/api/arbitrage/upload", {
      method: "POST", body: { runId: "test-run" }, env: { ...env, ARBITRAGE_UPLOAD_URL: url }, fetchImpl,
    })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("checks authentication without writing or printing credentials or feedback", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ entries: [{ key: "private-feedback-key" }] })));
    const result = await publicationPreflight({ env, fetchImpl });
    expect(result).toEqual({ status: "ready", destination: RETAIL_UPLOAD_URL, authentication: "automatic", writesPerformed: false });
    expect(JSON.stringify(result)).not.toMatch(/test-runner-secret|private-feedback-key/);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://ebayscan.vercel.app/api/arbitrage/operations?action=feedback");
    expect(request).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: "Bearer test-runner-secret" } });
    expect(request).not.toHaveProperty("body");
  });
  it("does not count failed authentication or an unexpected payload as ready", async () => {
    await expect(publicationPreflight({ env, fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 401 })) })).rejects.toThrow("401");
    await expect(publicationPreflight({ env, fetchImpl: vi.fn().mockResolvedValue(new Response("{}")) })).rejects.toThrow("unexpected response");
  });
  it("posts the exact payload with redirects disabled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    const body = { runId: "scan-test", phase: "final", finds: [] };
    await publicationRequest("/api/arbitrage/upload", { env, fetchImpl, method: "POST", body });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify(body), redirect: "error" });
    await expect(publicationRequest("/unrelated", { env, fetchImpl })).rejects.toThrow("Unsupported");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
