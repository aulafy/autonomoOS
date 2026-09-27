import { WorldRuntime } from "@agent-world/world-core";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { createDemoControlPlane } from "../../src/demo-control-plane.js";

const path = process.argv[2];
if (!path) throw new Error("DATABASE_PATH_REQUIRED");
const clock = new ReplayClock();
const database = new RuntimeDatabase(path, clock.now);
const kernel = new JournalKernel(database, clock);
const stores = createDurableDomainStores(kernel);
await kernel.restore();
const world = new WorldRuntime();
world.addEntity({ id: "astra", kind: "agent", name: "Astra", state: {},
  affordances: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } });
world.addEntity({ id: "meeting_room", kind: "space", name: "Meeting Room",
  state: {}, affordances: [], transform: { position: [4, 0, -2],
    rotation: [0, 0, 0, 1] } });
const control = createDemoControlPlane(world, event => database.appendRuntimeEvent(event),
  { kernel, stores, beforeExecutorDispatch: () => process.kill(process.pid, "SIGKILL") });
control.recoverOnStartup();
await control.run({ id: "i1", actorId: "astra", action: "goto",
  targetId: "meeting_room", parameters: {}, provenance: { source: "model" } },
"t1", "t1");
throw new Error("CRASH_BOUNDARY_NOT_REACHED");
