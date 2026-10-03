import { recordDigest,type DecisionLedger } from "@agent-world/decision-ledger";
import type { ArtifactRegistry } from "@agent-world/artifacts";
import type { JsonValue } from "@agent-world/task-runtime";
import type { ContextSource } from "./types.js";
import { validContextId } from "./canonical.js";
export interface LedgerSourceInput {
  taskId: string; targetWorkUnitId: string; decisionRefs: string[]; artifactRefs: string[];
  decisions: DecisionLedger; artifacts: ArtifactRegistry;
  /** Host binds the CURRENT record digest to a labelled C9 object. */
  bind(kind: "decision" | "artifact",recordId: string,digest: string): { objectId: string; locality: "any" | "local-only" };
}
export function ledgerContextSources(input: LedgerSourceInput): ContextSource[] {
  if (![input.taskId,input.targetWorkUnitId,...input.decisionRefs,...input.artifactRefs].every(validContextId)) throw new Error("INVALID_LEDGER_CONTEXT_SCOPE");
  const sources: ContextSource[]=[];
  for (const [kind,refs] of [["decision",input.decisionRefs],["artifact",input.artifactRefs]] as const) {
    for (const ref of refs) {
      const record=kind === "decision" ? input.decisions.resolveCurrent(ref) : input.artifacts.get(ref);
      if (!record || record.taskId !== input.taskId) throw new Error("LEDGER_CONTEXT_SCOPE_MISMATCH");
      const binding=input.bind(kind,record.id,recordDigest(record));
      if (!validContextId(binding.objectId) || !["any","local-only"].includes(binding.locality)) throw new Error("INVALID_LEDGER_DATA_BINDING");
      sources.push({ id:`${kind}:${ref}`,objectId:binding.objectId,taskId:input.taskId,workUnitIds:[input.targetWorkUnitId],kind,category:kind,locality:binding.locality,value:record as unknown as JsonValue });
    }
  }
  return sources;
}
