import { historyGmail, msg, NOW, DAY } from "./gmail-history-fake.js";
/** Deterministic scenarios shared by parent and child processes. */
export const P04_SCOPE = { tenant: "agency", owner: "owner" };
export const P04_OPTIONS = {
  sync: { listPageSize: 4, maxCandidates: 100, selectionCap: 50, batchSize: 3 },
  incremental: { historyPageSize: 3, batchSize: 3, maxRequestsPerRun: 6 },
  minBackoffMs: 60_000,
  maxBackoffMs: 1_800_000,
};
export function initialMessages() {
  return Array.from({ length: 12 }, (_, i) => msg("r" + String(i).padStart(2, "0"), { internalDate: NOW - (i + 1) * DAY }));
}
/** State after Gmail changed while our cursor was too old: 3 deleted/archived/spam, rest intact. */
export function scenarioAfterExpiry(onRequest?: (p: string) => void | Promise<void>) {
  const messages = initialMessages();
  messages.splice(messages.findIndex((m) => m.id === "r01"), 1);
  messages.find((m) => m.id === "r02")!.labels = [];
  messages.find((m) => m.id === "r03")!.labels = ["SPAM"];
  const g = historyGmail(messages, { onRequest });
  g.expire();
  return g;
}
export function scenarioIncremental(onRequest?: (p: string) => void | Promise<void>) {
  const g = historyGmail(initialMessages(), { onRequest });
  for (let i = 0; i < 8; i++) g.add(msg("n" + i, { internalDate: NOW - 1000 * i }));
  return g;
}
