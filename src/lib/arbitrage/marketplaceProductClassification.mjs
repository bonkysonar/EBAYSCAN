const NON_RECORD_MARKETPLACE_PRODUCT =
  /\b(?:decal|label\s+decal|non\s+adhesive\s+label|paper\s+label|platter\s+mat|record\s+bowl|drink\s+coasters?|coasters?\s+(?:set|pack)|replacement\s+(?:cover|jacket|sleeve)|slip\s*mat|turntable\s+(?:platter\s+)?mat|wall\s+(?:art|clock|decor)|(?:tote|canvas|shoulder|shopping)\s+bags?|earrings?|cufflinks?|keychains?|jewel(?:ry|lery)|phone\s+case)\b|\b(?:vinyl|record|lp).{0,40}\b(?:bowl|decal|floor\s+mat|label\s+decal|mouse\s+mat|paper\s+label|platter\s+mat|record\s+mat|turntable\s+(?:platter\s+)?mat|wall\s+(?:art|clock|decor))\b|\b(?:bowl|floor\s+mat|mouse\s+mat|wall\s+(?:art|clock|decor)).{0,40}\b(?:vinyl|record|lp)\b|\b(?:made|crafted|cut)\s+from\s+(?:an?\s+)?(?:recycled|upcycled)\s+(?:vinyl\s+)?records?\b/i;

export function isMarketplaceNonRecordTitle(value) {
  return NON_RECORD_MARKETPLACE_PRODUCT.test(normalizeMarketplaceProductText(value));
}

function normalizeMarketplaceProductText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
