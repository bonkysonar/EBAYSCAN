import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveVinylLotFeedback } from "../server/vinylLotFeedbackApi";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("vinyl lot feedback storage", () => {
  it("writes a sanitized local packet and prepares an honest Codex deep link", async () => {
    const storageRoot = await temporaryDirectory();
    const result = await saveVinylLotFeedback(feedbackPayload(), {
      clock: () => new Date("2026-07-28T13:00:00.000Z"),
      feedbackId: "feedback-test-123",
      storageRoot,
      workspaceRoot: "C:\\Record Scanner",
    });
    const saved = JSON.parse(await readFile(result.feedbackPath, "utf8")) as Record<string, unknown>;
    const serialized = JSON.stringify(saved);

    expect(result.storage).toBe("local-device");
    expect(result.codexUrl).toMatch(/^codex:\/\/new\?/);
    expect(result.codexPrompt).toContain(result.feedbackPath);
    expect(serialized).toContain("Scanner confused this with a single");
    expect(serialized).not.toContain("v1|raw-ebay-item|0");
    expect(serialized).not.toMatch(/itemWebUrl|imageUrl|seller|price|listing title/i);
    expect(serialized).toMatch(/itemKey/);
  });

  it("rejects expired or incomplete feedback", async () => {
    const storageRoot = await temporaryDirectory();
    await expect(saveVinylLotFeedback(feedbackPayload({ expiresAt: "2026-07-28T12:00:00.000Z" }), {
      clock: () => new Date("2026-07-28T13:00:00.000Z"),
      feedbackId: "feedback-test-expired",
      storageRoot,
      workspaceRoot: "C:\\Record Scanner",
    })).rejects.toThrow(/expired/i);

    await expect(saveVinylLotFeedback(feedbackPayload({ listings: [] }), {
      clock: () => new Date("2026-07-28T13:00:00.000Z"),
      feedbackId: "feedback-test-incomplete",
      storageRoot,
      workspaceRoot: "C:\\Record Scanner",
    })).rejects.toThrow(/Every displayed listing/i);
  });

  it("rejects local feedback that claims a display window longer than six hours", async () => {
    const storageRoot = await temporaryDirectory();

    await expect(saveVinylLotFeedback(feedbackPayload({ expiresAt: "2026-07-28T18:00:00.001Z" }), {
      clock: () => new Date("2026-07-28T13:00:00.000Z"),
      feedbackId: "feedback-test-window",
      storageRoot,
      workspaceRoot: "C:\\Record Scanner",
    })).rejects.toThrow(/six-hour/i);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "record-scanner-vinyl-feedback-"));
  temporaryDirectories.push(directory);
  return directory;
}

function feedbackPayload(overrides: Record<string, unknown> = {}) {
  return {
    expectedListingCount: 1,
    expiresAt: "2026-07-28T18:00:00.000Z",
    laneCoverage: [{ displayedCount: 10, genre: "classic-rock", retainedCount: 12, status: "ok" }],
    listings: [{
      classificationFlags: ["quantity-unverified"],
      classificationStatus: "review",
      conditionLevel: "unknown",
      genre: "classic-rock",
      itemId: "v1|raw-ebay-item|0",
      note: "Scanner confused this with a single, not a real collection.",
      priorityArtistMatched: true,
      quantityBucket: "unknown",
      reasonTags: ["not-a-lot"],
      score: 2,
    }],
    overall: { note: "Too many single albums survived.", score: 3 },
    scanObservedAt: "2026-07-28T12:00:00.000Z",
    scanOptions: {
      excludeSinglesAndFortyFives: true,
      genres: ["classic-rock"],
      includeUnknownCount: true,
      minimumRecords: 12,
      resultsPerGenre: 12,
    },
    scanSchemaVersion: 2,
    schemaVersion: 1,
    ...overrides,
  };
}
