import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiEndpointRegistry, type CredentialProvider } from "@agent-world/http-api";
import { LlamaCppProvider } from "@agent-world/inference";
import type { RuntimeEvent } from "@agent-world/protocol";
import { DurableRuntimeEventPublisher, createDurableDomainStores,
  JournalKernel, ReplayClock, RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "./demo-control-plane.js";
import { H3GoalService } from "./h3-goal-service.js";

const provider = new LlamaCppProvider();
const health = await provider.health();
if (!health.ok) {
  console.error(JSON.stringify({ status: "LOCAL_INFERENCE_UNAVAILABLE", health,
    startupCommand: "env -u LLAMA_API_KEY -u LLAMA_ARG_API_KEY_FILE llama-server -hf Qwen/Qwen3-4B-GGUF:Q4_K_M --host 127.0.0.1 --port 8080 -c 8192" }, null, 2));
  process.exitCode = 2;
} else {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-h4-live-"));
  const token = `fixture-${crypto.randomUUID()}`;
  const fixturePath = resolve(fileURLToPath(new URL(
    "../../../packages/http-api/tests/fixtures/api-server.ts", import.meta.url)));
  const child = spawn(process.execPath, ["--import", "tsx", fixturePath], {
    env: { ...process.env, H4_FIXTURE_DB: join(directory, "external.db"),
      H4_FIXTURE_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise<number>((done, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("FIXTURE_START_TIMEOUT")), 10000);
    child.stdout!.on("data", chunk => {
      output += chunk.toString();
      const line = output.split("\n")[0];
      if (line && line.endsWith("}")) {
        clearTimeout(timer);
        done(JSON.parse(line).port);
      }
    });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`FIXTURE_EXIT_${code}`)));
  });
  const origin = `http://127.0.0.1:${port}`;
  const database = new RuntimeDatabase(join(directory, "runtime.db"));
  try {
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
    const emit = (event: RuntimeEvent) => { publisher.append(event); };
    const control = createDemoControlPlane(new WorldRuntime(), emit,
      { kernel, stores, httpApi: { endpoints, credentials } });
    control.recoverOnStartup();
    const service = new H3GoalService({ provider, control,
      resources: stores.resources, emit,
      allowedTargetIds: [binding.endpointId], actorId: "astra" });
    const result = await service.submitGoal({ principalId: "astra",
      goal: "Create a demo API record named alpha with value 42.",
      targetId: binding.endpointId, action: "api.create_record",
      expectedRecord: { name: "alpha", value: 42 } });
    const externalState = await (await fetch(`${origin}/__stats`)).json() as any;
    console.log(JSON.stringify({ health, result,
      externalState: { counts: externalState.counts, items: externalState.items },
      effectStatus: result.effectId ? stores.effects.get(result.effectId)?.status : null,
      taskStatus: stores.tasks.get(result.taskId)?.status,
      runtimeDatabase: join(directory, "runtime.db"),
      externalDatabase: join(directory, "external.db") }, null, 2));
    if (!result.ok || externalState.counts.post !== 1 ||
      externalState.items.length !== 1) process.exitCode = 1;
  } finally {
    database.close();
    child.kill("SIGTERM");
    await new Promise(resolveExit => child.once("exit", resolveExit));
  }
}
