import { learningIdentity } from "./retailLearning.mjs";
export function deferredResearch(find, memory = {}, now = Date.now()) {
  const identity = learningIdentity(find),
    entry = memory[identity.key];
  return entry?.status === "no_rows" &&
    entry.observation === identity.observation &&
    now - Date.parse(entry.checkedAt) < 7 * 86400000
    ? entry
    : null;
}
export function rememberResearch(finds, memory = {}, now = Date.now()) {
  const next = Object.fromEntries(
    Object.entries(memory).filter(
      ([, entry]) => now - Date.parse(entry.checkedAt) < 14 * 86400000,
    ),
  );
  for (const find of finds) {
    if (
      find.ebayResearchStatus !== "no_rows" ||
      !find.ebayResearchSearchComplete ||
      !find.ebayResearchUpdatedAt
    )
      continue;
    const identity = learningIdentity(find);
    next[identity.key] = {
      observation: identity.observation,
      status: "no_rows",
      checkedAt: find.ebayResearchUpdatedAt,
    };
  }
  return next;
}
