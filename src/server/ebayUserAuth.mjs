import { Buffer } from "node:buffer";

let cachedUserAccessToken = null;
let pendingUserAccessToken = null;

export async function getEbayUserAccessToken(env, options = {}) {
  if (env.EBAY_USER_REFRESH_TOKEN) {
    if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
      throw new Error(
        "Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET. EBAY_USER_REFRESH_TOKEN requires server-side eBay OAuth credentials.",
      );
    }

    const now = Date.now();
    const cacheKey = `${env.EBAY_ENV ?? "production"}:${env.EBAY_CLIENT_ID}:${env.EBAY_USER_REFRESH_TOKEN}`;
    if (
      !options.forceRefresh &&
      cachedUserAccessToken &&
      cachedUserAccessToken.cacheKey === cacheKey &&
      cachedUserAccessToken.expiresAt > now + 60_000
    ) {
      return cachedUserAccessToken.token;
    }

    if (!options.forceRefresh && pendingUserAccessToken?.cacheKey === cacheKey) {
      return pendingUserAccessToken.promise;
    }

    const promise = refreshEbayUserAccessToken({
      clientId: env.EBAY_CLIENT_ID,
      clientSecret: env.EBAY_CLIENT_SECRET,
      ebayEnv: env.EBAY_ENV ?? "production",
      fetchImpl: options.fetchImpl,
      refreshToken: env.EBAY_USER_REFRESH_TOKEN,
    })
      .then((token) => {
        cachedUserAccessToken = { ...token, cacheKey };
        return token.token;
      })
      .finally(() => {
        if (pendingUserAccessToken?.promise === promise) pendingUserAccessToken = null;
      });
    pendingUserAccessToken = { cacheKey, promise };
    return promise;
  }

  if (env.EBAY_USER_ACCESS_TOKEN) {
    return env.EBAY_USER_ACCESS_TOKEN;
  }

  throw new Error(
    "Missing EBAY_USER_REFRESH_TOKEN or EBAY_USER_ACCESS_TOKEN. This read-only eBay operation needs seller user authorization.",
  );
}

export function resetEbayUserAccessTokenCache() {
  cachedUserAccessToken = null;
  pendingUserAccessToken = null;
}

export function isLikelyExpiredEbayUserTokenError(error) {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : null;
  const message = error instanceof Error ? error.message : String(error);
  return status === 401 || /access token|iaf token|token.*expired|token.*invalid|invalid.*token/i.test(message);
}

async function refreshEbayUserAccessToken(config) {
  const endpointRoot = config.ebayEnv === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await fetchImpl(`${endpointRoot}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
    }),
  });
  const payloadText = await response.text();
  const payload = parseJsonObject(payloadText);

  if (!response.ok || typeof payload.access_token !== "string" || typeof payload.expires_in !== "number") {
    throw new Error(
      `eBay user token refresh failed (${response.status}): ${
        typeof payload.error_description === "string" ? payload.error_description : response.statusText
      }`,
    );
  }

  return {
    token: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
