import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDemoClassifierHandler } from "../src/demo-classifier-http.js";

test("demo classifier rejects unknown messages and serializes model calls", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let origin = "";
  let received = "";
  const classifier = createDemoClassifierHandler("http://127.0.0.1:5175", async input => {
    received = input.text;
    entered();
    await gate;
    return { proposal: { topic: "incident", insuranceLine: "auto" }, model: "test", latencyMs: 1 };
  });
  const server = createServer(async (req, res) => { if (!await classifier(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  const options = { method: "POST", headers: { Origin: "http://127.0.0.1:5175" }, body: "arbitrary client text" };
  try {
    assert.equal((await fetch(origin + "/api/demo-classify/not-a-fixture", options)).status, 404);
    assert.equal((await fetch(origin + "/api/demo-classify/msg-1", { method: "POST", headers: { Origin: "https://external.test" } })).status, 403);
    const first = fetch(origin + "/api/demo-classify/msg-1", options);
    await started;
    assert.equal((await fetch(origin + "/api/demo-classify/msg-2", options)).status, 429);
    assert.notEqual(received, options.body);
    release();
    const result = await (await first).json() as { fixtureOnly: boolean; accepted: boolean };
    assert.equal(result.fixtureOnly, true);
    assert.equal(result.accepted, false);
  } finally {
    release();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
