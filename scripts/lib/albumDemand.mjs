import { normalizeResearchTitle } from "../../src/lib/arbitrage/soldResearchLinks.mjs";

const DAY_MS = 86_400_000;
const NON_ALBUM =
  /\b(?:cds?|compact\s+discs?|cassette|dvd|blu[ -]?ray|lot|bundle|poster|magazine|t[ -]?shirt|signed\s+photo|record\s+cover\s+only|hardback|paperback|hardcover|softcover)\b/i;
const GRADE =
  /\b(?:NM|EX|VG\+?|G\+?|M|F|P)\s*\/\s*(?:NM|EX|VG\+?|G\+?|M|F|P)(?![A-Z])/i;
const METADATA_TAIL =
  /^(?:(?:19|20)\d{2}|\d+(?:st|nd|rd|th)|\d+g|\d+x|\d+lp|(?:black|blue|clear|gold|green|orange|pink|purple|red|silver|white|yellow|tan|translucent|transparent|opaque|colored|coloured|vinyl|lp|record|records|edition|ed|ltd|lmtd|limited|deluxe|super|anniversary|remastered|remaster|reissue|stereo|mono|gatefold|180|gram|grams|g|new|sealed|brand|factory|pressing|press|pitman|terreh[a-z]+|santa|maria|audiophile|half|speed|mastered|master|essential|essentials|series|rsd|collectable|collectible|explicit))$/;

