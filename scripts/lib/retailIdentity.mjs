import {
  decodeHtmlEntities,
  inferRetailArtist,
  inferRetailTitle,
} from "./retailListingParsing.mjs";

const clean = (value) =>
  decodeHtmlEntities(String(value ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const damaged =
  /\b(?:damaged|dented|b-stock|defective|warped|jacket\s+damage|sleeve\s+damage|scratch\s+and\s+dent|shopworn|open[ -]box)\b/i;
const digital =
  /\b(?:digital(?:[ -]album|[ -]download)?|download|mp3|flac|wav)\b/i;
const accessory =
  /\b(?:funko|figurines?|vinyl\s+figures?|pop!|record\s+bowl|coasters?|slipmats?)\b/i;
const vinyl = /\b(?:(?:\d[ x-]?)?lp|vinyl|12[ -]inch)\b/i;
const vinylFormat =
  /\b(?:vinyl\b|(?:[1-9]\s*[x-]?\s*)?lps?\b|phonograph\s+record\b|record\s+album\b|(?:7|10|12)\s*(?:[ -]?inch\b|in\.?\b|["”]))/i;
const nonVinylFormat =
  /\b(?:(?:\d+\s*x?\s*)?cds?|compact\s+discs?|cassettes?|(?:audio\s+)?tapes?|dvds?|blu[ -]?ray|sacd|mini[ -]?disc)\b/i;
// “Tapes” also names albums (The Basement Tapes, The Tiberi Tapes). A
// product title needs an explicit tape-format cue; selected SKU metadata does not.
const nonVinylTitleFormat =
  /\b(?:(?:\d+\s*x?\s*)?cds?|compact\s+discs?|cassettes?|audio\s+tapes?|\d+\s+tapes|tape|dvds?|blu[ -]?ray|sacd|mini[ -]?disc)\b/i;
const variantOnly =
  /^(?:(?:baby|royal|cloudy|opaque|transparent|translucent|milky|neon|hot|light|dark|limited|exclusive|standard|180g|180|gram|vinyl|lp|2lp|3lp|black|white|red|blue|pink|purple|orange|yellow|green|gold|silver|bone|clear|beer|tan|tangerine|amber|ruby|coral|navy|teal|grey|gray|sea|coke|bottle|inch|in|marble|marbled|galaxy|splatter|swirl|smoke|in|with|w|and|edition|pressing|colour|color|colored|coloured|\d+)|[\s/&()+.\-"”])+$/i;
const storeVendor =
  /\b(?:records?|recordings|official|shop|store|merchnow|music|distribution|entertainment)\b/i;

export function retailEligibility(find = {}) {
  const title = clean(
    find.sourceListingTitle ?? find.listingTitle ?? find.title,
  );
  const variant = clean(find.shopifyVariantTitle ?? find.variantTitle);
  const text = `${title} ${variant}`;
  // A selected SKU's format takes precedence over a mixed-format parent page.
  // Explicit non-vinyl variants cannot borrow "vinyl" from tags or title copy.
  const format = retailRecordFormat(find);
  if (format === "non_vinyl")
    return { eligible: false, reason: "non_vinyl_format" };
  if (find.physicalFormatConfirmed === false)
    return { eligible: false, reason: "physical_record_format_unconfirmed" };
  if (accessory.test(text))
    return { eligible: false, reason: "record_accessory" };
  if (damaged.test(text)) return { eligible: false, reason: "damaged_stock" };
  if (
    digital.test(variant) ||
    (digital.test(title) &&
      !vinyl.test(variant) &&
      !/vinyl\s*\+\s*(?:mp3|download)/i.test(title))
  )
    return { eligible: false, reason: "digital_product" };
  if (
    find.available === false ||
    find.quantityAvailable === 0 ||
    /\b(?:sold[ -]?out|out[ -]of[ -]stock|discontinued)\b/i.test(
      find.stockStatus ?? "",
    )
  )
    return { eligible: false, reason: "unavailable" };
  if (/\bpre[ -]?order\b/i.test(text) || find.preorder === true)
    return { eligible: false, reason: "preorder" };
  return { eligible: true, reason: null };
}

export function retailRecordFormat(find = {}) {
  const variant = clean(find.shopifyVariantTitle ?? find.variantTitle);
  if (nonVinylFormat.test(variant)) return "non_vinyl";
  if (vinylFormat.test(variant)) return "vinyl";
  const structured = clean(find.recordFormat);
  if (structured === "non_vinyl" || nonVinylFormat.test(structured))
    return "non_vinyl";
  const title = clean(
    find.sourceListingTitle ?? find.listingTitle ?? find.title,
  );
  if (nonVinylTitleFormat.test(title)) return "non_vinyl";
  if (vinylFormat.test(`${title} ${structured}`)) return "vinyl";
  return "unknown";
}

export function shopifyIdentity(product, variant = {}, source = {}) {
  const rawTitle = clean(product.title);
  const tags = Array.isArray(product.tags)
    ? product.tags
    : String(product.tags ?? "").split(",");
  const taggedArtist = tags
    .map(clean)
    .find((tag) => /^(?:artist|band)\s*[:=]/i.test(tag))
    ?.replace(/^[^:=]+[:=]\s*/, "");
  const vendor = clean(product.vendor);
  const sourceId = source.sourceId ?? source.id;
  // This distributor's vendor is the issuing label (for example Enjoy the
  // Ride), while the artist may appear only in unstructured tags. Do not guess
  // which unlabelled tag is the artist.
  const vendorIsLabel =
    source.vendorIsLabel === true || sourceId === "light-in-the-attic";
  const retailerVendor = retailerArtistConflict(
    vendor,
    source.name ?? source.displayName ?? source.sourceName ?? source.id,
  );
  const knownArtist =
    taggedArtist ||
    (vendor &&
    !vendorIsLabel &&
    !retailerVendor &&
    !storeVendor.test(vendor) &&
    vendor !== "Default Title"
      ? vendor
      : null);
  const parts = rawTitle.split(/\s+[-–—]\s+/);
  const endsInVariant = parts.length > 1 && isVariantDescription(parts.at(-1));
  let artist = inferRetailArtist(rawTitle);
  let title = inferRetailTitle(rawTitle);
  // For split releases the vendor often names only one of the two artists.
  // The explicit shared artist heading is stronger than that partial vendor.
  const splitArtist =
    parts.length > 1 &&
    /\s\/\s/.test(parts[0]) &&
    (!knownArtist ||
      parts[0]
        .split(/\s\/\s/)
        .some((part) => part.toLowerCase() === knownArtist.toLowerCase()));
  if (
    !splitArtist &&
    knownArtist &&
    (taggedArtist ||
      !title ||
      variantOnly.test(title) ||
      vinylFormat.test(artist) ||
      (endsInVariant && parts.length === 2) ||
      artist === "Unknown Artist" ||
      rawTitle.toLowerCase().startsWith(knownArtist.toLowerCase()))
  ) {
    artist = knownArtist;
    const withoutArtist = rawTitle
      .toLowerCase()
      .startsWith(`${knownArtist.toLowerCase()} - `)
      ? rawTitle.slice(knownArtist.length + 3)
      : rawTitle;
    title =
      clean(
        withoutArtist
          .split(/\s+[-–—]\s+/)
          .filter(
            (part, i, all) =>
              i !== all.length - 1 || !isVariantDescription(part),
          )
          .join(" - "),
      ) || withoutArtist;
  } else if (endsInVariant && parts.length > 2) {
    title = parts.slice(1, -1).join(" - ");
  } else if (endsInVariant) {
    artist = "Unknown Artist";
    title = parts.slice(0, -1).join(" - ");
  }
  const formatText = [
    rawTitle,
    variant.title,
    product.product_type,
    product.type,
    ...tags.filter((tag) => !/^(?:artist|band)\s*[:=]/i.test(tag)),
  ].join(" ");
  const selectedFormat = retailRecordFormat({
    sourceListingTitle: rawTitle,
    shopifyVariantTitle: variant.title,
  });
  const explicitVinylVariant = vinylFormat.test(clean(variant.title));
  const physicalFormatConfirmed =
    variant.requires_shipping !== false &&
    selectedFormat !== "non_vinyl" &&
    (explicitVinylVariant ||
      (!nonVinylFormat.test(formatText) && vinylFormat.test(formatText)));
  const explicitArtist =
    artist !== "Unknown Artist" && !variantOnly.test(artist);
  return {
    artist: explicitArtist ? artist : "Unknown Artist",
    title,
    physicalFormatConfirmed,
    identityStatus: explicitArtist ? "resolved" : "unresolved",
    identitySource: taggedArtist
      ? "retailer_artist_tag"
      : knownArtist
        ? "retailer_vendor"
        : explicitArtist
          ? "title_structure"
          : "needs_artist",
    recordFormat:
      selectedFormat === "non_vinyl"
        ? "non_vinyl"
        : /\b7\s*(?:inch|in\.|["”])|7-inch/i.test(
              `${rawTitle} ${variant.title ?? ""}`,
            )
          ? "7-inch"
          : /\b(?:box\s*set|boxset)\b/i.test(rawTitle)
            ? "box_set"
            : "LP",
    preorder: /\bpre[ -]?order\b/i.test(`${rawTitle} ${variant.title ?? ""}`),
    releaseDate: product.release_date ?? null,
  };
}

export function isVariantDescription(value) {
  const text = clean(value);
  return (
    variantOnly.test(text) ||
    /^(?:[\w -]{1,40}\s+)?picture\s+disc(?:\s+vinyl(?:\s+lp)?)?$/i.test(text)
  );
}

export function retailerArtistConflict(artist, sourceName) {
  const brand = (value) =>
    clean(value)
      .toLowerCase()
      .replace(/\b(?:official|store|shop|records?|music)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  return Boolean(
    brand(artist) && brand(sourceName) && brand(artist) === brand(sourceName),
  );
}
