import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceApi } from "../src/workspace-api.js";
import { handlePymesRequest } from "../src/api-server.js";
import { WorkspaceClient, WorkspaceConflictError } from "../src/workspace-client.js";

function client() {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.addInbox({ id: "msg-remote", tenantId: "agency-1", state: "pending_review", summary: "Caso remoto" });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api,
    new Request(String(input), init));
  return new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1",
    token: "owner-token-123456" }, fetcher);
}

test("workspace client uses the API contract for approvals", async () => {
  const value = client();
  const created = await value.approve({ resourceId: "offer-1", reason: "Revisión completa",
    draftHash: "sha256:v1", approvedAt: "2026-09-29T14:00:00Z" });
  assert.equal(created.resourceId, "offer-1");
  assert.equal((await value.approvals()).length, 1);
  assert.equal((await value.inbox())[0]?.id, "msg-remote");
});

test("workspace client reads an individual effect", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects", authorization: "Bearer owner-token-123456",
    body: { id: "effect-client", caseId: "case-1", kind: "crm_task", payload: { title: "Llamar" },
      requestedAt: "2026-09-29T14:00:00Z", draftHash: "sha256:test" } });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  const effect = await value.effect("effect-client");
  assert.equal(effect.kind, "crm_task");
  assert.equal(effect.status, "pending");
  assert.equal((await value.effectsForCase("case-1")).length, 1);
});

test("workspace client performs an authenticated case transition", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.addInbox({ id: "case-client", tenantId: "agency-1", state: "approved", summary: "Caso listo" });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await value.transition("case-client", "executing", "2026-09-29T15:00:00Z", 0);
  assert.equal((await value.inbox())[0]?.state, "executing");
});

test("workspace client exposes current version on transition conflict", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.addInbox({ id: "case-conflict", tenantId: "agency-1", state: "approved", summary: "Caso", version: 3 });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.transition("case-conflict", "executing", "2026-09-29T15:00:00Z", 2),
    (error: unknown) => error instanceof WorkspaceConflictError && error.currentVersion === 3);
});

test("workspace client retries a failed effect through the API", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects", authorization: "Bearer owner-token-123456",
    body: { id: "effect-retry", caseId: "case-1", kind: "call", payload: { phone: "+34600000000" }, requestedAt: "2026-09-29T14:00:00Z", draftHash: "sha256:test" } });
  api.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-retry/confirm", authorization: "Bearer owner-token-123456",
    body: { confirm: true, confirmedAt: "2026-09-29T14:01:00Z" } });
  api.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-retry/result", authorization: "Bearer owner-token-123456",
    body: { result: "failed", executedAt: "2026-09-29T14:02:00Z", note: "No responde" } });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  const retry = await value.retryEffect("effect-retry", "Nueva franja disponible", "2026-09-29T15:00:00Z");
  assert.equal(retry.status, "pending");
});

test("workspace client rejects invalid configuration", () => {
  assert.throws(() => new WorkspaceClient({ baseUrl: "", tenantId: "a", token: "t" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "a", token: "short" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "a", token: "x".repeat(4097) }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "x".repeat(201), token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "not-a-url", tenantId: "agency-1", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "https://user:pass@workspace.local", tenantId: "agency-1", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "https://workspace.local/?tenant=other", tenantId: "agency-1", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: `https://${"a".repeat(2040)}.local`, tenantId: "agency-1", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1\nother", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456", requestTimeoutMs: 99 }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
});

test("workspace client can revoke its current session", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await value.revokeSession();
  await assert.rejects(() => value.inbox(), /UNAUTHENTICATED/);
});

test("workspace client trims endpoint and credential configuration", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: " http://workspace.local/ ", tenantId: " agency-1 ", token: " owner-token-123456 " }, fetcher);
  assert.equal((await value.inbox()).length, 0);
});

test("workspace client aborts a request after its configured timeout", async () => {
  const fetcher: typeof fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456", requestTimeoutMs: 100 }, fetcher);
  await assert.rejects(() => value.inbox(), (error: unknown) => error instanceof DOMException && error.name === "AbortError");
});
