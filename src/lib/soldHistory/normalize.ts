import { normalizeTitle } from "../normalization/normalizeTitle.js";
import type { SoldConditionBucket } from "./types";

const SEALED_PATTERNS = [
  /\bfactory\s+sealed\b/i,
  /\bbrand\s+new(?:\s*\/\s*sealed)?\b/i,
  /\bnew\s*\/\s*sealed\b/i,
  /\bnew\s+sealed\b/i,
  /\bsealed\b/i,
];

const USED_GRADE_PATTERN = /\b(M|NM|EX|VG\+|VG|G\+|G|F|P)\s*\/\s*(M|NM|EX|VG\+|VG|G\+|G|F|P)(?![A-Z+])/i;

export function inferSoldCondition(title: string, customLabel = ""): SoldConditionBucket {
  if (/^whole\b/i.test(customLabel.trim())) return "new_sealed";
  if (SEALED_PATTERNS.some((pattern) => pattern.test(title))) return "new_sealed";
  if (USED_GRADE_PATTERN.test(title)) return "used";
  return "unknown";
}

export function extractMediaSleeveGrades(title: string): { mediaGrade?: string; sleeveGrade?: string } {
  const match = title.match(USED_GRADE_PATTERN);
  if (!match) return {};
  return {
    mediaGrade: match[1].toUpperCase(),
    sleeveGrade: match[2].toUpperCase(),
  };
}

export function inferArtistAndRelease(title: string): { artist?: string; releaseTitle?: string } {
  const cleaned = stripSalesTitleNoise(title);
  const dashMatch = cleaned.match(/^(.{2,80}?)(?:\s+[-–—]\s+|\s*[-–—]\s+)(.{2,})$/);
  if (!dashMatch) return { releaseTitle: cleaned.trim() || undefined };

  return {
    artist: dashMatch[1].trim(),
    releaseTitle: dashMatch[2].trim(),
  };
}

export function soldHistoryKey(title: string): string {
  const { artist, releaseTitle } = inferArtistAndRelease(title);
  const normalizedArtist = artist ? normalizeSoldText(artist) : "";
  const normalizedRelease = normalizeSoldText(releaseTitle ?? title);

  return normalizedArtist ? `${normalizedArtist}::${normalizedRelease}` : normalizedRelease;
}

export function normalizeSoldText(value: string): string {
  return normalizeTitle(stripSalesTitleNoise(value))
    .replace(/\b(pressing|press|edition|limited|remastered|stereo|mono)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSalesTitleNoise(title: string): string {
  return title
    .replace(/\|/g, " ")
    .replace(/\b(factory\s+sealed|brand\s+new(?:\s*\/\s*sealed)?|new\s*\/\s*sealed|new\s+sealed|sealed)\b/gi, " ")
    .replace(USED_GRADE_PATTERN, " ")
    .replace(/\bultrasonic(?:ally)?\s+clean(?:ed)?\b/gi, " ")
    .replace(/\bvinyl\s+record\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\b\d+\s*(?:gram|grams|g)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
