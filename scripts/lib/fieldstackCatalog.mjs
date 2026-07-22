export function parseFieldstackSearchConfig(html, pageUrl) {
  const source = String(html ?? "");
  const matches = [...source.matchAll(/searchFilterable\.init\(\{([\s\S]{0,5000}?)\}\)/gi)];
  const block = matches.at(-1)?.[1] ?? "";
  const searchId = stringField(block, "SearchId");
  if (!block || !searchId) return null;

  return {
    allowPageParam: booleanField(block, "AllowPageParm", true),
    allowQueryParam: booleanField(block, "AllowQParm", true),
    allowSortParam: booleanField(block, "AllowSortParm", true),
    baseUrl: normalizeHttpUrl(stringField(block, "BaseUrl"), pageUrl) ?? pageUrl,
    categoryId: stringField(block, "CategoryId"),
    pageNumber: positiveInteger(stringField(block, "PageNumber"), 1),
    searchId,
    searchQuery: stringField(block, "SearchQuery"),
    selectedSectionId: nonNegativeInteger(stringField(block, "SelectedSectionId"), 0),
    sortType: nonNegativeInteger(stringField(block, "SortType"), 0),
  };
}

export function fieldstackResultsUrl(pageUrl, config, pageNumber) {
  const url = new URL(`/gsrp/${pageNumber}`, pageUrl);
  if (config.allowQueryParam) url.searchParams.set("q", config.searchQuery ?? "");
  if (config.allowSortParam) url.searchParams.set("so", String(config.sortType ?? 0));
  if (config.allowPageParam) url.searchParams.set("page", String(pageNumber));
  if (Number(config.selectedSectionId) > 0) {
    url.searchParams.set("sid", String(config.selectedSectionId));
  }
  return url.toString();
}

export function parseFieldstackResultsPayload(value) {
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const data = payload?.data;
  if (!data || typeof data !== "object" || typeof data.data !== "string") return null;
  return {
    html: data.data,
    itemCountHtml: typeof data.itemcount === "string" ? data.itemcount : "",
    pageNumber: positiveInteger(data.pageNumber, 1),
    totalPages: positiveInteger(data.totalPages, 1),
  };
}

export function parseFieldstackResultTotal(value) {
  const text = String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(/\bof\s+([0-9][0-9,]*)\s+results?\b/i);
  if (!match) return null;
  const total = Number(match[1].replace(/,/g, ""));
  return Number.isInteger(total) && total >= 0 ? total : null;
}

function stringField(block, name) {
  const match = String(block ?? "").match(
    new RegExp(`${name}\\s*:\\s*(?:["']([^"']*)["']|([^,}\\s]+))`, "i"),
  );
  const value = (match?.[1] ?? match?.[2] ?? "").trim();
  return value && !/^(?:null|undefined)$/i.test(value) ? value : null;
}

function booleanField(block, name, fallback) {
  const value = stringField(block, name);
  if (value === null) return fallback;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  return fallback;
}

function normalizeHttpUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const parsed = new URL(value, baseUrl);
    return /^https?:$/.test(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}
