import { EvidenceLedger } from "@agent-world/evidence-ledger";
import type { JournalKernel } from "./journal-kernel.js";
export function createDurableEvidenceLedger(kernel:JournalKernel):EvidenceLedger {
  return kernel.register("aw2EvidenceLedger",() => new EvidenceLedger(),["append"]);
}
