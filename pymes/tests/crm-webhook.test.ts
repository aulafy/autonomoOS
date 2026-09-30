import assert from "node:assert/strict";
import test from "node:test";
import { createCrmTaskWebhook } from "../src/connectors.js";

test("CRM webhook creates an idempotent task", async () => {
  let init: RequestInit | undefined;
  const result = await createCrmTaskWebhook({ endpoint: "https://crm.example.test/tasks", token: "token-1234567890123456", title: "Revisar póliza", contactId: "contact-1", idempotencyKey: "effect-1", fetcher: async (_input, options) => { init = options; return new Response(JSON.stringify({ id: "task-1" }), { status: 201 }); } });
  assert.equal((init?.headers as Record<string, string>)["Idempotency-Key"], "effect-1"); assert.equal(result.externalId, "task-1");
});

test("CRM webhook rejects insecure remote endpoints", async () => {
  await assert.rejects(() => createCrmTaskWebhook({ endpoint: "http://crm.example.test/tasks", token: "token-1234567890123456", title: "Task", contactId: "contact-1" }), /UNSAFE_CRM_ENDPOINT/);
});
