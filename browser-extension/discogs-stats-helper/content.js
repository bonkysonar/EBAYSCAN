(() => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, "") || window.location.search);
  const storedChoice = readStoredChoice();
  const isRecordScannerPage = params.get("recordScanner") === "1";
  if (!isRecordScannerPage && !storedChoice) return;

  const mode = params.get("recordScannerMode") || storedChoice?.mode;
  const origin = params.get("recordScannerOrigin") || storedChoice?.origin;
  const token = params.get("recordScannerToken") || storedChoice?.token;
  if (!token) return;

  if (isRecordScannerPage) {
    storeChoice({ mode, origin, token });
  }

  if (mode === "choose") {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "record-scanner-discogs-helper-choose-current") return;
      if (message?.token !== token) return;
      sendCurrentPressing(token);
    });
    return;
  }

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
      return;
    }

    chrome.runtime.sendMessage(message);
  }

  function sendCurrentPressing(token) {
    const stats = readStats() || undefined;
    sendResult({
      matchedTitle: readReleaseTitle(),
      releaseId: readReleaseId(),
      releaseUrl: window.location.href.split("#")[0],
      stats,
      token,
    });
  }

  function readStoredChoice() {
    try {
      const parsed = JSON.parse(window.name || "{}");
      return parsed?.recordScannerDiscogsChoice || null;
    } catch {
      return null;
    }
  }

  function storeChoice(choice) {
    try {
      const parsed = JSON.parse(window.name || "{}");
      window.name = JSON.stringify({
        ...parsed,
        recordScannerDiscogsChoice: choice,
      });
    } catch {
      window.name = JSON.stringify({ recordScannerDiscogsChoice: choice });
    }
  }

  async function waitForStats() {
    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    let attentionSent = false;

    while (Date.now() - startedAt < timeoutMs) {
      const stats = readStats();
      if (stats) return stats;

      if (!attentionSent && (looksLikeBrowserChallenge() || Date.now() - startedAt >= 15_000)) {
        attentionSent = true;
        sendAttention(
          looksLikeBrowserChallenge()
            ? "Discogs needs browser verification in the helper window. Complete it once; this lookup will continue automatically."
            : "Discogs is open but its sales statistics are not visible yet. Check the reusable helper window.",
        );
      }
      await sleep(250);
    }

    throw new Error("Discogs helper could not find Last Sold / Low / Median / High on this page.");
  }

  function sendAttention(message) {
    const payload = {
      message,
      token,
      type: "record-scanner-discogs-helper-attention",
    };

    if (mode === "background") {
      chrome.runtime.sendMessage(payload);
      return;
    }

    if (origin && window.opener) {
      window.opener.postMessage(
        {
          ...payload,
          type: "record-scanner-discogs-helper-status",
        },
        origin,
      );
    }
  }

  function looksLikeBrowserChallenge() {
    if (document.querySelector('iframe[src*="challenges.cloudflare.com"], #challenge-running, .cf-challenge')) {
      return true;
    }

    const pageText = `${document.title} ${document.body?.textContent || ""}`.slice(0, 10_000);
    return /checking your browser|enable javascript and cookies|performing security verification|verify you are human|just a moment/i.test(
      pageText,
    );
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

  function readReleaseTitle() {
    const heading = document.querySelector("h1");
    return (heading?.textContent || document.title || "").replace(/\s+/g, " ").trim();
  }

  function readReleaseId() {
    const match = window.location.pathname.match(/\/release\/(\d+)/);
    return match ? Number(match[1]) : undefined;
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
})();
