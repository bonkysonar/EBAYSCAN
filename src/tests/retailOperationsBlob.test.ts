import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, head, put, BlobNotFoundError } from "@vercel/blob";
import { retailOperations } from "../server/retailOperationsApi";
import { readCurrentPublicBlobJson, preservePublicBlobVersion, publicBlobVersionPath } from "../server/readCurrentPublicBlobJson";

vi.mock("@vercel/blob", async (original) => ({
  ...(await original<typeof import("@vercel/blob")>()),
  head:vi.fn(),
  get:vi.fn(),
  put:vi.fn(),
}));
beforeEach(() => { vi.mocked(get).mockResolvedValue(null); });
const originalToken=process.env.BLOB_READ_WRITE_TOKEN;
afterEach(()=>{
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=originalToken;
});
const metadata={url:"https://example.public.blob.vercel-storage.com/retail-operations/status.json",pathname:"retail-operations/status.json",uploadedAt:new Date("2026-09-05T01:38:35Z"),etag:'"published-version"',size:456,contentType:"application/json",contentDisposition:"inline",cacheControl:"public, max-age=60",downloadUrl:"https://example.public.blob.vercel-storage.com/retail-operations/status.json?download=1"};

describe("current public-blob workflow status",()=>{
  it("reads an immutable current version when the regional mutable CDN remains stale",async()=>{
    process.env.BLOB_READ_WRITE_TOKEN="test-token";
    vi.mocked(head).mockResolvedValue(metadata);
    vi.mocked(get).mockResolvedValue({statusCode:200,stream:new Response(JSON.stringify({status:"published"})).body,blob:{etag:metadata.etag}} as never);
    const stale=vi.fn(async()=>new Response(JSON.stringify({status:"research"}),{headers:{etag:'"old-regional-version"',age:"838"}}));
    vi.stubGlobal("fetch",stale);
    await expect(retailOperations("unused","GET",null)).resolves.toEqual({status:"published"});
    expect(get).toHaveBeenCalledWith(publicBlobVersionPath(metadata.pathname,metadata.etag),{access:"public"});
    expect(stale).not.toHaveBeenCalled();
  });
  it("rejects a mismatched immutable version instead of accepting its status",async()=>{
    vi.mocked(head).mockResolvedValue(metadata);
    vi.mocked(get).mockResolvedValue({statusCode:200,stream:new Response('{}').body,blob:{etag:'"wrong-version"'}} as never);
    await expect(readCurrentPublicBlobJson(metadata.pathname)).rejects.toMatchObject({statusCode:503});
  });
  it("preserves identical bytes without overwriting existing version files",async()=>{
    vi.mocked(put).mockResolvedValue({etag:metadata.etag} as never);
    const body='{"status":"published"}';
    await preservePublicBlobVersion(metadata.pathname,metadata.etag,body);
    expect(put).toHaveBeenCalledWith(publicBlobVersionPath(metadata.pathname,metadata.etag),body,expect.objectContaining({allowOverwrite:false,addRandomSuffix:false}));
  });
  it("permits an idempotent mirror retry only for identical bytes",async()=>{
    const body='{"status":"published"}';
    const conflict=new Error("Already exists");
    vi.mocked(put).mockRejectedValue(conflict);
    vi.mocked(get).mockResolvedValueOnce({statusCode:200,stream:new Response(body).body} as never);
    await expect(preservePublicBlobVersion(metadata.pathname,metadata.etag,body)).resolves.toBeUndefined();
    vi.mocked(get).mockResolvedValueOnce({statusCode:200,stream:new Response('{"status":"research"}').body} as never);
    await expect(preservePublicBlobVersion(metadata.pathname,metadata.etag,body)).rejects.toBe(conflict);
  });
  it("keeps feedback versions outside the feedback listing prefix",async()=>{
    const path=`retail-operations/feedback/${"a".repeat(64)}.json`;
    expect(publicBlobVersionPath(path,metadata.etag).startsWith("retail-operations/feedback/")).toBe(false);
    vi.mocked(put).mockResolvedValue({etag:metadata.etag} as never);
    await expect(preservePublicBlobVersion(path,metadata.etag,'{}')).resolves.toBeUndefined();
  });
  it("retains stale-run rejection when the previous status comes from its immutable version",async()=>{
    process.env.BLOB_READ_WRITE_TOKEN="test-token";
    const previousToken=process.env.ARBITRAGE_UPLOAD_TOKEN;
    process.env.ARBITRAGE_UPLOAD_TOKEN="upload-test";
    vi.mocked(head).mockResolvedValue(metadata);
    const now=Date.now();
    vi.mocked(get).mockResolvedValue({statusCode:200,stream:new Response(JSON.stringify({startedAt:new Date(now-1000).toISOString(),status:"research"})).body,blob:{etag:metadata.etag}} as never);
    try {
      await expect(retailOperations("unused","POST",{runId:"older-run",status:"published",startedAt:new Date(now-10000).toISOString()},"upload-test")).rejects.toMatchObject({statusCode:409});
      expect(put).not.toHaveBeenCalled();
    } finally {
      if(previousToken===undefined) delete process.env.ARBITRAGE_UPLOAD_TOKEN;
      else process.env.ARBITRAGE_UPLOAD_TOKEN=previousToken;
    }
  });
  it("uses the same version check for the mutable publication pointer",async()=>{
    const pointerMetadata={...metadata,url:"https://example.public.blob.vercel-storage.com/arbitrage-finds/latest.json",pathname:"arbitrage-finds/latest.json"};
    vi.mocked(head).mockResolvedValue(pointerMetadata);
    const fetchPointer=vi.fn(async()=>new Response(JSON.stringify({runId:"new-publication"}),{headers:{etag:metadata.etag}}));
    vi.stubGlobal("fetch",fetchPointer);
    await expect(readCurrentPublicBlobJson(pointerMetadata.pathname)).resolves.toMatchObject({etag:metadata.etag,value:{runId:"new-publication"}});
    expect(head).toHaveBeenCalledWith("arbitrage-finds/latest.json");
    expect(fetchPointer.mock.calls[0]).toBeDefined();
  });
  it("reads the stored published version instead of reusing a cached research response",async()=>{
    process.env.BLOB_READ_WRITE_TOKEN="test-token";
    vi.mocked(head).mockResolvedValue(metadata);
    const request=vi.fn(async(input:URL)=>{
      const current=input.searchParams.get("version")===`${metadata.uploadedAt.getTime()}-${metadata.etag}`;
      return new Response(JSON.stringify({status:current?"published":"research",updatedAt:current?"2026-09-05T01:38:34Z":"2026-09-05T01:37:22Z"}),{headers:{etag:current?metadata.etag:'"research-version"'}});
    });
    vi.stubGlobal("fetch",request);
    await expect(retailOperations("unused","GET",null)).resolves.toMatchObject({status:"published",updatedAt:"2026-09-05T01:38:34Z"});
    expect(head).toHaveBeenCalledWith("retail-operations/status.json");
    expect(request).toHaveBeenCalledWith(expect.any(URL),expect.objectContaining({cache:"no-store"}));
  });
  it("does not report stale research if the CDN has not propagated the stored version",async()=>{
    process.env.BLOB_READ_WRITE_TOKEN="test-token";
    vi.mocked(head).mockResolvedValue(metadata);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({status:"research"}),{headers:{etag:'"research-version"'}})));
    await expect(retailOperations("unused","GET",null)).rejects.toMatchObject({statusCode:503});
  });
  it("retains the unknown state for a status blob that has never been written",async()=>{
    process.env.BLOB_READ_WRITE_TOKEN="test-token";
    vi.mocked(head).mockRejectedValue(new BlobNotFoundError());
    await expect(retailOperations("unused","GET",null)).resolves.toEqual({status:"unknown"});
  });
});
