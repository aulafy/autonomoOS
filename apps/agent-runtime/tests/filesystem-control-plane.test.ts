import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FilesystemWorkspace } from "@agent-world/filesystem";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "../src/demo-control-plane.js";

test("governed file.write creates real hello.txt and commits only after disk observation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "h2-e2e-"));
  const workspaceRoot = join(directory, "workspace");
  mkdirSync(workspaceRoot);
  const database = new RuntimeDatabase(join(directory, "runtime.db"));
  try {
    const clock = new ReplayClock();
    const kernel = new JournalKernel(database, clock);
    const stores = createDurableDomainStores(kernel);
    await kernel.restore();
    const filesystem = new FilesystemWorkspace(workspaceRoot, stores.resources);
    const file = filesystem.registerFile({ relativePath: "hello.txt" });
    const events: string[] = [];
    const control = createDemoControlPlane(new WorldRuntime(), event => {
      events.push(event.type === "control.event"
        ? String(event.payload.controlEventType) : event.type);
      database.appendRuntimeEvent(event);
    }, { kernel, stores, filesystem });
    control.recoverOnStartup();
    const content = "Hello from Agent World OS";
    const objectId = await control.stageTrustedContent("task-file", "astra", content,
      { confidentiality: "public", categories: [], jurisdictions: [],
        ownerPrincipalIds: [], releasable: true, metadata: {} });
    const result = await control.run({ id: "intent-file", actorId: "astra",
      action: "file.write", targetId: "hello.txt",
      parameters: { mode: "create", content }, provenance: { source: "human" } },
    "task-file", "task-file", undefined, undefined, { flowObjectIds: [objectId] });
    assert.equal(result.status, "completed", result.reasonCode);
    assert.deepEqual(readFileSync(join(workspaceRoot, "hello.txt")),
      Buffer.from(content, "utf8"));
    assert.equal(stores.effects.get(result.effectId!)?.status, "committed");
    assert.equal(stores.budgets.getReservation(stores.effects.get(result.effectId!)!
      .budgetReservationIds[0]!)?.status, "committed");
    assert.equal(stores.budgets.getBudget("budget:task-file")?.consumed.bytes,
      String(Buffer.byteLength(content, "utf8")));
    assert.equal(stores.observations.listByEffect(result.effectId!).at(-1)?.status,
      "confirmed");
    assert.equal(stores.resources.get(file.id)?.generation, 2);
    assert.equal(await control.mayComplete("task-file"), true);
    assert.equal(stores.tasks.get("task-file")?.status, "completed");
    assert.ok(events.indexOf("effect.dispatching") < events.indexOf("effect.committed"));
    assert.ok(database.runtimeEvents().some(event => event.type === "control.event" &&
      (event.payload as { controlEventType?: string }).controlEventType === "effect.dispatching"));
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("unregistered target and secret-to-public flow deny without changing bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "h2-denial-"));
  const workspaceRoot = join(directory, "workspace");
  mkdirSync(workspaceRoot);
  const database = new RuntimeDatabase(join(directory, "runtime.db"));
  try {
    const clock = new ReplayClock();
    const kernel = new JournalKernel(database, clock);
    const stores = createDurableDomainStores(kernel);
    await kernel.restore();
    const filesystem = new FilesystemWorkspace(workspaceRoot, stores.resources);
    filesystem.registerFile({ relativePath: "public.txt", sink: {
      external: true, trustClass: "public", allowedSensitivity: ["public"] } });
    const control = createDemoControlPlane(new WorldRuntime(), event =>
      database.appendRuntimeEvent(event), { kernel, stores, filesystem });
    control.recoverOnStartup();
    const secret = "private value";
    const objectId = await control.stageTrustedContent("task-secret", "astra", secret,
      { confidentiality: "secret", categories: [], jurisdictions: [],
        ownerPrincipalIds: [], releasable: false, metadata: {} });
    const denied = await control.run({ id: "i1", actorId: "astra", action: "file.write",
      targetId: "public.txt", parameters: { mode: "create", content: secret },
      provenance: { source: "model" } }, "task-secret", "task-secret", undefined,
    undefined, { flowObjectIds: [objectId] });
    assert.equal(denied.status, "denied");
    assert.equal(denied.reasonCode, "FLOW_DENIED");
    assert.equal(stores.effects.list().length, 0);
    assert.throws(() => readFileSync(join(workspaceRoot, "public.txt")), /ENOENT/);
    const unregistered = await control.run({ id: "i2", actorId: "astra",
      action: "file.write", targetId: "invented.txt",
      parameters: { mode: "create", content: secret },
      provenance: { source: "model" } }, "task-secret", "task-secret", undefined,
    undefined, { flowObjectIds: [objectId] });
    assert.equal(unregistered.status, "denied");
    assert.equal(stores.effects.list().length, 0);
    assert.ok(database.runtimeEvents().some(event => event.type === "control.event" &&
      (event.payload as { controlEventType?: string; reasonCode?: string })
        .reasonCode === "RESOURCE_NOT_FOUND"));
    assert.throws(() => readFileSync(join(workspaceRoot, "invented.txt")), /ENOENT/);
    for (const targetId of ["../outside.txt", "/etc/passwd", "public.txt/../outside.txt"]) {
      const invalid = await control.run({ id: `invalid:${targetId}`, actorId: "astra",
        action: "file.write", targetId,
        parameters: { mode: "create", content: secret },
        provenance: { source: "model" } }, "task-secret", "task-secret", undefined,
      undefined, { flowObjectIds: [objectId] });
      assert.equal(invalid.reasonCode, "INVALID_LOGICAL_PATH");
    }
    assert.equal(stores.effects.list().length, 0);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("governed secret read taints C9 and C8 blocks a later file write", async () => {
  const directory = mkdtempSync(join(tmpdir(), "h2-read-"));
  const workspaceRoot = join(directory, "workspace");
  mkdirSync(workspaceRoot);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(workspaceRoot, "secret.txt"), "classified");
  const database = new RuntimeDatabase(join(directory, "runtime.db"));
  try {
    const clock = new ReplayClock();
    const kernel = new JournalKernel(database, clock);
    const stores = createDurableDomainStores(kernel);
    await kernel.restore();
    const filesystem = new FilesystemWorkspace(workspaceRoot, stores.resources);
    filesystem.registerFile({ relativePath: "secret.txt", label: {
      sensitivity: "secret", categories: [], source: "host", classifiedAt: Date.now() } });
    filesystem.registerFile({ relativePath: "output.txt" });
    const control = createDemoControlPlane(new WorldRuntime(), event =>
      database.appendRuntimeEvent(event), { kernel, stores, filesystem });
    control.recoverOnStartup();
    const read = await control.run({ id: "read", actorId: "astra", action: "file.read",
      targetId: "secret.txt", parameters: {}, provenance: { source: "model" } },
    "task-read", "task-read");
    assert.equal(read.status, "completed", read.reasonCode);
    assert.equal(stores.dataObjects.get(`file-read:${read.effectId}`)?.label?.confidentiality,
      "secret");
    assert.equal(stores.workingSets.get("task-read").objectIds.length, 1);
    assert.ok(stores.history.listByTask("task-read").some(fact =>
      fact.kind === "sensitive_read"));
    const content = "public text";
    const objectId = await control.stageTrustedContent("task-read", "astra", content,
      { confidentiality: "public", categories: [], jurisdictions: [],
        ownerPrincipalIds: [], releasable: true, metadata: {} });
    const write = await control.run({ id: "write", actorId: "astra", action: "file.write",
      targetId: "output.txt", parameters: { mode: "create", content },
      provenance: { source: "model" } }, "task-read", "task-read", undefined,
    undefined, { flowObjectIds: [objectId] });
    assert.equal(write.reasonCode, "COMPOSITION_APPROVAL_REQUIRED");
    assert.equal(stores.effects.list().length, 1);
    assert.throws(() => readFileSync(join(workspaceRoot, "output.txt")), /ENOENT/);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
