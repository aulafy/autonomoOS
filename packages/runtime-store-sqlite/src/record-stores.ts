import { DecisionLedger } from "@agent-world/decision-ledger";
import { ArtifactRegistry } from "@agent-world/artifacts";
import type { JournalKernel } from "./journal-kernel.js";
/** Register before restore; records remain separate from authorization and evidence. */
export function createDurableRecordStores(kernel: JournalKernel): { decisions: DecisionLedger; artifacts: ArtifactRegistry } {
  return { decisions:kernel.register("aw2DecisionLedger",() => new DecisionLedger(),["append"]),
    artifacts:kernel.register("aw2ArtifactRegistry",() => new ArtifactRegistry(),["append"]) };
}
