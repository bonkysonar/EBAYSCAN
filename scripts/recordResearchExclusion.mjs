import { readFileSync, copyFileSync, constants } from "node:fs";
import { resolve } from "node:path";
import { atomicJson, beginResearchWrite, readResearchSession } from "./lib/retailResearchSession.mjs";
import { candidateIdentity, researchSelection } from "./lib/researchExclusions.mjs";
const [draftArgument, findId, evidenceArgument] = process.argv.slice(2);
if (!draftArgument || !findId || !evidenceArgument) throw new Error("Usage: recordResearchExclusion.mjs <exact-draft> <find-id> <review-receipt-json>");
beginResearchWrite();
const path = resolve(draftArgument), draft = JSON.parse(readFileSync(path, "utf8"));
const session = readResearchSession();
if (draft.phase !== "scan" || session?.workflowRunId !== draft.runId) throw new Error("Exclusion requires the owned unpublished run");
const review = JSON.parse(readFileSync(resolve(evidenceArgument), "utf8"));
const find = (draft.researchCandidates ?? draft.finds ?? []).find(f => f.id === findId);
if (!find || review.runId !== draft.runId || review.findId !== findId || review.recoveryAttempted !== true ||
    review.reason !== "unverifiable_sold_controls" || review.observedSoldEmpty !== true ||
    review.currentSoldControlsVerified !== false || !Number.isFinite(Date.parse(review.observedAt)) ||
    Date.now() - Date.parse(review.observedAt) > 3600000 || Date.parse(review.observedAt) > Date.now())
  throw new Error("Fresh exact-candidate failed-control review and attempted recovery are required");
const row = {runId:draft.runId,findId,candidateIdentity:candidateIdentity(find),reason:review.reason,
  outcome:"excluded_unpriceable",reviewedAt:new Date().toISOString(),recoveryAttempted:true,evidenceVerified:false};
const next = {...draft,researchExclusions:[...(draft.researchExclusions??[]).filter(r=>r.findId!==findId),row]};
researchSelection(next);
// Never destroy the original evidence. Each exclusion retains its preceding draft.
copyFileSync(path, `${path}.before-exclusion-${Date.now()}.json`, constants.COPYFILE_EXCL);
atomicJson(path,next);
console.log(JSON.stringify({findId,outcome:row.outcome,priceValidated:false,demandUnknown:true,rebuildRequired:true}));
