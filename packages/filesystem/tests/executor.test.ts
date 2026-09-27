import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryResourceRegistry } from "@agent-world/resources";
import { FilesystemReadExecutor, FilesystemWorkspace, FilesystemWriteExecutor } from
  "../src/index.js";

test("filesystem executor creates atomically, refuses implicit overwrite and replaces explicitly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "h2-executor-"));
  try {
    const workspace = new FilesystemWorkspace(directory, new InMemoryResourceRegistry());
    const file = workspace.registerFile({ relativePath: "hello.txt" });
    const writer = new FilesystemWriteExecutor(workspace);
    const context = { taskId: "t1", intentId: "i1", effectId: "e1",
      idempotencyKey: "key", resourceIds: [file.id],
      parameters: { content: "Hello from Agent World OS", mode: "create" } };
    const signal = new AbortController().signal;
    const result = await writer.dispatch(context, signal);
    assert.equal(result.kind, "reported_success");
    assert.equal(readFileSync(join(directory, "hello.txt"), "utf8"),
      "Hello from Agent World OS");
    assert.equal(result.metadata.sha256, createHash("sha256")
      .update(Buffer.from("Hello from Agent World OS", "utf8")).digest("hex"));
    const duplicate = await writer.dispatch(context, signal);
    assert.deepEqual({ kind: duplicate.kind, certainty: "certainty" in duplicate
      ? duplicate.certainty : undefined },
    { kind: "reported_failure", certainty: "certified_not_started" });
    assert.equal(readFileSync(join(directory, "hello.txt"), "utf8"),
      "Hello from Agent World OS");
    const replaced = await writer.dispatch({ ...context, effectId: "e2",
      parameters: { content: "replacement", mode: "replace" } }, signal);
    assert.equal(replaced.kind, "reported_success");
    assert.equal(readFileSync(join(directory, "hello.txt"), "utf8"), "replacement");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("read keeps bytes host-side and symlink destinations never change outside files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "h2-executor-"));
  const root = join(directory, "root");
  mkdirSync(root);
  const outside = join(directory, "outside.txt");
  writeFileSync(outside, "outside");
  writeFileSync(join(root, "safe.txt"), "secret");
  try {
    const workspace = new FilesystemWorkspace(root, new InMemoryResourceRegistry());
    const file = workspace.registerFile({ relativePath: "safe.txt" });
    const reader = new FilesystemReadExecutor(workspace);
    const context = { taskId: "t1", intentId: "i1", effectId: "e1",
      idempotencyKey: "key", resourceIds: [file.id], parameters: {} };
    assert.equal((await reader.dispatch(context, new AbortController().signal)).kind,
      "reported_success");
    assert.equal(reader.takeReadResult("e1")?.toString("utf8"), "secret");
    assert.equal(reader.takeReadResult("e1"), null);
    const escaping = workspace.registerFile({ relativePath: "escape.txt" });
    symlinkSync(outside, join(root, "escape.txt"));
    const writer = new FilesystemWriteExecutor(workspace);
    const result = await writer.dispatch({ ...context, resourceIds: [escaping.id],
      parameters: { content: "attack", mode: "replace" } }, new AbortController().signal);
    assert.equal(result.kind, "reported_failure");
    assert.equal(readFileSync(outside, "utf8"), "outside");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
