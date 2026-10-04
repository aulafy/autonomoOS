// Child process for SIGKILL tests: runs the real service against a shared SQLite file and hangs mid-reconciliation.
import { InboxStore } from "../../src/inbox-store.js";
import { InboxService } from "../../src/inbox-service.js";
import { scenarioAfterExpiry, scenarioIncremental, P04_SCOPE, P04_OPTIONS } from "./inbox-p04-scenarios.js";
import { credentialSource, NOW } from "./gmail-history-fake.js";
const [path, mode, hangAfter] = process.argv.slice(2);
let dates = 0;
const hook = async (p: string) => {
  if (p.includes("fields=id,labelIds,internalDate") && ++dates === Number(hangAfter)) {
    process.send!("hanging");
    await new Promise(() => {});
  }
};
const g = mode === "resync" ? scenarioAfterExpiry(hook) : scenarioIncremental(hook);
const store = new InboxStore(path!, () => NOW + 60_000);
const service = new InboxService(credentialSource().source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW + 60_000);
for (let i = 0; i < 50; i++) await service.syncNow();
process.send!("finished");
