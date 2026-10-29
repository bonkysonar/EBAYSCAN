import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { atomicJson, beginResearchWrite, readResearchSession } from "./lib/retailResearchSession.mjs";

const [planArgument, reviewId, outcome] = process.argv.slice(2);
if (!planArgument || !/^[a-f0-9]{64}$/.test(reviewId ?? "") || !["unconfirmed_unpriced", "incompatible_unpriced"].includes(outcome))
  throw new Error("Usage: node scripts/recordRetailEditionReview.mjs <exact-plan> <review-id> <unconfirmed_unpriced|incompatible_unpriced>. Only after inspecting the edition evidence.");
beginResearchWrite();
const plan = JSON.parse(readFileSync(resolve(planArgument), "utf8"));
const session = readResearchSession();
if (session?.workflowRunId && plan.runId !== session.workflowRunId) throw new Error("Edition review belongs to another run");
if (!plan.editionReviews?.some(review => review.reviewId === reviewId)) throw new Error("Review is not pending in this plan");
const path = join(process.cwd(), "exports", "arbitrage-finds", "research-queue-state.json");
const state = JSON.parse(readFileSync(path, "utf8"));
state.editionReviewOutcomes = { ...state.editionReviewOutcomes, [reviewId]: { outcome, reviewedAt: new Date().toISOString() } };
atomicJson(path, state);
console.log(JSON.stringify({ reviewId, outcome, priceValidated: false, rebuildRequired: true }));
