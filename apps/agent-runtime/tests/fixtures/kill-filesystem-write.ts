import { FilesystemWorkspace } from "@agent-world/filesystem";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "../../src/demo-control-plane.js";

const [path, workspaceRoot, window] = process.argv.slice(2);
if (!path || !workspaceRoot || !window) throw new Error("CRASH_FIXTURE_ARGS_REQUIRED");
const clock = new ReplayClock();
const database = new RuntimeDatabase(path, clock.now);
const kernel = new JournalKernel(database, clock);
const stores = createDurableDomainStores(kernel);
await kernel.restore();
const filesystem = new FilesystemWorkspace(workspaceRoot, stores.resources);
filesystem.registerFile({ relativePath: "hello.txt" });
const dieAt = (point: string) => {
  if (window === point) process.kill(process.pid, "SIGKILL");
};
const control = createDemoControlPlane(new WorldRuntime(), event =>
  database.appendRuntimeEvent(event), { kernel, stores, filesystem,
    beforePreparedDispatch: () => dieAt("A"),
    beforeExecutorDispatch: () => dieAt("B"),
    afterFilesystemMutation: () => dieAt("C"),
    afterExecutorResponse: () => dieAt("D"),
    afterObservationPersisted: () => dieAt("E") });
control.recoverOnStartup();
const content = "Hello from Agent World OS";
const objectId = await control.stageTrustedContent("t1", "astra", content,
  { confidentiality: "public", categories: [], jurisdictions: [],
    ownerPrincipalIds: [], releasable: true, metadata: {} });
await control.run({ id: "i1", actorId: "astra", action: "file.write",
  targetId: "hello.txt", parameters: { mode: "create", content },
  provenance: { source: "human" } }, "t1", "t1", undefined, undefined,
{ flowObjectIds: [objectId] });
throw new Error(`CRASH_BOUNDARY_NOT_REACHED:${window}`);
