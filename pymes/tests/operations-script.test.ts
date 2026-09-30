import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("operations healthcheck returns healthy and alert exit codes", async () => {
  const server = createServer((request, response) => {
    const failed = request.headers.authorization === "Bearer failed-token";
    const busy = request.headers.authorization === "Bearer busy-token";
    const stale = request.headers.authorization === "Bearer stale-token";
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ tenantId: "agency-1", generatedAt: "2026-09-30T10:00:00Z",
      inbox: { total: busy ? 21 : 1, byState: { pending_review: busy ? 21 : 1 } },
      effects: { total: failed ? 1 : 0, byStatus: failed ? { failed: 1 } : {} }, approvals: { total: 0 },
      ...(stale ? { alerts: [{ code: "STALE_CASES", severity: "warning", count: 1 }] } : {}) }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const env = { ...process.env, PYMES_API_BASE_URL: base, PYMES_API_TOKEN: "test-token", PYMES_API_TENANT: "agency-1" };
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    const run = (token: string) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn("bash", ["scripts/check-operations.sh"], { cwd, env: { ...env, PYMES_API_TOKEN: token } });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += String(chunk); });
      child.once("error", reject);
      child.once("close", code => resolve({ code, stderr }));
    });
    const healthy = await run("test-token");
    assert.equal(healthy.code, 0, healthy.stderr);
    const failed = await run("failed-token");
    assert.equal(failed.code, 2, failed.stderr);
    const busy = await run("busy-token");
    assert.equal(busy.code, 2, busy.stderr);
    const stale = await run("stale-token");
    assert.equal(stale.code, 2, stale.stderr);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
