import { createHash } from "node:crypto";
import { get, head, put, BlobNotFoundError } from "@vercel/blob";

const isVersionedPath = (pathname: string) => pathname === "arbitrage-finds/latest.json" ||
  /^retail-operations\/(?:status|feedback\/[a-f0-9]{64}|metrics\/[a-z0-9._-]+)\.json$/i.test(pathname);
export function publicBlobVersionPath(pathname: string, etag: string): string {
  const separator = pathname.indexOf("/");
  return `${pathname.slice(0, separator)}/.versions/${pathname.slice(separator + 1)}/${createHash("sha256").update(etag).digest("hex")}.json`;
}

/** Preserve the exact bytes of a successfully stored version at a new pathname. */
export async function preservePublicBlobVersion(pathname: string, etag: string, body: string): Promise<void> {
  if (!isVersionedPath(pathname) || !etag) throw new Error("Invalid versioned scanner blob.");
  const versionPath = publicBlobVersionPath(pathname, etag);
  try {
    await put(versionPath, body, {
      access: "public", addRandomSuffix: false, allowOverwrite: false,
      contentType: "application/json", cacheControlMaxAge: 31_536_000,
    });
  } catch (error) {
    // Repeating a successful write is safe only if the immutable bytes match.
    const existing = await get(versionPath, { access: "public" });
    if (existing?.statusCode === 200 && existing.stream && await new Response(existing.stream).text() === body) return;
    throw error;
  }
}

/** Read a mutable public JSON blob using its current control-plane version. */
export async function readCurrentPublicBlobJson(pathname: string): Promise<{etag:string;url:string;value:unknown}|null> {
  let metadata;
  try { metadata=await head(pathname); }
  catch(error) { if(error instanceof BlobNotFoundError) return null; throw error; }
  if (isVersionedPath(pathname) && metadata.etag) {
    const immutable = await get(publicBlobVersionPath(pathname, metadata.etag), { access: "public" });
    if (immutable) {
      if (immutable.statusCode !== 200 || !immutable.stream || immutable.blob.etag !== metadata.etag)
        throw Object.assign(new Error("Scanner storage version failed validation."), {statusCode: 503});
      return {etag:metadata.etag,url:metadata.url,value:await new Response(immutable.stream).json()};
    }
  }
  // Public get() ignores useCache:false. A versioned URL avoids reusing the
  // application fetch cache; the ETag guard also detects delayed CDN propagation.
  const url=new URL(metadata.url);
  url.searchParams.set("version",`${metadata.uploadedAt.getTime()}-${metadata.etag}`);
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw Object.assign(new Error("Scanner storage is temporarily unavailable."),{statusCode:502});
  if(metadata.etag && response.headers.get("etag")!==metadata.etag) {
    console.error("Scanner blob version mismatch", {
      pathname, expectedEtag: metadata.etag, receivedEtag: response.headers.get("etag"),
      uploadedAt: metadata.uploadedAt.toISOString(), age: response.headers.get("age"),
      contentEncoding: response.headers.get("content-encoding"),
    });
    throw Object.assign(new Error("The latest scanner data is still propagating. Retry shortly."),{statusCode:503});
  }
  return {etag:metadata.etag,url:metadata.url,value:await response.json()};
}
