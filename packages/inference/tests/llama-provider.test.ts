import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { LlamaCppProvider, parseStructuredPlan } from "../src/index.js";

async function serverFor(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LISTEN_FAILED");
  return { url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

test("structured parser rejects prose, extra authority fields and unsupported actions", () => {
  assert.throws(() => new LlamaCppProvider({ baseUrl: "https://cloud.example/v1" }),
    /LOCAL_INFERENCE_ENDPOINT_REQUIRED/);
  const plan = { actions: [{ action: "file.write", targetId: "file:workspace/hello.txt",
    parameters: { mode: "create", content: "hello" } }] };
  assert.equal(parseStructuredPlan(JSON.stringify(plan)).actions.length, 1);
  assert.throws(() => parseStructuredPlan(`Here is your plan: ${JSON.stringify(plan)}`));
  assert.throws(() => parseStructuredPlan(JSON.stringify({ ...plan, grantId: "admin" })));
  assert.throws(() => parseStructuredPlan(JSON.stringify({ actions: [
    { ...plan.actions[0], approvalId: "minted" }] })));
  assert.throws(() => parseStructuredPlan(JSON.stringify({ actions: [
    { action: "shell", targetId: "/etc/passwd" }] })));
});

test("health distinguishes authentication, malformed model list and unavailable configured model", async () => {
  let mode: "auth" | "malformed" | "model" = "auth";
  const server = await serverFor((_req, res) => {
    if (mode === "auth") json(res, {}, 401);
    else if (mode === "malformed") json(res, { data: [{}] });
    else json(res, { data: [{ id: "loaded" }] });
  });
  try {
    const provider = new LlamaCppProvider({ baseUrl: server.url, model: "requested" });
    assert.equal((await provider.health()).reason, "authentication");
    mode = "malformed";
    assert.equal((await provider.health()).reason, "malformed_response");
    mode = "model";
    assert.equal((await provider.health()).reason, "model_unavailable");
    await assert.rejects(() => provider.proposePlan({ agentId: "astra", userGoal: "x",
      availableActions: ["file.write"], entities: [] }), /MODEL_UNAVAILABLE/);
  } finally { await server.close(); }
});

test("provider requests JSON mode, passes minimal context and reports actual token usage", async () => {
  let requestBody: any;
  const server = await serverFor(async (req, res) => {
    if (req.url === "/v1/models") return json(res, { data: [{ id: "loaded" }] });
    let data = "";
    for await (const chunk of req) data += chunk;
    requestBody = JSON.parse(data);
    json(res, { model: "loaded", choices: [{ message: { content: JSON.stringify({
      actions: [{ action: "file.write", targetId: "file:workspace/hello.txt",
        parameters: { mode: "create", content: "hello" } }] }) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 } });
  });
  try {
    const provider = new LlamaCppProvider({ baseUrl: server.url, model: "loaded" });
    const result = await provider.proposePlan({ agentId: "astra", userGoal: "create hello",
      availableActions: ["file.write"], entities: [{ id: "file:workspace/hello.txt",
        name: "hello.txt", kind: "file", affordances: ["file.write"] }] });
    assert.equal(requestBody.response_format.type, "json_object");
    assert.equal(requestBody.model, "loaded");
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8 });
    assert.equal(JSON.stringify(requestBody).includes("/Users/"), false);
  } finally { await server.close(); }
});
