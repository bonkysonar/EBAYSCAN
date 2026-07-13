const pendingRequests = new Map();
const HELPER_SESSION_KEY = "recordScannerDiscogsHelperSession";
const PENDING_REQUESTS_KEY = "recordScannerDiscogsPendingRequests";
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const STORED_REQUEST_MAX_AGE_MS = 10 * 60 * 1000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "record-scanner-discogs-helper-request") {
    sendResponse({
      accepted: true,
      helperVersion: chrome.runtime.getManifest().version,
    });
    void openDiscogsWindow(message, sender);
    return;
  }

  if (message?.type === "record-scanner-discogs-helper-choose-request") {
    sendResponse({
      accepted: true,
      helperVersion: chrome.runtime.getManifest().version,
    });
    void openDiscogsChoiceWindow(message, sender);
    return;
  }

  if (message?.type === "record-scanner-discogs-helper-accept-current") {
    sendResponse({ accepted: true });
    void acceptCurrentDiscogsChoice(message, sender);
    return;
  }

  if (message?.type === "record-scanner-discogs-helper-attention") {
    void handleHelperAttention(message);
    return;
  }

  if (message?.type === "record-scanner-discogs-helper-result") {
    void completeRequest(message, sender);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearHelperSessionForTab(tabId);
});

async function openDiscogsWindow(message, sender) {
  const appTabId = sender.tab?.id;
  const appWindowId = sender.tab?.windowId;
  if (!appTabId || !message.releaseUrl || !message.token) return;

  try {
    const url = buildDiscogsUrl(message.releaseUrl, {
      recordScanner: "1",
      recordScannerMode: "background",
      recordScannerToken: message.token,
    });
    const { created, tab } = await getOrCreateHelperTab();
    if (!tab.id || tab.windowId === undefined) {
      throw new Error("Discogs helper window did not create a usable tab.");
    }

    const request = {
      appTabId,
      appWindowId,
      helperTabId: tab.id,
      helperWindowId: tab.windowId,
      startedAt: Date.now(),
    };
    await clearPendingRequestsForHelperTab(tab.id);
    await savePendingRequest(message.token, request);
    await chrome.tabs.update(tab.id, { active: true, url });

    if (created) {
      await focusHelperWindow(request);
    }

    await sendStatus(
      request,
      message.token,
      created
        ? "Discogs helper window opened. Complete the browser check if Discogs asks; scanning will resume automatically."
        : "Reusing the Discogs helper window for this record.",
    );
    setTimeout(() => void expireRequest(message.token), REQUEST_TIMEOUT_MS);
  } catch (error) {
    await sendResultToApp(appTabId, {
      error: error instanceof Error ? error.message : "Discogs helper could not open the release.",
      token: message.token,
      type: "record-scanner-discogs-helper-result",
    });
  }
}

async function openDiscogsChoiceWindow(message, sender) {
  const appTabId = sender.tab?.id;
  const appWindowId = sender.tab?.windowId;
  if (!appTabId || !message.releaseUrl || !message.token) return;

  try {
    const url = buildDiscogsUrl(message.releaseUrl, {
      recordScanner: "1",
      recordScannerMode: "choose",
      recordScannerToken: message.token,
    });
    const { tab } = await getOrCreateHelperTab();
    if (!tab.id || tab.windowId === undefined) {
      throw new Error("Discogs helper window did not create a usable tab.");
    }

    const request = {
      appTabId,
      appWindowId,
      helperTabId: tab.id,
      helperWindowId: tab.windowId,
      startedAt: Date.now(),
    };
    await clearPendingRequestsForHelperTab(tab.id);
    await savePendingRequest(message.token, request);
    await chrome.tabs.update(tab.id, { active: true, url });
    await focusHelperWindow(request);
    await sendStatus(
      request,
      message.token,
      "Discogs chooser opened in the reusable helper window. Navigate to the correct pressing, then return and click Accept New Pressing.",
    );
  } catch (error) {
    await sendResultToApp(appTabId, {
      error: error instanceof Error ? error.message : "Discogs chooser could not open the release.",
      token: message.token,
      type: "record-scanner-discogs-helper-result",
    });
  }
}

async function acceptCurrentDiscogsChoice(message, sender) {
  const request = await getPendingRequest(message.token);
  const appTabId = sender.tab?.id || request?.appTabId;
  if (!request?.helperTabId) {
    if (appTabId) {
      await sendResultToApp(appTabId, {
        error: "Discogs chooser window was not found. Click Manually Choose Pressing again.",
        token: message.token,
        type: "record-scanner-discogs-helper-result",
      });
    }
    return;
  }

  try {
    await chrome.tabs.sendMessage(request.helperTabId, {
      token: message.token,
      type: "record-scanner-discogs-helper-choose-current",
    });
  } catch (error) {
    await sendResultToApp(request.appTabId, {
      error: error instanceof Error ? error.message : "Discogs chooser could not read the selected pressing.",
      token: message.token,
      type: "record-scanner-discogs-helper-result",
    });
  }
}

async function handleHelperAttention(message) {
  const request = await getPendingRequest(message.token);
  if (!request) return;

  await sendStatus(
    request,
    message.token,
    message.message || "Discogs needs attention in the helper window.",
  );
  await focusHelperWindow(request);
}

