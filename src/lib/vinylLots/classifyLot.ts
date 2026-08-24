import type {
  ClassifyVinylLotInput,
  VinylLotClassification,
  VinylLotCollectionAssessment,
  VinylLotConditionAssessment,
  VinylLotGenreAssessment,
  VinylLotPriorityArtistInput,
  VinylLotQuantityAssessment,
  VinylLotReviewReason,
  VinylLotTargetGenre,
} from "./types";

export const VINYL_LOT_DEFAULT_MINIMUM_RECORDS = 12;
export const VINYL_LOT_HARD_MINIMUM_RECORDS = 12;
export const VINYL_LOT_MAXIMUM_MINIMUM_RECORDS = 100;

const NOISE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:you|u)\s+pick\b|\bpick\s+(?:your|any|\d+)\b|\bchoose\s+(?:your|any)\b/i, "choice-listing"],
  [/\b(?:priced|sold)\s+(?:each|individually)\b|\bper\s+(?:record|lp|album)\b|\$\s*\d+(?:\.\d{1,2})?\s+each\b/i, "per-record-listing"],
  [/\bdive\s*bin\b|\bbuild\s+your\s+own\s+lot\b/i, "build-a-lot-listing"],
  [/\bempty\s+(?:lp\s+)?sleeves?\b|\balbum\s+covers?\s+only\b|\bjackets?\s+only\b|\bno\s+(?:vinyl|records?|lps?)\b/i, "packaging-only"],
];

const GENRE_SIGNALS: Record<VinylLotTargetGenre, RegExp[]> = {
  "hip-hop": [
    /\bhip[ -]?hop\b/i,
    /\b(?:gangsta|old school)\s+rap\b|\brap\b/i,
    /\b(?:tupac|2pac|nas|jay[- ]?z|busta rhymes|mase|nelly|outkast|wu[- ]?tang|a tribe called quest|de la soul|public enemy|dr\.? dre|snoop|three 6 mafia|mf doom|gang starr)\b/i,
  ],
  "classic-rock": [
    /\bclassic\s+rock\b/i,
    /\b(?:led zeppelin|pink floyd|fleetwood mac|the beatles|rolling stones|the who|eagles|doors|queen|aerosmith|van halen|black sabbath|david bowie|jimi hendrix|creedence|ccr|genesis|elo|electric light orchestra|reo speedwagon|neil young|styx|traffic|rush|kinks|peter frampton|wings|guess who|bto|iron butterfly|mott the hoople|ted nugent|grateful dead|king crimson)\b/i,
    /\b(?:60s|70s|1970s)\s+rock\b/i,
  ],
  "1990s-rock": [
    /\b(?:90s|1990s|1990's)\s+(?:alternative\s+)?rock\b/i,
    /\b(?:grunge|britpop)\b/i,
    /\b90s\s+(?:indie|punk|ska|alternative)\b/i,
    /\b(?:nirvana|pearl jam|soundgarden|alice in chains|smashing pumpkins|radiohead|oasis|blur|hole|stone temple pilots|foo fighters|beck|weezer|tool|nine inch nails|rage against the machine)\b/i,
  ],
  "instrumental-jazz": [
    /\b(?:hard\s*bop|be\s*bop|bebop|post[- ]?bop|modal\s+jazz|jazz\s+fusion)\b/i,
    /\b(?:miles davis|john coltrane|thelonious monk|art blakey|charles mingus|herbie hancock|wayne shorter|chick corea|sonny rollins|cannonball adderley|weather report|bill evans|lee morgan|hank mobley|grant green|alice coltrane)\b/i,
    /\bjazz\s+(?:lp|vinyl|record|collection|lot)s?\b/i,
  ],
};

const POSITIVE_CONDITION = /\b(?:near\s+mint|nm-?|mint-?|excellent)\b|\b(?:vg\+{1,2}|ex\+?)(?=\s|$|[),/])/i;
const NEGATIVE_CONDITION = /\b(?:good|fair|poor|untested|as[- ]is|warped|deep\s+scratch(?:es)?)\b|\bg\+?(?=\s|$|[),/])|\bvg\b(?!\s*\+)/i;

