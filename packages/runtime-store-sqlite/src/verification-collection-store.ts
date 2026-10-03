import { VerificationCollectionStore } from "@agent-world/verification";
import type { JournalKernel } from "./journal-kernel.js";
export function createDurableVerificationCollectionStore(kernel:JournalKernel):VerificationCollectionStore {
  return kernel.register("aw2VerificationCollections",() => new VerificationCollectionStore(),["claim","prepared","finish"]);
}
