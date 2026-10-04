// Child process holding the namespace lease, to prove cross-process exclusion.
import { InboxStore, inboxNamespace } from "../../src/inbox-store.js";
import { NOW } from "./gmail-history-fake.js";
const [path] = process.argv.slice(2);
const store = new InboxStore(path!, () => NOW);
const ns = inboxNamespace("agency", "owner", "account-one");
store.ensureNamespace("agency", "owner", "account-one", "owner@example.test");
if (!store.acquireLease(ns, 60 * 60_000)) process.exit(3);
process.send!("holding");
setInterval(() => {}, 1000);
