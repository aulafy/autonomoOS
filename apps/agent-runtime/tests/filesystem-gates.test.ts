import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FilesystemWorkspace } from "@agent-world/filesystem";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "../src/demo-control-plane.js";

type Stores = ReturnType<typeof createDurableDomainStores>;
const mutations: Record<string, (stores: Stores, fileId: ReturnType<FilesystemWorkspace["registerFile"]>["id"]) => void> = {
  revoked_grant(stores) {
    stores.grants.revoke("grant:t1", 1, Date.now());
  },
  revoked_authority_lease(stores) {
    const lease = stores.authorityLeases.get("authority:t1")!;
    stores.authorityLeases.setStatus(lease.id, "revoked", lease.version);
  },
  stale_fence(stores, fileId) {
    const lease = stores.resourceLeases.getCurrent(fileId)!;
    stores.resourceLeases.revoke(lease.id, lease.version);
    stores.resourceLeases.acquire({ id: "new-writer", resourceId: fileId,
      holderPrincipalId: "other", taskId: "other", expiresAt: Date.now() + 30000 });
  },
  changed_generation(stores, fileId) {
    const current = stores.resources.get(fileId)!;
    stores.resources.update({ ...current, generation: current.generation + 1 }, current.version);
  },
  changed_composition(stores, fileId) {
    stores.history.append({ id: "new-sensitive-read", taskId: "t1", kind: "sensitive_read",
      occurredAt: Date.now(), source: "trusted_control_event", sourceId: "event-1",
      resourceIds: [fileId], metadata: {} });
  },
  changed_working_set(stores) {
    stores.dataObjects.addSource({ id: "new-object", taskId: "t1", origin: "human",
      createdAt: Date.now(), label: { confidentiality: "public", categories: [],
        jurisdictions: [], ownerPrincipalIds: [], releasable: true, metadata: {} },
      metadata: {} });
    stores.workingSets.add("t1", "new-object", stores.workingSets.get("t1").version);
  },
  emergency_stop(stores) {
    stores.emergencyStop.activate("test", Date.now());
  },
  executor_quarantine(stores) {
    stores.quarantines.add({ id: "q1", executorId: "filesystem-write",
      reason: "test", createdAt: Date.now(), active: true });
  }
};

for (const [name, mutate] of Object.entries(mutations)) {
  test(`filesystem write has zero mutation when ${name} changes before commit gate`, async () => {
    const directory = mkdtempSync(join(tmpdir(), `h2-gate-${name}-`));
    const root = join(directory, "workspace");
    mkdirSync(root);
    const database = new RuntimeDatabase(join(directory, "runtime.db"));
    try {
      const clock = new ReplayClock();
      const kernel = new JournalKernel(database, clock);
      const stores = createDurableDomainStores(kernel);
      await kernel.restore();
      const filesystem = new FilesystemWorkspace(root, stores.resources);
      const file = filesystem.registerFile({ relativePath: "hello.txt" });
      const control = createDemoControlPlane(new WorldRuntime(), event =>
        database.appendRuntimeEvent(event), { kernel, stores, filesystem,
          beforeCommitGate: () => mutate(stores, file.id) });
      control.recoverOnStartup();
      const content = "Hello from Agent World OS";
      const objectId = await control.stageTrustedContent("t1", "astra", content,
        { confidentiality: "public", categories: [], jurisdictions: [],
          ownerPrincipalIds: [], releasable: true, metadata: {} });
      const result = await control.run({ id: "i1", actorId: "astra", action: "file.write",
        targetId: "hello.txt", parameters: { mode: "create", content },
        provenance: { source: "human" } }, "t1", "t1", undefined, undefined,
      { flowObjectIds: [objectId] });
      assert.notEqual(result.status, "completed", `${name}: ${result.reasonCode}`);
      assert.equal(existsSync(join(root, "hello.txt")), false);
      assert.equal(stores.effects.list().some(effect => effect.status === "dispatching"), false);
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}
