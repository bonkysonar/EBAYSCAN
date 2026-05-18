(() => {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "record-scanner-discogs-helper-request") return;

    chrome.runtime.sendMessage({
      releaseUrl: event.data.releaseUrl,
      token: event.data.token,
      type: "record-scanner-discogs-helper-request",
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "record-scanner-discogs-helper-result") return;
    window.postMessage(message, window.location.origin);
  });
})();
