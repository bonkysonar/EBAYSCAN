import { describe, expect, it } from "vitest";
import { parseDiscogsReleaseReference } from "../lib/discogs/releaseUrl";

describe("parseDiscogsReleaseReference", () => {
  it("parses Discogs release URLs", () => {
    const reference = parseDiscogsReleaseReference("https://www.discogs.com/release/8769631-Various-Pebbles-Vol-One");

    expect(reference.releaseId).toBe(8769631);
    expect(reference.releaseUrl).toBe("https://www.discogs.com/release/8769631-Various-Pebbles-Vol-One");
    expect(reference.matchedTitle).toBe("Various Pebbles Vol One");
  });

  it("parses relative Discogs release paths", () => {
    const reference = parseDiscogsReleaseReference("/release/12345-Test-Pressing");

    expect(reference.releaseId).toBe(12345);
    expect(reference.releaseUrl).toBe("https://www.discogs.com/release/12345-Test-Pressing");
  });

  it("rejects non-release URLs", () => {
    expect(() => parseDiscogsReleaseReference("https://example.com/release/123")).toThrow("Discogs");
    expect(() => parseDiscogsReleaseReference("https://www.discogs.com/master/123")).toThrow("/release/{id}");
  });
});
