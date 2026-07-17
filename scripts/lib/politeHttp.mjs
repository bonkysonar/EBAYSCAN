const DEFAULT_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function createPoliteFetcher(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maxConcurrency = positiveInteger(options.maxConcurrency, 6);
  const maxPerHost = positiveInteger(options.maxPerHost, 1);
  const minHostDelayMs = nonNegativeNumber(options.minHostDelayMs, 200);
  const maxRetries = nonNegativeInteger(options.maxRetries, 2);
  const baseRetryDelayMs = nonNegativeNumber(options.baseRetryDelayMs, 350);
  const maxRetryDelayMs = nonNegativeNumber(options.maxRetryDelayMs, 30_000);
  const requestTimeoutMs = nonNegativeNumber(options.requestTimeoutMs, 0);
  const retryStatuses = options.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const queue = [];
  const hostState = new Map();
  let active = 0;
  let scheduled = false;

  return function politeFetch(url, init) {
    const host = hostFor(url);
    return new Promise((resolve, reject) => {
      queue.push({ host, init, reject, resolve, url });
      schedule();
    });
  };

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(runQueue);
  }

  function runQueue() {
    scheduled = false;
    if (active >= maxConcurrency || queue.length === 0) return;

    const now = Date.now();
    let soonestDelay = Number.POSITIVE_INFINITY;
    let launched = false;

    for (let index = 0; index < queue.length && active < maxConcurrency; ) {
      const task = queue[index];
      const state = getHostState(task.host);
      const delay = Math.max(0, state.nextAt - now);
      if (state.active >= maxPerHost || delay > 0) {
        if (delay > 0) soonestDelay = Math.min(soonestDelay, delay);
        index += 1;
        continue;
      }

      queue.splice(index, 1);
      launched = true;
      active += 1;
      state.active += 1;
      void execute(task, state);
    }

    if (!launched && Number.isFinite(soonestDelay)) {
      setTimeout(schedule, Math.max(1, soonestDelay));
    }
  }

  async function execute(task, state) {
    try {
      task.resolve(await fetchWithRetry(task.url, task.init));
    } catch (error) {
      task.reject(error);
    } finally {
      active -= 1;
      state.active -= 1;
      state.nextAt = Date.now() + minHostDelayMs;
      schedule();
    }
  }

  async function fetchWithRetry(url, init) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const requestInit =
          requestTimeoutMs > 0
            ? {
                ...init,
                signal: init?.signal
                  ? AbortSignal.any([init.signal, AbortSignal.timeout(requestTimeoutMs)])
                  : AbortSignal.timeout(requestTimeoutMs),
              }
            : init;
        const response = await fetchImpl(url, requestInit);
        if (!retryStatuses.has(response.status) || attempt === maxRetries) return response;
        lastError = new Error(`Retryable HTTP ${response.status} for ${url}`);
        await response.body?.cancel?.();
        await sleep(retryDelay(response, attempt));
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries || error?.name === "AbortError") throw error;
        await sleep(clampRetryDelay(baseRetryDelayMs * 2 ** attempt));
      }
    }
    throw lastError;
  }

  function retryDelay(response, attempt) {
    const retryAfter = response.headers?.get?.("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return clampRetryDelay(seconds * 1_000);
      const at = new Date(retryAfter).getTime();
      if (Number.isFinite(at)) return clampRetryDelay(at - Date.now());
    }
    return clampRetryDelay(baseRetryDelayMs * 2 ** attempt);
  }

  function clampRetryDelay(value) {
    return Math.min(maxRetryDelayMs, Math.max(0, value));
  }

  function getHostState(host) {
    if (!hostState.has(host)) hostState.set(host, { active: 0, nextAt: 0 });
    return hostState.get(host);
  }
}

function hostFor(value) {
  try {
    return new URL(String(value)).host.toLowerCase();
  } catch {
    return "invalid-host";
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
