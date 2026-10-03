import { ContextEnvelopeStore } from "@agent-world/context-engine";
import type { JournalKernel } from "./journal-kernel.js";
/** Immutable context snapshots join H1; rendering revalidates current policy. */
export function createDurableContextStore(kernel: JournalKernel): ContextEnvelopeStore {
  return kernel.register("aw2ContextEnvelopes", () => new ContextEnvelopeStore(), ["record"]);
}
