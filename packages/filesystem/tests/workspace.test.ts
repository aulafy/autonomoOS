import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryResourceRegistry, mintResourceId } from "@agent-world/resources";
import { FilesystemWorkspace, validateLogicalPath } from "../src/index.js";

test("logical paths reject traversal, absolute and ambiguous spellings", () => {
  for (const value of ["../secret", "a/../secret", "/etc/passwd", "a//b", "a/./b",
    "a\\b", "a\0b", "A.txt", "a/", "a.", "é.txt", "a:b"]) {
    assert.throws(() => validateLogicalPath(value), /INVALID_LOGICAL_PATH/, value);
  }
  assert.equal(validateLogicalPath("notes/hello.txt"), "notes/hello.txt");
});

test("registered file is bound to root and symlink escapes are denied", () => {
  const directory = mkdtempSync(join(tmpdir(), "h2-path-"));
  const root = join(directory, "workspace");
  const outside = join(directory, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  mkdirSync(join(root, "notes"));
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(outside, join(root, "link"));
  symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
  try {
    const resources = new InMemoryResourceRegistry();
    const workspace = new FilesystemWorkspace(root, resources);
    const file = workspace.registerFile({ relativePath: "notes/hello.txt" });
    assert.equal(file.id, mintResourceId("file", "workspace/notes/hello.txt"));
    assert.equal(workspace.pathForResource(file.id, "write"),
      join(workspace.root, "notes/hello.txt"));
    assert.throws(() => workspace.pathForResource(mintResourceId("file", "workspace/invented"),
      "write"), /FILE_RESOURCE_NOT_AUTHORIZED/);
    assert.throws(() => workspace.registerFile({ relativePath: "link/secret.txt" }),
      /SYMLINK_DENIED/);
    assert.throws(() => workspace.registerFile({ relativePath: "escape.txt" }),
      /SYMLINK_DENIED/);
    assert.throws(() => new FilesystemWorkspace(outside, resources).registerRoot(),
      /WORKSPACE_BINDING_CHANGED/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
