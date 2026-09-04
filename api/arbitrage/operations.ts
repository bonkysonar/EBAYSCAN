import { retailOperations } from "../../src/server/retailOperationsApi.js";
export default async function handler(
  req: {
    method?: string;
    body?: unknown;
    query?: { action?: string };
    headers?: { authorization?: string };
  },
  res: {
    setHeader(name: string, value: string): void;
    status(code: number): { json(value: unknown): void };
  },
) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    res
      .status(200)
      .json(
        await retailOperations(
          process.cwd(),
          req.method ?? "GET",
          body,
          req.headers?.authorization?.replace(/^Bearer /, ""),
          req.query?.action ?? "status",
        ),
      );
  } catch (error) {
    res
      .status(
        typeof error === "object" && error && "statusCode" in error
          ? Number(error.statusCode)
          : 500,
      )
      .json({
        error: error instanceof Error ? error.message : "Operation failed",
      });
  }
}
