import { FormEvent, KeyboardEvent, RefObject, useEffect, useRef, useState } from "react";
import type { ListingConditionFilter, SearchInput } from "../lib/ebay/types";

type Props = {
  isSearching: boolean;
  onSearch: (input: SearchInput) => void;
};

export function SearchInputPanel({ isSearching, onSearch }: Props) {
  const [barcode, setBarcode] = useState("");
  const [catalogNumber, setCatalogNumber] = useState("");
  const [query, setQuery] = useState("");
  const [conditionFilter, setConditionFilter] = useState<ListingConditionFilter>("used");
  const [isSpeedMode, setIsSpeedMode] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const catalogRef = useRef<HTMLInputElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const lastEntryRef = useRef<RefObject<HTMLInputElement | null>>(barcodeRef);
  const wasSearchingRef = useRef(false);

  useEffect(() => {
    function refocusLastEntry() {
      focusNextEntry(lastEntryRef.current, true);
    }

    window.addEventListener("record-scanner-refocus-last-input", refocusLastEntry);
    return () => window.removeEventListener("record-scanner-refocus-last-input", refocusLastEntry);
  }, []);

  useEffect(() => {
    if (!isSpeedMode) return;
    barcodeRef.current?.focus();
    barcodeRef.current?.select();
  }, [isSpeedMode]);

  useEffect(() => {
    if (isSpeedMode && wasSearchingRef.current && !isSearching) {
      barcodeRef.current?.focus();
      barcodeRef.current?.select();
    }

    wasSearchingRef.current = isSearching;
  }, [isSearching, isSpeedMode]);

  function runBarcodeSearch() {
    const value = barcode.trim();
    if (!value) return;
    lastEntryRef.current = barcodeRef;
    onSearch({ type: "barcode", barcode: value, conditionFilter });
    setBarcode("");
    focusNextEntry(barcodeRef, true);
  }

  function runCatalogSearch() {
    const value = catalogNumber.trim();
    if (!value || isSpeedMode) return;
    lastEntryRef.current = catalogRef;
    onSearch({ type: "catalog", catalogNumber: value, conditionFilter });
    setCatalogNumber("");
    focusNextEntry(catalogRef, true);
  }

  function runManualSearch() {
    const value = query.trim();
    if (!value || isSpeedMode) return;
    lastEntryRef.current = manualRef;
    onSearch({ type: "manual", query: value, conditionFilter });
    setQuery("");
    focusNextEntry(manualRef, true);
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
    if (!file || isSpeedMode) return;
    const imageBase64 = await fileToBase64(file);
    onSearch({ type: "image", imageBase64, fileName: file.name, conditionFilter });
  }

  return (
    <section className={`search-panel ${isSpeedMode ? "speed-mode-active" : ""}`}>
      <div className="lookup-heading">
        <h2>Lookup</h2>
        <label className="speed-toggle">
          <input type="checkbox" checked={isSpeedMode} onChange={(event) => setIsSpeedMode(event.target.checked)} />
          Speed Mode
        </label>
      </div>
      {isSpeedMode ? <p className="speed-mode-note">Barcode-only. Scan, glance, scan again.</p> : null}

      <fieldset className="condition-filter">
        <legend>Condition</legend>
        <label>
          <input
            type="radio"
            name="condition-filter"
            value="used"
            checked={conditionFilter === "used"}
            onChange={() => setConditionFilter("used")}
          />
          Used
        </label>
        <label>
          <input
            type="radio"
            name="condition-filter"
            value="new"
            checked={conditionFilter === "new"}
            onChange={() => setConditionFilter("new")}
          />
          New
        </label>
        <label>
          <input
            type="radio"
            name="condition-filter"
            value="both"
            checked={conditionFilter === "both"}
            onChange={() => setConditionFilter("both")}
          />
          Both
        </label>
      </fieldset>

      <form className="input-group scanner-group" onSubmit={submitBarcode}>
        <label htmlFor="barcode">Barcode scanner input</label>
        <input
          ref={barcodeRef}
          id="barcode"
          autoFocus
          value={barcode}
          inputMode="numeric"
          placeholder={isSpeedMode ? "Speed mode: scan barcode" : "Scan or type barcode, then Enter"}
          onChange={(event) => setBarcode(event.target.value)}
          onKeyDown={(event) => submitOnEnter(event, runBarcodeSearch)}
        />
        <button type="submit" disabled={isSearching}>Scan</button>
      </form>

      <form className="input-group" onSubmit={submitCatalog}>
        <label htmlFor="catalog">Catalog number</label>
        <input
          ref={catalogRef}
          id="catalog"
          disabled={isSpeedMode}
          value={catalogNumber}
          autoCapitalize="characters"
          placeholder="Example: 60296-1, ST-A-691671, B0021234-01"
          onChange={(event) => setCatalogNumber(event.target.value)}
          onKeyDown={(event) => submitOnEnter(event, runCatalogSearch)}
        />
        <button type="submit" disabled={isSearching || isSpeedMode}>Catalog Search</button>
        <p className="hint">Catalog numbers can overlap, so mixed matches should stay YELLOW unless the evidence is very clean.</p>
      </form>

      <form className="input-group" onSubmit={submitManual}>
        <label htmlFor="manual">Manual artist / title search</label>
        <input
          ref={manualRef}
          id="manual"
          disabled={isSpeedMode}
          value={query}
          placeholder="Example: blue note mono original"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => submitOnEnter(event, runManualSearch)}
        />
        <button type="submit" disabled={isSearching || isSpeedMode}>Search</button>
      </form>

      <div className="input-group">
        <label htmlFor="image">Cover image placeholder</label>
        <input
          id="image"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={isSpeedMode}
          onChange={(event) => submitImage(event.target.files?.[0])}
        />
        <p className="hint">Uses mock data for now; real eBay image search belongs behind the same client interface.</p>
      </div>
    </section>
  );
}

function focusNextEntry(ref: RefObject<HTMLInputElement | null>, focusWindow = false) {
  window.requestAnimationFrame(() => {
    if (focusWindow) window.focus();
    ref.current?.focus();
    ref.current?.select();
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
