import assert from "node:assert/strict";
import test from "node:test";
import { executeConfirmedEffects } from "../src/effect-worker.js";
import { InMemoryEffectLeaseStore } from "../src/effect-lease.js";
import type { RemoteEffect, WorkspaceClient } from "../src/workspace-client.js";

const base = (id: string): RemoteEffect => ({ tenantId: "agency-1", id, caseId: `case-${id}`, kind: "crm_task", status: "confirmed", requestedBy: "owner-1", requestedAt: "2026-09-30T08:00:00Z", confirmedBy: "reviewer-1", payload: { title: "Task", contactId: "contact-1" } });

test("batch worker continues after an item fails", async () => {
  const completed: string[] = [];
  const client = { async confirmedEffects() { return [base("one"), base("two")]; }, async effect(id: string) { return id === "one" ? base(id) : base(id); }, async reportEffectResult(id: string, result: "succeeded" | "failed") { completed.push(`${id}:${result}`); return { ...base(id), status: result }; } } as unknown as WorkspaceClient;
  const results = await executeConfirmedEffects({ client, handlers: { crm_task: { async execute(effect) { if (effect.id === "one") throw new Error("PROVIDER_DOWN"); return "created"; } } } });
  assert.deepEqual(results.map(value => value.status), ["failed", "succeeded"]);
  assert.deepEqual(completed, ["one:failed", "two:succeeded"]);
});

test("batch worker bounds the number of effects", async () => {
  const client = { async confirmedEffects() { return [base("one"), base("two")]; } } as unknown as WorkspaceClient;
  await assert.rejects(() => executeConfirmedEffects({ client, handlers: {}, limit: 0 }), /INVALID_EFFECT_BATCH_LIMIT/);
});

test("batch worker skips an effect leased by another owner and releases its own lease", async () => {
  const leases = new InMemoryEffectLeaseStore();
  leases.acquire("one", "other-worker");
  const completed: string[] = [];
  const client = { async confirmedEffects() { return [base("one"), base("two")]; }, async effect(id: string) { return base(id); }, async reportEffectResult(id: string, result: "succeeded" | "failed") { completed.push(id); return { ...base(id), status: result }; } } as unknown as WorkspaceClient;
  const results = await executeConfirmedEffects({ client, leaseStore: leases, leaseOwnerId: "worker-a", handlers: { crm_task: { async execute() { return "created"; } } } });
  assert.deepEqual(results.map(value => value.status), ["skipped", "succeeded"]);
  assert.deepEqual(completed, ["two"]);
  assert.equal(leases.acquire("two", "worker-b" )?.ownerId, "worker-b");
});
