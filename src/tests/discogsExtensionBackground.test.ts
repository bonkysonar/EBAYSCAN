import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("Discogs extension persistent helper window", () => {
  it("creates one visible window, reuses it, and focuses the scanner after a successful result", async () => {
    const listeners: Array<(message: Record<string, unknown>, sender: Record<string, unknown>, sendResponse: (value: unknown) => void) => void> = [];
    const storage: Record<string, unknown> = {};
    const tabs = {
      get: vi.fn(async (tabId: number) => ({ id: tabId, windowId: 10 })),
      onRemoved: { addListener: vi.fn() },
      query: vi.fn(async () => [{ id: 20, windowId: 10 }]),
      sendMessage: vi.fn(async () => undefined),
      update: vi.fn(async (tabId: number, changes: Record<string, unknown>) => ({ id: tabId, windowId: 10, ...changes })),
    };
    const windows = {
      create: vi.fn(async () => ({ id: 10, tabs: [{ id: 20, windowId: 10 }] })),
      update: vi.fn(async () => undefined),
    };
    const chrome = {
      runtime: {
        getManifest: () => ({ version: "0.3.0" }),
        onMessage: {
          addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
        },
      },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          remove: vi.fn(async (key: string) => {
            delete storage[key];
          }),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(storage, values);
          }),
        },
      },
      tabs,
      windows,
    };
    const backgroundSource = readFileSync(
      join(process.cwd(), "browser-extension", "discogs-stats-helper", "background.js"),
      "utf8",
    );
    const scheduleTimeout = vi.fn();
    new Function("chrome", "setTimeout", backgroundSource)(chrome, scheduleTimeout);
    const receiveMessage = listeners[0];

    const firstResponse = vi.fn();
    receiveMessage(
      {
        releaseUrl: "https://www.discogs.com/release/1-First",
        token: "first-token",
        type: "record-scanner-discogs-helper-request",
      },
      { tab: { id: 1, windowId: 2 } },
      firstResponse,
    );

    await vi.waitFor(() => {
      expect(tabs.update).toHaveBeenCalledWith(
        20,
        expect.objectContaining({ url: expect.stringContaining("/release/1-First") }),
      );
    });
    expect(firstResponse).toHaveBeenCalledWith({ accepted: true, helperVersion: "0.3.0" });
    expect(windows.create).toHaveBeenCalledTimes(1);

    receiveMessage(
      {
        releaseUrl: "https://www.discogs.com/release/2-Second",
        token: "second-token",
        type: "record-scanner-discogs-helper-request",
      },
      { tab: { id: 1, windowId: 2 } },
      vi.fn(),
    );

    await vi.waitFor(() => {
      expect(tabs.update).toHaveBeenCalledWith(
        20,
        expect.objectContaining({ url: expect.stringContaining("/release/2-Second") }),
      );
    });
    expect(windows.create).toHaveBeenCalledTimes(1);

    receiveMessage(
      {
        stats: { medianPrice: { currency: "USD", value: 9 } },
        token: "first-token",
        type: "record-scanner-discogs-helper-result",
      },
      { tab: { id: 20, windowId: 10 } },
      vi.fn(),
    );
    await Promise.resolve();
    expect(tabs.sendMessage).not.toHaveBeenCalledWith(
      1,
      expect.objectContaining({ token: "first-token", type: "record-scanner-discogs-helper-result" }),
    );

    receiveMessage(
      {
        stats: { medianPrice: { currency: "USD", value: 12 } },
        token: "second-token",
        type: "record-scanner-discogs-helper-result",
      },
      { tab: { id: 20, windowId: 10 } },
      vi.fn(),
    );

    await vi.waitFor(() => {
      expect(windows.update).toHaveBeenCalledWith(2, { focused: true });
    });
    expect(tabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ token: "second-token", type: "record-scanner-discogs-helper-result" }),
    );
  });
});
