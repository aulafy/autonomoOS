import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemWorkspace } from "@agent-world/filesystem";
import { LlamaCppProvider } from "@agent-world/inference";
import type { RuntimeEvent } from "@agent-world/protocol";
import { DurableRuntimeEventPublisher, createDurableDomainStores,
  JournalKernel, ReplayClock, RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "./demo-control-plane.js";
import { H3GoalService } from "./h3-goal-service.js";

const content = "Hello from Agent World OS";
const provider = new LlamaCppProvider();
const health = await provider.health();
if (!health.ok) {
  console.error(JSON.stringify({ status: "LOCAL_INFERENCE_UNAVAILABLE", health,
    startupCommand: "env -u LLAMA_API_KEY -u LLAMA_ARG_API_KEY_FILE llama-server -hf Qwen/Qwen3-4B-GGUF:Q4_K_M --host 127.0.0.1 --port 8080 -c 8192" }, null, 2));
  process.exitCode = 2;
} else {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-h3-live-"));
  const workspaceRoot = join(directory, "workspace");
  mkdirSync(workspaceRoot);
  const database = new RuntimeDatabase(join(directory, "runtime.db"));
  try {
    const kernel = new JournalKernel(database, new ReplayClock());
    const stores = createDurableDomainStores(kernel);
    await kernel.restore();
    const filesystem = new FilesystemWorkspace(workspaceRoot, stores.resources);
    const file = filesystem.registerFile({ relativePath: "hello.txt" });
    const publisher = new DurableRuntimeEventPublisher<RuntimeEvent>(database, () => {});
    const emit = (event: RuntimeEvent) => { publisher.append(event); };
    const control = createDemoControlPlane(new WorldRuntime(), emit,
      { kernel, stores, filesystem });
    control.recoverOnStartup();
    const service = new H3GoalService({ provider, control, resources: stores.resources,
      emit, allowedTargetIds: [file.id], actorId: "astra" });
    const result = await service.submitGoal({ principalId: "astra",
      targetId: file.id,
      goal: `Astra, create hello.txt in the workspace and write exactly: ${content}`,
      expectedContent: content });
    const actual = result.ok ? readFileSync(join(workspaceRoot, "hello.txt"), "utf8") : null;
    console.log(JSON.stringify({ health, result, actual, expected: content,
      workspaceRoot, runtimeDatabase: join(directory, "runtime.db"),
      effectStatus: result.effectId ? stores.effects.get(result.effectId)?.status : null,
      taskStatus: stores.tasks.get(result.taskId)?.status }, null, 2));
    if (!result.ok || actual !== content) process.exitCode = 1;
  } finally { database.close(); }
}
