const normalized = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const itemId = value => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.ebay.com" || url.username || url.password || url.port) return null;
    return url.pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{12})\/?$/)?.[1] ?? null;
  } catch { return null; }
};

/** Missing edition details may come from the same observed item, never another listing. */
export function verifiedSoldItemIdentity(row, now = new Date()) {
  const proof = row.itemIdentityEvidence;
  if (!proof || proof.captureMethod !== "visible_browser") return null;
  const age = Number(now) - Date.parse(proof.capturedAt);
  const id = itemId(row.itemUrl);
  if (!id || itemId(proof.url) !== id || !(age >= -300000 && age <= 6 * 3600000)) return null;
  if (typeof proof.visibleText !== "string" || proof.visibleText.length > 20000 ||
      typeof proof.editionText !== "string" || !proof.editionText.trim() || proof.editionText.length > 1500 ||
      normalized(proof.listingTitle) !== normalized(row.title) ||
      !normalized(proof.visibleText).includes(normalized(proof.listingTitle)) ||
      !proof.visibleText.includes(proof.editionText) ||
      /verify you are human|access denied|captcha/i.test(proof.visibleText)) return null;
  return { url: proof.url, capturedAt: proof.capturedAt, editionText: proof.editionText };
}
