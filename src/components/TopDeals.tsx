import { useMemo, useState } from "react";
import { normalizeAlbumPriceBenchmark } from "../../scripts/lib/albumPriceBenchmark.mjs";
import type { RetailCampaignRadarPayload, RetailDealRadarPayload, RetailMarkdownPayload } from "../lib/arbitrage/dealRadar";
import { isIndividualRecordFind, replaceWithLatestFinds } from "../lib/arbitrage/individualRecords";
import { loadReviewFeedback, type ReviewFeedback } from "../lib/arbitrage/reviewFeedback";
import { evaluateOpportunity } from "../lib/arbitrage/rules";
import { normalizeSalePayload, type NormalizedSaleCampaign, type SalePayloadShape } from "../lib/arbitrage/saleCampaigns";
import { loadArbitrageFinds, loadArbitrageSettings } from "../lib/arbitrage/storage";
import { topAlbums, topSales, type DealPick } from "../lib/arbitrage/topDeals";
import { useRefreshingFeed } from "../lib/arbitrage/useRefreshingFeed";
import type { ArbitrageImportPayload, ArbitrageScoredFind, ArbitrageSettings } from "../lib/arbitrage/types";
import { useRetailRadar } from "./RetailDealRadar";

function readLatest(value: unknown) {
  const data = value as { status?: string; payload?: ArbitrageImportPayload & SalePayloadShape };
  if (data?.status === "empty") return null;
  if (data?.status !== "available" || !Array.isArray(data.payload?.finds)) throw new Error("Research unavailable");
  return data.payload;
}

export function TopDealsPage() {
  const latest = useRefreshingFeed("/api/arbitrage/latest", readLatest);
  const [settings] = useState(loadArbitrageSettings);
  const [feedback] = useState(loadReviewFeedback);
  const finds = useMemo(() => {
    const records = (latest.payload?.finds ?? []).filter(isIndividualRecordFind);
    return replaceWithLatestFinds(loadArbitrageFinds(), records).map(find => evaluateOpportunity({
      ...find, albumPriceBenchmark: normalizeAlbumPriceBenchmark(find.albumPriceBenchmark, latest.now),
    }, settings, latest.now));
  }, [latest.payload, latest.now, settings]);
  const sales = useMemo(() => normalizeSalePayload(latest.payload ?? {}).campaigns, [latest.payload]);
  return <>
    <div className="top-deals-grid">
      <AlbumPicks finds={finds} settings={settings} feedback={feedback} overview />
      <SalePicks campaigns={sales} feedback={feedback} overview />
    </div>
    <p className="picks-publication" role="status">{latest.error ? "The published research is unavailable." :
      latest.payload ? "Latest published research · " + timestamp(latest.payload.publishedAt ?? latest.payload.createdAt) : ""}</p>
  </>;
}

export function AlbumPicks({ finds, settings, feedback, overview }: {
  finds: ArbitrageScoredFind[]; settings: ArbitrageSettings; feedback: ReviewFeedback; overview?: boolean;
}) {
  const { payload, error, now } = useRetailRadar<RetailDealRadarPayload>("/api/arbitrage/deal-radar");
  const markdowns = useRetailRadar<RetailMarkdownPayload>("/api/arbitrage/deal-radar?scope=markdowns");
  const rows = topAlbums(finds, payload, feedback, settings, Math.max(now, markdowns.now), markdowns.payload);
  const feed = feedState(payload, error, now);
  const catalogs = feedState(markdowns.payload, markdowns.error, markdowns.now);
  return <PicksList title="Single albums" variant="albums" rows={rows}
    href={overview ? "#/retail-arbitrage" : undefined} linkLabel="All albums"
    state={feed === catalogs ? feed : [catalogs && "Retailer catalogs: " + catalogs, feed && "Deal feed: " + feed].filter(Boolean).join(" · ")}
    empty="No current album offers in the checked sources." />;
}

export function SalePicks({ campaigns, feedback, overview }: {
  campaigns: NormalizedSaleCampaign[]; feedback: ReviewFeedback; overview?: boolean;
}) {
  const { payload, error, now } = useRetailRadar<RetailCampaignRadarPayload>("/api/arbitrage/deal-radar?scope=campaigns");
  const rows = topSales(campaigns, payload, feedback, now);
  return <PicksList title="Store sales" variant="sales" rows={rows}
    href={overview ? "#/site-wide-sales" : undefined} linkLabel="All sales"
    state={feedState(payload, error, now)} empty="No current discounts in the checked stores." />;
}

function timestamp(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function feedState(feed: RetailDealRadarPayload | RetailCampaignRadarPayload | RetailMarkdownPayload | null, error: boolean, now: number) {
  if (error || feed?.status === "unavailable" || (feed && Date.parse(feed.expiresAt) <= now)) return "Live feed unavailable";
  if (!feed) return "Checking live offers…";
  if (feed.status === "partial") return "Some sources unavailable";
  return "";
}

function PicksList({ title, variant, rows, href, linkLabel, empty, state }: {
  title: string; variant: "albums" | "sales"; rows: DealPick[]; href?: string; linkLabel: string; empty: string; state: string;
}) {
  return <section className={"picks-panel picks-" + variant} aria-label={title}>
    <header className="picks-heading">
      <h2>{title}</h2>
      {href && <a href={href}>{linkLabel} <span aria-hidden="true">→</span></a>}
    </header>
    {rows.length > 0 && <ol className="picks-list">{rows.map((row, index) =>
      <li key={row.key}>
        <span className="picks-rank" aria-hidden="true">{index + 1}</span>
        <div className="picks-body">
          <div className="picks-line">
            <a href={row.url} target="_blank" rel="noreferrer">{row.name}</a>
            <strong>{row.value}</strong>
          </div>
          <div className="picks-terms">{row.terms}</div>
          <div className="picks-source">{row.source} · {variant === "albums" && row.tier === 4 ? "Posted" : "Checked"} <time dateTime={row.checked}>{timestamp(row.checked)}</time></div>
        </div>
      </li>)}</ol>}
    {(state || !rows.length) && <p className="picks-feed-state" role="status">{state || empty}</p>}
  </section>;
}
