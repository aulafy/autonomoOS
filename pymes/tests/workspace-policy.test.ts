import assert from "node:assert/strict";
import test from "node:test";
import { can, createApproval, requirePermission, type WorkspacePrincipal } from "../src/workspace-policy.js";

const resource = { tenantId: "agency-1", id: "offer-1" };
const principal = (role: WorkspacePrincipal["role"], tenantId = "agency-1"): WorkspacePrincipal =>
  ({ userId: `${role}-1`, tenantId, role });

test("roles remain scoped to tenant and operation", () => {
  assert.equal(can(principal("agent"), "prepareQuote", resource), true);
  assert.equal(can(principal("agent"), "approveOffer", resource), false);
  assert.equal(can(principal("reviewer"), "approveOffer", resource), true);
  assert.equal(can(principal("reviewer"), "executeEffect", resource), false);
  assert.equal(can(principal("owner", "agency-2"), "approveOffer", resource), false);
});

test("permission checks fail closed", () => {
  assert.throws(() => requirePermission(principal("agent"), "approveOffer", resource),
    /WORKSPACE_PERMISSION_DENIED/);
  assert.throws(() => requirePermission(principal("owner", "agency-2"), "executeEffect", resource),
    /WORKSPACE_PERMISSION_DENIED/);
});

test("approval records actor, tenant, reason and draft version", () => {
  const approval = createApproval({ id: "approval-1", principal: principal("reviewer"),
    resource, operation: "approveOffer", approvedAt: "2026-09-29T10:00:00Z",
    reason: "Oferta revisada con el documento original", draftHash: "sha256:abc" });
  assert.deepEqual(approval, {
    id: "approval-1", tenantId: "agency-1", resourceId: "offer-1",
    operation: "approveOffer", approvedBy: "reviewer-1",
    approvedAt: "2026-09-29T10:00:00Z",
    reason: "Oferta revisada con el documento original", draftHash: "sha256:abc"
  });
});

test("approval requires meaningful reason and valid timestamp", () => {
  assert.throws(() => createApproval({ id: "a", principal: principal("reviewer"), resource,
    operation: "approveOffer", approvedAt: "bad", reason: "ok", draftHash: "hash" }),
    /INVALID_APPROVAL/);
});
