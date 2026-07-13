import { describe, expect, it } from "vitest";
import { readJsonResponse } from "../lib/http/jsonResponse";

describe("readJsonResponse", () => {
  it("parses a JSON response", async () => {
    const response = new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

    await expect(readJsonResponse<{ status: string }>(response, "Test endpoint")).resolves.toEqual({ status: "ok" });
  });

  it("reports a useful error for a non-JSON server response", async () => {
    const response = new Response("A server error has occurred\n\nFUNCTION_INVOCATION_FAILED", { status: 500 });

    await expect(readJsonResponse(response, "Discogs stats endpoint")).rejects.toThrow(
      "Discogs stats endpoint returned a non-JSON response (HTTP 500): A server error has occurred FUNCTION_INVOCATION_FAILED",
    );
  });
});
