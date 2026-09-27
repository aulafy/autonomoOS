import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryResourceRegistry } from "@agent-world/resources";
import { FilesystemObserver, FilesystemReconciler, FilesystemWorkspace } from
  "../src/index.js";

test("independent observer hashes disk and reconciler performs no write", async () => {
  const directory = mkdtempSync(join(tmpdir(), "h2-observer-"));
  try {
    const resources = new InMemoryResourceRegistry(() => 100);
    const workspace = new FilesystemWorkspace(directory, resources);
    const file = workspace.registerFile({ relativePath: "hello.txt" });
    const content = Buffer.from("Hello from Agent World OS", "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    const expectedPostcondition = { kind: "filesystem_write", resourceIds: [file.id],
      predicate: "hash" as const, expected: { sha256: hash, byteLength: content.length },
      metadata: {} };
    const subject = { taskId: "t1", intentId: "i1", executionId: "x1",
      effectId: "e1", resourceIds: [file.id] };
    const observer = new FilesystemObserver(workspace, resources, () => 100);
    const request = { subject, expectedPostcondition,
      context: { resourceIds: [file.id] } };
    assert.equal((await observer.observe(request, new AbortController().signal)).status,
      "contradicted");
    writeFileSync(join(directory, "hello.txt"), content);
    const observed = await observer.observe(request, new AbortController().signal);
    assert.equal(observed.status, "confirmed");
    assert.equal(observed.evidence[0]?.metadata.sha256, hash);
    writeFileSync(join(directory, "hello.txt"), "different");
    assert.equal((await observer.observe(request, new AbortController().signal)).status,
      "contradicted");
    writeFileSync(join(directory, "hello.txt"), content);
    const reconciler = new FilesystemReconciler(observer);
    const effect = { id: "e1", taskId: "t1", intentId: "i1", executionId: "x1",
      executorId: "filesystem-write", resourceIds: [file.id], expectedPostcondition };
    assert.equal(reconciler.supports(effect as Parameters<typeof reconciler.supports>[0]), true);
    const result = await reconciler.reconcile(effect as Parameters<typeof reconciler.reconcile>[0],
      1, new AbortController().signal);
    assert.equal(result.kind, "observations");
    if (result.kind === "observations") assert.equal(result.observations[0]?.status, "confirmed");
    assert.deepEqual(readFileSync(join(directory, "hello.txt")), content);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
