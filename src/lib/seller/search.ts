import type { CandidateListing, SearchInput } from "../ebay/types";
import type { SellerListing } from "./types";

export function ebaySellerSearchUrl(listing: Pick<SellerListing, "condition" | "title">, mode: "active" | "sold"): string {
  const url = new URL("https://www.ebay.com/sch/i.html");
  const mediaGrade = mediaGradeFromListing({ condition: listing.condition ?? "", title: listing.title });
  const gradeKeyword = ebayGradeKeyword(mediaGrade);
  const keywords = `${cleanTitleForEbaySearch(listing.title)} ${gradeKeyword} vinyl`.replace(/\s+/g, " ").trim();
  const ebayGrade = ebayRecordGradeFilter(mediaGrade);

  url.searchParams.set("_nkw", keywords);
  url.searchParams.set("_sacat", "0");
  url.searchParams.set("_from", "R40");
  url.searchParams.set("_sop", "15");
  if (mode === "sold") url.searchParams.set("LH_Sold", "1");
  if (ebayGrade) {
    url.searchParams.set("_dcat", "176985");
    url.searchParams.set("Record%20Grading", ebayGrade);
  }

  return url.toString();
}

export function mediaGradeFromListing(listing: Pick<CandidateListing, "condition" | "title" | "recordGrade" | "recordGradeSource">): string {
  if (/^(new|brand new|1000)$/i.test(listing.condition) || isSealed(listing.title)) return "Sealed";
  const suffixedMedia = listing.title.match(/\b(NM[+-]?|M-|VG\+\+|VG[+-]?|EX\+?|G[+-]?)\s+(?:vinyl|record|media)\b/i);
  if (suffixedMedia) return normalizeMediaGrade(suffixedMedia[1]);
  const explicitMedia = listing.title.match(/\b(?:media|vinyl|record|lp)\s*(?:grade|condition)?\s*[:=-]?\s*(near mint|mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor|sealed)(?=\s|[),/;-]|$)/i);
  if (explicitMedia && (!/^lp\b/i.test(explicitMedia[0]) || !/^\s*(?:cover|sleeve|jacket)\b/i.test(listing.title.slice(explicitMedia.index! + explicitMedia[0].length)))) return normalizeMediaGrade(explicitMedia[1]);

  const pairedGrade = listing.title.match(/\b(mint|m|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor)\s*\/\s*(mint|m|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor)(?=\s|[),/;-]|$)/i);
  if (pairedGrade) return normalizeMediaGrade(pairedGrade[1]);

  if (/\b(?:sleeve|cover|jacket)\s*(?:grade|condition)?\s*[:=-]?\s*(?:NM|M-|VG|EX|G)|\b(?:NM|M-|VG\+?|EX|G)\s+(?:sleeve|cover|jacket)\b/i.test(listing.title)) return listing.recordGradeSource === "description" ? listing.recordGrade ?? "Unknown" : "Unknown";
  if (/\bM-(?=\s|\/|$)/.test(listing.title)) return "NM";
  const longGrade = listing.title.match(/\b(?:very good plus|near mint|excellent|very good)\s*\((VG\+\+|VG\+|VG|NM|EX|M-)\)/i);
  if (longGrade) return normalizeMediaGrade(longGrade[1]);

  const titleGrade = listing.title.match(/\b(sealed|mint|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor)(?=\s|[),/;-]|$)/i);
  if (titleGrade) return normalizeMediaGrade(titleGrade[1]);

  if (/new|sealed/i.test(listing.condition)) return "Sealed";
  return listing.recordGradeSource === "description" ? listing.recordGrade ?? "Unknown" : "Unknown";
}

function cleanTitleForEbaySearch(title: string): string {
  const titleBeforeGrade = title.split(mediaGradeBoundaryPattern())[0] || title;
  return titleBeforeGrade
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+\+\s+/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mediaGradeBoundaryPattern(): RegExp {
  return /\b(?:media|vinyl|record|lp)?\s*(?:grade|condition)?\s*[:=-]?\s*(?:sealed|mint|m|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor)(?:\s*\/\s*(?:mint|m|near mint|nm\+|nm-|nm|vg\+\+|vg\+|vg-|vg|ex\+|ex|g\+|g-|g|fair|poor))?(?=\s|[),/;-]|$)/i;
}

function ebayGradeKeyword(grade: string): string {
  const normalized = normalizeMediaGrade(grade);
  const keywordMap: Record<string, string> = {
    EX: "EX",
    "EX+": "EX plus",
    Fair: "fair",
    G: "good",
    "G+": "good plus",
    "G-": "good",
    M: "mint",
    NM: "near mint",
    "NM+": "near mint",
    "NM-": "near mint",
    Poor: "poor",
    Sealed: "sealed",
    VG: "VG",
    "VG+": "VG plus",
    "VG++": "VG plus",
    "VG-": "VG",
  };

  return keywordMap[normalized] ?? "";
}

