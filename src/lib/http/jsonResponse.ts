export async function readJsonResponse<T>(response: Response, endpointLabel: string): Promise<T> {
  const body = await response.text();

  if (!body) {
    throw new Error(`${endpointLabel} returned an empty response (HTTP ${response.status}).`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    const preview = body.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(`${endpointLabel} returned a non-JSON response (HTTP ${response.status}): ${preview}`);
  }
}
