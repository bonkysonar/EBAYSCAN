import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { acquireResearchMutex, acquireResearchSession, assertResearchOwner, atomicJson, readResearchSession, researchBrowserDecision, sessionPath, updateResearchSession } from "../../scripts/lib/retailResearchSession.mjs";

const binding = { profileName: "Expected profile", extensionInstanceId: "expected-extension", expectedSellerHandle: "expected-seller" };
const dirs = [];
const workspace = () => { const path = mkdtempSync(join(tmpdir(), "research-session-test-")); dirs.push(path); return path; };
const browser = { id: "changed-handle", profileName: binding.profileName, metadata: { extensionInstanceId: binding.extensionInstanceId }, tabs: [] };
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("profile-bound research recovery", () => {
  it("recreates an absent tab using current profile metadata, ignoring stale browser handles", () => {
    const session = { binding, workflowRunId: "scan-current", lastKnownTabId: "retired", tabWorkflowRunId: "scan-previous" };
    const wrong = { ...browser, id: "old-handle", profileName: "Other profile", metadata: { extensionInstanceId: "other-extension" }, tabs: [{ id: "retired" }] };
    expect(researchBrowserDecision(session, { browsers: [wrong, browser] })).toEqual({ action: "create_tab", code: "tab_missing_recoverable", browserId: "changed-handle" });
    expect(researchBrowserDecision(session, { browsers: [{ ...browser, tabs: [{ id: "retired" }] }] }).action).toBe("create_tab");
  });
  it.each([
    [{ browsers: [] }, "profile_unavailable"],
    [{ browsers: [browser, browser] }, "profile_ambiguous"],
    [{ browsers: [browser], sellerHandle: "wrong" }, "seller_identity_mismatch"],
    [{ browsers: [browser], authenticationRequired: true }, "authentication_required"],
    [{ browsers: [browser], challenge: true }, "interactive_challenge"],
    [{ disconnected: true }, "browser_disconnected"],
  ])("keeps real blockers distinct", (observation, code) => {
    expect(researchBrowserDecision({ binding }, observation)).toMatchObject({ action: "stop", blockerCode: code });
  });
  it("requires an observed seller and task-owned tab before research", () => {
    const observation = { browsers: [{ ...browser, tabs: [{ id: "new" }] }], browserId: browser.id, tabId: "new", taskOwned: true };
    expect(researchBrowserDecision({ binding }, observation).action).toBe("create_tab");
    expect(researchBrowserDecision({ binding }, { ...observation, sellerHandle: binding.expectedSellerHandle }).action).toBe("research");
    expect(researchBrowserDecision({ binding }, { ...observation, sellerHandle: binding.expectedSellerHandle, captureRepair: true }).blockerCode).toBe("capture_repair");
  });
});

