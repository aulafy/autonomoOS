import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route, defaultRoutingWeights, type RoutingRequest } from "@agent-world/routing";
import { RuntimeDatabase, JournalKernel, ReplayClock, createDurableRoutingStore } from "../src/index.js";
test("routing inputs, scores and explanation survive closing SQLite and replay unchanged", async () => {
  const folder = mkdtempSync(join(tmpdir(), "aw2-routing-")); let database = new RuntimeDatabase(join(folder,"runtime.db"));
  try {
    const input: RoutingRequest = { taskId: "task", workUnit: { id: "unit", title: "Verify", objective: "Run authorized check", dependencies: [], requiredCapabilities: [{ capability: "test.run" }], constraints: [], expectedArtifacts: [], successCriteria: [{ id: "test", kind: "custom", verifierId: "host", input: null }] },
      policySnapshotRef: "policy:1", decidedAt: 100, mode: "deterministic", candidates: [{ actor: { id: "local:test", providerId: "local", kind: "deterministic", capabilities: [{ capability: "test.run", confidence: 1 }], costProfile: { currency: "EUR", estimatedCost: 0 }, latencyProfile: { estimatedMs: 1 }, trustProfile: { level: "restricted" }, privacyProfile: { locality: "local", dataResidency: ["ES"] }, availability: "available" }, providerAvailability: { status: "available", capabilities: ["test.run"] }, policyAllowed: true, informationFlowAllowed: true, resourceAccessAllowed: true, satisfiedRuleRefs: [], reliability: 1, contextLocality: 1 }],
      constraints: { minimumTrust: "restricted", requiredLocality: "local" }, budget: { currency: "EUR", remaining: 0, snapshotRef: "budget:1" }, weights: { ...defaultRoutingWeights }, normalization: { cost: 1, latencyMs: 100 } };
    const journal = new JournalKernel(database, new ReplayClock(() => 100)); const store = createDurableRoutingStore(journal); await journal.restore();
    const decision = route(input); store.record(decision); database.close();
    database = new RuntimeDatabase(join(folder,"runtime.db"));
    const restoredJournal = new JournalKernel(database, new ReplayClock(() => 200)); const restored = createDurableRoutingStore(restoredJournal); await restoredJournal.restore();
    assert.deepEqual(restored.get(decision.id),decision);
    assert.deepEqual(route(restored.get(decision.id)!.input),decision);
    restored.record(decision); assert.equal(restored.list("task").length,1);
    assert.equal(restored.list("another-task").length,0);
  } finally { database.close(); rmSync(folder,{ recursive:true, force:true }); }
});
