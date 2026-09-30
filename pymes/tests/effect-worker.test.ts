import assert from "node:assert/strict";
import test from "node:test";
import { executeRemoteEffect, runEffectWorker, summarizeEffectBatch } from "../src/effect-worker.js";
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

test("worker loop never overlaps polls and stops on abort", async () => {
  const controller = new AbortController();
  let active = 0;
  let calls = 0;
  const cycles: number[] = [];
  await runEffectWorker({
    intervalMs: 250, signal: controller.signal,
    poll: async () => {
      active += 1; assert.equal(active, 1); calls += 1;
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1; if (calls === 2) controller.abort();
      return [{ effectId: `effect-${calls}`, status: "succeeded" }];
    },
    onCycle: results => { cycles.push(results.length); },
  });
  assert.equal(calls, 2); assert.deepEqual(cycles, [1, 1]);
});

test("worker loop rejects unsafe polling intervals", async () => {
  await assert.rejects(() => runEffectWorker({ intervalMs: 10, poll: async () => [] }), /INVALID_EFFECT_WORKER_INTERVAL/);
});

test("worker batch summary exposes only safe counters", () => {
  assert.deepEqual(summarizeEffectBatch([
    { effectId: "a", status: "succeeded" },
    { effectId: "b", status: "failed", error: "secret message" },
    { effectId: "c", status: "skipped", error: "provider token" },
  ]), { total: 3, succeeded: 1, failed: 1, skipped: 1 });
});

test("worker loop supports a finite max cycle run", async () => {
  let calls = 0;
  await runEffectWorker({ intervalMs: 250, maxCycles: 3, poll: async () => { calls += 1; return []; } });
  assert.equal(calls, 3);
});

test("worker loop emits a safe summary callback", async () => {
  let summary: unknown;
  await runEffectWorker({ maxCycles: 1, poll: async () => [
    { effectId: "ok", status: "succeeded" }, { effectId: "bad", status: "failed", error: "private" },
  ], onSummary: value => { summary = value; } });
  assert.deepEqual(summary, { total: 2, succeeded: 1, failed: 1, skipped: 0 });
});

test("worker loop rejects unsafe max cycle values", async () => {
  await assert.rejects(() => runEffectWorker({ maxCycles: 0, poll: async () => [] }), /INVALID_EFFECT_WORKER_MAX_CYCLES/);
});

test("worker loop rejects a non-array polling result", async () => {
  await assert.rejects(() => runEffectWorker({ maxCycles: 1, poll: async () => null as unknown as never }), /INVALID_EFFECT_WORKER_RESULTS/);
});

test("worker loop rejects malformed batch entries", async () => {
  await assert.rejects(() => runEffectWorker({ maxCycles: 1, poll: async () => [{ effectId: "", status: "pending" } as never] }), /INVALID_EFFECT_WORKER_RESULTS/);
});

test("worker loop rejects duplicate effect results", async () => {
  await assert.rejects(() => runEffectWorker({ maxCycles: 1, poll: async () => [
    { effectId: "same", status: "succeeded" }, { effectId: "same", status: "failed" },
  ] }), /INVALID_EFFECT_WORKER_RESULTS/);
});

test("worker loop rejects batches over the execution bound", async () => {
  const results = Array.from({ length: 101 }, (_, index) => ({ effectId: `effect-${index}`, status: "succeeded" as const }));
  await assert.rejects(() => runEffectWorker({ maxCycles: 1, poll: async () => results }), /INVALID_EFFECT_WORKER_RESULTS/);
});

test("worker loop reports a poll error and retries after a bounded delay", async () => {
  const controller = new AbortController();
  let calls = 0;
  const errors: string[] = [];
  await runEffectWorker({ intervalMs: 250, retryDelayMs: 250, signal: controller.signal,
    poll: async () => { calls += 1; if (calls === 1) throw new Error("API_DOWN"); controller.abort(); return []; },
    onError: error => { errors.push(error instanceof Error ? error.message : "unknown"); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(errors, ["API_DOWN"]);
});
