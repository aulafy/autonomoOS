import { DurableRuntimeEventPublisher, RuntimeDatabase } from "../../src/index.js";

const path = process.argv[2];
if (!path) throw new Error("DATABASE_PATH_REQUIRED");
const database = new RuntimeDatabase(path, () => 100);
const publisher = new DurableRuntimeEventPublisher(database, () =>
  process.kill(process.pid, "SIGKILL"));
database.transaction(() => publisher.append({ id: "committed-before-delivery",
  timestamp: 100, type: "control.event" }));
throw new Error("POST_COMMIT_CALLBACK_NOT_INVOKED");
