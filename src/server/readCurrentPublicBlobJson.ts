import { head, BlobNotFoundError } from "@vercel/blob";

/** Read a mutable public JSON blob using its current control-plane version. */
export async function readCurrentPublicBlobJson(pathname: string): Promise<{etag:string;url:string;value:unknown}|null> {
  let metadata;
  try { metadata=await head(pathname); }
  catch(error) { if(error instanceof BlobNotFoundError) return null; throw error; }
  // Public get() ignores useCache:false. A versioned URL avoids reusing the
  // application fetch cache; the ETag guard also detects delayed CDN propagation.
  const url=new URL(metadata.url);
  url.searchParams.set("version",`${metadata.uploadedAt.getTime()}-${metadata.etag}`);
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw Object.assign(new Error("Scanner storage is temporarily unavailable."),{statusCode:502});
  if(metadata.etag && response.headers.get("etag")!==metadata.etag)
    throw Object.assign(new Error("The latest scanner data is still propagating. Retry shortly."),{statusCode:503});
  return {etag:metadata.etag,url:metadata.url,value:await response.json()};
}
