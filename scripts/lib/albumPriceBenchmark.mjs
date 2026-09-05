import { buildSoldResearchQueryVariants } from "../../src/lib/arbitrage/soldResearchLinks.mjs";
import { parseProductResearchRow } from "./productResearchCuration.mjs";

const DAY = 86_400_000;
const SCOPE = "provisional_album_across_pressings";
const PARENTHETICAL_GENRE = /\(\s*(?:rock|pop|jazz|blues|soul|funk|disco|reggae|punk|metal|folk|country|classical|electronic|hip[- ]hop|r\s*&\s*b)\s*\)/gi;
const NON_ALBUM = /\b(?:cds?|compact\s+discs?|cassettes?|dvds?|blu[- ]?ray|lots?|bundles?|poster|magazine|t[- ]?shirt|signed\s+photo|cover\s+only|sleeve\s+only|karaoke|tribute)\b/i;
const METADATA = new Set("a an the and by with on of for from in at new sealed brand factory shrink shrinkwrap vinyl lp lps record records album ed ltd lmtd edition limited deluxe anniversary remaster remastered rmst reissue repress pressing press original mono stereo analog analogue digital audiophile gram grams g gm rpm inch inches gatefold sleeve cover jacket obi import imported export uk us usa japan japanese germany german europe european eu holland netherlands france french canada canadian numbered num no bonus track tracks soundtrack ost explicit parental advisory blue red green yellow orange pink purple black white clear translucent transparent opaque colored coloured color colour splatter swirl smoke smoky marbled marble galaxy neon ghostly apple tangerine amber ruby coral cream bone grey gray silver gold golden brown teal navy aqua aquamarine turquoise violet lavender magenta burgundy burgandy tan sand beige platinum pearl crystal cloudy milky baby royal light dark sea coke bottle half halfspeed speed master mastered cut etched etching picture disc discs exclusive exclusivepress rsd bf recordstoreday store day blackfriday friday essential essentials classic series verve vault mofi mfsl mobile fidelity music matters tone poet productions acoustic sounds universal capitol columbia warner atlantic geffen reprise rhino def jam craft bluenote prestige riverside impulse decca emi sony mercury rca polydor epic recordlabel recordslabel vmp club subscription release re released anniversaryedition reissued mint unplayed unopened condition free shipping ship ships sealednew authentic genuine official promo promotional test hype sticker stickers w booklet insert inserts download mp3 voucher code made printed mastered direct metal mastering dmm lacquers lacquer recut recuts anniversaryremaster box boxset set best seller sale special editionexclusive collectible collectable rare audiophilequality anniversaryreissue vinylnew vinylrecord vinylexclusive".split(" "));

