import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { candidateIdentity, researchSelection } from "../../scripts/lib/researchExclusions.mjs";
import { researchProgress, assertResearchReady } from "../../scripts/lib/retailWorkflowState.mjs";
import { buildPersistentResearchQueue } from "../../scripts/lib/persistentResearchQueue.mjs";
const find={id:"offer-1",title:"Sleep",artist:"Sad Park",sourceId:"store",sourceUrl:"https://example.test/sleep",purchasePrice:20,opportunityType:"product"};
const draft={runId:"run-1",phase:"scan",researchCandidates:[find]};
const row={runId:"run-1",findId:find.id,candidateIdentity:candidateIdentity(find),reason:"unverifiable_sold_controls",outcome:"excluded_unpriceable",reviewedAt:"2026-11-13T15:00:00Z",recoveryAttempted:true,evidenceVerified:false};
describe("explicit unpriceable exclusions",()=>{
 it("is opt-in and preserves the source candidate",()=>{expect(researchSelection(draft).included).toEqual([find]);const p={...draft,researchExclusions:[row]};expect(researchSelection(p).included).toEqual([]);expect(p.researchCandidates).toEqual([find]);});
 it.each([{runId:"other"},{findId:"other"},{candidateIdentity:"bad"},{outcome:"complete"},{evidenceVerified:true},{recoveryAttempted:false}])("rejects unbound or misleading outcomes %j",change=>{expect(()=>researchSelection({...draft,researchExclusions:[{...row,...change}]})).toThrow();});
 it("reopens changed candidate identities instead of silently excluding them",()=>{expect(()=>researchSelection({...draft,researchCandidates:[{...find,purchasePrice:99}],researchExclusions:[row]})).toThrow();});
 it("never counts an exclusion as completed research or zero demand",()=>{const p={...draft,researchExclusions:[row]};const progress=researchProgress(p);expect(progress.completed).toBe(0);expect(progress.noRows).toBe(0);expect(progress.excluded).toBe(1);expect(progress.coverage).toBe("partial");expect(progress.selected).toBe(1);});
 it("retains the strict block on any remaining unfinished candidate",()=>{const p={...draft,researchCandidates:[find,{...find,id:"offer-2",title:"Other"}],researchExclusions:[row]};const q=buildPersistentResearchQueue(p,{now:new Date("2026-11-13T15:01:00Z")});expect(q.plan.summary.excluded).toBe(1);expect(q.plan.entries.flatMap(e=>e.findIds)).not.toContain(find.id);expect(()=>assertResearchReady(researchProgress(p),q.plan.summary)).toThrow();});
});

it("curation cannot repopulate excluded candidates even when stale positive evidence exists",()=>{
 const workspace=mkdtempSync(join(tmpdir(),"scanner-exclusion-fixture-"));
 const dir=join(workspace,"exports","arbitrage-finds"); mkdirSync(dir,{recursive:true});
 const positive={...find,decision:"BUY",averageSoldPrice:100,conservativeResalePrice:100};
 const p={...draft,createdAt:new Date().toISOString(),researchCandidates:[positive],finds:[positive],researchExclusions:[{...row,candidateIdentity:candidateIdentity(positive)}]};
 const file=join(dir,"draft.json");writeFileSync(file,JSON.stringify(p));
 const result=spawnSync(process.execPath,[join(process.cwd(),"scripts","curateRetailArbitrageRun.mjs"),file,"--pending"],{cwd:workspace,encoding:"utf8",windowsHide:true});
 expect(result.status,result.stderr).toBe(0);
 const final=JSON.parse(readFileSync(join(dir,"retail-arbitrage-final-run-1.json"),"utf8"));
 expect(final.finds).toEqual([]); expect(final.researchCoverage.status).toBe("partial");
 expect(final.researchExclusions[0].outcome).toBe("excluded_unpriceable");
 expect(JSON.parse(readFileSync(file,"utf8"))).toEqual(p);
});
