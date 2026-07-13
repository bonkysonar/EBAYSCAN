# Vercel Troubleshooting

## Node 24 serverless functions returning `A server error has occurred`

### Symptom

The browser reports an error such as:

```text
Unexpected token 'A', "A server e"... is not valid JSON
```

The JSON error is secondary. Vercel returned a plain-text function failure beginning with `A server error has occurred`, and the browser called `response.json()` on that response.

### Root cause

This project uses ESM (`"type": "module"`) and Vercel's Node 24 runtime. Runtime imports that cross TypeScript files in a serverless dependency graph must use the emitted `.js` filename:

```ts
// Correct for code executed by a Vercel function
import { parseDiscogsSalesStats } from "../lib/discogs/parseSalesStats.js";
```

An extensionless runtime import can pass `npm run build` because TypeScript is configured with `moduleResolution: "Bundler"` and `noEmit`, but then fail when Node loads the packaged serverless function. Type-only imports are erased and do not cause this runtime failure.

### Diagnosis

Check production function logs instead of treating the browser's JSON parser message as the root error:

```powershell
npx vercel logs --environment production --status-code 500 --since 30m --expand --no-branch
```

An ESM packaging failure appears as `ERR_MODULE_NOT_FOUND` and identifies the unresolved import and importing module.

Vercel marking a deployment `Ready` only confirms that it built and deployed; it does not prove every function can initialize. Always invoke the affected production endpoint after deployment.

### Repair and validation

1. Add `.js` to every runtime import in the failing serverless dependency chain, including nested imports.
2. Parse browser responses from text with a JSON guard so a hosting failure produces a useful endpoint/HTTP error instead of `Unexpected token`.
3. Run `npm test` and `npm run build`.
4. Deploy with `npx vercel deploy --prod --yes`.
5. Smoke-test through `https://ebayscan.vercel.app`, not only the generated deployment URL.
6. Check the new deployment's logs for fresh HTTP 500 responses.

The July 13, 2026 repair was deployed as `ebayscan-bmkgc020k-bonkysonars-projects.vercel.app` and aliased to production.

## Discogs page pulls and HTTP 403

The best-effort `POST /api/discogs/stats` function fetches one Discogs release page. Discogs may return a 403 browser challenge to Vercel even when the function itself is healthy. That is distinct from `FUNCTION_INVOCATION_FAILED`:

- Function/package failure: plain-text HTTP 500 from Vercel and an `ERR_MODULE_NOT_FOUND` or similar runtime log.
- Discogs browser challenge: structured JSON HTTP 502 from the application explaining that Discogs blocked the page fetch.

Do not attempt to bypass Discogs browser challenges. Use the Chrome helper or the manual import flow for sales statistics when Discogs blocks the server request. The official Discogs API can still provide release/marketplace metadata, but it does not supply the historical Low/Median/High values used by this workflow.

## Windows local Vercel build note

In the July 13 repair session, `npx vercel build --prod --yes` failed locally with `spawn cmd.exe ENOENT` even though `cmd.exe`, `npm test`, and `npm run build` all worked. Vercel's remote Linux builder completed successfully during `vercel deploy`. Treat this specific message as a local CLI process-launch issue, then rely on the remote build result plus production endpoint and log checks.
