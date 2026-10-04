export const RETAIL_PUBLICATION_ORIGIN = "https://ebayscan.vercel.app";
export const RETAIL_UPLOAD_URL = `${RETAIL_PUBLICATION_ORIGIN}/api/arbitrage/upload`;

export function publicationConfiguration(env = process.env) {
  const configured = env.ARBITRAGE_UPLOAD_URL || RETAIL_UPLOAD_URL;
  let url;
  try { url = new URL(configured); } catch {
    throw new Error("Retail publication destination is invalid.");
  }
  if (url.origin !== RETAIL_PUBLICATION_ORIGIN || url.pathname !== "/api/arbitrage/upload" ||
      url.username || url.password || url.search || url.hash) {
    throw new Error(`Retail publication is restricted to ${RETAIL_UPLOAD_URL}.`);
  }
  const token = env.ARBITRAGE_UPLOAD_TOKEN?.trim();
  if (!token) throw new Error("Automatic retail publication credentials are missing from the runner environment.");
  return { uploadUrl: RETAIL_UPLOAD_URL, token };
}

export async function publicationRequest(path, { method = "GET", body, env = process.env, fetchImpl = fetch } = {}) {
  const config = publicationConfiguration(env);
  if (!["/api/arbitrage/upload", "/api/arbitrage/operations", "/api/arbitrage/operations?action=feedback"].includes(path)) {
    throw new Error("Unsupported retail publication endpoint.");
  }
  const response = await fetchImpl(new URL(path, RETAIL_PUBLICATION_ORIGIN), {
    method,
    headers: { Authorization: `Bearer ${config.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    // Only expose the API's bounded error message, never an HTML response or a
    // complete payload. Redact the credential even if an upstream error echoes it.
    let detail = "";
    try {
      const payload = await response.json();
      if (typeof payload?.error === "string") {
        detail = payload.error.replaceAll(config.token, "[redacted]").replace(/[\r\n\t]+/g, " ").slice(0, 1000);
      }
    } catch { /* The HTTP status remains useful for non-JSON failures. */ }
    throw new Error(`Retail publication request failed: HTTP ${response.status}.${detail ? " " + detail : ""}`);
  }
  return response;
}

export async function publicationPreflight(options = {}) {
  // An authenticated read verifies the same scanner credential without changing publication.
  const response = await publicationRequest("/api/arbitrage/operations?action=feedback", options);
  const payload = await response.json();
  if (!Array.isArray(payload.entries)) throw new Error("Retail publication preflight received an unexpected response.");
  return { status: "ready", destination: RETAIL_UPLOAD_URL, authentication: "automatic", writesPerformed: false };
}
