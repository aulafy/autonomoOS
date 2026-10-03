import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OrcaCliTransport, OrcaExecutionProvider, OrcaAttemptStore } from "../src/index.js";
import type { ActorDescriptor, PrepareExecutionInput } from "@agent-world/execution-providers";
const fixture = fileURLToPath(new URL("./fixtures/adapter-cli.cjs", import.meta.url));
const actor: ActorDescriptor = { id: "orca:codex", providerId: "orca", kind: "coding-agent", capabilities: [{ capability: "code.modify_repo", confidence: 1 }],
  costProfile: { currency: "EUR", estimatedCost: null }, latencyProfile: { estimatedMs: null }, trustProfile: { level: "restricted" }, privacyProfile: { locality: "remote", dataResidency: [] }, availability: "available" };
const input: PrepareExecutionInput = { taskId: "global-task", workUnitId: "unit", attemptId: "attempt", actorId: actor.id, objective: "Modify fixture", contextRef: "scoped-context", authorizationRef: "host-permit", resourceRefs: ["fixture"], dispatchFingerprint: "stable-fingerprint" };
function setup(scenario = "success") {
  const folder = mkdtempSync(join(tmpdir(), "aw2-orca-"));
  let store = new OrcaAttemptStore(join(folder, "provider.db")), allowed = true, replyAllowed = true;
  const build = () => new OrcaExecutionProvider({ store,
    transport: new OrcaCliTransport(process.execPath, { prefixArgs: [fixture, folder, scenario], timeoutMs: 500 }), actors: [actor], authorize: async () => allowed, authorizeMessage: async () => replyAllowed,
    resolvePlacement: async () => ({ worktree: folder, agent: "codex", coordinator: "terminal:coordinator", spec: "Target: disposable fixture\nChange: requested feature\nConstraints: fixture only\nOwnership: host\nObservable acceptance: tests" }), now: () => 100 });
  return { folder, get store() { return store; }, provider: build(),
    deny() { allowed = false; }, denyReply() { replyAllowed = false; }, reopen() { store.close(); store = new OrcaAttemptStore(join(folder, "provider.db")); return build(); },
    calls() { return readFileSync(join(folder, "calls.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]); },
    close() { store.close(); rmSync(folder, { recursive: true, force: true }); } };
}
async function prepared(provider: OrcaExecutionProvider) {
  const result = await provider.prepare(input); assert.equal(result.status, "prepared");
  if (result.status !== "prepared") throw new Error("not prepared");
  return { ...input, handle: result.handle };
}
test("real CLI fixture dispatch persists references and replays receipt after restart", async () => {
  const env = setup(); try {
    const request = await prepared(env.provider);
    const receipt = await env.provider.dispatch(request); assert.equal(receipt.status, "dispatched"); if (receipt.status !== "dispatched") return;
    assert.equal(receipt.ref.externalRunId, "run-1"); assert.equal(receipt.ref.externalTaskId, "provider-task-1");
    assert.equal(receipt.ref.externalAttemptId, "dispatch-1");
    const calls = env.calls(); assert.equal(calls.length, 2);
    for (const args of calls) assert.match(args[args.indexOf("--retry-request") + 1]!, /^[0-9a-f-]{36}$/);
    assert.ok(calls[1]![calls[1]!.indexOf("--spec") + 1]!.includes("GlobalTaskId: global-task"));
    const reopened = env.reopen(); assert.deepEqual(await reopened.dispatch(request), receipt);
    assert.equal(env.calls().length, 2);
    assert.equal((await reopened.observe(receipt.ref)).status, "reported-success");
  } finally { env.close(); }
});
test("authorization is rechecked before any mutation", async () => {
  const env = setup(); try {
    const request = await prepared(env.provider); env.deny();
    assert.deepEqual(await env.provider.dispatch(request), { status: "not-executed", reason: "policy_denied" });
    assert.equal(env.store.get(request.handle)!.state, "prepared");
  } finally { env.close(); }
});
test("timeout before dispatch leaves provider unavailable and starts no attempt", async () => {
  const env = setup("probe-timeout"); try { assert.deepEqual(await env.provider.prepare(input), { status: "rejected", reason: "provider_unavailable" }); } finally { env.close(); }
});
for (const scenario of ["dispatch-timeout", "malformed", "unknown-start"]) {
  test(`${scenario} after possible effect remains unknown across restart without redispatch`, async () => {
    const env = setup(scenario); try {
      const request = await prepared(env.provider);
      assert.equal((await env.provider.dispatch(request)).status, "unknown");
      const reopened = env.reopen(); assert.equal((await reopened.dispatch(request)).status, "unknown");
      assert.equal(env.calls().length, 2); assert.equal(env.store.get(request.handle)!.state, "unknown");
    } finally { env.close(); }
  });
}
for (const [scenario, expected] of [["failed", "reported-failure"], ["unknown-observe", "unknown"], ["stale", "unverifiable"]] as const) {
  test(`exact observation preserves ${expected}`, async () => {
    const env = setup(scenario); try {
      const receipt = await env.provider.dispatch(await prepared(env.provider)); if (receipt.status !== "dispatched") assert.fail();
      assert.equal((await env.provider.observe(receipt.ref)).status, expected);
    } finally { env.close(); }
  });
}
test("competing provider instances cannot claim the same attempt twice", async () => {
  const env = setup(); const secondStore = new OrcaAttemptStore(join(env.folder, "provider.db"));
  try {
    const request = await prepared(env.provider);
    const competing = new OrcaExecutionProvider({ store: secondStore, actors: [actor], authorize: async () => true,
      resolvePlacement: async () => { throw new Error("not used"); }, transport: new OrcaCliTransport(process.execPath, { prefixArgs: [fixture, env.folder, "success"], timeoutMs: 500 }) });
    const results = await Promise.all([env.provider.dispatch(request), competing.dispatch(request)]);
    assert.equal(results.filter(result => result.status === "dispatched").length, 1);
    assert.equal(results.filter(result => result.status === "unknown").length, 1);
    assert.equal(env.calls().length, 2);
  } finally { secondStore.close(); env.close(); }
});
test("completed lost receipt recovers the same dispatch after restart without a second worker effect", async () => {
  const env = setup("recover-completed"); try {
    const request = await prepared(env.provider);
    assert.equal((await env.provider.dispatch(request)).status, "unknown");
    const reopened = env.reopen();
    const receipt = await reopened.recoverDispatch(request); assert.equal(receipt.status, "dispatched");
    if (receipt.status !== "dispatched") assert.fail();
    assert.equal(receipt.ref.externalAttemptId, "dispatch-1");
    assert.equal(readFileSync(join(env.folder, "effects.jsonl"), "utf8"), "worker-created\n");
    assert.deepEqual(await reopened.recoverDispatch(request), receipt);
    assert.equal(env.calls().length, 2);
  } finally { env.close(); }
});
for (const scenario of ["recover-absent", "recover-pending", "recover-stale", "recover-wrong-method", "recover-wrong-receipt"]) {
  test(`${scenario} cannot replay a mutation or authorize a fresh worker`, async () => {
    const env = setup(scenario); try {
      const request = await prepared(env.provider);
      assert.equal((await env.provider.dispatch(request)).status, "unknown");
      assert.equal((await env.reopen().recoverDispatch(request)).status, "unknown");
      assert.equal(env.calls().length, 2);
      assert.equal(env.store.get(request.handle)!.state, "unknown");
    } finally { env.close(); }
  });
}
test("receipt recovery preserves uncertainty after authorization revocation", async () => {
  const env = setup("recover-completed"); try {
    const request = await prepared(env.provider); await env.provider.dispatch(request); env.deny();
    assert.deepEqual(await env.provider.recoverDispatch(request), { status: "unknown", reason: "recovery_policy_denied" });
    assert.equal(env.calls().length, 2);
  } finally { env.close(); }
});
test("recovery reads both persisted provider receipts when local references were lost", async () => {
  const env = setup(); try {
    const request = await prepared(env.provider); await env.provider.dispatch(request);
    const record = env.store.get(request.handle)!;
    delete record.runId; delete record.ref; delete record.receipt;
    record.state = "dispatching"; env.store.save(record);
    const receipt = await env.reopen().recoverDispatch(request);
    assert.equal(receipt.status, "dispatched");
    if (receipt.status !== "dispatched") assert.fail();
    assert.equal(receipt.ref.externalRunId, "run-1"); assert.equal(receipt.ref.externalAttemptId, "dispatch-1");
    assert.equal(env.calls().length, 2);
  } finally { env.close(); }
});
for (const [scenario, expected] of [["signals-success", "reported-success"], ["signals-failed", "reported-failure"]] as const) {
  test(`worker_done ${expected} stays a report scoped to the exact attempt`, async () => {
    const env = setup(scenario); try {
      const receipt = await env.provider.dispatch(await prepared(env.provider)); if (receipt.status !== "dispatched") assert.fail();
      const result = await env.provider.receive(receipt.ref); if (result.status !== "observed") assert.fail();
      assert.deepEqual(result.signals.map(signal => signal.id), ["done-1", "escalation-1", "question-1"]);
      assert.equal(result.signals[0]!.type, expected);
      assert.ok(result.signals.every(signal => signal.attemptId === input.attemptId));
      assert.deepEqual(await env.reopen().receive(receipt.ref), result);
    } finally { env.close(); }
  });
}
test("question reply is authorized, durable and idempotent across restart", async () => {
  const env = setup("question"); try {
    const receipt = await env.provider.dispatch(await prepared(env.provider)); if (receipt.status !== "dispatched") assert.fail();
    const answer = { id: "global-answer-1", inReplyTo: "question-1", text: "Unit test" };
    assert.deepEqual(await env.provider.send(receipt.ref, { ...answer, inReplyTo: "obsolete-question" }), { status: "rejected", reason: "question_not_observed" });
    const sent = await env.provider.send(receipt.ref, answer); assert.deepEqual(sent, { status: "accepted", operationId: "answer-1" });
    const reopened = env.reopen(); assert.deepEqual(await reopened.send(receipt.ref, answer), sent);
    assert.deepEqual(await reopened.send(receipt.ref, { ...answer, text: "Different answer" }), { status: "rejected", reason: "reply_identity_conflict" });
    assert.equal(readFileSync(join(env.folder, "effects.jsonl"), "utf8"), "answer-sent\n");
    assert.equal(env.calls().length, 3);
  } finally { env.close(); }
});
test("lost reply receipt recovers read-only and never resends the answer", async () => {
  const env = setup("question-lost-reply"); try {
    const receipt = await env.provider.dispatch(await prepared(env.provider)); if (receipt.status !== "dispatched") assert.fail();
    const answer = { id: "global-answer-1", inReplyTo: "question-1", text: "Unit test" };
    assert.equal((await env.provider.send(receipt.ref, answer)).status, "unknown");
    const reopened = env.reopen(); assert.equal((await reopened.send(receipt.ref, answer)).status, "unknown");
    assert.deepEqual(await reopened.recoverSend(receipt.ref, answer), { status: "accepted", operationId: "answer-1" });
    assert.equal(env.calls().length, 3);
    assert.equal(readFileSync(join(env.folder, "effects.jsonl"), "utf8"), "answer-sent\n");
  } finally { env.close(); }
});
test("answer content needs separate host authorization", async () => {
  const env = setup("question"); try {
    const receipt = await env.provider.dispatch(await prepared(env.provider)); if (receipt.status !== "dispatched") assert.fail();
    env.denyReply();
    assert.deepEqual(await env.provider.send(receipt.ref, { id: "answer", inReplyTo: "question-1", text: "Secret" }), { status: "rejected", reason: "reply_policy_denied" });
    assert.equal(env.calls().length, 2);
  } finally { env.close(); }
});
test("stale fleet liveness cannot authorize a question reply", async () => {
  const env = setup("question-stale-projection"); try {
    const receipt = await env.provider.dispatch(await prepared(env.provider)); if (receipt.status !== "dispatched") assert.fail();
    assert.equal((await env.provider.observe(receipt.ref)).status, "unverifiable");
    assert.deepEqual(await env.provider.send(receipt.ref, { id: "answer", inReplyTo: "question-1", text: "Unit test" }), { status: "rejected", reason: "question_worker_not_running" });
    assert.equal(env.calls().length, 2);
  } finally { env.close(); }
});
for (const scenario of ["question-malformed", "question-conflict"]) {
  test(`${scenario} does not deliver unverifiable provider messages`, async () => {
    const env = setup(scenario); try {
      const receipt = await env.provider.dispatch(await prepared(env.provider)); if (receipt.status !== "dispatched") assert.fail();
      if (scenario === "question-conflict") {
        assert.equal((await env.provider.receive(receipt.ref)).status, "observed");
        writeFileSync(join(env.folder, "alter-signal"), "yes");
      }
      assert.equal((await env.provider.receive(receipt.ref)).status, "unverifiable");
    } finally { env.close(); }
  });
}
