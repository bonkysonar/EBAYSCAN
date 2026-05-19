(() => {
  const params = readHelperParams();
  if (params.get("recordScanner") !== "1") return;

  const mode = params.get("recordScannerMode");
  const origin = params.get("recordScannerOrigin");
  const token = params.get("recordScannerToken");
  if (!token) return;

  setTimeout(() => showHelperStatus("Record Scanner helper active. Checking Discogs stats before full page load..."), 50);

  waitForStatsAfterFixedDelay()
    .then((stats) => {
      showHelperStatus("Record Scanner helper found stats. Sending them back...");
      sendResult({ stats, token });
    })
    .catch((error) => {
      showHelperStatus(error instanceof Error ? error.message : "Discogs helper could not read stats.");
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

    chrome.runtime.sendMessage({
      ...message,
      recordScannerOrigin: origin,
    });

    if (mode === "background") return;

    if (origin && window.opener) {
      window.opener.postMessage(message, origin);
      showHelperStatus("Record Scanner helper sent stats back to the scanner window.");
      return;
    }

    showHelperStatus("Record Scanner helper sent stats through the extension bridge.");
    if (origin) {
      setTimeout(() => returnViaScannerStorage(origin, token, message), 350);
    }
  }

  async function waitForStatsAfterFixedDelay() {
    await sleep(500);

    const startedAt = Date.now();
    const timeoutMs = 6_000;

    while (Date.now() - startedAt < timeoutMs) {
      const stats = readStats();
      if (stats) return stats;
      await sleep(100);
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

  function readHelperParams() {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    return hashParams.get("recordScanner") ? hashParams : queryParams;
  }

  function returnViaScannerStorage(origin, token, message) {
    const url = new URL(origin);
    url.searchParams.set("recordScannerReturn", "1");
    url.searchParams.set("recordScannerToken", token);
    url.searchParams.set("recordScannerPayload", btoa(encodeURIComponent(JSON.stringify(message))));
    window.location.href = url.toString();
  }

  function showHelperStatus(message) {
    const existing = document.getElementById("record-scanner-helper-status");
    if (existing) {
      existing.textContent = message;
      return;
    }

    const box = document.createElement("div");
    box.id = "record-scanner-helper-status";
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
    const parent = document.documentElement || document.body;
    if (parent) {
      parent.appendChild(box);
      return;
    }

    setTimeout(() => showHelperStatus(message), 50);
  }
})();
