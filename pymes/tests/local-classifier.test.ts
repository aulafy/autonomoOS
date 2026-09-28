import assert from "node:assert/strict";
import test from "node:test";
import { classifyDemoText } from "../src/local-classifier.js";

test("local classifier sends a bounded demo prompt and returns only a proposal", async () => {
  let request: RequestInit | undefined;
  const result = await classifyDemoText({ text: "Quiero seguro de hogar",
    fetcher: async (url, init) => {
      assert.equal(String(url), "http://127.0.0.1:11434/api/chat");
      request = init;
      return Response.json({ model: "llama3.2:3b", message: {
        content: JSON.stringify({ topic: "quote", insuranceLine: "home" }) } });
    } });
  assert.deepEqual(result.proposal, { topic: "quote", insuranceLine: "home" });
  const body = JSON.parse(String(request?.body));
  assert.equal(body.stream, false);
  assert.equal(body.format.additionalProperties, false);
  assert.equal(body.messages[1].content.includes("Quiero seguro de hogar"), true);
});

test("classifier abstains and rejects malformed or out of scope output", async () => {
  const abstain = await classifyDemoText({ text: "Texto sin contexto",
    fetcher: async () => Response.json({ message: { content:
      '{"topic":"unknown","insuranceLine":"unknown"}' } }) });
  assert.deepEqual(abstain.proposal, { topic: "unknown", insuranceLine: null });
  await assert.rejects(() => classifyDemoText({ text: "Hola",
    fetcher: async () => Response.json({ message: { content:
      '{"topic":"quote","insuranceLine":"home","send":true}' } }) }),
  /LOCAL_CLASSIFIER_INVALID_RESPONSE/);
  await assert.rejects(() => classifyDemoText({ text: "Hola",
    fetcher: async () => Response.json({ message: { content: "```json" } }) }),
  /LOCAL_CLASSIFIER_INVALID_JSON/);
});

test("classifier rejects non-loopback endpoints before network access", async () => {
  await assert.rejects(() => classifyDemoText({ text: "Hola", baseUrl: "https://example.com" }),
    /LOCAL_CLASSIFIER_ENDPOINT_REQUIRED/);
  await assert.rejects(() => classifyDemoText({ text: "Hola", baseUrl: "http://127.0.0.1:11434/other" }),
    /LOCAL_CLASSIFIER_ENDPOINT_REQUIRED/);
  await assert.rejects(() => classifyDemoText({ text: "x".repeat(2001) }),
    /INVALID_DEMO_MESSAGE/);
});
