import { afterEach, describe, expect, it, vi } from "vitest";
import { head, BlobNotFoundError } from "@vercel/blob";
import { retailOperations } from "../server/retailOperationsApi";
import { readCurrentPublicBlobJson } from "../server/readCurrentPublicBlobJson";

vi.mock("@vercel/blob", async (original) => ({
  ...(await original<typeof import("@vercel/blob")>()),
  head:vi.fn(),
}));
const originalToken=process.env.BLOB_READ_WRITE_TOKEN;
afterEach(()=>{
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=originalToken;
});
const metadata={url:"https://example.public.blob.vercel-storage.com/retail-operations/status.json",pathname:"retail-operations/status.json",uploadedAt:new Date("2026-09-05T01:38:35Z"),etag:'"published-version"',size:456,contentType:"application/json",contentDisposition:"inline",cacheControl:"public, max-age=60",downloadUrl:"https://example.public.blob.vercel-storage.com/retail-operations/status.json?download=1"};

describe("current public-blob workflow status",()=>{
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