describe("durable single-writer ownership", () => {
  it("rejects simultaneous owners, wrong nonces, and expired writers", () => {
    const cwd = workspace(), now = Date.now();
    const first = acquireResearchSession(cwd, { ownerThreadId: "chat-one", binding }, now);
    expect(() => acquireResearchSession(cwd, { ownerThreadId: "chat-two" }, now)).toThrow("live lease");
    expect(() => assertResearchOwner(first, "wrong", now)).toThrow("lease");
    expect(() => assertResearchOwner(first, first.ownerToken, now + 31 * 60_000)).toThrow("expired");
    expect(() => acquireResearchSession(cwd, { ownerThreadId: "chat-two" }, now + 31 * 60_000)).toThrow("inactive");
    expect(readResearchSession(cwd).ownerAttemptId).toBe(first.ownerAttemptId);
  });
  it("transfers an expired lease only with fresh exact-owner inactivity evidence", () => {
    const cwd = workspace(), start = Date.now(), later = start + 31 * 60_000;
    const first = acquireResearchSession(cwd, { ownerThreadId: "chat-one", binding }, start);
    const evidence = { ownerThreadId: first.ownerThreadId, ownerAttemptId: first.ownerAttemptId, status: "idle", verifiedAt: new Date(later).toISOString() };
    for (const bad of [{ ...evidence, status: "active" }, { ...evidence, ownerAttemptId: "different" }, { ...evidence, verifiedAt: new Date(start).toISOString() }])
      expect(() => acquireResearchSession(cwd, { ownerThreadId: "chat-two", previousOwner: bad }, later)).toThrow("inactive");
    const second = acquireResearchSession(cwd, { ownerThreadId: "chat-two", previousOwner: evidence }, later);
    expect(second.ownerAttemptId).not.toBe(first.ownerAttemptId);
    expect(() => updateResearchSession(cwd, first.ownerToken, "renew", {}, later)).toThrow("lease");
    updateResearchSession(cwd, second.ownerToken, "release", {}, later);
    expect(acquireResearchSession(cwd, { ownerThreadId: "chat-three" }, later).ownerThreadId).toBe("chat-three");
  });
  it("persists the exact run and blocker without changing checkpoint bytes or original start", () => {
    const cwd = workspace(), first = acquireResearchSession(cwd, { ownerThreadId: "chat-one", binding });
    const out = join(cwd, "exports", "arbitrage-finds"), draftPath = join(out, "draft.json"), checkpointPath = join(out, "checkpoint.json"), contextPath = join(out, "workflow-1.json");
    atomicJson(draftPath, { phase: "scan", runId: "scan-one" });
    atomicJson(checkpointPath, { runId: "scan-one", entries: [] });
    atomicJson(contextPath, { runId: "scan-one", startedAt: "2026-10-15T12:28:59.709Z", draftPath, checkpointPath });
    const before = readFileSync(checkpointPath, "utf8");
    updateResearchSession(cwd, first.ownerToken, "bind", { contextPath });
    expect(() => updateResearchSession(cwd, first.ownerToken, "observe", { browsers: [browser], challenge: true })).toThrow("last minute");
    updateResearchSession(cwd, first.ownerToken, "observe", { browsers: [browser], challenge: true, observedAt: new Date().toISOString() });
    expect(JSON.parse(readFileSync(contextPath, "utf8"))).toMatchObject({ startedAt: "2026-10-15T12:28:59.709Z", browserRecovery: { blockerCode: "interactive_challenge", phase: "blocked" } });
    expect(readFileSync(checkpointPath, "utf8")).toBe(before);
    expect(readFileSync(sessionPath(cwd), "utf8")).not.toMatch(/password|cookie|itemUrl|rawRows/);
    atomicJson(checkpointPath, { runId: "wrong-run", entries: [] });
    expect(() => updateResearchSession(cwd, first.ownerToken, "bind", { contextPath })).toThrow("exact unpublished");
  });
  it("rejects an independent writer while a process owns the mutex, and releases it on exit", () => {
    const cwd = workspace();
    const moduleUrl = pathToFileURL(join(process.cwd(), "scripts/lib/retailResearchSession.mjs")).href;
    const release = acquireResearchMutex(cwd);
    try {
      const env = { ...process.env }; delete env.RETAIL_RESEARCH_MUTEX;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { beginResearchWrite } from ${JSON.stringify(moduleUrl)}; beginResearchWrite();`], { cwd, env, encoding: "utf8", windowsHide: true });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("writer busy");
    } finally { release(); }
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { beginResearchWrite } from ${JSON.stringify(moduleUrl)}; beginResearchWrite();`], { cwd, encoding: "utf8", windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    const unlock = acquireResearchMutex(cwd); unlock();
  });
  it("rolls a lease into an exact durably superseding cohort without discarding prior evidence", () => {
    const cwd = workspace(), first = acquireResearchSession(cwd, { ownerThreadId: "chat-one", binding });
    const out = join(cwd, "exports", "arbitrage-finds");
    const prior = { runId: "scan-old", draftPath: join(out, "old-draft.json"), checkpointPath: join(out, "old-checkpoint.json") };
    const next = { runId: "scan-new", draftPath: join(out, "new-draft.json"), checkpointPath: join(out, "new-checkpoint.json") };
    const priorPath = join(out, "workflow-old.json"), nextPath = join(out, "workflow-new.json");
    atomicJson(prior.draftPath, { phase: "scan", runId: prior.runId });
    atomicJson(prior.checkpointPath, { runId: prior.runId, entries: [] });
    atomicJson(priorPath, prior);
    updateResearchSession(cwd, first.ownerToken, "bind", { contextPath: priorPath });
    const priorEvidence = readFileSync(prior.checkpointPath, "utf8");
    atomicJson(next.draftPath, { phase: "scan", runId: next.runId });
    atomicJson(next.checkpointPath, { runId: next.runId, entries: [] });
    atomicJson(nextPath, next);
    expect(() => updateResearchSession(cwd, first.ownerToken, "bind", { contextPath: nextPath })).toThrow("durably supersede");
    atomicJson(priorPath, { ...prior, supersededByRunId: next.runId, supersededAt: new Date().toISOString() });
    expect(() => updateResearchSession(cwd, first.ownerToken, "bind", { contextPath: nextPath })).toThrow("durably supersede");
    atomicJson(next.draftPath, { phase: "scan", runId: next.runId, researchBacklog: { supersededRunIds: [prior.runId] } });
    const rolled = updateResearchSession(cwd, first.ownerToken, "bind", { contextPath: nextPath });
    expect(rolled.workflowRunId).toBe(next.runId);
    expect(rolled.binding).toEqual(binding);
    expect(rolled.ownerToken).toBe(first.ownerToken);
    expect(readFileSync(prior.checkpointPath, "utf8")).toBe(priorEvidence);
  });
  it("makes actual import/planner commands reject an unauthorized writer before reading data", () => {
    const cwd = workspace();
    acquireResearchSession(cwd, { ownerThreadId: "chat-one", binding });
    for (const script of ["importBrowserSoldResearch", "prepareArbitrageResearchPlan", "runRetailWorkflow"]) {
      const env = { ...process.env }; delete env.RETAIL_RESEARCH_OWNER; delete env.RETAIL_RESEARCH_MUTEX;
      const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", `${script}.mjs`), "missing-draft.json"], { cwd, env, encoding: "utf8", windowsHide: true });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Research lease required");
    }
  });
  it("does not reclaim a dead parent's mutex while its child is still writing", () => {
    const cwd = workspace();
    const exited = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8", windowsHide: true });
    const path = join(cwd, "exports", "arbitrage-finds", ".research-writer.lock");
    atomicJson(path, { pid: Number(exited.stdout.trim()), nonce: "dead-parent", participants: [process.pid] });
    expect(() => acquireResearchMutex(cwd)).toThrow("writer busy");
    atomicJson(path, { pid: Number(exited.stdout.trim()), nonce: "dead-parent", participants: [] });
    const release = acquireResearchMutex(cwd); release();
  });
});