/** Purchase history is a research prior only. It never supplies prices or exact-pressing velocity. */
export function createAlbumDemandIndex(index = {}, { now = Date.now() } = {}) {
  const referenceMs = Number(new Date(now));
  const byFirstWord = new Map();
  const seen = new Set();
  for (const comp of index.comps ?? []) {
    for (const record of comp.records ?? []) {
      const title = String(record.title ?? "");
      const saleMs = Date.parse(record.saleDate);
      const units = retainedUnits(record);
      if (
        !title ||
        NON_ALBUM.test(title) ||
        !Number.isFinite(saleMs) ||
        saleMs > referenceMs ||
        units <= 0
      )
        continue;
      // The CSV and API can contain the same sanitized observation. Conservative
      // deduplication is preferable to claiming repeat purchases from that overlap.
      const fingerprint = [
        key(title),
        record.saleDate,
        units,
        record.totalBuyerPaid,
      ].join("|");
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const normalized = recordIdentity(title);
      const words = normalized.split(" ");
      // Index the optional merchandising prefix as well as the real artist.
      // Retaining the original identity also supports an artist named LP.
      const firstWords = new Set([words[0], ...(/^(?:vinyl|lp) /.test(normalized) ? [words[1]] : [])]);
      for (const firstWord of firstWords) {
        const entries = byFirstWord.get(firstWord) ?? [];
        entries.push({ normalized, saleMs, saleDate: record.saleDate, units, comp });
        byFirstWord.set(firstWord, entries);
      }
    }
  }

  return {
    matchingComps(candidate = {}) {
      const artist = artistKey(candidate.artist);
      const album = albumKey(candidate.title, artist);
      if (!artist || !album) return [];
      const prefix = `${artist} ${album}`;
      return [...new Set((byFirstWord.get(artist.split(" ")[0]) ?? []).filter(({ normalized }) => matchesIdentity(normalized, prefix)).map(({ comp }) => comp))];
    },
    match(candidate = {}) {
      const artist = artistKey(candidate.artist);
      const album = albumKey(candidate.title, artist);
      if (!artist || !album || candidate.identityStatus === "unresolved")
        return undefined;
      // A 7-inch single may share its name with an LP. Album purchases do not
      // establish demand for that separate release format.
      if (
        /\b(?:7|10)\s*(?:[- ]?inch|["”])|\b(?:single|ep)\b/i.test(
          `${candidate.title ?? ""} ${candidate.sourceListingTitle ?? ""} ${candidate.recordFormat ?? ""}`,
        )
      )
        return undefined;
      const prefix = `${artist} ${album}`;
      const matches = (byFirstWord.get(artist.split(" ")[0]) ?? []).filter(
        ({ normalized }) => matchesIdentity(normalized, prefix),
      );
      if (!matches.length) return undefined;
      const unitsInDays = (days) =>
        matches.reduce(
          (sum, row) =>
            sum + (referenceMs - row.saleMs <= days * DAY_MS ? row.units : 0),
          0,
        );
      return {
        version: 1,
        status: "observed",
        source: "local-own-sales-history",
        scope: "album_across_conditions_and_editions",
        artistMatchConfirmed: true,
        albumMatchConfirmed: true,
        capturedAt: index.createdAt ?? null,
        latestSaleDate: matches
          .map((row) => row.saleDate)
          .sort()
          .at(-1),
        transactionCount: matches.length,
        unitsSold: matches.reduce((sum, row) => sum + row.units, 0),
        unitsSold90Days: unitsInDays(90),
        unitsSold365Days: unitsInDays(365),
      };
    },
  };
}

export function ownSaleMatchesAlbum(candidate = {}, record = {}) {
  const artist = artistKey(candidate.artist);
  const album = albumKey(candidate.title, artist);
  const title = String(record.title ?? "");
  if (!artist || !album || !title || NON_ALBUM.test(title)) return false;
  return matchesIdentity(recordIdentity(title), `${artist} ${album}`);
}

function matchesIdentity(normalized, prefix) {
  if (normalized !== prefix && !normalized.startsWith(`${prefix} `))
    normalized = normalized.replace(/^(?:vinyl|lp) /, "");
  if (normalized === prefix) return true;
  if (!normalized.startsWith(`${prefix} `)) return false;
  return normalized
    .slice(prefix.length)
    .trim()
    // This merchandising phrase is meaningful only after the complete album
    // identity. Do not allow its individual words to swallow a different title.
    .replace(/\brecord store day(?: black friday)?\b/g, "rsd")
    .split(" ")
    .every((token) => METADATA_TAIL.test(token));
}

/** Only trusted album purchases can move a lead out of capped exploration. */
export function researchDemand(candidate = {}) {
  const album = candidate.albumDemand;
  if (
    album?.version === 1 &&
    album.status === "observed" &&
    ["local-own-sales-history", "ebay-product-research"].includes(album.source) &&
    album.artistMatchConfirmed === true &&
    album.albumMatchConfirmed === true &&
    positive(album.unitsSold)
  ) {
    return {
      observed: true,
      source: album.source === "ebay-product-research" ? "marketplace_sold" : "album_own_sales",
      units: positive(album.unitsSold),
      recentUnits: positive(album.unitsSold90Days),
      latestSaleDate: album.latestSaleDate ?? null,
    };
  }
  const sold = candidate.soldEvidence;
  if (
    sold?.status === "validated" &&
    sold.source === "local-own-sales-history" &&
    sold.artistMatchConfirmed === true &&
    sold.albumMatchConfirmed === true &&
    sold.editionMatchConfirmed === true &&
    Number(sold.matchConfidence) >= 0.8
  ) {
    const units = Math.max(
      positive(sold.unitsSold90Days),
      positive(sold.unitsSold365Days),
      positive(candidate.totalSoldCount),
    );
    if (units)
      return {
        observed: true,
        source: "exact_own_sales",
        units,
        recentUnits: positive(sold.unitsSold90Days),
        latestSaleDate: sold.latestSaleDate ?? null,
      };
  }
  if (
    candidate.ebayResearchStatus === "validated" &&
    ["high", "medium"].includes(candidate.ebaySoldMatchConfidence) &&
    positive(candidate.totalSoldCount) &&
    Array.isArray(candidate.productResearchRows) &&
    candidate.productResearchRows.some(
      (row) => Number(row.matchScore) >= 0.68 && positive(row.totalSold),
    )
  ) {
    return {
      observed: true,
      source: "marketplace_sold",
      units: positive(candidate.totalSoldCount),
      recentUnits:
        sold?.status === "validated" ? positive(sold.unitsSold90Days) : 0,
      latestSaleDate: candidate.ebayResearchLatestSaleDate ?? null,
    };
  }
  return {
    observed: false,
    source: "unproven",
    units: 0,
    recentUnits: 0,
    latestSaleDate: null,
  };
}

function recordIdentity(value) {
  const withoutCondition = String(value)
    .split(GRADE)[0]
    .replace(
      /\b(?:brand\s+new(?:\s*\/\s*sealed)?|factory\s+sealed|new\s*\/\s*sealed)\b/gi,
      " ",
    )
    // Keep color marketing from becoming a spurious album extension when the
    // shared query normalizer subsequently removes the color/format suffix.
    // The modifier must introduce a named color immediately followed by vinyl
    // format; an unrelated title word such as "Ghostly" stays significant.
    .replace(/\bghostly(?=\s+(?:blue|white|clear)\s+(?:lp|vinyl)\b)/gi, " ")
    .replace(/\bultrasonic(?:ally)?\s+clean(?:ed)?\b.*$/i, " ");
  return artistKey(normalizeResearchTitle(withoutCondition));
}

function albumKey(value, artist) {
  const withoutSeries = String(value ?? "").replace(
    /\([^)]*\b(?:vinyl|edition|series|remaster(?:ed)?)\b[^)]*\)/gi,
    " ",
  );
  let album = key(normalizeResearchTitle(withoutSeries));
  if (album.startsWith(`${artist} `)) album = album.slice(artist.length + 1);
  return album;
}

function artistKey(value) {
  const normalized = key(value).replace(/^the\s+/, "");
  return /^(?:unknown artist|various(?: artists?)?)$/.test(normalized)
    ? ""
    : normalized;
}

function key(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function retainedUnits(record) {
  if (
    record.retainedQuantity !== null &&
    record.retainedQuantity !== undefined &&
    Number.isFinite(Number(record.retainedQuantity))
  )
    return Math.max(0, Math.floor(Number(record.retainedQuantity)));
  return Math.floor(positive(record.quantity));
}
