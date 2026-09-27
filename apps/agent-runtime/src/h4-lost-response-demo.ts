import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiEndpointRegistry, type CredentialProvider } from "@agent-world/http-api";
import type { DataLabel } from "@agent-world/information-flow";
import type { RuntimeEvent } from "@agent-world/protocol";
import { DurableRuntimeEventPublisher, createDurableDomainStores,
  JournalKernel, ReplayClock, RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "./demo-control-plane.js";

type FixtureState = { counts: { post: number; get: number };
  items: Array<{ key: string; name: string; value: number }> };

const directory = mkdtempSync(join(tmpdir(), "agent-world-h4-lost-"));
const runtimePath = join(directory, "runtime.db");
const externalPath = join(directory, "external.db");
const token = `fixture-${crypto.randomUUID()}`;
const fixturePath = fileURLToPath(new URL(
  "../../../packages/http-api/tests/fixtures/api-server.ts", import.meta.url));
const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", fixturePath], {
  env: { ...process.env, H4_FIXTURE_DB: externalPath, H4_FIXTURE_TOKEN: token },
  stdio: ["ignore", "pipe", "pipe"] });

async function fixturePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("FIXTURE_START_TIMEOUT")), 10000);
    child.stdout!.on("data", chunk => {
      output += chunk.toString();
      const line = output.split("\n")[0];
      if (line.endsWith("}")) {
        clearTimeout(timer);
        resolve(JSON.parse(line).port as number);
      }
    });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`FIXTURE_EXIT_${code}`)));
  });
}

const publicLabel: DataLabel = { confidentiality: "public", categories: [],
  jurisdictions: [], ownerPrincipalIds: [], releasable: true, metadata: {} };
let database: RuntimeDatabase | undefined;
try {
  const origin = `http://127.0.0.1:${await fixturePort()}`;
  const setMode = await fetch(`${origin}/__mode`, { method: "POST",
    body: JSON.stringify({ mode: "drop_after" }) });
  assert.equal(setMode.status, 200);
  const stats = async () => (await (await fetch(`${origin}/__stats`)).json()) as FixtureState;

  async function openRuntime() {
    database = new RuntimeDatabase(runtimePath);
    const kernel = new JournalKernel(database, new ReplayClock());
    const stores = createDurableDomainStores(kernel);
    await kernel.restore();
    const endpoints = new ApiEndpointRegistry(stores.resources);
    const binding = endpoints.register({ serviceName: "demo-api", origin,
      credentialRef: "demo-api-default", allowFixtureLoopback: true,
      certifiesRejectedNoEffect: true });
    const credentials: CredentialProvider = { getCredential: ref =>
      ref === "demo-api-default" ? token : null };
    const publisher = new DurableRuntimeEventPublisher<RuntimeEvent>(database, () => {});
    const control = createDemoControlPlane(new WorldRuntime(),
      event => { publisher.append(event); },
      { kernel, stores, httpApi: { endpoints, credentials } });
    control.recoverOnStartup();
    return { stores, binding, control };
  }

  const first = await openRuntime();
  const taskId = `h4-lost-${crypto.randomUUID()}`;
  const parameters = { name: "alpha", value: 42 };
  await first.control.prepareGoalTask({ taskId, principalId: "astra",
    targetId: first.binding.endpointId, action: "api.create_record",
    objective: "Demonstrate lost API response and read-only recovery" });
  const objectId = await first.control.stageTrustedContent(taskId, "astra",
    JSON.stringify(parameters), publicLabel);
  const result = await first.control.run({ id: `intent:${taskId}`, actorId: "astra",
    action: "api.create_record", targetId: first.binding.endpointId,
    parameters, provenance: { source: "human" } }, taskId, taskId,
  undefined, undefined, { flowObjectIds: [objectId] });
  assert.equal(result.status, "unknown", result.reasonCode);
  assert.ok(result.effectId);
  const effectId = result.effectId;
  const firstEffect = first.stores.effects.get(effectId)!;
  const before = await stats();
  assert.equal(firstEffect.status, "unknown");
  assert.equal(before.counts.post, 1);
  assert.equal(before.items.length, 1);
  const reservationBefore = first.stores.budgets.getReservation(
    firstEffect.budgetReservationIds[0]!)?.status;
  assert.equal(reservationBefore, "active");
  console.log(JSON.stringify({ checkpoint: "response_lost", effectId,
    effectStatus: firstEffect.status, reservationStatus: reservationBefore,
    postCount: before.counts.post, getCount: before.counts.get,
    providerRecord: before.items[0], runtimeDatabase: runtimePath,
    externalDatabase: externalPath }, null, 2));

  database!.close();
  database = undefined;
  const restarted = await openRuntime();
  const recoveredEffect = restarted.stores.effects.get(effectId)!;
  assert.equal(recoveredEffect.status, "unknown");
  assert.equal((await stats()).counts.post, 1);
  await restarted.control.reconcilePendingHttpApi();
  const after = await stats();
  const settled = restarted.stores.effects.get(effectId)!;
  const reservationAfter = restarted.stores.budgets.getReservation(
    settled.budgetReservationIds[0]!)?.status;
  const accepted = await restarted.control.mayComplete(taskId);
  assert.equal(settled.status, "committed");
  assert.equal(reservationAfter, "committed");
  assert.equal(after.counts.post, 1);
  assert.ok(after.counts.get >= 1);
  assert.equal(accepted, true);
  console.log(JSON.stringify({ checkpoint: "reconciled_after_restart", effectId,
    effectStatus: settled.status, reservationStatus: reservationAfter,
    taskAcceptanceConfirmed: accepted, postCount: after.counts.post,
    getCount: after.counts.get, providerRecord: after.items[0],
    runtimeDatabase: runtimePath, externalDatabase: externalPath }, null, 2));
} finally {
  database?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
}