async function completeRequest(message, sender) {
  const request = await getPendingRequest(message.token);
  if (!request) return;

  await removePendingRequest(message.token);
  await sendResultToApp(request.appTabId, message);

  if (message.error) {
    await focusHelperWindow({
      ...request,
      helperTabId: sender.tab?.id || request.helperTabId,
    });
    return;
  }

  await returnFocusToScanner(request);
}

async function expireRequest(token) {
  const request = await getPendingRequest(token);
  if (!request || Date.now() - request.startedAt < REQUEST_TIMEOUT_MS) return;

  await removePendingRequest(token);
  await sendResultToApp(request.appTabId, {
    error: "Discogs helper timed out. Finish any browser check in the reusable helper window, then retry this record.",
    token,
    type: "record-scanner-discogs-helper-result",
  });
  await focusHelperWindow(request);
}

function buildDiscogsUrl(releaseUrl, hashValues) {
  const url = new URL(releaseUrl);
  if (url.hostname !== "www.discogs.com" && url.hostname !== "discogs.com") {
    throw new Error("Record Scanner helper only opens Discogs URLs.");
  }
  url.hash = new URLSearchParams(hashValues).toString();
  return url.toString();
}

async function getOrCreateHelperTab() {
  const stored = (await chrome.storage.session.get(HELPER_SESSION_KEY))[HELPER_SESSION_KEY];
  if (stored?.tabId) {
    try {
      const tab = await chrome.tabs.get(stored.tabId);
      return { created: false, tab };
    } catch {
      await chrome.storage.session.remove(HELPER_SESSION_KEY);
    }
  }

  const helperWindow = await chrome.windows.create({
    focused: true,
    height: 820,
    type: "popup",
    url: "about:blank",
    width: 1000,
  });
  const tab = helperWindow.tabs?.[0] ?? (await chrome.tabs.query({ windowId: helperWindow.id }))[0];
  if (!tab?.id || helperWindow.id === undefined) {
    throw new Error("Chrome did not return the Discogs helper window tab.");
  }

  await chrome.storage.session.set({
    [HELPER_SESSION_KEY]: {
      tabId: tab.id,
      windowId: helperWindow.id,
    },
  });
  return { created: true, tab };
}

async function savePendingRequest(token, request) {
  pendingRequests.set(token, request);
  const stored = (await chrome.storage.session.get(PENDING_REQUESTS_KEY))[PENDING_REQUESTS_KEY] || {};
  const cutoff = Date.now() - STORED_REQUEST_MAX_AGE_MS;
  for (const [storedToken, storedRequest] of Object.entries(stored)) {
    if (!storedRequest?.startedAt || storedRequest.startedAt < cutoff) {
      delete stored[storedToken];
    }
  }
  stored[token] = request;
  await chrome.storage.session.set({ [PENDING_REQUESTS_KEY]: stored });
}

async function getPendingRequest(token) {
  if (pendingRequests.has(token)) return pendingRequests.get(token);
  const stored = (await chrome.storage.session.get(PENDING_REQUESTS_KEY))[PENDING_REQUESTS_KEY] || {};
  const request = stored[token];
  if (request) pendingRequests.set(token, request);
  return request;
}

async function removePendingRequest(token) {
  pendingRequests.delete(token);
  const stored = (await chrome.storage.session.get(PENDING_REQUESTS_KEY))[PENDING_REQUESTS_KEY] || {};
  delete stored[token];
  await chrome.storage.session.set({ [PENDING_REQUESTS_KEY]: stored });
}

async function clearPendingRequestsForHelperTab(helperTabId) {
  const stored = (await chrome.storage.session.get(PENDING_REQUESTS_KEY))[PENDING_REQUESTS_KEY] || {};
  for (const [token, request] of Object.entries(stored)) {
    if (request?.helperTabId === helperTabId) {
      pendingRequests.delete(token);
      delete stored[token];
    }
  }
  await chrome.storage.session.set({ [PENDING_REQUESTS_KEY]: stored });
}

async function clearHelperSessionForTab(tabId) {
  const stored = (await chrome.storage.session.get(HELPER_SESSION_KEY))[HELPER_SESSION_KEY];
  if (stored?.tabId === tabId) {
    await chrome.storage.session.remove(HELPER_SESSION_KEY);
  }
  await clearPendingRequestsForHelperTab(tabId);
}

async function sendStatus(request, token, message) {
  await sendResultToApp(request.appTabId, {
    message,
    token,
    type: "record-scanner-discogs-helper-status",
  });
}

async function sendResultToApp(appTabId, message) {
  try {
    await chrome.tabs.sendMessage(appTabId, message);
  } catch {
    // The scanner tab may have been closed while Discogs was loading.
  }
}

async function focusHelperWindow(request) {
  try {
    if (request.helperTabId) {
      await chrome.tabs.update(request.helperTabId, { active: true });
    }
    if (request.helperWindowId !== undefined) {
      await chrome.windows.update(request.helperWindowId, { focused: true });
    }
  } catch {
    // The user may have closed the helper window between messages.
  }
}

async function returnFocusToScanner(request) {
  try {
    await chrome.tabs.update(request.appTabId, { active: true });
    if (request.appWindowId !== undefined) {
      await chrome.windows.update(request.appWindowId, { focused: true });
    }
  } catch {
    // The scanner tab may no longer exist.
  }
}
