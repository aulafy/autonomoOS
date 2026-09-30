import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryWorkspaceRepository } from "../src/workspace-api.js";
import { ingestOpenClawIntoWorkspace } from "../src/workspace-ingress.js";

const policy = {
  tenantId: "agency-1", allowedAgentIds: new Set(["agent-1"]),
  allowedResourceIds: new Set(["inbox-1"]),
  allowedChannels: new Set(["whatsapp"] as const),
  pairedSenderIds: new Set(["sender-1"]),
  consentedConversationIds: new Set(["conversation-1"])
};
const envelope = {
  tenantId: "agency-1", agentId: "agent-1", resourceId: "inbox-1",
  inbound: { eventId: "event-1", externalMessageId: "wa-1", channel: "whatsapp" as const,
    conversationId: "conversation-1", senderId: "sender-1",
    receivedAt: "2026-09-29T08:00:00+02:00", text: "Quiero revisar mi seguro",
    senderPaired: true, consented: true }
};

test("accepted gateway event is persisted as a neutral workspace case", () => {
  const repository = new InMemoryWorkspaceRepository();
  const result = ingestOpenClawIntoWorkspace({ envelope, policy, repository });
  assert.equal(result.accepted, true);
  assert.equal(repository.listInbox("agency-1")[0]?.id, "openclaw:event-1");
  assert.equal(repository.listInbox("agency-1")[0]?.state, "received");
});

test("replayed gateway event is not persisted twice", () => {
  const repository = new InMemoryWorkspaceRepository();
  ingestOpenClawIntoWorkspace({ envelope, policy, repository });
  assert.deepEqual(ingestOpenClawIntoWorkspace({ envelope, policy, repository }),
    { accepted: false, reason: "DUPLICATE_EVENT" });
  assert.equal(repository.listInbox("agency-1").length, 1);
});

test("same external message with a new gateway event id is deduplicated", () => {
  const repository = new InMemoryWorkspaceRepository();
  ingestOpenClawIntoWorkspace({ envelope, policy, repository });
  const replay = { ...envelope, inbound: { ...envelope.inbound, eventId: "event-2" } };
  assert.deepEqual(ingestOpenClawIntoWorkspace({ envelope: replay, policy, repository }),
    { accepted: false, reason: "DUPLICATE_EVENT" });
  assert.equal(repository.listInbox("agency-1").length, 1);
});

test("in-memory inbox enforces external message uniqueness", () => {
  const repository = new InMemoryWorkspaceRepository();
  repository.appendInbox({ id: "event-1", tenantId: "agency-1", state: "received", summary: "Mensaje", sourceExternalMessageId: "wa-1", sourceChannel: "whatsapp" });
  assert.throws(() => repository.appendInbox({ id: "event-2", tenantId: "agency-1", state: "received", summary: "Reintento", sourceExternalMessageId: "wa-1", sourceChannel: "whatsapp" }));
});

test("tenant mismatch is rejected before persistence", () => {
  const repository = new InMemoryWorkspaceRepository();
  const result = ingestOpenClawIntoWorkspace({ envelope: { ...envelope, tenantId: "agency-2" }, policy, repository });
  assert.deepEqual(result, { accepted: false, reason: "TENANT_SCOPE_DENIED" });
  assert.equal(repository.listInbox("agency-2").length, 0);
});
