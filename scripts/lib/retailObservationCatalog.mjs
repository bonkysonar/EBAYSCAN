import { readFile } from "node:fs/promises";
import ts from "typescript";

// Match the scanner's checked-in catalog; this never adds or fetches a source.
export async function readRetailObservationCatalog() {
  const text = await readFile(new URL("../../src/lib/arbitrage/vinylShopSources.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const catalog = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
  return catalog.getActiveRetailSources().map(source => ({
    ...source, url: source.url ?? source.baseUrl,
  }));
}
