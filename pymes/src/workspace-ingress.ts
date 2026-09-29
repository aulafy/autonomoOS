import { ingestOpenClawEnterpriseEvent, type OpenClawEnterpriseEnvelope,
  type OpenClawEnterprisePolicy } from "./openclaw-gateway.js";
import type { WorkspaceInboxRecord, WorkspaceRepository } from "./workspace-api.js";

export type WorkspaceIngressResult =
  | { accepted: true; record: WorkspaceInboxRecord }
  | { accepted: false; reason: string };

/** Owns the gateway-to-workspace cutover: validate, deduplicate, then persist. */
export function ingestOpenClawIntoWorkspace(input: {
  envelope: OpenClawEnterpriseEnvelope;
  policy: OpenClawEnterprisePolicy;
  repository: WorkspaceRepository;
}): WorkspaceIngressResult {
  if (input.envelope.tenantId !== input.policy.tenantId) {
    return { accepted: false, reason: "TENANT_SCOPE_DENIED" };
  }
  const result = ingestOpenClawEnterpriseEvent(input.envelope, input.policy);
  if (!result.accepted) return result;
  const existing = input.repository.listInbox(input.envelope.tenantId);
  if (existing.some(record => record.id === result.message.id)) {
    return { accepted: false, reason: "DUPLICATE_EVENT" };
  }
  const record: WorkspaceInboxRecord = {
    id: result.message.id,
    tenantId: input.envelope.tenantId,
    state: "received",
    summary: result.message.text
  };
  try { input.repository.appendInbox(record); }
  catch {
    // A concurrent request may win the unique inbox insert between the read
    // above and this write. Treat that race as the same idempotent duplicate.
    if (input.repository.listInbox(input.envelope.tenantId).some(value => value.id === record.id)) {
      return { accepted: false, reason: "DUPLICATE_EVENT" };
    }
    throw new Error("WORKSPACE_INGRESS_PERSIST_FAILED");
  }
  return { accepted: true, record };
}
