import assert from "node:assert/strict";
import test from "node:test";
import { executeRemoteEffect } from "../src/effect-worker.js";
import type { RemoteEffect } from "../src/workspace-client.js";

const effect: RemoteEffect = { tenantId: "agency-1", id: "effect-1", caseId: "case-1", kind: "crm_task", status: "confirmed", requestedBy: "owner-1", requestedAt: "2026-09-30T08:00:00Z", confirmedBy: "reviewer-1", payload: { title: "Task", contactId: "contact-1" } };

test("worker reports provider success", async () => {
  const calls: string[] = [];
  const client = { async effect() { return effect; }, async reportEffectResult(_id: string, result: "succeeded" | "failed", note: string) { calls.push(`${result}:${note}`); return { ...effect, status: result }; } } as unknown as import("../src/workspace-client.js").WorkspaceClient;
  const result = await executeRemoteEffect({ client, effectId: "effect-1", handlers: { crm_task: { async execute() { return "CRM task created"; } } } });
  assert.equal(result.status, "succeeded"); assert.deepEqual(calls, ["succeeded:CRM task created"]);
});

test("worker records provider failure", async () => {
  const client = { async effect() { return effect; }, async reportEffectResult(_id: string, result: "succeeded" | "failed", note: string) { return { ...effect, status: result, executionNote: note }; } } as unknown as import("../src/workspace-client.js").WorkspaceClient;
  const result = await executeRemoteEffect({ client, effectId: "effect-1", handlers: { crm_task: { async execute() { throw new Error("PROVIDER_DOWN"); } } } });
  assert.equal(result.status, "failed"); assert.equal(result.executionNote, "PROVIDER_DOWN");
});
