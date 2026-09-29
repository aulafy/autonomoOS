import assert from "node:assert/strict";
import test from "node:test";
import { handlePymesRequest } from "../src/api-server.js";
import { WorkspaceApi } from "../src/workspace-api.js";

const policy = {
  tenantId: "agency-1", allowedAgentIds: new Set(["agent-1"]),
  allowedResourceIds: new Set(["inbox-1"]), allowedChannels: new Set(["whatsapp"] as const),
  pairedSenderIds: new Set(["sender-1"]), consentedConversationIds: new Set(["conversation-1"])
};
const envelope = { tenantId: "agency-1", agentId: "agent-1", resourceId: "inbox-1",
  inbound: { eventId: "evt-api-1", externalMessageId: "wa-api-1", channel: "whatsapp" as const,
    conversationId: "conversation-1", senderId: "sender-1", receivedAt: "2026-09-29T08:00:00Z",
    text: "Necesito una propuesta", senderPaired: true, consented: true } };

test("internal ingress endpoint persists an OpenClaw event", async () => {
  const api = new WorkspaceApi(undefined, { token: "ingress-token-123456", policy });
  const response = await handlePymesRequest(api, new Request("http://localhost/v1/workspaces/agency-1/ingress/openclaw", {
    method: "POST", headers: { "x-pymes-ingress-token": "ingress-token-123456", "content-type": "application/json" },
    body: JSON.stringify(envelope)
  }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, "openclaw:evt-api-1");
});

test("internal ingress token and policy are not caller-controlled", async () => {
  const api = new WorkspaceApi(undefined, { token: "ingress-token-123456", policy });
  const response = await handlePymesRequest(api, new Request("http://localhost/v1/workspaces/agency-1/ingress/openclaw", {
    method: "POST", headers: { "x-pymes-ingress-token": "wrong-token", "content-type": "application/json" },
    body: JSON.stringify({ ...envelope, tenantId: "agency-2", agentId: "untrusted" })
  }));
  assert.equal(response.status, 401);
});
