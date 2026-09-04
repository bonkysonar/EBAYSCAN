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
const variantOnly =
  /^(?:(?:baby|royal|cloudy|opaque|transparent|translucent|milky|neon|hot|light|dark|limited|exclusive|standard|180g|180|gram|vinyl|lp|2lp|3lp|black|white|red|blue|pink|purple|orange|yellow|green|gold|silver|bone|clear|beer|marble|marbled|galaxy|splatter|swirl|smoke|in|with|w|and|edition|pressing|colour|color|colored|coloured|\d+)|[\s/&()+.-])+$/i;
const storeVendor =
  /\b(?:records?|recordings|official|shop|store|merchnow|music|distribution|entertainment)\b/i;

export function retailEligibility(find = {}) {
  const title = clean(
    find.sourceListingTitle ?? find.listingTitle ?? find.title,
  );
  const variant = clean(find.shopifyVariantTitle ?? find.variantTitle);
  const text = `${title} ${variant}`;
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
  const retailerVendor = retailerArtistConflict(
    vendor,
    source.name ?? source.displayName ?? source.sourceName ?? source.id,
  );
  const knownArtist =
    taggedArtist ||
    (vendor &&
    !retailerVendor &&
    !storeVendor.test(vendor) &&
    vendor !== "Default Title"
      ? vendor
      : null);
  const parts = rawTitle.split(/\s+[-–—]\s+/);
  const endsInVariant = parts.length > 1 && variantOnly.test(parts.at(-1));
  let artist = inferRetailArtist(rawTitle);
  let title = inferRetailTitle(rawTitle);
  if (
    knownArtist &&
    (taggedArtist ||
      !title ||
      variantOnly.test(title) ||
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
            (part, i, all) => i !== all.length - 1 || !variantOnly.test(part),
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
  const physicalFormatConfirmed =
    /\b(?:vinyl|[1-9]?lp|record\s+album|[127][02]?[ -]inch|box[ -]?set)\b/i.test(
      formatText,
    );
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
    recordFormat: /\b7\s*(?:inch|in\.|["”])|7-inch/i.test(
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
  return variantOnly.test(clean(value));
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
