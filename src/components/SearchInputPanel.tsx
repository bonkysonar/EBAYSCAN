import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import type { SearchInput } from "../lib/ebay/types";

type Props = {
  isSearching: boolean;
  onSearch: (input: SearchInput) => void;
};

export function SearchInputPanel({ isSearching, onSearch }: Props) {
  const [barcode, setBarcode] = useState("");
  const [catalogNumber, setCatalogNumber] = useState("");
  const [query, setQuery] = useState("");
  const barcodeRef = useRef<HTMLInputElement>(null);

  function runBarcodeSearch() {
    const value = barcode.trim();
    if (!value) return;
    onSearch({ type: "barcode", barcode: value });
    setBarcode("");
    barcodeRef.current?.focus();
  }

  function runCatalogSearch() {
    const value = catalogNumber.trim();
    if (!value) return;
    onSearch({ type: "catalog", catalogNumber: value });
  }

  function runManualSearch() {
    const value = query.trim();
    if (!value) return;
    onSearch({ type: "manual", query: value });
  }

  function submitBarcode(event: FormEvent) {
    event.preventDefault();
    runBarcodeSearch();
  }

  function submitCatalog(event: FormEvent) {
    event.preventDefault();
    runCatalogSearch();
  }

  function submitManual(event: FormEvent) {
    event.preventDefault();
    runManualSearch();
  }

  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>, submit: () => void) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  }

  async function submitImage(file: File | undefined) {
    if (!file) return;
    const imageBase64 = await fileToBase64(file);
    onSearch({ type: "image", imageBase64, fileName: file.name });
  }

  return (
    <section className="search-panel">
      <h2>Lookup</h2>
      <form className="input-group scanner-group" onSubmit={submitBarcode}>
        <label htmlFor="barcode">Barcode scanner input</label>
        <input
          ref={barcodeRef}
          id="barcode"
          autoFocus
          value={barcode}
          inputMode="numeric"
          placeholder="Scan or type barcode, then Enter"
          onChange={(event) => setBarcode(event.target.value)}
          onKeyDown={(event) => submitOnEnter(event, runBarcodeSearch)}
        />
        <button type="submit" disabled={isSearching}>Scan</button>
      </form>

      <form className="input-group" onSubmit={submitCatalog}>
        <label htmlFor="catalog">Catalog number</label>
        <input
          id="catalog"
          value={catalogNumber}
          autoCapitalize="characters"
          placeholder="Example: 60296-1, ST-A-691671, B0021234-01"
          onChange={(event) => setCatalogNumber(event.target.value)}
          onKeyDown={(event) => submitOnEnter(event, runCatalogSearch)}
        />
        <button type="submit" disabled={isSearching}>Catalog Search</button>
        <p className="hint">Catalog numbers can overlap, so mixed matches should stay YELLOW unless the evidence is very clean.</p>
      </form>

      <form className="input-group" onSubmit={submitManual}>
        <label htmlFor="manual">Manual artist / title search</label>
        <input
          id="manual"
          value={query}
          placeholder="Example: blue note mono original"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => submitOnEnter(event, runManualSearch)}
        />
        <button type="submit" disabled={isSearching}>Search</button>
      </form>

      <div className="input-group">
        <label htmlFor="image">Cover image placeholder</label>
        <input id="image" type="file" accept="image/*" capture="environment" onChange={(event) => submitImage(event.target.files?.[0])} />
        <p className="hint">Uses mock data for now; real eBay image search belongs behind the same client interface.</p>
      </div>
    </section>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
