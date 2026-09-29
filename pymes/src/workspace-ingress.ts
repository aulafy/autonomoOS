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
  input.repository.appendInbox(record);
  return { accepted: true, record };
}
