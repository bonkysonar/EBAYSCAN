import { createHash, webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveVinylLotFeedbackInBrowser,
  submitVinylLotFeedback,
  usesBrowserLocalVinylLotFeedback,
  VINYL_LOT_BROWSER_FEEDBACK_STORAGE_KEY,
} from "../lib/vinylLots/browserFeedback";
import type { VinylLotFeedbackSubmission } from "../lib/vinylLots/feedback";

const cryptoProvider = webcrypto as unknown as Crypto;

beforeEach(() => localStorage.clear());

describe("hosted vinyl-lot feedback fallback", () => {
  it("uses the local endpoint only for loopback hostnames", () => {
    expect(usesBrowserLocalVinylLotFeedback("localhost")).toBe(false);
    expect(usesBrowserLocalVinylLotFeedback("127.0.0.1")).toBe(false);
    expect(usesBrowserLocalVinylLotFeedback("[::1]")).toBe(false);
    expect(usesBrowserLocalVinylLotFeedback("record-scanner.vercel.app")).toBe(true);
    expect(usesBrowserLocalVinylLotFeedback("")).toBe(true);
  });

  it("never posts hosted feedback and persists only a sanitized packet with SHA-256 item keys", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const rawItemId = "v1|raw-ebay-item|0";
    const input = feedbackPayload(rawItemId);
    Object.assign(input.listings[0], {
      imageUrl: "https://images.example/record.jpg",
      itemWebUrl: "https://www.ebay.com/itm/raw-ebay-item",
      price: { currency: "USD", value: "12.34" },
      seller: { username: "private-seller" },
      title: "Private listing title",
    });

    const result = await submitVinylLotFeedback(input, {
      clock: () => new Date("2026-07-28T13:00:00.000Z"),
      cryptoProvider,
      feedbackId: "browser-feedback-123",
      fetcher,
      hostname: "record-scanner.vercel.app",
      storage: localStorage,
    });
    const serialized = localStorage.getItem(VINYL_LOT_BROWSER_FEEDBACK_STORAGE_KEY) ?? "";
    const expectedHash = createHash("sha256").update(rawItemId).digest("hex");

    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      feedbackPath: `browser-local:${VINYL_LOT_BROWSER_FEEDBACK_STORAGE_KEY}`,
      storage: "browser-local",
    });
    expect(result.codexUrl).toMatch(/^codex:\/\/new\?prompt=/);
    expect(result.message).toMatch(/press Send/i);
    expect(serialized).toContain(expectedHash);
    expect(serialized).toContain("This looked like a single record, not a collection.");
    expect(serialized).not.toContain(rawItemId);
    expect(result.codexPrompt).not.toContain(rawItemId);
    expect(serialized).not.toMatch(/imageUrl|itemWebUrl|private-seller|Private listing title|"price"/i);
  });

  it("preserves the local development POST behavior", async () => {
    const responsePayload = {
      codexPrompt: "Review the local packet.",
      codexUrl: "codex://new?prompt=Review%20the%20local%20packet",
      feedbackId: "feedback-local-123",
      feedbackPath: "C:\\feedback\\feedback-local-123.json",
      message: "Saved locally.",
      storage: "local-device",
    };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(responsePayload), { status: 200 }));

    const result = await submitVinylLotFeedback(feedbackPayload(), {
      fetcher,
      hostname: "127.0.0.1",
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/vinyl-lots/feedback", expect.objectContaining({ method: "POST" }));
    expect(result).toEqual(responsePayload);
    expect(localStorage.getItem(VINYL_LOT_BROWSER_FEEDBACK_STORAGE_KEY)).toBeNull();
  });

  it("rejects expired scans and feedback windows longer than six hours before writing", async () => {
    await expect(saveVinylLotFeedbackInBrowser(feedbackPayload(), {
      clock: () => new Date("2026-07-28T18:00:00.001Z"),
      cryptoProvider,
      storage: localStorage,
    })).rejects.toThrow(/expired/i);

    const tooLong = feedbackPayload();
    tooLong.expiresAt = "2026-07-28T18:00:00.001Z";
    await expect(saveVinylLotFeedbackInBrowser(tooLong, {
      clock: () => new Date("2026-07-28T13:00:00.000Z"),
      cryptoProvider,
      storage: localStorage,
    })).rejects.toThrow(/six-hour/i);

    expect(localStorage.getItem(VINYL_LOT_BROWSER_FEEDBACK_STORAGE_KEY)).toBeNull();
  });
});

function feedbackPayload(itemId = "v1|raw-ebay-item|0"): VinylLotFeedbackSubmission {
  return {
    expectedListingCount: 1,
    expiresAt: "2026-07-28T18:00:00.000Z",
    laneCoverage: [{ displayedCount: 10, genre: "classic-rock", retainedCount: 12, status: "ok" }],
    listings: [{
      classificationFlags: ["quantity-unverified"],
      classificationStatus: "review",
      conditionLevel: "unknown",
      genre: "classic-rock",
      itemId,
      note: "This looked like a single record, not a collection.",
      priorityArtistMatched: true,
      quantityBucket: "unknown",
      reasonTags: ["not-a-lot"],
      score: 2,
    }],
    overall: { note: "Too many single albums survived.", score: 3 },
    scanObservedAt: "2026-07-28T12:00:00.000Z",
    scanOptions: {
      customQueries: {},
      excludeSinglesAndFortyFives: true,
      genres: ["classic-rock"],
      includeUnknownCount: true,
      minimumRecords: 12,
      priorityArtists: [],
      resultsPerGenre: 12,
    },
    scanSchemaVersion: 2,
    schemaVersion: 1,
  };
}
