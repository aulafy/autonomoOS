import assert from "node:assert/strict";
import test from "node:test";
import { transitionCase, transitionTable, type WorkspaceCase } from "../src/case-lifecycle.js";
import type { WorkspacePrincipal } from "../src/workspace-policy.js";

const current: WorkspaceCase = { id: "case-1", tenantId: "agency-1", state: "received",
  version: 0, updatedAt: "2026-09-29T08:00:00Z" };
const principal = (role: WorkspacePrincipal["role"]): WorkspacePrincipal =>
  ({ userId: role, tenantId: "agency-1", role });

test("case follows the governed proposal lifecycle", () => {
  let value = current;
  for (const [to, role] of [["pending_identity", "agent"], ["classified", "agent"],
    ["preparing_data", "agent"], ["offer_received", "agent"],
    ["pending_review", "agent"], ["approved", "reviewer"],
    ["executing", "owner"], ["confirmed", "owner"]] as const) {
    const at = new Date(Date.parse("2026-09-29T08:00:00Z") + (value.version + 1) * 3600000).toISOString();
    value = transitionCase({ current: value, to, principal: principal(role), at });
  }
  assert.equal(value.state, "confirmed");
  assert.equal(value.version, 8);
});

test("agent cannot approve and invalid jumps fail closed", () => {
  const pending = { ...current, state: "pending_review" as const, version: 5 };
  assert.throws(() => transitionCase({ current: pending, to: "approved",
    principal: principal("agent"), at: "2026-09-29T10:00:00Z" }), /WORKSPACE_PERMISSION_DENIED/);
  assert.throws(() => transitionCase({ current, to: "approved",
    principal: principal("owner"), at: "2026-09-29T10:00:00Z" }), /CASE_TRANSITION_NOT_ALLOWED/);
});

test("uncertain execution can only be retried through governed execution", () => {
  const uncertain = { ...current, state: "uncertain" as const, version: 4 };
  const next = transitionCase({ current: uncertain, to: "executing",
    principal: principal("owner"), at: "2026-09-29T10:00:00Z" });
  assert.equal(next.state, "executing");
  assert.equal(next.version, 5);
});

test("transition table has no direct received-to-effect path", () => {
  assert.equal(transitionTable().some(value => value.from === "received" && value.to === "executing"), false);
});
