import { readFileSync } from "node:fs";
import { acquireResearchSession, readResearchSession, researchBrowserDecision, updateResearchSession } from "./lib/retailResearchSession.mjs";

const [action = "status", ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=")]; }));
const cwd = process.cwd();
const file = path => path ? JSON.parse(readFileSync(path, "utf8")) : undefined;
let session;
if (action === "status") session = readResearchSession(cwd);
else if (action === "acquire") session = acquireResearchSession(cwd, {
  ownerThreadId: args.ownerThread, previousOwner: file(args.previousOwner),
  binding: args.profile ? { profileName: args.profile, extensionInstanceId: args.extension, expectedSellerHandle: args.seller } : undefined,
});
else session = updateResearchSession(cwd, process.env.RETAIL_RESEARCH_OWNER, action,
  action === "bind" ? { contextPath: args.context } : action === "observe" ? file(args.observation) : {});
const { ownerToken, ...publicState } = session ?? {};
// A local coordination nonce, not an account credential. Emit only on acquisition.
console.log(JSON.stringify({ ...publicState, ...(action === "acquire" ? { ownerToken } : {}),
  ...(args.observation && session ? { decision: researchBrowserDecision(session, file(args.observation)) } : {}) }, null, 2));
