import assert from "node:assert/strict";
import test from "node:test";
import { startCallWebhook } from "../src/connectors.js";

test("call webhook starts an idempotent call", async () => {
  let init: RequestInit | undefined;
  const result = await startCallWebhook({ endpoint: "https://telephony.example.test/calls", token: "token-1234567890123456", phone: "+34600111222", objective: "Revisar póliza", idempotencyKey: "effect-1", fetcher: async (_input, options) => { init = options; return new Response(JSON.stringify({ externalId: "call-1" }), { status: 201 }); } });
  assert.equal((init?.headers as Record<string, string>)["Idempotency-Key"], "effect-1"); assert.equal(result.externalId, "call-1");
});

test("call webhook rejects insecure remote endpoints", async () => {
  await assert.rejects(() => startCallWebhook({ endpoint: "http://telephony.example.test/calls", token: "token-1234567890123456", objective: "Llamar" }), /UNSAFE_CALL_ENDPOINT/);
});
