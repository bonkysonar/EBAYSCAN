import { describe, expect, it } from "vitest";
import { carryUnfinishedResearch, carryResearchCheckpoint, resumableResearchWorkflow } from "../../scripts/lib/retailResearchBacklog.mjs";

const now = new Date("2026-10-03T18:00:00Z");
const offer = { id: "retained", artist: "Artist", title: "Album", sourceListingTitle: "Artist Album LP", purchasePrice: 10, capturedAt: "2026-10-01T12:00:00Z" };
const work = (runId, createdAt, extra = {}) => ({ context: { runId, status: "research", ...extra }, draft: { runId, phase: "scan", createdAt, finds: [offer] } });

describe("unfinished research survives daily scans", () => {
  it('preserves checkpoint-only captures through rollover and rematches current queries', () => {
    const candidate={...offer,artist:'Example Artist',title:'Open Sky',sourceListingTitle:'Example Artist Open Sky LP'};
    const page={query:'Example Artist Open Sky',capturedAt:now.toISOString(),condition:'New',category:'Vinyl Records',complete:true,captureMethod:'visible_browser',rows:[],url:'https://www.ebay.com/sh/research?keywords=Example+Artist+Open+Sky&conditionId=1000&categoryId=176985&tabName=SOLD'};
    const prior={...work('old','2026-10-01T00:00:00Z'),checkpoint:{runId:'old',entries:[{findId:'old-id',runs:[page]}]}};
    const draft={runId:'new',phase:'scan',researchCandidates:[candidate]};
    expect(carryResearchCheckpoint(draft,[prior],now)).toMatchObject({runId:'new',entries:[{findId:candidate.id,runs:[{query:page.query,capturedAt:page.capturedAt}]}]});
    expect(carryResearchCheckpoint({...draft,researchCandidates:[{...candidate,title:'Different Album'}]},[prior],now).entries).toEqual([]);
    expect(carryResearchCheckpoint(draft,[{...prior,checkpoint:{...prior.checkpoint,runId:'unrelated'}}],now).entries).toEqual([]);
  });
  it("resumes the oldest valid unpublished draft instead of resetting the queue", () => {
    const old = work("older", "2026-10-03T05:00:00Z"), fresh = work("newer", "2026-10-03T15:00:00Z");
    expect(resumableResearchWorkflow([fresh, work("expired", "2026-10-01T00:00:00Z"), old], now)).toBe(old);
  });
  it("never resumes a published run, a mismatched checkpoint or a failed scan without a draft", () => {
    const published = work("published", now.toISOString(), { publishedAt: now.toISOString() });
    const mismatched = { ...work("one", now.toISOString()), checkpoint: { runId: "other" } };
    expect(resumableResearchWorkflow([published, mismatched, { context: { status: "failed" } }], now)).toBeNull();
  });
  it("carries aged unfinished offers without making their stock or price look fresh", () => {
    const draft = { runId: "new", finds: [{ ...offer, id: "new-offer" }] };
    const result = carryUnfinishedResearch(draft, [work("old", "2026-10-01T00:00:00Z")], now);
    expect(result.researchCandidates).toEqual([draft.finds[0], offer]);
    expect(result.researchBacklog.carriedCount).toBe(1);
    expect(result.finds).toEqual(draft.finds);
    expect(result.researchCandidates[1].capturedAt).toBe("2026-10-01T12:00:00Z");
  });
  it("keeps the current offer when the same offer is rediscovered", () => {
    const current = { ...offer, purchasePrice: 14, capturedAt: now.toISOString() };
    expect(carryUnfinishedResearch({ runId: "new", researchCandidates: [current] }, [work("old", "2026-10-01T00:00:00Z")], now).researchCandidates).toEqual([current]);
  });
  it("retains unpublished offers even after base research completes", () => {
    const prior = work("old", "2026-10-01T00:00:00Z");
    prior.checkpoint = { runId: "old", entries: [{ findId: offer.id, runs: [{
      query: "Artist Album", url: "https://www.ebay.com/sh/research?keywords=Artist+Album&conditionId=1000&categoryId=176985&tabName=SOLD&dayRange=90&tz=America%2FLos_Angeles",
      capturedAt: now.toISOString(), complete: true, completePagination: true,
      condition: "New", category: "Vinyl Records", observedWindow: { startDate: "2026-07-05", endDate: "2026-10-03" }, rows: [],
    }] }] };
    expect(carryUnfinishedResearch({ runId: "new", researchCandidates: [] }, [prior], now).researchCandidates).toEqual([offer]);
  });
  it("retires handed-off contexts without dropping work from the new draft", () => {
    const old = work("old", "2026-10-01T00:00:00Z");
    const result = carryUnfinishedResearch({ runId: "new", researchCandidates: [] }, [old], now);
    expect(result.researchBacklog.supersededRunIds).toEqual(['old']);
    expect(result.researchCandidates).toEqual([offer]);
    const handedOff = { ...old, context: { ...old.context, supersededByRunId: 'new' } };
    expect(resumableResearchWorkflow([handedOff], now)).toBeNull();
    expect(carryUnfinishedResearch({ runId: "later", researchCandidates: [] }, [handedOff], now).researchCandidates).toEqual([]);
  });
});
