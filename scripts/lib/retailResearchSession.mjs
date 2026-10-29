import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const LEASE_MS = 30 * 60_000;
const read = path => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
export const sessionPath = (cwd = process.cwd()) => join(cwd, "exports", "arbitrage-finds", "research-session.json");
export const readResearchSession = cwd => read(sessionPath(cwd));
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, path);
}
const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true; // Unknown is not dead.
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
};

/** Short-lived process mutex, separate from the chat lease. Only synchronous
 * workflow children inherit it; unrelated invocations must acquire it normally. */
export function acquireResearchMutex(cwd = process.cwd(), env = process.env) {
  const path = join(dirname(sessionPath(cwd)), ".research-writer.lock");
  mkdirSync(dirname(path), { recursive: true });
  const inherited = env.RETAIL_RESEARCH_MUTEX ? JSON.parse(env.RETAIL_RESEARCH_MUTEX) : null;
  if (inherited?.path === path) {
    const saved = read(path);
    if (saved?.nonce !== inherited.nonce || saved.pid !== inherited.pid || !alive(saved.pid)) throw new Error("Research writer inheritance is no longer valid");
    if (saved.pid === process.pid) return () => {}; // Reentrant manifest update.
    atomicJson(path, { ...saved, participants: [...new Set([...(saved.participants ?? []), process.pid])] });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = read(path);
      if (current?.nonce !== saved.nonce) return;
      current.participants = (current.participants ?? []).filter(pid => pid !== process.pid);
      if (!alive(current.pid) && !current.participants.some(alive)) unlinkSync(path);
      else atomicJson(path, current);
    };
  }
  const recovery = `${path}.recovery`;
  if (existsSync(recovery)) throw new Error("Research writer lock recovery in progress");
  const old = read(path);
  if (old) {
    if (alive(old.pid) || (old.participants ?? []).some(alive)) throw new Error(`Research writer busy (PID ${old.pid}; child processes may still be active)`);
    writeFileSync(recovery, JSON.stringify({ pid: process.pid }), { flag: "wx" });
    try {
      const current = read(path);
      if (current?.nonce !== old.nonce || alive(current.pid) || (current.participants ?? []).some(alive)) throw new Error("Research writer changed during recovery");
      unlinkSync(path);
    } finally { unlinkSync(recovery); }
  }
  const lock = { pid: process.pid, nonce: randomUUID(), participants: [] };
  writeFileSync(path, JSON.stringify(lock), { flag: "wx" });
  const previous = env.RETAIL_RESEARCH_MUTEX;
  env.RETAIL_RESEARCH_MUTEX = JSON.stringify({ path, ...lock });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = read(path);
    if (current?.nonce === lock.nonce && !(current.participants ?? []).some(alive)) unlinkSync(path);
    if (previous === undefined) delete env.RETAIL_RESEARCH_MUTEX;
    else env.RETAIL_RESEARCH_MUTEX = previous;
  };
}

export function assertResearchOwner(session, token, now = Date.now()) {
  if (!session) return; // Legacy manual runs still get the process mutex.
  if (!token || token !== session.ownerToken || !session.ownerThreadId ||
      !(Date.parse(session.leaseExpiresAt) > now)) throw new Error("Research lease required or expired; acquire/renew the saved session before writing");
}
export function beginResearchWrite(cwd = process.cwd(), env = process.env) {
  const inherited = Boolean(env.RETAIL_RESEARCH_MUTEX);
  const release = acquireResearchMutex(cwd, env);
  try {
    const session = readResearchSession(cwd);
    // A still-running parent holds the process mutex throughout its children;
    // no other chat can reclaim the lease mid-command. Renew before each step.
    assertResearchOwner(session, env.RETAIL_RESEARCH_OWNER, inherited ? -Infinity : Date.now());
    if (session) {
      session.leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString();
      atomicJson(sessionPath(cwd), session);
    }
  }
  catch (error) { release(); throw error; }
  process.once("exit", release);
  return () => { process.removeListener("exit", release); release(); };
}

/** Expiration alone is never permission to take another chat's work. The caller
 * must supply a fresh tool-observed inactive status for the exact old owner. */
export function acquireResearchSession(cwd, { ownerThreadId, previousOwner, binding }, now = Date.now()) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(ownerThreadId ?? "")) throw new Error("An explicit owner thread ID is required");
  const release = acquireResearchMutex(cwd);
  try {
    const prior = readResearchSession(cwd);
    if (prior?.ownerToken) {
      if (Date.parse(prior.leaseExpiresAt) > now) throw new Error("Research session already has a live lease");
      const age = now - Date.parse(previousOwner?.verifiedAt);
      if (previousOwner?.ownerThreadId !== prior.ownerThreadId || previousOwner?.ownerAttemptId !== prior.ownerAttemptId ||
          !["idle", "completed", "interrupted"].includes(previousOwner?.status) || !(age >= 0 && age < 60_000))
        throw new Error("Verify the expired lease's exact previous owner is inactive before reclaiming");
    }
    const selectedBinding = prior?.binding ?? binding;
    if (!selectedBinding?.profileName || !selectedBinding?.extensionInstanceId || !selectedBinding?.expectedSellerHandle)
      throw new Error("A verified profile name, extension instance and expected seller binding are required");
    if (binding && prior?.binding && JSON.stringify(binding) !== JSON.stringify(prior.binding)) throw new Error("Research profile binding cannot change during continuation");
    const session = { ...prior, version: 1, binding: {
      profileName: selectedBinding.profileName, extensionInstanceId: selectedBinding.extensionInstanceId,
      expectedSellerHandle: selectedBinding.expectedSellerHandle,
    }, ownerThreadId, ownerAttemptId: randomUUID(), ownerToken: randomUUID(),
    attemptStartedAt: new Date(now).toISOString(), leaseExpiresAt: new Date(now + LEASE_MS).toISOString(), phase: "recovering", blockerCode: null, retryAfter: null };
    atomicJson(sessionPath(cwd), session);
    return session;
  } finally { release(); }
}