export function classifyVinylLot(input: ClassifyVinylLotInput): VinylLotClassification {
  const title = cleanText(input.title);
  const description = cleanText(input.shortDescription);
  const combined = [title, description].filter(Boolean).join(" \n ");
  const flags: string[] = [];
  const reviewReasons: VinylLotReviewReason[] = [];
  const minimumRecords = boundedMinimum(input.minimumRecords);
  const includeUnknownCount = input.includeUnknownCount !== false;
  const excludeSinglesAndFortyFives = input.excludeSinglesAndFortyFives !== false;
  const priorityArtists = normalizePriorityArtists(input.priorityArtists ?? []);
  const priorityArtistMatches = matchPriorityArtists(combined, priorityArtists).map((artist) => artist.name);
  const quantity = assessQuantity(title, description, minimumRecords);
  const collectionText = withoutLabelLikeLotPhrases(combined);
  const collection = assessCollection(collectionText, quantity);
  const genre = assessGenre(combined, input.searchGenre ?? null, priorityArtists);
  const condition = assessCondition([input.conditionText, title, description].filter(Boolean).join(" "));

  const noiseFlag = NOISE_PATTERNS.find(([pattern]) => pattern.test(combined))?.[1] ?? null;
  const nonVinylFormat = isNonVinylFormat(combined);
  const singlesOrFortyFives = isSinglesOrFortyFives(combined);
  const formatRejected = nonVinylFormat || (excludeSinglesAndFortyFives && singlesOrFortyFives);

  if (noiseFlag) flags.push(noiseFlag);
  if (singlesOrFortyFives) flags.push("singles-or-45-rpm");
  if (/\bmixed\s+(?:lot|collection|genres?)\b|\bassorted\b/i.test(combined)) flags.push("mixed-inventory");
  const apparentSingleItem = isApparentSingleItem(withoutLabelLikeLotPhrases(title), quantity);
  if (!collection.isCollection || apparentSingleItem) flags.push("single-item-likely");
  if (priorityArtistMatches.length > 0) flags.push("priority-artist");
  if (matchPriorityArtists(combined, priorityArtists).some((artist) => artist.mode === "always-review")) {
    flags.push("always-review-artist");
  }

  if (quantity.count === null) {
    flags.push("quantity-unverified");
    reviewReasons.push(reason("quantity-unverified", "The listing does not state a trustworthy record count."));
    if (!includeUnknownCount) {
      reviewReasons.push(reason("quantity-required", "This scan is configured to exclude listings without a stated count."));
    }
  } else if (quantity.count < VINYL_LOT_HARD_MINIMUM_RECORDS) {
    reviewReasons.push(reason("too-small", `The stated count is ${quantity.count}, below the 12-record floor.`));
  } else if (quantity.nearMatch) {
    flags.push("near-match-size");
    reviewReasons.push(reason("near-match-size", `The stated count is ${quantity.count}, below this scan's ${minimumRecords}-record target.`));
  }

  if (!collection.isCollection || apparentSingleItem) {
    reviewReasons.push(reason("single-item-likely", "The listing text does not support that this is one multi-record collection."));
  }
  if (!genre.matchesTarget) {
    flags.push("genre-unverified");
    reviewReasons.push(reason("genre-unverified", "The listing text does not independently support the target genre."));
  }
  if (condition.level === "unknown") {
    flags.push("condition-unverified");
    reviewReasons.push(reason("condition-unverified", "VG+ media condition is not supported by the listing text."));
  } else if (condition.level === "below-target") {
    flags.push("condition-below-target");
    reviewReasons.push(reason("condition-below-target", "The stated condition is below or less reliable than the VG+ target."));
  }
  if (noiseFlag) reviewReasons.push(reason(
    noiseFlag,
    noiseFlag === "packaging-only"
      ? "This listing appears to sell empty sleeves, jackets, or covers instead of records."
      : "This appears to be a choice or per-record listing rather than one fixed lot.",
  ));
  if (formatRejected) {
    reviewReasons.push(reason("format-rejected", excludeSinglesAndFortyFives && singlesOrFortyFives
      ? "This scan excludes singles, 7-inch records, and 45 RPM lots."
      : "The listing is not a vinyl record collection."));
  }

  let status: VinylLotClassification["status"] = "review";
  if (
    noiseFlag ||
    formatRejected ||
    !collection.isCollection ||
    apparentSingleItem ||
    (quantity.count === null && !includeUnknownCount) ||
    (quantity.count !== null && quantity.count < VINYL_LOT_HARD_MINIMUM_RECORDS)
  ) {
    status = "rejected";
  } else if (quantity.nearMatch && genre.matchesTarget) {
    status = "near-match";
  } else if (quantity.meetsMinimum && genre.matchesTarget && condition.level !== "below-target") {
    status = "qualifying";
  }

  return {
    collection,
    condition,
    flags: unique(flags),
    genre,
    priorityArtistMatches: unique(priorityArtistMatches),
    quantity,
    reviewReasons: uniqueReasons(reviewReasons),
    status,
  };
}