function ebayRecordGradeFilter(grade: string): string | null {
  const normalized = normalizeMediaGrade(grade);
  const gradeMap: Record<string, string> = {
    EX: "Excellent (EX)",
    "EX+": "Excellent (EX)",
    Fair: "Fair (F)",
    G: "Good (G)",
    "G+": "Good Plus (G+)",
    "G-": "Good (G)",
    M: "Mint (M)",
    NM: "Near Mint (NM or M-)",
    "NM+": "Near Mint (NM or M-)",
    "NM-": "Near Mint (NM or M-)",
    Poor: "Poor (P)",
    VG: "Very Good (VG)",
    "VG+": "Very Good Plus (VG+)",
    "VG++": "Very Good Plus (VG+)",
    "VG-": "Very Good (VG)",
  };

  return gradeMap[normalized] ?? null;
}

function normalizeMediaGrade(value: string): string {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  const gradeMap: Record<string, string> = {
    ex: "EX",
    "ex+": "EX+",
    fair: "Fair",
    g: "G",
    "g+": "G+",
    "g-": "G-",
    m: "M",
    mint: "M",
    near: "NM",
    "near mint": "NM",
    "m-": "NM",
    nm: "NM",
    "nm+": "NM+",
    "nm-": "NM-",
    poor: "Poor",
    sealed: "Sealed",
    vg: "VG",
    "vg+": "VG+",
    "vg++": "VG++",
    "vg-": "VG-",
  };

  return gradeMap[normalized] ?? value.toUpperCase();
}


export function sellerSearchInput(listing: SellerListing): SearchInput {
  return { type: "manual", query: sellerSearchQuery(listing.title), conditionFilter: sellerCondition(listing), searchProfile: "seller-pricing" };
}

export function sellerCondition(listing: Pick<SellerListing, "condition" | "title">): "new" | "used" | "both" {
  if (/^(new|brand new|1000)$/i.test(listing.condition ?? "") || isSealed(listing.title) || /\bbrand new\b/i.test(listing.title)) return "new";
  if (/used|3000|4000|5000|6000/i.test(listing.condition ?? "") || mediaGradeFromListing({ ...listing, condition: listing.condition ?? "" }) !== "Unknown") return "used";
  return "both";
}

export function sellerSearchQuery(title: string): string {
  // A paired media/sleeve grade marks the seller's trailing condition and process notes.
  // A lone word such as Mint can be an artist or album name and is never a boundary.
  const cleaned = title.replace(/[–—]/g, " - ").split(/\b(?:NM[+-]?|VG\+\+|VG[+-]?|EX\+?|G[+-]?|M-?)\s*\/\s*(?:NM[+-]?|VG\+\+|VG[+-]?|EX\+?|G[+-]?|M-?)(?=\s|[),;]|$)/i)[0]
    .replace(/\bultrasonic(?:ally)?\s+clean(?:ed)?\b/gi, " ")
    .replace(/\b(?:new[\s/-]+sealed|brand new|factory sealed|sealed|\d\s*x?\s*LPs?\b|180\s*g\b|200\s*g\b|remaster(?:ed)?|vinyl(?: records?)?|limited edition|RSD)\b.*$/i, "")
    .replace(/\(Record,\s*\d{4}\)/i, "")
    .replace(/\s+/g, " ").replace(/[\s-]+$/, "").trim();
  const parts = cleaned.split(/\s+-\s*|(?<=[a-z])-\s+(?=[A-Z])/);
  if (parts.length > 1) parts[0] = parts[0].replace(/\s+(?:with|feat\.?|featuring)\s+.+$/i, "");
  return parts.join(" - ");
}

function isSealed(title: string): boolean {
  return /\bsealed\b/i.test(title) && !/\b(?:not|un|no longer)\s*[- ]?sealed\b/i.test(title);
}

// Only an explicit media/record label supplies grade evidence from a description.
// Generic descriptions such as "all records are VG or better" are not a grade.
export function mediaGradeFromDescription(description: string): string | undefined {
  const match = description.match(/\b(?:media|vinyl|record)\s*(?:grading|grade|condition)?\s*(?::|=|is(?: in)?)\s*(?:in\s+)?(very good plus|near mint|excellent|very good|good plus|mint|NM[+-]?|M-|VG\+\+|VG[+-]?|EX\+?|G\+?)(?=\s|[.,;(/]|$)/i);
  if (!match || /\b(?:or better|at least)\b/i.test(description.slice(Math.max(0, match.index! - 15), match.index! + match[0].length + 20))) return undefined;
  const grade = { "very good plus": "VG+", "very good": "VG", "excellent": "EX", "good plus": "G+" }[match[1].toLowerCase()];
  return grade ?? normalizeMediaGrade(match[1]);
}
