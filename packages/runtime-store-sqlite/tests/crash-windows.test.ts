import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EffectCoordinator } from "@agent-world/effects";
import { InMemoryObserverRegistry, ObservationPolicy } from "@agent-world/observation";
import { ReconciliationService } from "@agent-world/reconciliation";
import { RecoveryManager, RuntimeModeController } from "@agent-world/recovery";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "../src/index.js";

const fixture = fileURLToPath(new URL("./fixtures/crash-window.ts", import.meta.url));

test("SIGKILL windows A-H recover in fresh processes without redispatch", async () => {
  for (const window of "ABCDEFGH") {
    const directory = mkdtempSync(join(tmpdir(), `h1-crash-${window}-`));
    const path = join(directory, "runtime.db");
    const marker = join(directory, "external-attempt.txt");
    try {
      const child = spawnSync(process.execPath,
        ["--import", "tsx", fixture, path, window, marker], {
          cwd: fileURLToPath(new URL("../../..", import.meta.url)),
          encoding: "utf8", timeout: 15000 });
      assert.equal(child.signal, "SIGKILL", `${window}: ${child.stderr}`);
      const before = existsSync(marker) ? readFileSync(marker, "utf8") : "";
      const clock = new ReplayClock(() => 150);
      const database = new RuntimeDatabase(path, clock.now);
      const kernel = new JournalKernel(database, clock);
      const stores = createDurableDomainStores(kernel);
      await kernel.restore();
      const observers = new InMemoryObserverRegistry();
      observers.register({ descriptor: { id: "observer", implementation: "fixture",
        sourceType: "world", independence: "independent_local", strength: "strong",
        authenticated: true, metadata: {} }, observe: async () => {
          throw new Error("RECOVERY_MUST_NOT_OBSERVE_OR_DISPATCH");
        } });
      const policy = new ObservationPolicy(clock);
      const coordinator = new EffectCoordinator(stores.effects, stores.observations,
        observers, policy, stores.effectEvents, clock);
      const mode = new RuntimeModeController();
      const reconciliation = new ReconciliationService(stores.effects,
        stores.reconciliations, stores.observations, observers, policy, [], clock.now);
      const recoveryEvents: unknown[] = [];
      const recovery = new RecoveryManager({ effects: stores.effects, coordinator,
        observations: stores.observations, observers, observationPolicy: policy,
        budgets: stores.budgets, queue: stores.reconciliations, reconciliation,
        emergencyStop: stores.emergencyStop, quarantines: stores.quarantines,
        mode, events: { append: event => { recoveryEvents.push(event); database.appendRuntimeEvent({
          ...event, id: `${window}:${event.type}:${crypto.randomUUID()}`,
          timestamp: event.at }); } }, now: clock.now,
        criticalStoresHealthy: kernel.isHealthy.bind(kernel), policyHealthy: () => true,
        resourcesHealthy: () => true, authorityReadable: () => true });
      assert.deepEqual(recovery.run().failedActions, [],
        `window ${window}: ${JSON.stringify(recoveryEvents)}`);
      const effect = stores.effects.get("e1");
      const reservation = stores.budgets.getReservation("r1")!;
      if (window === "A" || window === "B") {
        assert.equal(effect?.status ?? null, window === "A" ? null : "failed");
        assert.equal(reservation.status, "released");
      } else if ("CDE".includes(window)) {
        assert.equal(effect?.status, "unknown");
        assert.equal(reservation.status, "active");
        assert.equal(stores.reconciliations.list().length, 1);
      } else {
        assert.equal(effect?.status, "committed");
        assert.equal(reservation.status, "committed");
        assert.equal(stores.reconciliations.list().length, 0);
      }
      assert.equal(stores.tasks.get("t1")?.status, "running");
      assert.equal(existsSync(marker) ? readFileSync(marker, "utf8") : "", before);
      const again = new RecoveryManager({ effects: stores.effects, coordinator,
        observations: stores.observations, observers, observationPolicy: policy,
        budgets: stores.budgets, queue: stores.reconciliations, reconciliation,
        emergencyStop: stores.emergencyStop, quarantines: stores.quarantines,
        mode: new RuntimeModeController(), events: { append: () => {} }, now: clock.now,
        criticalStoresHealthy: kernel.isHealthy.bind(kernel), policyHealthy: () => true,
        resourcesHealthy: () => true, authorityReadable: () => true });
      again.run();
      assert.equal(stores.reconciliations.list().length, "CDE".includes(window) ? 1 : 0);
      assert.equal(stores.budgets.getReservation("r1")?.status, reservation.status);
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
