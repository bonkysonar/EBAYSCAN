const STOP_WORDS = new Set(["the", "a", "an", "lp", "vinyl", "record", "records", "album", "used"]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token))
    .join(" ")
    .trim();
}

export function titleTokens(title: string): string[] {
  return normalizeTitle(title).split(" ").filter(Boolean);
}
