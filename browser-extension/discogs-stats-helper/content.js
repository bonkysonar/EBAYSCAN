(() => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, "") || window.location.search);
  if (params.get("recordScanner") !== "1") return;

  const mode = params.get("recordScannerMode");
  const origin = params.get("recordScannerOrigin");
  const token = params.get("recordScannerToken");
  if (!token) return;

  waitForStats()
    .then((stats) => {
      sendResult({ stats, token });
    })
    .catch((error) => {
      sendResult({
        error: error instanceof Error ? error.message : "Discogs helper could not read stats.",
        token,
      });
    });

  function sendResult(result) {
    const message = {
      ...result,
      stats: result.stats
        ? {
            ...result.stats,
            importedAt: new Date().toISOString(),
            source: "browser_extension",
          }
        : undefined,
      type: "record-scanner-discogs-helper-result",
    };

    if (mode === "background") {
      chrome.runtime.sendMessage(message);
      return;
    }

    if (origin && window.opener) {
      window.opener.postMessage(message, origin);
    }

    // If Discogs or Chrome severs window.opener, leave a visible breadcrumb for debugging
    // instead of failing silently inside the helper popup.
    if (origin && !window.opener) {
      showHelperStatus("Record Scanner helper could not reach the opener window.");
    }
  }

  async function waitForStats() {
    const startedAt = Date.now();
    const timeoutMs = 12_000;

    while (Date.now() - startedAt < timeoutMs) {
      const stats = readStats();
      if (stats) return stats;
      await sleep(250);
    }

    throw new Error("Discogs helper could not find Last Sold / Low / Median / High on this page.");
  }

  function readStats() {
    const root = document.querySelector("#release-stats") || findStatsHeadingBlock();
    const text = normalizeText(root ? root.textContent || "" : document.body.textContent || "");
    const lastSold = matchValue(text, /last\s+sold\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i);
    const lowPrice = matchMoney(text, /low\s*:?\s*(\$?\s*\d+(?:\.\d{1,2})?)/i);
    const medianPrice = matchMoney(text, /median\s*:?\s*(\$?\s*\d+(?:\.\d{1,2})?)/i);
    const highPrice = matchMoney(text, /high\s*:?\s*(\$?\s*\d+(?:\.\d{1,2})?)/i);

    if (!lastSold && !lowPrice && !medianPrice && !highPrice) return null;

    return {
      highPrice,
      lastSold,
      lowPrice,
      medianPrice,
    };
  }

  function findStatsHeadingBlock() {
    const heading = [...document.querySelectorAll("h2, h3, section, div")].find((element) =>
      /^statistics$/i.test((element.textContent || "").trim()),
    );
    return heading?.closest("section") || heading?.parentElement || null;
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function matchValue(text, pattern) {
    return text.match(pattern)?.[1]?.trim();
  }

  function matchMoney(text, pattern) {
    const raw = matchValue(text, pattern);
    if (!raw) return undefined;

    const value = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(value)) return undefined;

    return { currency: "USD", value: Math.round(value * 100) / 100 };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function showHelperStatus(message) {
    const box = document.createElement("div");
    box.textContent = message;
    box.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "top:12px",
      "right:12px",
      "max-width:360px",
      "padding:12px",
      "background:#fff8dc",
      "border:2px solid #b45309",
      "border-radius:10px",
      "color:#111827",
      "font:14px/1.4 sans-serif",
      "box-shadow:0 12px 30px rgba(0,0,0,.2)",
    ].join(";");
    document.documentElement.appendChild(box);
  }
})();