function assessQuantity(title: string, description: string, minimumRecords: number): VinylLotQuantityAssessment {
  const sources: Array<{ source: "title" | "description"; text: string }> = [
    { source: "title", text: title },
    { source: "description", text: description },
  ];
  const patterns = [
    /\blot\s+of\s+(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm))\b/i,
    /\blot\s+of\s*\((\d{1,4})\)(?!\s*(?:[\"”″]|inch|rpm))/i,
    /\blot\s*[-–—:]?\s*(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm))\b/i,
    /\bcollection\s+of\s+(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm))\b/i,
    /\b(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm))\s*(?:pc|pcs|piece|pieces)\b/i,
    /\b(\d{1,4})x\s*(?:lot|bundle|vinyl|records?|lps?|albums?)\b/i,
    /\b(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm))\s*[- ]?(?:vinyl\s+)?(?:records|lps|albums)\b/i,
    /\b(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm))\s*[- ]?(?:vinyl\s+)?(?:record|lp|album)\s+(?:lot|collection|bundle)\b/i,
    /^\s*\((\d{1,4})\)\s*/i,
    /\b(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm))\s+lot\b/i,
    /\b(?:records?|lps?|albums?)\s+(?:lot|collection)\s*(?:of\s*)?(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm))\b/i,
    /\blot\s*\((\d{1,4})\)/i,
    /^\s*(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm|'?s\b))\b(?=.{0,65}\b(?:lot|collection|bundle)\b)/i,
    /\b(\d{1,4})(?!\s*(?:[\"”″]|inch|rpm|'?s\b))\b(?=\s+(?:(?:[a-z&/-]+|vinyl)\s+){0,5}(?:records|lps|albums)\b)/i,
  ];

  for (const candidate of sources) {
    for (const pattern of patterns) {
      const match = candidate.text.match(pattern);
      const count = match ? Number(match[1]) : Number.NaN;
      if (!isPlausibleCount(count, match?.[0] ?? "")) continue;
      return quantityAssessment(candidate.source, count, match?.[0] ?? null, minimumRecords);
    }
  }

  const wordCounts: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, dozen: 12,
  };
  for (const candidate of sources) {
    const match = candidate.text.match(/\b(?:lot|collection)\s+of\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|dozen)\b/i);
    if (!match) continue;
    return quantityAssessment(candidate.source, wordCounts[match[1].toLowerCase()], match[0], minimumRecords);
  }

  return {
    confidence: "low",
    count: null,
    evidence: null,
    meetsMinimum: false,
    nearMatch: false,
    source: "unknown",
  };
}

function quantityAssessment(
  source: "title" | "description",
  count: number,
  evidence: string | null,
  minimumRecords: number,
): VinylLotQuantityAssessment {
  return {
    confidence: source === "title" ? "high" : "medium",
    count,
    evidence,
    meetsMinimum: count >= minimumRecords,
    nearMatch: count >= VINYL_LOT_HARD_MINIMUM_RECORDS && count < minimumRecords,
    source,
  };
}

function assessCollection(text: string, quantity: VinylLotQuantityAssessment): VinylLotCollectionAssessment {
  if (quantity.count !== null && quantity.count >= 2) {
    return { confidence: "high", evidence: quantity.evidence, isCollection: true };
  }
  const strong = text.match(/\b(?:records?|vinyl|lps|albums)\s+(?:lot|collection|bundle)\b|\b(?:lot|collection|bundle|job\s*lot)\s+(?:of\s+)?(?:records|vinyl|lps|albums)\b|\b(?:record\s+crate|crate\s+of\s+records|box\s+of\s+(?:records|lps)|estate\s+collection)\b/i)?.[0] ?? null;
  if (strong) return { confidence: "high", evidence: strong, isCollection: true };
  const medium = text.match(/\b(?:assorted|mixed|bulk|various\s+artists?)\b.{0,40}\b(?:records|lps|albums|vinyl)\b|\b(?:records|lps|albums|vinyl)\b.{0,40}\b(?:assorted|mixed|bulk|various\s+artists?)\b/i)?.[0] ?? null;
  if (medium) return { confidence: "medium", evidence: medium, isCollection: true };
  return { confidence: "low", evidence: null, isCollection: false };
}

