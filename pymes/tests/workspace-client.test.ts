import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceApi } from "../src/workspace-api.js";
import { handlePymesRequest } from "../src/api-server.js";
import { WorkspaceClient } from "../src/workspace-client.js";

function client() {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
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
});

test("workspace client rejects invalid configuration", () => {
  assert.throws(() => new WorkspaceClient({ baseUrl: "", tenantId: "a", token: "t" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
});
