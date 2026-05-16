import type { CandidateListing } from "../ebay/types";

export const DEFAULT_RISK_KEYWORDS = [
  "promo",
  "white label",
  "test pressing",
  "sealed",
  "colored vinyl",
  "color vinyl",
  "limited",
  "numbered",
  "import",
  "original",
  "first press",
  "mono",
  "quad",
  "audiophile",
  "mfsl",
  "mobile fidelity",
  "blue note",
  "prestige",
  "impulse",
  "punk",
  "hardcore",
  "metal",
  "psych",
  "private press",
  "reggae",
  "ska",
  "hip hop",
  "12\"",
  "maxi-single",
  "bootleg",
  "unofficial",
  "rare",
  "misprint",
  "withdrawn",
  "club edition",
];

export type RiskFlag = {
  keyword: string;
  listingId: string;
  title: string;
};

export function findRiskFlags(listings: CandidateListing[], keywords = DEFAULT_RISK_KEYWORDS): RiskFlag[] {
  const flags: RiskFlag[] = [];

  for (const listing of listings) {
    const title = listing.title.toLowerCase();
    for (const keyword of keywords) {
      if (title.includes(keyword.toLowerCase())) {
        flags.push({ keyword, listingId: listing.id, title: listing.title });
      }
    }
  }

  return flags;
}