function assessGenre(
  text: string,
  searchGenre: VinylLotTargetGenre | null,
  priorityArtists: VinylLotPriorityArtistInput[],
): VinylLotGenreAssessment {
  const artistMatches = matchPriorityArtists(text, priorityArtists);
  const matches = (Object.entries(GENRE_SIGNALS) as Array<[VinylLotTargetGenre, RegExp[]]>)
    .map(([genre, patterns]) => ({
      genre,
      signals: [
        ...patterns.flatMap((pattern) => text.match(pattern)?.[0] ?? []),
        ...artistMatches.filter((artist) => artist.genre === genre).map((artist) => artist.name),
      ],
    }))
    .filter((candidate) => candidate.signals.length > 0)
    .sort((left, right) => right.signals.length - left.signals.length);
  const primary = matches[0]?.genre ?? null;
  const signals = unique(matches.flatMap((candidate) => candidate.signals));
  const matchesTarget = Boolean(searchGenre ? matches.some((candidate) => candidate.genre === searchGenre) : primary);

  return {
    confidence: signals.length >= 2 ? "high" : signals.length === 1 ? "medium" : "low",
    matchesTarget,
    primary: searchGenre && matchesTarget ? searchGenre : primary,
    searchGenre,
    signals,
  };
}

function assessCondition(text: string): VinylLotConditionAssessment {
  const negative = text.match(NEGATIVE_CONDITION)?.[0] ?? null;
  if (negative) return { confidence: "high", evidence: negative, level: "below-target" };
  const positive = text.match(POSITIVE_CONDITION)?.[0] ?? null;
  if (positive) return { confidence: "medium", evidence: positive, level: "supported-vg-plus" };
  return { confidence: "low", evidence: null, level: "unknown" };
}

function isSinglesOrFortyFives(text: string): boolean {
  return /\b45\s*rpm\b|\b45s\b|\b45\s+(?:record|single)\b|\b7[- ]?inch\b|\b7[\"”″]\s*(?:vinyl|records?|singles?)?\b|\b(?:vinyl|record|lp|dj|promo)\s+singles?\b|\bsingles?\s*[-–—:/]?\s*(?:lot|collection|bundle)\b|\b12(?:[- ]?inch|[\"”″])\s+(?:vinyl\s+)?singles?\b/i.test(text);
}

function isApparentSingleItem(text: string, quantity: VinylLotQuantityAssessment): boolean {
  if (quantity.count !== null) return false;
  const strongMultiItemWord = /\b(?:lot|bundle|job\s*lot|crate|box\s+of|estate|bulk|assorted|mixed|various\s+artists?)\b/i.test(text);
  const singularLp = /\b(?:lp|album)\b/i.test(text) && !/\b(?:lps|albums)\b/i.test(text);
  const singularRecord = /\brecord\b/i.test(text) && !/\brecords\b/i.test(text);
  const singularFormat = singularLp || singularRecord;
  return singularFormat && !strongMultiItemWord;
}

function withoutLabelLikeLotPhrases(text: string): string {
  return text.replace(/\brap\s*-?\s*a\s*-?\s*lot(?:\s+records?)?\b/gi, " ");
}

function isPlausibleCount(count: number, evidence: string): boolean {
  if (!Number.isInteger(count) || count <= 0 || count > 10_000) return false;
  if (count >= 1900 && count <= 2099 && /\b(?:19|20)\d{2}\b/.test(evidence)) return false;
  if (count > 1_000 && !/\b(?:lot|collection|records|lps|albums)\b/i.test(evidence)) return false;
  return true;
}

function isNonVinylFormat(text: string): boolean {
  const nonVinyl = /\b(?:cds?|compact discs?|cassettes?|8[- ]?tracks?|dvds?)\b/i.test(text);
  const vinyl = /\b(?:vinyl|records?|lps?|12[- ]?inch|12\")\b/i.test(text);
  return nonVinyl && !vinyl;
}

function normalizePriorityArtists(artists: VinylLotPriorityArtistInput[]): VinylLotPriorityArtistInput[] {
  const seen = new Set<string>();
  return artists.flatMap((artist) => {
    const name = cleanText(artist?.name).slice(0, 80);
    if (!name || !GENRE_SIGNALS[artist?.genre] || !["always-review", "priority"].includes(artist?.mode)) return [];
    const key = `${artist.genre}:${name.toLowerCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ genre: artist.genre, mode: artist.mode, name }];
  }).slice(0, 100);
}

function matchPriorityArtists(text: string, artists: VinylLotPriorityArtistInput[]): VinylLotPriorityArtistInput[] {
  return artists.filter((artist) => artistPattern(artist.name).test(text));
}

function artistPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i");
}

function boundedMinimum(value: number | undefined): number {
  if (!Number.isFinite(value)) return VINYL_LOT_DEFAULT_MINIMUM_RECORDS;
  return Math.min(VINYL_LOT_MAXIMUM_MINIMUM_RECORDS, Math.max(VINYL_LOT_HARD_MINIMUM_RECORDS, Math.floor(value as number)));
}

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function reason(code: string, message: string): VinylLotReviewReason {
  return { code, message };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueReasons(values: VinylLotReviewReason[]): VinylLotReviewReason[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.code)) return false;
    seen.add(value.code);
    return true;
  });
}
