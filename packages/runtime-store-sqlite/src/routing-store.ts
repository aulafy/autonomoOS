import { RoutingDecisionStore } from "@agent-world/routing";
import type { JournalKernel } from "./journal-kernel.js";
/** Register before restore; selection is recorded before any governed dispatch. */
export function createDurableRoutingStore(kernel: JournalKernel): RoutingDecisionStore {
  return kernel.register("aw2RoutingDecisions", () => new RoutingDecisionStore(), ["record"]);
}
