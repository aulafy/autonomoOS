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
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  const response = await handlePymesRequest(api, new Request("http://localhost/v1/workspaces/agency-1/ingress/openclaw", {
    method: "POST", headers: { "x-pymes-ingress-token": "ingress-token-123456", "content-type": "application/json" },
    body: JSON.stringify(envelope)
  }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, "openclaw:evt-api-1");
  const auditBody = api.handle({ method: "GET", path: "/v1/workspaces/agency-1/cases/openclaw:evt-api-1/audit", authorization: "Bearer owner-token-123456" }).body;
  assert.equal(Array.isArray(auditBody.audit) ? auditBody.audit.length : 0, 1);
});

test("internal ingress token and policy are not caller-controlled", async () => {
  const api = new WorkspaceApi(undefined, { token: "ingress-token-123456", policy });
  const response = await handlePymesRequest(api, new Request("http://localhost/v1/workspaces/agency-1/ingress/openclaw", {
    method: "POST", headers: { "x-pymes-ingress-token": "wrong-token", "content-type": "application/json" },
    body: JSON.stringify({ ...envelope, tenantId: "agency-2", agentId: "untrusted" })
  }));
  assert.equal(response.status, 401);
});

test("internal ingress reports duplicate events as a conflict", async () => {
  const api = new WorkspaceApi(undefined, { token: "ingress-token-123456", policy });
  const init = { method: "POST", headers: { "x-pymes-ingress-token": "ingress-token-123456", "content-type": "application/json" }, body: JSON.stringify(envelope) } as const;
  assert.equal((await handlePymesRequest(api, new Request("http://localhost/v1/workspaces/agency-1/ingress/openclaw", init))).status, 201);
  const duplicate = await handlePymesRequest(api, new Request("http://localhost/v1/workspaces/agency-1/ingress/openclaw", init));
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, "DUPLICATE_EVENT");
});
