import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrcaCliTransport, decodeOrcaStatus, decodeOrcaEnvelope } from "../src/index.js";
const fixture = fileURLToPath(new URL("./fixtures/fake-cli.cjs", import.meta.url));
const fake = (mode: string, limits = {}) => new OrcaCliTransport(process.execPath, { prefixArgs: [fixture, mode], ...limits });
test("real subprocess transport decodes ready and unavailable runtime states", async () => {
  const ready = await fake("ready").call(["status", "--json"]); assert.equal(ready.status, "completed");
  if (ready.status === "completed") assert.equal(decodeOrcaStatus(ready.stdout).status, "available");
  const off = await fake("unavailable").call(["status", "--json"]);
  if (off.status === "completed") assert.equal(decodeOrcaStatus(off.stdout).status, "unavailable"); else assert.fail();
});
test("arguments remain literal and cannot become shell code", async () => {
  const result = await fake("args").call(["$(touch /tmp/should-not-run)", "a b", "--json"]);
  assert.equal(result.status, "completed");
  if (result.status === "completed") assert.deepEqual(JSON.parse(result.stdout), ["$(touch /tmp/should-not-run)", "a b", "--json"]);
});
test("missing executable, timeout and output overflow stay distinct", async () => {
  assert.equal((await new OrcaCliTransport("/does/not/exist").call([])).status, "start-failed");
  assert.equal((await fake("hang", { timeoutMs: 100 }).call([])).status, "timeout");
  assert.equal((await fake("large", { maxOutputBytes: 100 }).call([])).status, "output-limit");
});
test("malformed JSON, failed envelopes and unsupported semantics cannot probe available", async () => {
  assert.throws(() => decodeOrcaStatus("not-json"));
  assert.throws(() => decodeOrcaEnvelope('{"ok":false,"result":{}}'));
  const result = { ok: true, result: { target: { kind: "local" }, runtime: { state: "ready", reachable: true, capabilities: [] } } };
  assert.deepEqual(decodeOrcaStatus(JSON.stringify(result)), { status: "unavailable", reason: "orca_supervised_contract_missing" });
});
test("timeout kills a descendant that ignores SIGTERM after its parent exits", { skip: process.platform === "win32" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "orca-descendant-"));
  const path = join(directory, "pid");
  let pid: number | undefined;
  try {
    const result = await fake("descendant", { timeoutMs: 1000 }).call([path]);
    assert.equal(result.status, "timeout");
    pid = Number(readFileSync(path, "utf8"));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  } finally {
    if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
    rmSync(directory, { recursive: true, force: true });
  }
});
test("live Orca probe is opt-in and performs no worker launch", { skip: process.env.AWOS_LIVE_ORCA !== "1" }, async () => {
  const transport = new OrcaCliTransport(process.env.AWOS_ORCA_EXECUTABLE ?? "/Applications/Orca.app/Contents/Resources/bin/orca");
  const result = await transport.call(["status", "--json"]); assert.equal(result.status, "completed");
  if (result.status === "completed") { assert.equal(result.exitCode, 0); assert.equal(decodeOrcaStatus(result.stdout).status, "available"); }
});