export function updateResearchSession(cwd, token, action, value = {}, now = Date.now()) {
  const release = acquireResearchMutex(cwd);
  try {
    const session = readResearchSession(cwd);
    if (!session) throw new Error("No research session exists");
    // The same owner may renew an expired lease, provided no takeover occurred.
    assertResearchOwner(session, token, action === "renew" || action === "release" ? -Infinity : now);
    if (action === "renew") session.leaseExpiresAt = new Date(now + LEASE_MS).toISOString();
    else if (action === "release") {
      session.ownerToken = null;
      session.leaseExpiresAt = null;
      session.releasedAt = new Date(now).toISOString();
    } else if (action === "bind") {
      const path = resolve(value.contextPath), context = read(path);
      const draft = context?.draftPath && read(context.draftPath);
      const checkpoint = context?.checkpointPath && read(context.checkpointPath);
      if (!draft || draft.phase !== "scan" || draft.runId !== context.runId || checkpoint?.runId !== draft.runId || context.publishedAt || context.supersededByRunId)
        throw new Error("Session must bind the exact unpublished context, draft and checkpoint");
      if (session.workflowRunId && session.workflowRunId !== context.runId) {
        const prior = read(session.contextPath);
        // A deliberate fresh scan may retire an expired acquisition cohort,
        // but only after writing its exact successor and preserved checkpoint.
        const successorIsDurable = prior?.supersededByRunId === context.runId &&
          draft.researchBacklog?.supersededRunIds?.includes(prior.runId) &&
          Number.isFinite(Date.parse(prior.supersededAt));
        if (!prior?.publishedAt && !successorIsDurable) throw new Error("Finish or durably supersede the retained workflow before binding a different run");
        delete session.lastKnownTabId;
        delete session.tabWorkflowRunId;
      }
      Object.assign(session, { workflowRunId: context.runId, contextPath: path, checkpointPath: context.checkpointPath, workflowStartedAt: context.startedAt });
    } else if (action === "observe") {
      if (!session.workflowRunId) throw new Error("Bind the saved workflow before observing browser recovery");
      const observationAge = now - Date.parse(value.observedAt);
      if (!(observationAge >= 0 && observationAge < 60_000)) throw new Error("Browser recovery needs an inventory/observation from the last minute");
      const decision = researchBrowserDecision(session, value);
      Object.assign(session, { phase: decision.blockerCode ? "blocked" : decision.action === "research" ? "research" : "recovering",
        blockerCode: decision.blockerCode ?? null, recoveryCode: decision.code, retryAfter: decision.blockerCode ? new Date(now + 10 * 60_000).toISOString() : null });
      if (decision.action === "research") Object.assign(session, {
        lastKnownTabId: String(value.tabId), tabWorkflowRunId: session.workflowRunId, lastVerifiedAt: new Date(now).toISOString(),
      });
      if (value.nextTaskId && /^[a-f0-9]{64}$/.test(value.nextTaskId)) session.nextTaskId = value.nextTaskId;
    } else throw new Error("Unknown research session action");
    session.updatedAt = new Date(now).toISOString();
    atomicJson(sessionPath(cwd), session);
    if (session.contextPath) {
      const context = read(session.contextPath);
      if (context?.runId !== session.workflowRunId) throw new Error("Session context changed run identity");
      context.browserRecovery = { phase: session.phase, blockerCode: session.blockerCode, recoveryCode: session.recoveryCode,
        retryAfter: session.retryAfter, lastVerifiedAt: session.lastVerifiedAt, nextTaskId: session.nextTaskId,
        ownerThreadId: session.ownerThreadId, ownerAttemptId: session.ownerAttemptId, updatedAt: session.updatedAt };
      atomicJson(session.contextPath, context);
    }
    return session;
  } finally { release(); }
}

/** Inventory is freshly observed by the browser tool. This selects handles; it
 * does not read browser profiles, cookies, hidden state or marketplace pages. */
export function researchBrowserDecision(session, observation) {
  const block = code => ({ action: "stop", code, blockerCode: code });
  if (observation.disconnected) return block("browser_disconnected");
  const matches = (observation.browsers ?? []).filter(browser => browser.profileName === session.binding.profileName &&
    browser.metadata?.extensionInstanceId === session.binding.extensionInstanceId);
  if (!matches.length) return block("profile_unavailable");
  if (matches.length !== 1) return block("profile_ambiguous");
  const browser = matches[0];
  if (observation.browserId !== undefined && String(observation.browserId) !== String(browser.id)) return block("profile_unavailable");
  if (observation.challenge) return block("interactive_challenge");
  if (observation.authenticationRequired) return block("authentication_required");
  if (observation.sellerHandle && observation.sellerHandle.toLowerCase() !== session.binding.expectedSellerHandle.toLowerCase()) return block("seller_identity_mismatch");
  if (observation.tabId && observation.taskOwned === true && observation.sellerHandle &&
      browser.tabs?.some(tab => String(tab.id) === String(observation.tabId))) {
    if (observation.captureRepair) return block("capture_repair");
    return { action: "research", code: "browser_verified", browserId: browser.id };
  }
  const hint = session.tabWorkflowRunId === session.workflowRunId && browser.tabs?.find(tab => String(tab.id) === session.lastKnownTabId);
  return { action: hint ? "verify_tab" : "create_tab", code: hint ? "seller_verification_required" : "tab_missing_recoverable", browserId: browser.id, ...(hint ? { tabId: hint.id } : {}) };
}
