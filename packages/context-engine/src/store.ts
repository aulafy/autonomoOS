import { canonicalContext, contextDigest } from "./canonical.js";
import type { ContextEnvelope } from "./types.js";
export class ContextEnvelopeStore {
  private envelopes = new Map<string, ContextEnvelope>();
  record(input: ContextEnvelope): { envelopeId: string } {
    const envelope = structuredClone(input), { id, ...content } = envelope;
    if (id !== `context:${contextDigest(content)}`) throw new Error("CONTEXT_INTEGRITY_MISMATCH");
    const previous = this.envelopes.get(id);
    if (previous) { if (canonicalContext(previous) !== canonicalContext(envelope)) throw new Error("CONTEXT_ID_CONFLICT"); return { envelopeId: id }; }
    const history = [...this.envelopes.values()].filter(item => item.taskId === envelope.taskId && item.workUnitId === envelope.workUnitId && item.attemptId === envelope.attemptId).sort((a,b) => b.version-a.version);
    if (envelope.version !== (history[0]?.version ?? 0)+1 || envelope.previousEnvelopeId !== history[0]?.id) throw new Error("CONTEXT_VERSION_CONFLICT");
    this.envelopes.set(id,envelope); return { envelopeId: id };
  }
  get(id: string): ContextEnvelope | undefined { const value = this.envelopes.get(id); return value ? structuredClone(value) : undefined; }
}
