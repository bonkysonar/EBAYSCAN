(() => {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (
      event.data?.type !== "record-scanner-discogs-helper-request" &&
      event.data?.type !== "record-scanner-discogs-helper-choose-request" &&
      event.data?.type !== "record-scanner-discogs-helper-accept-current"
    ) return;

    const request = {
      releaseUrl: event.data.releaseUrl,
      token: event.data.token,
      type: event.data.type,
    };

    try {
      chrome.runtime.sendMessage(request, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          window.postMessage(
            {
              error: `Discogs helper bridge failed: ${lastError.message}`,
              token: request.token,
              type: "record-scanner-discogs-helper-result",
            },
            window.location.origin,
          );
          return;
        }

        window.postMessage(
          {
            message: response?.accepted ? "Discogs helper bridge connected." : "Discogs helper bridge sent request.",
            token: request.token,
            type: "record-scanner-discogs-helper-status",
          },
          window.location.origin,
        );
      });
    } catch (error) {
      window.postMessage(
        {
          error: error instanceof Error ? error.message : "Discogs helper bridge crashed before sending the request.",
          token: request.token,
          type: "record-scanner-discogs-helper-result",
        },
        window.location.origin,
      );
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "record-scanner-discogs-helper-result") return;
    window.postMessage(message, window.location.origin);
  });
})();
