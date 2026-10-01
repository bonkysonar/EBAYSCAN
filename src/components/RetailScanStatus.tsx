import { useEffect, useState } from "react";
import type { ArbitrageImportPayload, ArbitrageResearchProgress, ArbitrageResearchQueue } from "../lib/arbitrage/types";
type Attempt = {
  status: string;
  updatedAt?: string;
  startedAt?: string;
  sourceCount?: number;
  message?: string;
  researchProgress?: ArbitrageResearchProgress | null;
  researchQueue?: ArbitrageResearchQueue | null;
};
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "Not yet available";
export function RetailScanStatus({
  payload,
}: {
  payload: ArbitrageImportPayload | null;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/arbitrage/operations", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) setAttempt(await response.json());
      } catch {
        /* Publication dates remain visible if the status service is unavailable. */
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  const interrupted =
    attempt &&
    ["running", "research"].includes(attempt.status) &&
    Date.now() - Date.parse(attempt.updatedAt ?? "") > 3 * 3600000;
  const research = attempt?.researchProgress ?? payload?.researchProgress;
  const queue = attempt?.researchQueue ?? payload?.researchQueue;
  return (
    <aside className="panel retail-scan-status" aria-label="Scanner freshness">
      <strong>
        {payload?.publicationMode === "evidence_updates"
          ? "Album price research updated · retail observations unchanged"
          : payload?.publicationMode === "source_updates"
          ? "Verified retailer updates · partial coverage"
          : "Daily scanner"}
      </strong>
      <p>
        Latest publication: {date(payload?.publishedAt ?? payload?.createdAt)}.
        Latest attempt: {date(attempt?.startedAt)}
        {attempt
          ? ` · ${interrupted ? "interrupted or overdue" : attempt.status}`
          : ""}
        .
      </p>
      {payload?.sourceUpdates ? (
        <p>
          Last successful broad scan:{" "}
          {date(payload.sourceUpdates.lastBroadScanAt)}. Last broad attempt:{" "}
          {date(payload.sourceUpdates.lastBroadAttemptAt)}.{" "}
          {payload.publicationMode === "evidence_updates"
            ? "No retail source rescan; offers retain their original observation dates."
            : `${payload.sourceUpdates.updatedSourceIds.length} sources updated; other observations retain their original dates.`}
        </p>
      ) : null}
      {attempt?.message ? <p role="status">{attempt.message}</p> : null}
      {research ? (
        <p>
          {attempt?.researchProgress ? "Latest attempt" : "Published scan"} sold research: {research.completed}/{research.planned} offers researched; {research.validated} with matching sales; {research.noRows} without matching sales; {research.pending} pending; {research.failed} failed; {research.outsidePlan} deferred beyond this run’s research limit.
        </p>
      ) : null}
      {queue ? (
        <p aria-label="Research queue">
          {queue.distinctQueries} distinct album searches across {queue.offers} offers. {queue.reused} date-window captures reused; {queue.repair} need capture repair; {queue.refresh} need fresh evidence; {queue.pending} await research. {queue.scheduled} searches queued now; {queue.retryLater} retry later; {queue.editionReviews} need edition identification.
        </p>
      ) : null}
    </aside>
  );
}