/** Observed album prices are a provisional comparison, never exact pressing or BUY evidence. */
export function createAlbumPriceBenchmarkIndex(captures = {}, now = Date.now()) {
  const pages = new Map();
  if (captures.captureMethod === "visible_browser") {
    for (const page of captures.pages ?? []) {
      const window = observedWindow(page.observedWindow);
      if (!window || !validCapture(page, window, now)) continue;
      const group = pages.get(key(page.query)) ?? [];
      group.push({ page, window });
      pages.set(key(page.query), group);
    }
  }
  return { match(candidate = {}) {
    if (candidate.identityStatus === "unresolved") return undefined;
    const query = buildSoldResearchQueryVariants(candidate)[0]?.query;
    if (!query) return undefined;
    const benchmarks = (pages.get(key(query)) ?? []).map(({ page, window }) => {
      const seen = new Set();
      const rows = [];
      for (const raw of page.rows) {
        const row = parseProductResearchRow(raw);
        row.title = row.title.replace(/^\s*,?\s*preview full size image\s*/i, "");
        const units = Number(String(raw.totalSold ?? raw.cells?.[4] ?? "").replaceAll(",", "").trim());
        const soldAt = Date.parse(row.dateLastSold ?? "");
        if (!Number.isInteger(units) || units <= 0 || !(row.avgSoldPrice > 0) ||
            !Number.isFinite(soldAt) || soldAt < Date.parse(window.startDate) || soldAt > Date.parse(window.endDate) ||
            !albumRowMatches(candidate, row.title)) continue;
        const itemId = row.itemUrl ? listingIdentity(row.itemUrl) : null;
        if (row.itemUrl && !itemId) continue;
        const fingerprint = itemId || JSON.stringify([key(row.title), row.avgSoldPrice, row.avgShipping, units, row.dateLastSold]);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        rows.push({ price: row.avgSoldPrice, units });
      }
      if (!rows.length) return undefined;
      const units = rows.reduce((sum, row) => sum + row.units, 0);
      const prices = rows.map((row) => row.price);
      return normalizeAlbumPriceBenchmark({
        version: 1, status: "observed", source: "ebay-product-research", scope: SCOPE,
        currency: "USD", lowPrice: Math.min(...prices), highPrice: Math.max(...prices),
        weightedMeanPrice: money(rows.reduce((sum, row) => sum + row.price * row.units, 0) / units),
        weightedMedianPrice: weightedMedian(rows, units), unitsSold1095Days: units, listingCount: rows.length,
        capturedAt: page.capturedAt, query: page.query, url: page.url, observedWindow: window,
        sampleComplete: (page.complete === true || page.completePagination === true) && page.complete !== false && page.completePagination !== false,
        unitCountBasis: "matched_captured_rows", priceBasis: "observed_listing_averages", shippingIncluded: false,
        volumeSupported: units > 10, sampleStatus: units > 10 ? "volume_supported" : "thin_sample",
      }, now);
    }).filter(Boolean).sort((a, b) => b.observedWindow.endDate.localeCompare(a.observedWindow.endDate) ||
      Number(b.sampleComplete) - Number(a.sampleComplete) || b.unitsSold1095Days - a.unitsSold1095Days ||
      Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    return benchmarks[0];
  } };
}

/** Runtime boundary for UI/import: derived support labels cannot be asserted by malformed fields. */
export function normalizeAlbumPriceBenchmark(value, now = Date.now()) {
  if (!value || value.version !== 1 || value.status !== "observed" || value.source !== "ebay-product-research" ||
      value.scope !== SCOPE || value.currency !== "USD" || value.shippingIncluded !== false ||
      value.priceBasis !== "observed_listing_averages" || value.unitCountBasis !== "matched_captured_rows") return undefined;
  const window = observedWindow(value.observedWindow);
  if (!window || !validResearchUrl(value.url, value.query) || !fresh(value.capturedAt, now) ||
      Date.parse(value.capturedAt) < Date.parse(window.endDate) || Date.parse(value.capturedAt) - Date.parse(window.endDate) > 2 * DAY) return undefined;
  const prices = [value.lowPrice, value.highPrice, value.weightedMeanPrice, value.weightedMedianPrice];
  if (!prices.every((price) => typeof price === "number" && Number.isFinite(price) && price > 0) ||
      value.lowPrice > value.highPrice || prices.slice(2).some((price) => price < value.lowPrice - .01 || price > value.highPrice + .01) ||
      !Number.isInteger(value.unitsSold1095Days) || value.unitsSold1095Days <= 0 ||
      !Number.isInteger(value.listingCount) || value.listingCount <= 0 || value.listingCount > value.unitsSold1095Days ||
      typeof value.sampleComplete !== "boolean") return undefined;
  return {
    version: 1, status: "observed", source: "ebay-product-research", scope: SCOPE, currency: "USD",
    lowPrice: money(value.lowPrice), highPrice: money(value.highPrice), weightedMeanPrice: money(value.weightedMeanPrice), weightedMedianPrice: money(value.weightedMedianPrice),
    unitsSold1095Days: value.unitsSold1095Days, listingCount: value.listingCount,
    capturedAt: value.capturedAt, query: value.query, url: value.url, observedWindow: window,
    sampleComplete: value.sampleComplete, unitCountBasis: "matched_captured_rows", priceBasis: "observed_listing_averages", shippingIncluded: false,
    volumeSupported: value.unitsSold1095Days > 10, sampleStatus: value.unitsSold1095Days > 10 ? "volume_supported" : "thin_sample",
  };
}

function validCapture(page, window, now) {
  return fresh(page.capturedAt, now) && page.condition === "New" && page.category === "Vinyl Records" &&
    !page.error && !["failed", "blocked", "unavailable"].includes(page.status) && Array.isArray(page.rows) &&
    page.rows.length <= 5000 && validResearchUrl(page.url, page.query) &&
    Date.parse(page.capturedAt) >= Date.parse(window.endDate) && Date.parse(page.capturedAt) - Date.parse(window.endDate) <= 2 * DAY;
}

function validResearchUrl(value, query) {
  try {
    const url = new URL(value);
    const params = url.searchParams;
    const period = Number(params.get("dayRange")) || (Number(params.get("endDate")) - Number(params.get("startDate"))) / DAY;
    return url.protocol === "https:" && url.hostname === "www.ebay.com" && !url.username && !url.password && !url.port &&
      url.pathname === "/sh/research" && params.get("categoryId") === "176985" && params.get("conditionId") === "1000" &&
      params.get("tabName") === "SOLD" && (!params.has("marketplace") || params.get("marketplace") === "EBAY-US") &&
      period === 1095 && typeof query === "string" && query.trim().length > 0 && key(params.get("keywords")) === key(query);
  } catch { return false; }
}

function observedWindow(value) {
  if (!value || typeof value !== "object") return null;
  const parts = String(value.text ?? value.label ?? "").split(/\s+[–—-]\s+/);
  const start = Date.parse(value.startDate ?? parts[0] ?? "");
  const end = Date.parse(value.endDate ?? parts[1] ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs((end - start) / DAY - 1095) > 1) return null;
  return { startDate: new Date(start).toISOString().slice(0, 10), endDate: new Date(end).toISOString().slice(0, 10) };
}

function albumRowMatches(candidate, title) {
  if (NON_ALBUM.test(title) || /\b(?:signed|autograph(?:ed)?|test\s+press(?:ing)?)\b/i.test(title)) return false;
  const artist = words(candidate.artist).filter((word, index) => !(index === 0 && word === "the"));
  const fullQuery = buildSoldResearchQueryVariants(candidate)[0]?.query;
  let albumQuery = words(fullQuery).slice(words(candidate.artist).length).join(" ");
  if (!albumQuery) albumQuery = candidate.title;
  let creditedEnsemble = "";
  const heading = String(candidate.title ?? "").match(/^(.+?)(?:\s+[-–—]\s+|:\s+)(.+)$/);
  if (heading && key(heading[1]).startsWith(`${artist.join(" ")} and `)) {
    creditedEnsemble = key(heading[1]).slice(artist.join(" ").length).replace(/^ and (?:the )?/, "");
    albumQuery = buildSoldResearchQueryVariants({ artist: "", title: heading[2] })[0]?.query;
  }
  const album = words(albumQuery).filter((word, index) => !(index === 0 && word === "the"));
  const withoutGenreLabels = words(title.replace(PARENTHETICAL_GENRE, " "));
  // Only discard standalone parenthetical labels when the album and artist survive.
  // A release actually named Jazz or Rock still needs those words as its identity.
  const row = phraseAt(withoutGenreLabels, album) >= 0 && artist.every((word) => withoutGenreLabels.includes(word))
    ? withoutGenreLabels : words(title);
  if (!artist.length || !album.length) return false;
  let artistAt = phraseAt(row, artist);
  let artistWords = artist;
  if (artistAt < 0 && artist.length === 2 && new RegExp(`\\b${escape(artist[1])}\\s*,\\s*${escape(artist[0])}\\b`, "i").test(keyAccents(title))) {
    artistWords = [...artist].reverse(); artistAt = phraseAt(row, artistWords);
  }
  if (artistAt < 0) return false;
  let remainder = [...row.slice(0, artistAt), ...row.slice(artistAt + artistWords.length)];
  if (creditedEnsemble) {
    const ensemble = words(creditedEnsemble);
    const ensembleAt = phraseAt(remainder, ensemble);
    if (ensembleAt >= 0) remainder = [...remainder.slice(0, ensembleAt), ...remainder.slice(ensembleAt + ensemble.length)];
  }
  const albumAt = phraseAt(remainder, album);
  if (albumAt < 0) {
    if (artist.join(" ") !== album.join(" ")) return false;
    const selfTitled = /\bself[- ]?titled\b|\bs\s*\/\s*t\b/i.test(title);
    return selfTitled || remainder.every((token) => /^(?:new|sealed|vinyl|lp|record|records|original|remaster(?:ed)?|reissue|mono|stereo|gram|grams|g|factory|brand|gatefold|\d+(?:g|gm|lp)?)$/.test(token));
  }
  const candidateSmallFormat = /\b(7|10)\s*(?:[- ]?inch|["”])/i.exec(`${candidate.title ?? ""} ${candidate.sourceListingTitle ?? ""} ${candidate.shopifyVariantTitle ?? ""}`)?.[1];
  const rowSmallFormat = /\b(7|10)\s*(?:[- ]?inch|["”])/i.exec(title)?.[1];
  if (rowSmallFormat && candidateSmallFormat !== rowSmallFormat) return false;
  const extra = [...remainder.slice(0, albumAt), ...remainder.slice(albumAt + album.length)]
    .join(" ").replace(/\b(?:blue note|mobile fidelity|analogue productions|music matters|tone poet|classic records|verve vault|record store day|black friday|half speed|bonus tracks?|cash money records?|young money entertainment)\b/g, " ");
  return extra.split(/\s+/).filter(Boolean).every((token) => METADATA.has(token) || (candidateSmallFormat && token === "single") || /^\d+(?:st|nd|rd|th|g|gm|gram|rpm|lp|x)?$/.test(token));
}

function phraseAt(words, phrase) { return words.findIndex((_, index) => phrase.every((word, offset) => words[index + offset] === word)); }
function words(value) { return key(value).split(" ").filter(Boolean); }
function keyAccents(value) { return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); }
function key(value) { return keyAccents(value).toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function fresh(value, now) { const age = Number(new Date(now)) - Date.parse(value); return Number.isFinite(age) && age >= -300000 && age <= 7 * DAY; }
function listingIdentity(value) { try { const u = new URL(value); return u.protocol === "https:" && ["www.ebay.com", "ebay.com"].includes(u.hostname) && !u.username && !u.password && !u.port ? u.pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{9,15})\/?$/)?.[1] ?? null : null; } catch { return null; } }
function money(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function weightedMedian(rows, units) {
  const sorted = [...rows].sort((a, b) => a.price - b.price); let count = 0;
  for (let index = 0; index < sorted.length; index += 1) { count += sorted[index].units; if (count > units / 2) return sorted[index].price; if (count === units / 2) return money((sorted[index].price + sorted[index + 1].price) / 2); }
  return sorted.at(-1).price;
}
