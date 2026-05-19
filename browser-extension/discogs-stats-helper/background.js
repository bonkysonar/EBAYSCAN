const pendingRequests = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "record-scanner-discogs-helper-request") {
    sendResponse({ accepted: true });
    openDiscogsTab(message, sender);
    return true;
  }

  if (message?.type === "record-scanner-discogs-helper-result") {
    completeRequest(message, sender);
  }
});

async function openDiscogsTab(message, sender) {
  const appTabId = sender.tab?.id;
  if (!appTabId || !message.releaseUrl || !message.token) return;

  try {
    const url = new URL(message.releaseUrl);
    if (url.hostname !== "www.discogs.com" && url.hostname !== "discogs.com") {
      throw new Error("Record Scanner helper only opens Discogs URLs.");
    }

    url.hash = new URLSearchParams({
      recordScanner: "1",
      recordScannerMode: "background",
      recordScannerToken: message.token,
    }).toString();

    const tab = await chrome.tabs.create({ active: false, url: url.toString() });
    pendingRequests.set(message.token, {
      appTabId,
      helperTabId: tab.id,
      startedAt: Date.now(),
    });

    setTimeout(() => expireRequest(message.token), 20_000);
  } catch (error) {
    chrome.tabs.sendMessage(appTabId, {
      error: error instanceof Error ? error.message : "Discogs helper could not open the release.",
      token: message.token,
      type: "record-scanner-discogs-helper-result",
    });
  }
}

async function completeRequest(message, sender) {
  const request = pendingRequests.get(message.token);
  if (!request) return;

  pendingRequests.delete(message.token);
  await chrome.tabs.sendMessage(request.appTabId, message);

  const helperTabId = sender.tab?.id || request.helperTabId;
  if (helperTabId) {
    chrome.tabs.remove(helperTabId).catch(() => undefined);
  }
}

async function expireRequest(token) {
  const request = pendingRequests.get(token);
  if (!request) return;

  pendingRequests.delete(token);
  await chrome.tabs.sendMessage(request.appTabId, {
    error: "Discogs helper timed out before it could read the sales stats.",
    token,
    type: "record-scanner-discogs-helper-result",
  });

  if (request.helperTabId) {
    chrome.tabs.remove(request.helperTabId).catch(() => undefined);
  }
}
