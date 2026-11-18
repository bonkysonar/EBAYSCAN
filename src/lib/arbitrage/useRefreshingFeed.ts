import { useEffect, useState } from "react";

const REFRESH_MS = 5 * 60_000;

export function useRefreshingFeed<T>(url: string, parse: (value: unknown) => T) {
  const [payload, setPayload] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      const activeController = controller;
      const timeout = setTimeout(() => activeController.abort(), 22_000);
      try {
        const response = await fetch(url, { cache: "no-store", signal: activeController.signal });
        if (!response.ok) throw new Error("Unavailable");
        const result = parse(await response.json());
        if (!disposed && controller === activeController) { setPayload(result); setError(false); setClock(Date.now()); }
      } catch {
        if (!disposed && controller === activeController) { setError(true); setPayload(null); }
      } finally { clearTimeout(timeout); }
    };
    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    const tick = setInterval(() => setClock(Date.now()), 60_000);
    const focus = () => void load();
    const visibility = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; controller?.abort(); clearInterval(refresh); clearInterval(tick); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  }, [url, parse]);
  return { payload, error, now: clock };
}
