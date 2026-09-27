import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryResourceRegistry } from "@agent-world/resources";
import { ApiEndpointRegistry, CreateRecordSchema } from "../src/api-resource.js";
import { HttpApiExecutor } from "../src/executor.js";
import { resolveDestination, sendApiRequest } from "../src/transport.js";

function binding(origin: string, allowFixtureLoopback = false) {
  const endpoints = new ApiEndpointRegistry(new InMemoryResourceRegistry());
  return { endpoints, value: endpoints.register({ serviceName: "demo-api",
    origin, credentialRef: "demo-api-default", allowFixtureLoopback }) };
}

test("only explicit fixture loopback is allowed; private and metadata addresses fail closed", async () => {
  for (const origin of ["http://127.0.0.1:8080", "https://127.0.0.1:8443",
    "https://10.0.0.1:8443", "https://192.168.1.1:8443",
    "https://169.254.169.254:8443", "https://[::1]:8443"]) {
    const { value } = binding(origin);
    await assert.rejects(() => resolveDestination(value));
  }
  assert.equal((await resolveDestination(binding("http://127.0.0.1:8080", true).value))
    .address, "127.0.0.1");
  assert.throws(() => binding("file:///etc/passwd"));
  assert.throws(() => binding("ftp://example.com:21"));
  assert.throws(() => binding("http://user:pass@example.com:8080"));
  assert.throws(() => binding("http://example.com:8080/path"));
});

test("semantic request schema rejects method, URL, headers and credential overrides", async () => {
  const { endpoints, value } = binding("http://127.0.0.1:8080", true);
  assert.equal(CreateRecordSchema.safeParse({ name: "alpha", value: 42 }).success, true);
  for (const extra of [{ url: "http://169.254.169.254/" },
    { method: "DELETE" }, { Authorization: "Bearer stolen" },
    { credentialRef: "other" }, { path: "/admin" }]) {
    assert.equal(CreateRecordSchema.safeParse({ name: "alpha", value: 42,
      ...extra }).success, false);
  }
  await assert.rejects(() => sendApiRequest(value, "POST", "/admin", {}, "{}",
    new AbortController().signal), /REQUEST_NOT_ALLOWED/);
  const executor = new HttpApiExecutor(endpoints, { getCredential: () => "secret" });
  const result = await executor.dispatch({ taskId: "t", intentId: "i", effectId: "e",
    idempotencyKey: "a".repeat(64), resourceIds: [value.endpointId],
    parameters: { name: "alpha", value: 42, method: "DELETE" } },
  new AbortController().signal);
  assert.equal(result.kind, "reported_failure");
  if (result.kind === "reported_failure") assert.equal(result.certainty, "certified_not_started");
});
