export type DiscogsReleaseReference = {
  matchedTitle?: string;
  releaseId?: number;
  releaseUrl: string;
};

export function parseDiscogsReleaseReference(value: string): DiscogsReleaseReference {
  const url = new URL(value.trim().startsWith("http") ? value.trim() : `https://www.discogs.com${value.trim()}`);
  if (url.hostname !== "www.discogs.com" && url.hostname !== "discogs.com") {
    throw new Error("Enter a Discogs release URL.");
  }

  const match = url.pathname.match(/\/release\/(\d+)(?:-([^/?#]+))?/);
  if (!match) {
    throw new Error("Enter a Discogs release URL with /release/{id}.");
  }

  url.hash = "";
  return {
    matchedTitle: match[2] ? titleFromSlug(match[2]) : undefined,
    releaseId: Number(match[1]),
    releaseUrl: url.toString(),
  };
}

function titleFromSlug(slug: string): string {
  return decodeURIComponent(slug).replace(/-/g, " ").replace(/\s+/g, " ").trim();
}
