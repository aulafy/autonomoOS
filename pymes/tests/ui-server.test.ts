import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUiServer } from "../src/ui-server.js";

test("compiled UI serves pages but blocks secrets, writes and external symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "pymes-ui-"));
  const outside = await mkdtemp(join(tmpdir(), "pymes-outside-"));
  await writeFile(join(root, "index.html"), "<h1>PYMES</h1>");
  await writeFile(join(root, ".env"), "secret");
  await writeFile(join(outside, "outside.html"), "private");
  await symlink(join(outside, "outside.html"), join(root, "linked.html"));
  const server = createUiServer(root);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "<h1>PYMES</h1>");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(base + "/.env")).status, 404);
    assert.equal((await fetch(base + "/linked.html")).status, 404);
    assert.equal((await fetch(base + "/api/demo-classify/msg-1")).status, 404);
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
    const head = await fetch(base, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await Promise.all([rm(root, { recursive: true }), rm(outside, { recursive: true })]);
  }
});
