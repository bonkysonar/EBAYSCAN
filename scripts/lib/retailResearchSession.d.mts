export type RetailResearchSession = Record<string, any> & {
  binding: { profileName: string; extensionInstanceId: string; expectedSellerHandle: string };
  ownerThreadId: string;
  ownerAttemptId: string;
  ownerToken: string | null;
};
export function sessionPath(cwd?: string): string;
export function readResearchSession(cwd?: string): RetailResearchSession | null;
export function atomicJson(path: string, value: unknown): void;
export function acquireResearchMutex(cwd?: string, env?: Record<string, string | undefined>): () => void;
export function assertResearchOwner(session: RetailResearchSession | null, token?: string, now?: number): void;
export function beginResearchWrite(cwd?: string, env?: Record<string, string | undefined>): () => void;
export function acquireResearchSession(cwd: string, options: {
  ownerThreadId: string; previousOwner?: Record<string, any>; binding?: RetailResearchSession["binding"];
}, now?: number): RetailResearchSession & { ownerToken: string };
export function updateResearchSession(cwd: string, token: string | null, action: string, value?: Record<string, any>, now?: number): RetailResearchSession;
export function researchBrowserDecision(session: Record<string, any>, observation: Record<string, any>): Record<string, any>;
