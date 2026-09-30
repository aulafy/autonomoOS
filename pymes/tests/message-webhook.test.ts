import assert from "node:assert/strict";
import test from "node:test";
import { sendMessageWebhook } from "../src/connectors.js";

test("message webhook sends an authenticated idempotent request", async () => {
  let request: RequestInfo | URL = "";
  let init: RequestInit | undefined;
  const result = await sendMessageWebhook({ endpoint: "https://gateway.example.test/messages", token: "token-1234567890123456", channel: "telegram", text: "Hola", idempotencyKey: "effect-1", fetcher: async (input, options) => { request = input; init = options; return new Response(JSON.stringify({ externalId: "msg-1" }), { status: 200 }); } });
  assert.equal(new URL(String(request)).pathname, "/messages");
  assert.equal(init?.headers && (init.headers as Record<string, string>)["Idempotency-Key"], "effect-1");
  assert.equal(result.externalId, "msg-1");
});

test("message webhook rejects insecure remote endpoints", async () => {
  await assert.rejects(() => sendMessageWebhook({ endpoint: "http://gateway.example.test/messages", token: "token-1234567890123456", channel: "email", text: "Hola" }), /UNSAFE_MESSAGE_ENDPOINT/);
});
